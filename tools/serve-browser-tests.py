"""Serve disposable fixtures for Playwright; never use the production database."""
from __future__ import annotations

import argparse
import os
import sqlite3
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18574)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='gameplatform-browser-') as directory:
        db_path = Path(directory) / 'blog.db'
        os.environ['GAMEPLATFORM_DB_PATH'] = str(db_path)
        os.environ['PUBLIC_BASE_URL'] = f'http://127.0.0.1:{args.port}'

        from framework.auth.session import hash_password
        from framework.db import _SCHEMA
        import uvicorn

        with sqlite3.connect(db_path) as connection:
            connection.executescript(_SCHEMA)
            connection.execute(
                'INSERT INTO admin_users(username,password_hash) VALUES (?,?)',
                ('browser-admin', hash_password('browser-test-only')),
            )
            connection.execute(
                "INSERT INTO categories(id,name,slug) VALUES (1,'Browser category','browser')",
            )
            for number in range(1, 13):
                connection.execute(
                    """INSERT INTO posts(title,slug,content,category_id,published,created_at,updated_at,cover_image)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (f'Browser article {number:02}', f'browser-article-{number:02}',
                     '# Browser SSR heading\n\nVisible without JavaScript.\n\n'
                     '![sample](/favicon.svg)',
                     1, 1, f'2026-01-{number:02}T00:00:00+00:00',
                     f'2026-01-{number:02}T00:00:00+00:00', '/favicon.svg'),
                )
            connection.execute(
                """INSERT INTO posts(title,slug,content,published)
                   VALUES ('Private draft','browser-private-draft','DRAFT_MUST_NOT_LEAK',0)""",
            )
        uvicorn.run('framework.server:app', host='127.0.0.1', port=args.port, log_level='warning')


if __name__ == '__main__':
    main()
