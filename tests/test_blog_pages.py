import json
import re
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
from fastapi import HTTPException

from framework import db, server
from framework.blog import admin_routes
from framework.blog.pages import public_base_url
from framework.blog.rendering import image_url, render_markdown


class Document(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class BlogPageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path_patch = patch.object(db, '_DB_PATH', Path(self.directory.name) / 'blog.db')
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.environment = patch.dict('os.environ', {'PUBLIC_BASE_URL': 'https://blog.example.com'})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = TestClient(server.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.client.portal.call(self.seed)

    async def seed(self):
        connection = await db.get_db()
        await connection.execute("INSERT INTO categories(id,name,slug) VALUES(1,'分类','分类')")
        await connection.execute("INSERT INTO tags(id,name,slug) VALUES(1,'公共标签','public')")
        await connection.executemany(
            """INSERT INTO posts(id,title,slug,content,cover_image,category_id,published,created_at,updated_at)
               VALUES(?,?,?,?,?,1,?,?,?)""",
            [(number, f'Article {number}', f'article-{number}', '## Readable heading\n\nActual body.',
              '/favicon.svg', 1, '2026-01-01T00:00:00+00:00', '2026-01-02T00:00:00+00:00')
             for number in range(1, 13)]
            + [(13, 'Private title', 'private', 'SECRET_DRAFT', '', 0, '2026-01-01', '2026-01-01')],
        )
        await connection.execute('INSERT INTO post_tags(post_id,tag_id) VALUES(1,1)')
        await connection.commit()

    def mutate(self, sql, params=()):
        async def run():
            async with db.write_transaction() as connection:
                await connection.execute(sql, params)
        self.client.portal.call(run)

    def bootstrap(self, html):
        match = re.search(r'<script id="blog-bootstrap" type="application/json">(.*?)</script>', html, re.DOTALL)
        self.assertIsNotNone(match)
        return json.loads(match[1])

    def test_article_html_contains_body_metadata_and_bootstrap_without_api_fetch(self):
        response = self.client.get('/post/article-1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertIn('<h1>Article 1</h1>', response.text)
        self.assertIn('<h2>Readable heading</h2>', response.text)
        self.assertIn('<p>Actual body.</p>', response.text)
        elements = Document(response.text).elements
        self.assertIn(('link', {'rel': 'canonical', 'data-blog-meta': None,
                               'href': 'https://blog.example.com/post/article-1'}), elements)
        self.assertTrue(any(tag == 'meta' and attrs.get('property') == 'og:title'
                            and attrs['content'].startswith('Article 1') for tag, attrs in elements))
        post = self.bootstrap(response.text)['post']
        self.assertEqual(post['content_html'], self.client.get('/api/blog/posts/article-1').json()['content_html'])
        self.assertEqual(post['description'], 'Readable heading Actual body.')
        self.assertTrue(any(tag == 'link' and 'PostDetail-' in attrs.get('href', '') for tag, attrs in elements))

    def test_home_category_filter_and_pagination_are_rendered_and_bootstrapped(self):
        response = self.client.get('/?page=2')
        self.assertEqual(response.status_code, 200)
        data = self.bootstrap(response.text)
        self.assertEqual([post['id'] for post in data['listing']['posts']], [2, 1])
        self.assertIn('href="/?page=1"', response.text)
        self.assertIn('href="/post/article-1"', response.text)
        category = self.client.get('/category/%E5%88%86%E7%B1%BB')
        self.assertEqual(category.status_code, 200)
        self.assertIn('分类: 分类', category.text)
        self.assertEqual(self.bootstrap(category.text)['listing']['total'], 12)
        tagged = self.bootstrap(self.client.get('/?tag=public').text)
        self.assertEqual(tagged['listing']['total'], 1)

    def test_drafts_missing_articles_and_missing_categories_have_real_404(self):
        for path in ['/post/private', '/post/missing', '/category/missing']:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertIn('noindex, nofollow', response.text)
                self.assertNotIn('SECRET_DRAFT', response.text)
                self.assertNotIn('Private title', response.text)
        self.assertEqual(self.client.get('/api/blog/posts/private').status_code, 404)

    def test_ssr_query_normalization_matches_client_for_malformed_and_repeated_values(self):
        for query in ['page=0', 'page=01', 'page=1e2', 'page=9007199254740992', 'page=2&page=3']:
            with self.subTest(query=query):
                payload = self.bootstrap(self.client.get('/?' + query).text)
                self.assertEqual(payload['listing']['page'], 1)
        payload = self.bootstrap(self.client.get('/?tag=public&tag=missing').text)
        self.assertEqual(payload['listing']['total'], 12)

    def test_mutations_unpublish_and_delete_have_no_stale_html_or_sitemap(self):
        self.assertIn('Actual body.', self.client.get('/post/article-1').text)
        self.mutate('UPDATE posts SET content=?,title=? WHERE id=1', ('## New body', 'New title'))
        updated = self.client.get('/post/article-1').text
        self.assertIn('<h2>New body</h2>', updated)
        self.assertNotIn('Actual body.', updated)
        self.assertIn('New title', updated)
        self.mutate('UPDATE posts SET published=0 WHERE id=1')
        self.assertEqual(self.client.get('/post/article-1').status_code, 404)
        self.assertNotIn('/post/article-1<', self.client.get('/sitemap.xml').text)
        self.mutate('DELETE FROM posts WHERE id=2')
        self.assertEqual(self.client.get('/post/article-2').status_code, 404)

    def test_sitemap_and_robots_only_advertise_configured_public_urls(self):
        response = self.client.get('/sitemap.xml', headers={'host': 'untrusted.example'})
        self.assertEqual(response.status_code, 200)
        root = ET.fromstring(response.content)
        locations = [element.text for element in root.findall('.//{*}loc')]
        self.assertIn('https://blog.example.com/post/article-1', locations)
        self.assertIn('https://blog.example.com/category/%E5%88%86%E7%B1%BB', locations)
        self.assertFalse(any('private' in path or 'untrusted' in path for path in locations))
        robots = self.client.get('/robots.txt').text
        self.assertIn('Disallow: /admin', robots)
        self.assertIn('Sitemap: https://blog.example.com/sitemap.xml', robots)
        with patch.dict('os.environ', {'PUBLIC_BASE_URL': ''}):
            self.assertEqual(self.client.get('/sitemap.xml').status_code, 503)
            self.assertNotIn('Sitemap:', self.client.get('/robots.txt').text)

    def test_script_end_tags_and_titles_cannot_escape_bootstrap_or_metadata(self):
        title = '"><script>window.pwned=1</script>'
        content = '## Safe\n\n<img src="/favicon.svg" onerror="bad()">\n\n</script><script>bad()</script>'
        self.mutate('UPDATE posts SET title=?,content=? WHERE id=1', (title, content))
        response = self.client.get('/post/article-1')
        payload = self.bootstrap(response.text)
        self.assertEqual(payload['post']['title'], title)
        self.assertEqual(payload['post']['content'], content)
        elements = Document(response.text).elements
        self.assertFalse(any('onerror' in attrs for _, attrs in elements))
        self.assertFalse(any(tag == 'script' and not attrs.get('type') for tag, attrs in elements))
        self.assertIn('&lt;script&gt;', response.text)

    def test_images_reserve_cover_space_and_markdown_images_are_lazy(self):
        self.mutate('UPDATE posts SET content=? WHERE id=1', ('![alt](/favicon.svg)',))
        elements = Document(self.client.get('/post/article-1').text).elements
        images = [attrs for tag, attrs in elements if tag == 'img']
        self.assertEqual(images[0]['fetchpriority'], 'high')
        self.assertEqual((images[0]['width'], images[0]['height']), ('800', '400'))
        self.assertEqual(images[1]['loading'], 'lazy')
        self.assertEqual(images[1]['decoding'], 'async')
        cards = Document(self.client.get('/').text).elements
        self.assertTrue(all(attrs['loading'] == 'lazy' and attrs['width'] == '160'
                            for tag, attrs in cards if tag == 'img'))

    def test_spa_routes_clear_article_metadata_and_keep_game_api_working(self):
        for path in ['/game', '/admin/login']:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn('noindex, nofollow', response.text)
            self.assertNotIn('BlogPosting', response.text)
        self.assertEqual(self.client.get('/api/games').status_code, 200)
        self.assertEqual(self.client.get('/api/unknown').status_code, 404)

    def test_legacy_sqlite_timestamps_are_utc_in_metadata_and_sitemap(self):
        self.mutate("UPDATE posts SET updated_at='2026-01-03 04:05:06' WHERE id=1")
        payload = self.bootstrap(self.client.get('/post/article-1').text)
        self.assertEqual(payload['meta']['modified'], '2026-01-03T04:05:06+00:00')
        self.assertIn('2026-01-03T04:05:06+00:00', self.client.get('/sitemap.xml').text)


class MarkdownTests(unittest.TestCase):
    def test_sanitization_keeps_markdown_features_without_executable_html(self):
        html = render_markdown(
            '# Heading\n\n~~deleted~~\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n'
            '<img src="/ok.png" width="640" height="480" onerror="bad()">'
            '<img src="javascript:bad()"><svg onload="bad()"></svg>'
            '\n\n[bad](javascript:alert(1))\n\n```\n<script>literal</script>\n```',
        )
        self.assertIn('<table>', html)
        self.assertIn('<s>deleted</s>', html)
        elements = Document(html).elements
        self.assertFalse(any(tag in {'script', 'svg'} or 'onerror' in attrs for tag, attrs in elements))
        images = [attrs for tag, attrs in elements if tag == 'img']
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]['width'], '640')
        self.assertEqual(images[0]['loading'], 'lazy')
        self.assertIn('&lt;script&gt;literal&lt;/script&gt;', html)

    def test_image_urls_reject_executable_and_protocol_relative_values(self):
        for value in ['javascript:bad()', 'data:image/svg+xml,bad', '//bad.test/a', '\\bad',
                      'https://a.test/\nb', 'https://images.example.com:bad/a.png', 'http:images.example.com/a.png']:
            self.assertEqual(image_url(value), '')
        for value in ['/static/uploads/a.png', 'https://images.example.com/a.png']:
            self.assertEqual(image_url(value), value)

    def test_public_base_url_rejects_bad_configuration(self):
        for value in ['javascript:bad', 'https://a.test/path', 'https://u:p@a.test', 'https://a.test?x=1',
                      'https://a.test#x', 'https://a.test:wrong', 'https://a.test/\nunsafe']:
            with patch.dict('os.environ', {'PUBLIC_BASE_URL': value}), self.assertRaises(ValueError):
                public_base_url()


class BlogImageUploadTests(unittest.IsolatedAsyncioTestCase):
    async def test_oversized_upload_reads_only_the_limit_plus_one_byte(self):
        file = Mock(filename='cover.png', read=AsyncMock(return_value=b'x' * 11))
        with patch.object(admin_routes, '_MAX_FILE_SIZE', 10):
            with self.assertRaises(HTTPException) as raised:
                await admin_routes.upload_file(file=file, admin={})
        self.assertEqual(raised.exception.status_code, 400)
        file.read.assert_awaited_once_with(11)

    async def test_valid_image_is_preserved_and_returns_a_public_url(self):
        content = b'original image bytes'
        file = Mock(filename='cover.png', read=AsyncMock(return_value=content))
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(admin_routes, '_UPLOAD_DIR', Path(directory)):
                result = await admin_routes.upload_file(file=file, admin={})
            self.assertEqual((Path(directory) / result['filename']).read_bytes(), content)
            self.assertEqual(result['url'], '/static/uploads/' + result['filename'])


if __name__ == '__main__':
    unittest.main()
