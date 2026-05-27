"""
framework/blog/admin_routes — 博客管理 API（需鉴权）。
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from ..auth.deps import get_current_admin
from ..auth.session import create_session, delete_session, hash_password, verify_password
from ..db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])

_UPLOAD_DIR = Path(__file__).resolve().parent.parent / 'static' / 'uploads'
_ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
_MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


# ── 鉴权 ─────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: dict):
    """管理员登录，返回 session token（同时设置 Cookie）。"""
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not username or not password:
        raise HTTPException(400, "用户名和密码不能为空")

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, password_hash FROM admin_users WHERE username = ?",
        (username,)
    )
    if not rows or not verify_password(password, rows[0][1]):
        raise HTTPException(401, "用户名或密码错误")

    user_id = rows[0][0]
    token = await create_session(user_id)
    response = JSONResponse({"ok": True, "username": username})
    response.set_cookie(
        key="session_token", value=token,
        httponly=True, samesite="lax", max_age=7 * 24 * 3600
    )
    return response


@router.post("/logout")
async def logout(admin: dict = Depends(get_current_admin)):
    """登出，删除 session。"""
    response = JSONResponse({"ok": True})
    response.delete_cookie("session_token")
    return response


@router.get("/me")
async def get_me(admin: dict = Depends(get_current_admin)):
    """获取当前登录管理员信息。"""
    return {"username": admin["username"], "user_id": admin["user_id"]}


# ── 文章管理 ──────────────────────────────────────────────────────────────────

@router.get("/posts")
async def admin_list_posts(admin: dict = Depends(get_current_admin)):
    """列出所有文章（含草稿）。"""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.id, p.title, p.slug, p.published, p.created_at, p.updated_at,
                  c.name as category_name, p.pinned
           FROM posts p
           LEFT JOIN categories c ON p.category_id = c.id
           ORDER BY p.created_at DESC"""
    )
    return [
        {"id": r[0], "title": r[1], "slug": r[2], "published": bool(r[3]),
         "created_at": r[4], "updated_at": r[5], "category": r[6], "pinned": bool(r[7])}
        for r in rows
    ]


@router.get("/posts/{post_id}")
async def admin_get_post(post_id: int, admin: dict = Depends(get_current_admin)):
    """获取单篇文章完整内容（含草稿）。"""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.id, p.title, p.slug, p.content, p.cover_image,
                  p.category_id, p.published, p.created_at, p.updated_at, p.pinned
           FROM posts p WHERE p.id = ?""",
        (post_id,)
    )
    if not rows:
        raise HTTPException(404, "文章不存在")
    r = rows[0]
    tag_rows = await db.execute_fetchall(
        "SELECT t.id, t.name, t.slug FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = ?",
        (post_id,)
    )
    return {
        "id": r[0], "title": r[1], "slug": r[2], "content": r[3],
        "cover_image": r[4], "category_id": r[5], "published": bool(r[6]),
        "created_at": r[7], "updated_at": r[8], "pinned": bool(r[9]),
        "tags": [{"id": t[0], "name": t[1], "slug": t[2]} for t in tag_rows],
    }


@router.post("/posts")
async def create_post(body: dict, admin: dict = Depends(get_current_admin)):
    """创建新文章。"""
    title = str(body.get("title", "")).strip()
    if not title:
        raise HTTPException(400, "标题不能为空")

    slug = body.get("slug") or _slugify(title)
    content = str(body.get("content", ""))
    cover_image = str(body.get("cover_image", ""))
    category_id = body.get("category_id")
    published = bool(body.get("published", False))
    pinned = bool(body.get("pinned", False))
    tag_ids = body.get("tag_ids", [])

    db = await get_db()
    existing = await db.execute_fetchall("SELECT id FROM posts WHERE slug = ?", (slug,))
    if existing:
        raise HTTPException(400, f"slug '{slug}' 已存在")

    now = datetime.now(timezone.utc).isoformat()
    cursor = await db.execute(
        """INSERT INTO posts (title, slug, content, cover_image, category_id, published, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (title, slug, content, cover_image, category_id, int(published), int(pinned), now, now)
    )
    post_id = cursor.lastrowid

    for tid in tag_ids:
        await db.execute("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)", (post_id, tid))

    await db.commit()
    return {"id": post_id, "slug": slug}


