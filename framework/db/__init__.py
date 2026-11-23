"""
framework/db — SQLite 数据库管理模块。
提供异步连接管理与应用生命周期钩子。
"""
from __future__ import annotations

import aiosqlite
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

_DB_PATH = Path(os.environ.get(
    'GAMEPLATFORM_DB_PATH', Path(__file__).resolve().parent.parent / 'data' / 'blog.db',
))
_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    """获取共享读连接；CLI 仍可在此连接上执行自己的写入并提交。"""
    if _db is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _db


@asynccontextmanager
async def write_transaction() -> AsyncIterator[aiosqlite.Connection]:
    """每次写入使用独立连接，成功提交，异常或取消时回滚并关闭。"""
    await get_db()
    db = await aiosqlite.connect(str(_DB_PATH))
    try:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute("BEGIN IMMEDIATE")
        yield db
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    finally:
        await db.close()


async def init_db() -> None:
    """应用启动时调用：打开数据库连接并建表。"""
    global _db
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _db = await aiosqlite.connect(str(_DB_PATH))
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.execute("PRAGMA foreign_keys=ON")
    await _create_tables(_db)
    await _db.commit()


async def close_db() -> None:
    """应用关闭时调用：关闭数据库连接。"""
    global _db
    if _db:
        await _db.close()
        _db = None


async def _create_tables(db: aiosqlite.Connection) -> None:
    """建表（幂等）。"""
    await db.executescript(_SCHEMA)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS admin_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    slug        TEXT    NOT NULL UNIQUE,
    description TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    slug        TEXT    NOT NULL UNIQUE,
    content     TEXT    NOT NULL DEFAULT '',
    cover_image TEXT    NOT NULL DEFAULT '',
    category_id INTEGER,
    published   INTEGER NOT NULL DEFAULT 0,
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE,
    slug TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL,
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts(pinned);
CREATE INDEX IF NOT EXISTS idx_posts_public_order
    ON posts(published, pinned DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category_public_order
    ON posts(category_id, published, pinned DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag_post ON post_tags(tag_id, post_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
"""
