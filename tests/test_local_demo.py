import importlib.util
import json
import os
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import httpx

from framework.auth.session import verify_password

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools' / 'serve-local-demo.py'
spec = importlib.util.spec_from_file_location('local_demo_tool', SCRIPT)
assert spec is not None and spec.loader is not None
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


class LocalDemoTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / 'demo'

    def rows(self, sql):
        with closing(sqlite3.connect(self.directory / 'blog.db')) as connection:
            return connection.execute(sql).fetchall()

    def test_initialization_creates_expected_articles_and_a_random_private_password(self):
        demo.initialize_demo(self.directory)
        self.assertEqual(self.rows('SELECT published,COUNT(*) FROM posts GROUP BY published'), [(0, 1), (1, 12)])
        self.assertEqual(self.rows('SELECT COUNT(*) FROM categories'), [(2,)])
        self.assertEqual(self.rows('SELECT COUNT(*) FROM tags'), [(2,)])
        username, hashed = self.rows('SELECT username,password_hash FROM admin_users')[0]
        self.assertEqual(username, 'demo-admin')
        password_file = self.directory / 'admin-password.txt'
        password = password_file.read_text().strip()
        self.assertGreaterEqual(len(password), 24)
        self.assertTrue(verify_password(password, hashed))
        self.assertEqual(stat.S_IMODE(password_file.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.directory.stat().st_mode), 0o700)
        self.assertTrue((self.directory / 'uploads').is_dir())
        self.assertEqual((self.directory / demo.MARKER).read_text(), demo.MARKER_CONTENT)

    def test_restart_preserves_articles_uploads_and_password(self):
        demo.initialize_demo(self.directory)
        password = (self.directory / 'admin-password.txt').read_bytes()
        with closing(sqlite3.connect(self.directory / 'blog.db')) as connection, connection:
            connection.execute("UPDATE posts SET title='Edited by user' WHERE id=1")
        image = self.directory / 'uploads' / 'sample.png'
        image.write_bytes(b'local sample')
        demo.initialize_demo(self.directory)
        self.assertEqual(self.rows('SELECT title FROM posts WHERE id=1'), [('Edited by user',)])
        self.assertEqual(self.rows('SELECT COUNT(*) FROM posts'), [(13,)])
        self.assertEqual((self.directory / 'admin-password.txt').read_bytes(), password)
        self.assertEqual(image.read_bytes(), b'local sample')

    def test_new_demo_instances_have_different_credentials(self):
        demo.initialize_demo(self.directory)
        another = Path(self.temporary.name) / 'another'
        demo.initialize_demo(another)
        self.assertNotEqual(
            (self.directory / 'admin-password.txt').read_bytes(),
            (another / 'admin-password.txt').read_bytes(),
        )

    def test_nonempty_unowned_directory_is_not_modified(self):
        self.directory.mkdir()
        database = self.directory / 'blog.db'
        database.write_bytes(b'existing database must not be changed')
        with self.assertRaisesRegex(RuntimeError, 'refusing to overwrite'):
            demo.initialize_demo(self.directory)
        self.assertEqual(database.read_bytes(), b'existing database must not be changed')
        self.assertEqual(list(self.directory.iterdir()), [database])

    def test_invalid_marker_is_rejected(self):
        self.directory.mkdir()
        marker = self.directory / demo.MARKER
        marker.write_text('another application')
        with self.assertRaisesRegex(RuntimeError, 'Unrecognized'):
            demo.initialize_demo(self.directory)
        self.assertEqual(list(self.directory.iterdir()), [marker])

    def test_incomplete_demo_is_not_silently_reseeded(self):
        demo.initialize_demo(self.directory)
        (self.directory / 'admin-password.txt').unlink()
        with self.assertRaisesRegex(RuntimeError, 'Incomplete demo'):
            demo.initialize_demo(self.directory)
        self.assertEqual(self.rows('SELECT COUNT(*) FROM posts'), [(13,)])
        self.assertFalse((self.directory / 'admin-password.txt').exists())

    def test_invalid_port_fails_before_creating_data(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), '--port', '0', '--data-dir', str(self.directory)],
            cwd=self.temporary.name, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn('--port must be between', result.stderr)
        self.assertFalse(self.directory.exists())

    def test_missing_frontend_build_fails_before_creating_data(self):
        with patch.object(demo, 'DIST', Path(self.temporary.name) / 'missing-dist'):
            with patch('sys.stderr'), self.assertRaises(SystemExit) as raised:
                demo.main(['--data-dir', str(self.directory)])
        self.assertEqual(raised.exception.code, 2)
        self.assertFalse(self.directory.exists())

    def test_vscode_task_uses_workspace_and_selected_interpreter(self):
        example = ROOT / 'tools' / 'vscode-tasks.example.json'
        config = json.loads(example.read_text())
        task = config['tasks'][0]
        self.assertEqual(task['label'], 'Local website demo')
        self.assertEqual(task['command'], '${command:python.interpreterPath}')
        self.assertEqual(task['args'][0], '${workspaceFolder}/tools/serve-local-demo.py')
        self.assertEqual(task['options']['cwd'], '${workspaceFolder}')
        self.assertTrue(task['isBackground'])
        self.assertNotIn('/home/', example.read_text())

    def test_running_demo_uses_its_own_database_uploads_and_loopback_origin(self):
        untouched = Path(self.temporary.name) / 'unrelated.db'
        untouched.write_bytes(b'do not change this database')
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'
        environment = os.environ | {
            'GAMEPLATFORM_DB_PATH': str(untouched),
            'PUBLIC_BASE_URL': 'https://not-the-demo.example',
        }
        with tempfile.TemporaryFile(mode='w+') as output:
            process = subprocess.Popen(
                [sys.executable, str(SCRIPT), '--port', str(port), '--data-dir', str(self.directory)],
                cwd=self.temporary.name, env=environment, stdout=output, stderr=subprocess.STDOUT,
            )
            try:
                with httpx.Client(base_url=origin, trust_env=False, timeout=2) as client:
                    deadline = time.monotonic() + 15
                    while True:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            output.seek(0)
                            self.fail(f'Demo did not become ready:\n{output.read()}')
                        try:
                            response = client.get('/')
                        except httpx.TransportError:
                            time.sleep(0.05)
                        else:
                            response.raise_for_status()
                            break
                    self.assertIn('欢迎试用本地站点', response.text)
                    article = client.get('/post/local-preview')
                    self.assertEqual(article.status_code, 200)
                    self.assertIn('<h2>这是独立的本地演示环境</h2>', article.text)
                    self.assertIn(f'{origin}/post/local-preview', article.text)
                    self.assertIn(origin, client.get('/sitemap.xml').text)
                    self.assertEqual(len(client.get('/api/games').json()), 5)
                    password = (self.directory / 'admin-password.txt').read_text().strip()
                    login = client.post('/api/admin/login', json={'username': 'demo-admin', 'password': password})
                    self.assertEqual(login.status_code, 200)
                    image = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
                    uploaded = client.post('/api/admin/upload', files={'file': ('sample.svg', image, 'image/svg+xml')})
                    self.assertEqual(uploaded.status_code, 200)
                    file = uploaded.json()
                    self.assertEqual(client.get(file['url']).content, image)
                    self.assertEqual((self.directory / 'uploads' / file['filename']).read_bytes(), image)
                    self.assertFalse((ROOT / 'framework' / 'static' / 'uploads' / file['filename']).exists())
                    self.assertEqual(untouched.read_bytes(), b'do not change this database')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
            output.seek(0)
            logs = output.read()
            self.assertIn(f'Uvicorn running on {origin}', logs)
            self.assertNotIn(password, logs)


if __name__ == '__main__':
    unittest.main()