@router.put("/posts/{post_id}")
async def update_post(post_id: int, body: dict, admin: dict = Depends(get_current_admin)):
    """更新文章。"""
    db = await get_db()
    existing = await db.execute_fetchall("SELECT id FROM posts WHERE id = ?", (post_id,))
    if not existing:
        raise HTTPException(404, "文章不存在")

    fields = []
    params = []
    for key in ("title", "slug", "content", "cover_image", "category_id"):
        if key in body:
            fields.append(f"{key} = ?")
            params.append(body[key])
    if "published" in body:
        fields.append("published = ?")
        params.append(int(bool(body["published"])))
    if "pinned" in body:
        fields.append("pinned = ?")
        params.append(int(bool(body["pinned"])))

    if not fields:
        raise HTTPException(400, "没有可更新的字段")

    fields.append("updated_at = ?")
    params.append(datetime.now(timezone.utc).isoformat())
    params.append(post_id)

    await db.execute(f"UPDATE posts SET {', '.join(fields)} WHERE id = ?", params)

    if "tag_ids" in body:
        await db.execute("DELETE FROM post_tags WHERE post_id = ?", (post_id,))
        for tid in body["tag_ids"]:
            await db.execute("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)", (post_id, tid))

    await db.commit()
    return {"ok": True}


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, admin: dict = Depends(get_current_admin)):
    """删除文章。"""
    db = await get_db()
    await db.execute("DELETE FROM posts WHERE id = ?", (post_id,))
    await db.commit()
    return {"ok": True}


# ── 分类管理 ──────────────────────────────────────────────────────────────────

@router.post("/categories")
async def create_category(body: dict, admin: dict = Depends(get_current_admin)):
    """创建分类。"""
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "分类名不能为空")
    slug = body.get("slug") or _slugify(name)
    description = str(body.get("description", ""))

    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)",
            (name, slug, description)
        )
        await db.commit()
    except Exception:
        raise HTTPException(400, f"分类 '{name}' 或 slug '{slug}' 已存在")
    return {"id": cursor.lastrowid, "name": name, "slug": slug}


@router.put("/categories/{cat_id}")
async def update_category(cat_id: int, body: dict, admin: dict = Depends(get_current_admin)):
    """更新分类。"""
    db = await get_db()
    fields, params = [], []
    for key in ("name", "slug", "description"):
        if key in body:
            fields.append(f"{key} = ?")
            params.append(body[key])
    if not fields:
        raise HTTPException(400, "没有可更新的字段")
    params.append(cat_id)
    await db.execute(f"UPDATE categories SET {', '.join(fields)} WHERE id = ?", params)
    await db.commit()
    return {"ok": True}


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: int, admin: dict = Depends(get_current_admin)):
    """删除分类。"""
    db = await get_db()
    await db.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    await db.commit()
    return {"ok": True}


# ── 标签管理 ──────────────────────────────────────────────────────────────────

@router.post("/tags")
async def create_tag(body: dict, admin: dict = Depends(get_current_admin)):
    """创建标签。"""
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "标签名不能为空")
    slug = body.get("slug") or _slugify(name)

    db = await get_db()
    try:
        cursor = await db.execute("INSERT INTO tags (name, slug) VALUES (?, ?)", (name, slug))
        await db.commit()
    except Exception:
        raise HTTPException(400, f"标签 '{name}' 或 slug '{slug}' 已存在")
    return {"id": cursor.lastrowid, "name": name, "slug": slug}


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: int, admin: dict = Depends(get_current_admin)):
    """删除标签。"""
    db = await get_db()
    await db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
    await db.commit()
    return {"ok": True}


# ── 图片上传 ──────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(file: UploadFile = File(...), admin: dict = Depends(get_current_admin)):
    """上传图片，返回可访问 URL。"""
    if not file.filename:
        raise HTTPException(400, "文件名不能为空")

    ext = Path(file.filename).suffix.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"不支持的文件类型: {ext}")

    content = await file.read()
    if len(content) > _MAX_FILE_SIZE:
        raise HTTPException(400, f"文件大小超过限制 ({_MAX_FILE_SIZE // 1024 // 1024}MB)")

    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = _UPLOAD_DIR / filename
    filepath.write_bytes(content)

    return {"url": f"/static/uploads/{filename}", "filename": filename}


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _slugify(text: str) -> str:
    """简单 slug 生成：保留中文、英文、数字、连字符。"""
    text = text.lower().strip()
    text = re.sub(r'[^\w\u4e00-\u9fff\-]', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-') or 'untitled'
