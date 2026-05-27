"""
framework/cli — 命令行管理工具。
用法：python -m framework.cli <command>
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import click


def _run(coro):
    """在同步 CLI 中运行异步函数。"""
    return asyncio.run(coro)


@click.group()
def cli():
    """GamePlatform 管理工具。"""
    pass


@cli.command()
def init_db():
    """初始化数据库（创建表结构）。"""
    async def _init():
        from .db import init_db, close_db
        await init_db()
        await close_db()
        click.echo("✓ 数据库初始化完成")

    _run(_init())


@cli.command()
@click.option("--username", prompt="管理员用户名")
@click.option("--password", prompt="管理员密码", hide_input=True, confirmation_prompt=True)
def create_admin(username: str, password: str):
    """创建管理员账号。"""
    async def _create():
        from .db import init_db as _init_db, get_db, close_db
        from .auth.session import hash_password
        await _init_db()
        db = await get_db()
        existing = await db.execute_fetchall(
            "SELECT id FROM admin_users WHERE username = ?", (username,)
        )
        if existing:
            click.echo(f"✗ 用户名 '{username}' 已存在")
            await close_db()
            sys.exit(1)
        hashed = hash_password(password)
        await db.execute(
            "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
            (username, hashed)
        )
        await db.commit()
        await close_db()
        click.echo(f"✓ 管理员 '{username}' 创建成功")

    _run(_create())


@cli.command()
@click.option("--title", required=True, help="文章标题")
@click.option("--file", "filepath", required=True, type=click.Path(exists=True), help="Markdown 文件路径")
@click.option("--slug", default=None, help="URL slug（默认从标题生成）")
@click.option("--category", default=None, help="分类名称")
@click.option("--tags", default=None, help="标签名称，逗号分隔")
@click.option("--publish/--draft", default=True, help="是否直接发布")
def new_post(title, filepath, slug, category, tags, publish):
    """从 Markdown 文件创建文章。"""
    import re

    async def _create():
        from .db import init_db as _init_db, get_db, close_db
        from datetime import datetime, timezone

        content = Path(filepath).read_text(encoding='utf-8')
        await _init_db()
        db = await get_db()

        final_slug = slug or _slugify(title)

        category_id = None
        if category:
            rows = await db.execute_fetchall("SELECT id FROM categories WHERE name = ?", (category,))
            if rows:
                category_id = rows[0][0]
            else:
                cursor = await db.execute(
                    "INSERT INTO categories (name, slug) VALUES (?, ?)",
                    (category, _slugify(category))
                )
                category_id = cursor.lastrowid

        now = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            """INSERT INTO posts (title, slug, content, category_id, published, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (title, final_slug, content, category_id, int(publish), now, now)
        )
        post_id = cursor.lastrowid

        if tags:
            for tag_name in [t.strip() for t in tags.split(',') if t.strip()]:
                rows = await db.execute_fetchall("SELECT id FROM tags WHERE name = ?", (tag_name,))
                if rows:
                    tag_id = rows[0][0]
                else:
                    c = await db.execute(
                        "INSERT INTO tags (name, slug) VALUES (?, ?)",
                        (tag_name, _slugify(tag_name))
                    )
                    tag_id = c.lastrowid
                await db.execute(
                    "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
                    (post_id, tag_id)
                )

        await db.commit()
        await close_db()
        status = "已发布" if publish else "草稿"
        click.echo(f"✓ 文章 '{title}' 创建成功 (id={post_id}, {status})")

    _run(_create())


@cli.command()
def list_posts():
    """列出所有文章。"""
    async def _list():
        from .db import init_db as _init_db, get_db, close_db
        await _init_db()
        db = await get_db()
        rows = await db.execute_fetchall(
            "SELECT id, title, slug, published, created_at FROM posts ORDER BY created_at DESC"
        )
        await close_db()
        if not rows:
            click.echo("暂无文章")
            return
        click.echo(f"{'ID':<5} {'状态':<8} {'创建时间':<22} {'标题'}")
        click.echo("-" * 60)
        for r in rows:
            status = "✓ 发布" if r[3] else "✗ 草稿"
            click.echo(f"{r[0]:<5} {status:<8} {r[4]:<22} {r[1]}")

    _run(_list())


@cli.command()
@click.argument("post_id", type=int)
@click.confirmation_option(prompt="确认删除？")
def delete_post(post_id):
    """删除指定文章。"""
    async def _delete():
        from .db import init_db as _init_db, get_db, close_db
        await _init_db()
        db = await get_db()
        rows = await db.execute_fetchall("SELECT title FROM posts WHERE id = ?", (post_id,))
        if not rows:
            click.echo(f"✗ 文章 id={post_id} 不存在")
            await close_db()
            sys.exit(1)
        await db.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        await db.commit()
        await close_db()
        click.echo(f"✓ 文章 '{rows[0][0]}' 已删除")

    _run(_delete())


def _slugify(text):
    """简单 slug 生成。"""
    import re
    text = text.lower().strip()
    text = re.sub(r'[^\w\u4e00-\u9fff\-]', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-') or 'untitled'


if __name__ == '__main__':
    cli()
