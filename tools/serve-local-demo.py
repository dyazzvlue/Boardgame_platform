"""Serve a persistent, loopback-only demo with isolated data and uploads."""
from __future__ import annotations

import argparse
import os
import secrets
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'framework' / 'static' / 'dist'
MARKER = '.gameplatform-local-demo'
MARKER_CONTENT = 'gameplatform-local-demo-v1\n'


def initialize_demo(directory: Path) -> None:
    from framework.auth.session import hash_password
    from framework.db import _SCHEMA

    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    database = directory / 'blog.db'
    password_file = directory / 'admin-password.txt'
    marker = directory / MARKER
    if marker.is_file():
        if marker.read_text(encoding='utf-8') != MARKER_CONTENT:
            raise RuntimeError('Unrecognized demo marker; choose a different empty data directory.')
        if not database.is_file() or not password_file.is_file() or not (directory / 'uploads').is_dir():
            raise RuntimeError('Incomplete demo data; restore its files or choose a new empty directory.')
        return
    if any(directory.iterdir()):
        raise RuntimeError('Data directory is not empty and is not owned by this demo; refusing to overwrite it.')

    password = secrets.token_urlsafe(24)
    descriptor = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        stream.write(password + '\n')
    (directory / 'uploads').mkdir(mode=0o700)
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.executescript(_SCHEMA)
        connection.execute(
            'INSERT INTO admin_users(username,password_hash) VALUES(?,?)',
            ('demo-admin', hash_password(password)),
        )
        connection.executemany(
            'INSERT INTO categories(id,name,slug,description) VALUES(?,?,?,?)',
            [(1, '技术记录', 'technology', '本地演示：技术与网站优化'),
             (2, '桌游随笔', 'boardgames', '本地演示：多人联机体验')],
        )
        connection.executemany(
            'INSERT INTO tags(id,name,slug) VALUES(?,?,?)',
            [(1, '本地演示', 'demo'), (2, '网站优化', 'optimization')],
        )
        now = datetime.now(timezone.utc)
        for number in range(1, 13):
            title = '欢迎试用本地站点' if number == 1 else f'演示文章 {number:02}：记录与分享'
            slug = 'local-preview' if number == 1 else f'local-demo-{number:02}'
            content = (
                '## 这是独立的本地演示环境\n\n'
                '这里的文章、账号与上传文件均为演示数据，不会修改正式站点的数据。\n\n'
                '## 可以试试这些功能\n\n'
                '- 刷新文章页面，或禁用 JavaScript 后阅读正文。\n'
                '- 通过分类、标签和分页浏览文章。\n'
                '- 登录管理后台，编辑、预览、发布或撤回文章。\n'
                '- 打开游戏大厅，创建房间、添加 AI、刷新后恢复座位。\n\n'
                '> 修改正文后直接刷新文章地址即可看到结果，不需要重新构建前端。\n\n'
                '| 项目 | 本地演示 |\n| --- | --- |\n'
                '| 正文 | 服务端按请求渲染 |\n| 交互 | Vue 接管首屏数据 |\n'
                '| 图片 | 延迟加载与异步解码 |\n\n'
                '![站点演示图标](/favicon.svg)\n\n'
                f'这是第 {number} 篇示例文章，内容可以在后台自由修改或删除。\n'
            )
            created = (now - timedelta(days=number - 1)).isoformat()
            connection.execute(
                """INSERT INTO posts(id,title,slug,content,cover_image,category_id,
                                     published,pinned,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,1,?,?,?)""",
                (number, title, slug, content, '/favicon.svg',
                 1 if number % 2 else 2, int(number == 1), created, created),
            )
            connection.execute('INSERT INTO post_tags(post_id,tag_id) VALUES(?,1)', (number,))
            if number % 2:
                connection.execute('INSERT INTO post_tags(post_id,tag_id) VALUES(?,2)', (number,))
        connection.execute(
            """INSERT INTO posts(title,slug,content,published)
               VALUES('演示草稿：仅后台可见','local-demo-draft','这篇文章尚未发布。',0)""",
        )
    with marker.open('x', encoding='utf-8') as stream:
        stream.write(MARKER_CONTENT)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000, help='Local HTTP port (default: 8000).')
    parser.add_argument(
        '--data-dir', type=Path, default=ROOT / 'framework' / 'data' / 'local-demo',
        help='Persistent demo data directory; must be empty or initialized by this script.',
    )
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    if not (DIST / 'index.html').is_file() or not (DIST / '.vite' / 'manifest.json').is_file():
        parser.error('Frontend not built. Run: cd frontend && npm ci && npm run build')

    import uvicorn
    from fastapi.staticfiles import StaticFiles
    from starlette.routing import Mount

    directory = args.data_dir.expanduser().resolve()
    os.environ['GAMEPLATFORM_DB_PATH'] = str(directory / 'blog.db')
    os.environ['PUBLIC_BASE_URL'] = f'http://127.0.0.1:{args.port}'
    sys.path.insert(0, str(ROOT))
    try:
        initialize_demo(directory)
    except (OSError, sqlite3.Error, RuntimeError) as error:
        parser.exit(1, f'Unable to initialize local demo: {error}\n')

    from framework.blog import admin_routes
    from framework.server import app

    uploads = directory / 'uploads'
    admin_routes._UPLOAD_DIR = uploads
    app.router.routes.insert(
        0, Mount('/static/uploads', app=StaticFiles(directory=str(uploads)), name='demo_uploads'),
    )
    print(f'Local demo: http://127.0.0.1:{args.port}', flush=True)
    print(f'Database: {directory / "blog.db"}', flush=True)
    print(f'Admin: demo-admin; password file: {directory / "admin-password.txt"}', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='info')


if __name__ == '__main__':
    main()
