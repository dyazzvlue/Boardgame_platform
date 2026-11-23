import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from framework import server


class LearningSiteTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='learning-route-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / 'public'
        self.root.mkdir()
        (self.root / 'index.html').write_text('<h1>Learning</h1>', encoding='utf-8')
        (self.root / 'data.js').write_text('window.learningData = {};', encoding='utf-8')
        self.path_patch = patch.object(server, '_LEARNING', self.root)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.client = TestClient(server.app)
        self.addCleanup(self.client.close)

    def test_root_redirect_and_static_content(self):
        redirect = self.client.get('/learn', follow_redirects=False)
        self.assertEqual(redirect.status_code, 307)
        self.assertEqual(redirect.headers['location'], '/learn/')
        response = self.client.get('/learn/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('<h1>Learning</h1>', response.text)
        self.assertEqual(response.headers['cache-control'], 'no-cache')
        script = self.client.get('/learn/data.js')
        self.assertEqual(script.status_code, 200)
        self.assertIn('javascript', script.headers['content-type'])
        self.assertEqual(script.headers['x-content-type-options'], 'nosniff')

    def test_missing_and_private_paths_are_not_spa_fallbacks(self):
        for path in ['missing.html', '.git/config', 'resources/05_works/resume_draft.docx', '../private.txt']:
            with self.subTest(path=path):
                response = self.client.get('/learn/' + path.replace('..', '%2e%2e'))
                self.assertEqual(response.status_code, 404)

    def test_symlinks_cannot_escape_public_directory(self):
        private = Path(self.directory.name) / 'private.txt'
        private.write_text('not public', encoding='utf-8')
        (self.root / 'escape.txt').symlink_to(private)
        self.assertEqual(self.client.get('/learn/escape.txt').status_code, 404)

    def test_missing_build_has_an_explicit_failure(self):
        with patch.object(server, '_LEARNING', self.root / 'missing'):
            self.assertEqual(self.client.get('/learn/').status_code, 503)


if __name__ == '__main__':
    unittest.main()
