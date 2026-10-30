import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from framework import db
from framework.blog.routes import list_posts, list_tags


class BlogQueryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path_patch = patch.object(db, '_DB_PATH', Path(self.directory.name) / 'blog.db')
        self.path_patch.start()
        await db.init_db()
        self.connection = await db.get_db()
        await self.connection.execute(
            "INSERT INTO categories(id,name,slug) VALUES(1,'First','first'),(2,'Second','second')",
        )
        await self.connection.execute(
            "INSERT INTO tags(id,name,slug) VALUES(1,'Shared','shared'),(2,'Draft only','draft')",
        )
        await self.connection.executemany(
            """INSERT INTO posts(id,title,slug,category_id,published,created_at,pinned)
               VALUES(?,?,?,?,?,?,?)""",
            [(idx, f'Post {idx}', f'post-{idx}', 1 if idx <= 30 else 2, 1,
              '2026-01-01T00:00:00+00:00', int(idx == 1)) for idx in range(1, 61)]
            + [(61, 'Draft', 'draft', 1, 0, '2026-01-01T00:00:00+00:00', 0)],
        )
        await self.connection.execute(
            'INSERT INTO post_tags(post_id,tag_id) VALUES(1,1),(2,1),(61,1),(61,2)',
        )
        await self.connection.commit()

    async def asyncTearDown(self):
        await db.close_db()
        self.path_patch.stop()
        self.directory.cleanup()

    async def listing(self, **kwargs):
        trace = []
        await self.connection.set_trace_callback(trace.append)
        try:
            result = await list_posts(page=kwargs.get('page', 1), size=kwargs.get('size', 10),
                                      category=kwargs.get('category'), tag=kwargs.get('tag'))
        finally:
            await self.connection.set_trace_callback(None)
        return result, [query for query in trace if query.lstrip().upper().startswith('SELECT')]

    async def test_query_count_is_constant_for_one_ten_and_fifty_posts(self):
        for size in (1, 10, 50):
            with self.subTest(size=size):
                result, queries = await self.listing(size=size)
                self.assertEqual(len(result['posts']), size)
                self.assertEqual(len(queries), 3)
                self.assertEqual(result['total'], 60)
                if size == 1:
                    self.assertEqual(result['posts'][0]['tags'],
                                     [{'name': 'Shared', 'slug': 'shared'}])

    async def test_empty_page_does_not_run_tag_query(self):
        result, queries = await self.listing(page=100)
        self.assertEqual(result['posts'], [])
        self.assertEqual(result['total'], 60)
        self.assertEqual(len(queries), 2)

    async def test_pinned_order_and_equal_timestamp_pagination_are_stable(self):
        first, _ = await self.listing()
        second, _ = await self.listing(page=2)
        self.assertEqual([post['id'] for post in first['posts']],
                         [1, 60, 59, 58, 57, 56, 55, 54, 53, 52])
        self.assertFalse({post['id'] for post in first['posts']}
                         & {post['id'] for post in second['posts']})

    async def test_category_and_tag_filter_keep_shapes_and_counts(self):
        result, queries = await self.listing(category='first', tag='shared')
        self.assertEqual(result['total'], 2)
        self.assertEqual([post['id'] for post in result['posts']], [1, 2])
        self.assertEqual(len(queries), 3)
        self.assertEqual(result['posts'][0]['category'], {'name': 'First', 'slug': 'first'})
        self.assertEqual(result['page'], 1)
        self.assertEqual(result['size'], 10)

    async def test_public_tag_counts_exclude_draft_associations(self):
        tags = {tag['slug']: tag for tag in await list_tags()}
        self.assertEqual(tags['shared']['post_count'], 2)
        self.assertEqual(tags['draft']['post_count'], 0)

    async def test_actual_default_query_uses_composite_index_without_extra_sort(self):
        _, queries = await self.listing()
        listing_sql = next(query for query in queries if 'ORDER BY p.pinned' in query)
        rows = await self.connection.execute_fetchall('EXPLAIN QUERY PLAN ' + listing_sql)
        plan = ' '.join(row[3] for row in rows)
        self.assertIn('idx_posts_public_order', plan)
        self.assertNotIn('TEMP B-TREE', plan)

    async def test_reinitializing_existing_database_preserves_posts_and_indexes(self):
        await db.close_db()
        await db.init_db()
        connection = await db.get_db()
        rows = await connection.execute_fetchall('SELECT COUNT(*) FROM posts')
        self.assertEqual(rows[0][0], 61)
        indexes = await connection.execute_fetchall("PRAGMA index_list('posts')")
        self.assertIn('idx_posts_public_order', {row[1] for row in indexes})


if __name__ == '__main__':
    unittest.main()
