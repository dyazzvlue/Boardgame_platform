"""
framework/blog/routes — 博客公开 API（只读）。
所有访客可访问，无需鉴权。
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from ..db import get_db

router = APIRouter(prefix="/api/blog", tags=["blog"])


@router.get("/posts")
async def list_posts(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    category: str | None = None,
    tag: str | None = None,
):
    """分页获取已发布文章列表。支持按分类 slug 或标签 slug 筛选。"""
    db = await get_db()
    offset = (page - 1) * size

    conditions = ["p.published = 1"]
    params: list = []

    if category:
        conditions.append("c.slug = ?")
        params.append(category)

    if tag:
        conditions.append(
            "EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id = t.id "
            "WHERE pt.post_id = p.id AND t.slug = ?)"
        )
        params.append(tag)

    where = " AND ".join(conditions)

    count_sql = f"""
        SELECT COUNT(*) FROM posts p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE {where}
    """
    rows = await db.execute_fetchall(count_sql, params)
    total = rows[0][0]

    data_sql = f"""
        SELECT p.id, p.title, p.slug, p.cover_image, p.created_at, p.updated_at,
               c.name as category_name, c.slug as category_slug, p.pinned
        FROM posts p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE {where}
        ORDER BY p.pinned DESC, p.created_at DESC
        LIMIT ? OFFSET ?
    """
    rows = await db.execute_fetchall(data_sql, params + [size, offset])

    posts = []
    for r in rows:
        post_id = r[0]
        tag_rows = await db.execute_fetchall(
            "SELECT t.name, t.slug FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = ?",
            (post_id,)
        )
        posts.append({
            "id": r[0], "title": r[1], "slug": r[2],
            "cover_image": r[3], "created_at": r[4], "updated_at": r[5],
            "category": {"name": r[6], "slug": r[7]} if r[6] else None,
            "tags": [{"name": t[0], "slug": t[1]} for t in tag_rows],
            "pinned": bool(r[8]),
        })

    return {"posts": posts, "total": total, "page": page, "size": size}


@router.get("/posts/{slug}")
async def get_post(slug: str):
    """获取单篇文章详情（仅已发布）。"""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.id, p.title, p.slug, p.content, p.cover_image,
                  p.created_at, p.updated_at,
                  c.name as category_name, c.slug as category_slug
           FROM posts p
           LEFT JOIN categories c ON p.category_id = c.id
           WHERE p.slug = ? AND p.published = 1""",
        (slug,)
    )
    if not rows:
        return JSONResponse({"error": "文章不存在"}, status_code=404)
    r = rows[0]
    post_id = r[0]
    tag_rows = await db.execute_fetchall(
        "SELECT t.name, t.slug FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = ?",
        (post_id,)
    )
    return {
        "id": r[0], "title": r[1], "slug": r[2], "content": r[3],
        "cover_image": r[4], "created_at": r[5], "updated_at": r[6],
        "category": {"name": r[7], "slug": r[8]} if r[7] else None,
        "tags": [{"name": t[0], "slug": t[1]} for t in tag_rows],
    }


@router.get("/categories")
async def list_categories():
    """获取所有分类及其文章数量。"""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT c.id, c.name, c.slug, c.description,
                  COUNT(p.id) as post_count
           FROM categories c
           LEFT JOIN posts p ON p.category_id = c.id AND p.published = 1
           GROUP BY c.id
           ORDER BY c.name"""
    )
    return [
        {"id": r[0], "name": r[1], "slug": r[2], "description": r[3], "post_count": r[4]}
        for r in rows
    ]


@router.get("/tags")
async def list_tags():
    """获取所有标签及其文章数量。"""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT t.id, t.name, t.slug, COUNT(pt.post_id) as post_count
           FROM tags t
           LEFT JOIN post_tags pt ON pt.tag_id = t.id
           LEFT JOIN posts p ON pt.post_id = p.id AND p.published = 1
           GROUP BY t.id
           ORDER BY t.name"""
    )
    return [
        {"id": r[0], "name": r[1], "slug": r[2], "post_count": r[3]}
        for r in rows
    ]
