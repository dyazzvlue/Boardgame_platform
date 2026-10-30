import asyncio
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, closing
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from framework import db
from framework.auth import session
from framework.blog import admin_routes


class BlogAdminTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = session.hash_password("test-password")

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(
            prefix=".blog-admin-tests-", dir=Path(__file__).resolve().parent
        )
        self.addCleanup(self.directory.cleanup)
        self.database_path = Path(self.directory.name) / "blog.db"
        self.path_patch = patch.object(db, "_DB_PATH", self.database_path)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)

        @asynccontextmanager
        async def lifespan(app):
            await db.init_db()
            connection = await db.get_db()
            await connection.execute(
                "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
                ("admin", self.password_hash),
            )
            await connection.commit()
            try:
                yield
            finally:
                await db.close_db()

        app = FastAPI(lifespan=lifespan)
        app.include_router(admin_routes.router)
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.token = self.client.portal.call(session.create_session, 1)
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def request(self, method, path, body=None):
        return self.client.request(
            method, f"/api/admin{path}", json=body, headers=self.headers
        )

    def rows(self, sql, params=()):
        with closing(sqlite3.connect(self.database_path)) as connection:
            return connection.execute(sql, params).fetchall()

    def create_post(self, **fields):
        response = self.request("POST", "/posts", {"title": "Original", **fields})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def create_tag(self, name):
        response = self.request("POST", "/tags", {"name": name})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def assert_client_error(self, response):
        self.assertGreaterEqual(response.status_code, 400, response.text)
        self.assertLess(response.status_code, 500, response.text)

    def test_create_foreign_key_failure_rolls_back_before_category_commit(self):
        tag_id = self.create_tag("valid")
        response = self.request(
            "POST", "/posts",
            {"title": "Must rollback", "tag_ids": [tag_id, 999999]},
        )
        self.assert_client_error(response)
        self.assertEqual(self.rows("SELECT id FROM posts"), [])
        self.assertEqual(self.rows("SELECT * FROM post_tags"), [])
        self.assertEqual(
            self.request("POST", "/categories", {"name": "Later"}).status_code, 200
        )
        self.assertEqual(self.rows("SELECT id FROM posts"), [])
        self.assertEqual(self.rows("SELECT * FROM post_tags"), [])

    def test_failed_create_cannot_leak_through_new_session(self):
        response = self.request(
            "POST", "/posts", {"title": "No leak", "tag_ids": [999999]}
        )
        self.assert_client_error(response)
        login = self.client.post(
            "/api/admin/login",
            json={"username": "admin", "password": "test-password"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM sessions"), [(2,)])
        self.assertEqual(self.rows("SELECT id FROM posts"), [])

    def test_update_foreign_key_failure_restores_article_and_tags(self):
        original_tag = self.create_tag("original")
        replacement_tag = self.create_tag("replacement")
        post_id = self.create_post(content="Original content", tag_ids=[original_tag])
        before = self.request("GET", f"/posts/{post_id}").json()
        response = self.request(
            "PUT", f"/posts/{post_id}",
            {"title": "Changed", "content": "Changed", "tag_ids": [replacement_tag, 999999]},
        )
        self.assert_client_error(response)
        self.assertEqual(self.request("GET", f"/posts/{post_id}").json(), before)
        self.assertEqual(
            self.request("POST", "/categories", {"name": "Next commit"}).status_code, 200
        )
        self.assertEqual(self.request("GET", f"/posts/{post_id}").json(), before)
        self.assertEqual(
            self.rows("SELECT post_id, tag_id FROM post_tags"), [(post_id, original_tag)]
        )

    def test_invalid_category_rolls_back_create_and_update(self):
        response = self.request(
            "POST", "/posts", {"title": "Bad category", "category_id": 999999}
        )
        self.assert_client_error(response)
        post_id = self.create_post()
        response = self.request(
            "PUT", f"/posts/{post_id}", {"title": "Changed", "category_id": 999999}
        )
        self.assert_client_error(response)
        self.assertEqual(self.rows("SELECT title, category_id FROM posts"), [("Original", None)])

    def test_tag_only_update_and_clear_preserve_article_content(self):
        old_tag = self.create_tag("old")
        new_tag = self.create_tag("new")
        content = "  \n    code block\n\ntrailing spaces  \n"
        post_id = self.create_post(content=content, tag_ids=[old_tag])
        response = self.request("PUT", f"/posts/{post_id}", {"tag_ids": [new_tag, new_tag]})
        self.assertEqual(response.status_code, 200, response.text)
        post = self.request("GET", f"/posts/{post_id}").json()
        self.assertEqual(post["content"], content)
        self.assertEqual([tag["id"] for tag in post["tags"]], [new_tag])
        response = self.request("PUT", f"/posts/{post_id}", {"tag_ids": []})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.request("GET", f"/posts/{post_id}").json()["tags"], [])

    def test_create_validation_rejects_malformed_values(self):
        invalid = [
            {}, {"title": " \n\t"}, {"title": None}, {"title": 123},
            {"title": "ok", "tag_ids": [0]},
            {"title": "ok", "tag_ids": [-1]},
            {"title": "ok", "tag_ids": [True]},
            {"title": "ok", "tag_ids": ["1"]},
            {"title": "ok", "tag_ids": None},
            {"title": "ok", "category_id": 0},
            {"title": "ok", "category_id": -1},
            {"title": "ok", "category_id": False},
            {"title": "ok", "category_id": "1"},
            {"title": "ok", "published": "false"},
            {"title": "ok", "pinned": 1},
            {"title": "ok", "content": None},
            {"title": "ok", "slug": "../bad"},
            {"title": "ok", "slug": "bad slug"},
            {"title": "ok", "slug": " \n"},
            {"title": "ok", "slug": None},
        ]
        for body in invalid:
            with self.subTest(body=body):
                self.assert_client_error(self.request("POST", "/posts", body))
        self.assertEqual(self.rows("SELECT id FROM posts"), [])

    def test_patch_rejects_explicit_null_and_blank_fields(self):
        post_id = self.create_post()
        for field in ("title", "slug", "content", "cover_image", "published", "pinned", "tag_ids"):
            with self.subTest(field=field):
                self.assert_client_error(
                    self.request("PUT", f"/posts/{post_id}", {field: None})
                )
        for body in ({"title": "  "}, {"slug": ""}, {"slug": "bad/slug"}, {}, {"tag_ids": [0]}):
            with self.subTest(body=body):
                self.assert_client_error(self.request("PUT", f"/posts/{post_id}", body))
        self.assertEqual(self.rows("SELECT title, slug, content FROM posts"), [("Original", "original", "")])

    def test_frontend_payload_and_category_clearing_remain_supported(self):
        category = self.request("POST", "/categories", {"name": "Board games", "slug": ""}).json()
        tag_id = self.create_tag("桌游")
        content = "\n    markdown code\n\n"
        post_id = self.create_post(
            title="  中文 标题  ", slug="", content=content, cover_image="",
            category_id=category["id"], published=True, pinned=False, tag_ids=[tag_id],
        )
        post = self.request("GET", f"/posts/{post_id}").json()
        self.assertEqual(post["title"], "中文 标题")
        self.assertEqual(post["slug"], "中文-标题")
        self.assertEqual(post["content"], content)
        response = self.request(
            "PUT", f"/posts/{post_id}", {**post, "category_id": None, "tag_ids": [tag_id]}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(self.request("GET", f"/posts/{post_id}").json()["category_id"])

    def test_positive_path_ids(self):
        for path in ("/posts/0", "/posts/-1", "/categories/0", "/tags/-1"):
            with self.subTest(path=path):
                self.assert_client_error(self.request("DELETE", path))
        self.assert_client_error(self.request("GET", "/posts/0"))
        self.assert_client_error(self.request("PUT", "/posts/-1", {"title": "bad"}))
        self.assert_client_error(self.request("PUT", "/categories/-1", {"name": "bad"}))

    def test_category_and_tag_conflicts_are_client_errors(self):
        for endpoint in ("/categories", "/tags"):
            with self.subTest(endpoint=endpoint):
                first = self.request("POST", endpoint, {"name": "First", "slug": "first"})
                self.assertEqual(first.status_code, 200, first.text)
                for body in ({"name": "First", "slug": "different"}, {"name": "Other", "slug": "first"}):
                    response = self.request("POST", endpoint, body)
                    self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(
                    self.request("POST", endpoint, {"name": "Second", "slug": "second"}).status_code, 200
                )
        second_id = self.rows("SELECT id FROM categories WHERE name = 'Second'")[0][0]
        for body in ({"name": "First"}, {"slug": "first"}):
            response = self.request("PUT", f"/categories/{second_id}", body)
            self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.rows("SELECT name, slug FROM categories WHERE id = ?", (second_id,)), [("Second", "second")])

    def test_category_and_tag_validation(self):
        for endpoint in ("/categories", "/tags"):
            for body in ({}, {"name": None}, {"name": " \t"}, {"name": "OK", "slug": "bad/path"}):
                with self.subTest(endpoint=endpoint, body=body):
                    self.assert_client_error(self.request("POST", endpoint, body))
        category_id = self.request("POST", "/categories", {"name": "valid"}).json()["id"]
        for body in ({"name": None}, {"name": " "}, {"slug": None}, {"description": None}, {}):
            with self.subTest(body=body):
                self.assert_client_error(self.request("PUT", f"/categories/{category_id}", body))

    def test_duplicate_post_slug_rolls_back_update(self):
        self.create_post(slug="existing")
        post_id = self.create_post(title="Second", slug="second")
        response = self.request("PUT", f"/posts/{post_id}", {"title": "Changed", "slug": "existing"})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.rows("SELECT title, slug FROM posts WHERE id = ?", (post_id,)), [("Second", "second")])
        response = self.request("POST", "/posts", {"title": "Duplicate", "slug": "existing"})
        self.assertEqual(response.status_code, 409, response.text)

    def test_logout_revokes_bearer_token(self):
        self.assertEqual(self.request("GET", "/me").status_code, 200)
        self.assertEqual(self.request("POST", "/logout").json(), {"ok": True})
        self.assertEqual(self.request("GET", "/me").status_code, 401)
        self.assertEqual(self.rows("SELECT token FROM sessions WHERE token = ?", (self.token,)), [])

    def test_logout_revokes_cookie_token_and_clears_cookie(self):
        login = self.client.post(
            "/api/admin/login", json={"username": "admin", "password": "test-password"}
        )
        self.assertEqual(login.status_code, 200, login.text)
        token = self.client.cookies["session_token"]
        response = self.client.post("/api/admin/logout")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("session_token", self.client.cookies)
        self.assertEqual(
            self.client.get("/api/admin/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401
        )
        self.assertEqual(self.rows("SELECT token FROM sessions WHERE token = ?", (token,)), [])

    def test_login_bcrypt_runs_outside_event_loop(self):
        async def loop_thread():
            return threading.get_ident()

        event_loop_thread = self.client.portal.call(loop_thread)
        verifier_threads = []
        original = session.verify_password

        def verify(password, hashed):
            verifier_threads.append(threading.get_ident())
            return original(password, hashed)

        with patch.object(admin_routes, "verify_password", verify):
            response = self.client.post(
                "/api/admin/login", json={"username": "admin", "password": "test-password"}
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(verifier_threads), 1)
        self.assertNotEqual(verifier_threads[0], event_loop_thread)

    def test_concurrent_failed_and_successful_requests_are_isolated(self):
        def write(index):
            if index % 2:
                return self.request(
                    "POST", "/posts", {"title": f"Failed {index}", "tag_ids": [999999]}
                )
            return self.request("POST", "/categories", {"name": f"Success {index}"})

        with ThreadPoolExecutor(max_workers=8) as executor:
            responses = list(executor.map(write, range(16)))
        for index, response in enumerate(responses):
            if index % 2:
                self.assert_client_error(response)
            else:
                self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM categories"), [(8,)])
        self.assertEqual(self.rows("SELECT id FROM posts"), [])

    def test_inflight_request_is_invisible_and_other_writer_waits_for_rollback(self):
        inserted = threading.Event()
        second_writer_started = threading.Event()
        release = threading.Event()
        writers = []
        original_execute = db.aiosqlite.Connection.execute

        async def execute(connection, sql, parameters=()):
            if sql == "BEGIN IMMEDIATE":
                writers.append(connection)
                if inserted.is_set():
                    second_writer_started.set()
            cursor = await original_execute(connection, sql, parameters)
            if sql.lstrip().startswith("INSERT INTO posts"):
                inserted.set()
                if not await asyncio.to_thread(release.wait, 5):
                    raise AssertionError("Timed out waiting to release failing request")
            return cursor

        with patch.object(db.aiosqlite.Connection, "execute", execute):
            with ThreadPoolExecutor(max_workers=2) as executor:
                failed = executor.submit(
                    self.request, "POST", "/posts",
                    {"title": "In flight", "tag_ids": [999999]},
                )
                try:
                    self.assertTrue(inserted.wait(5))
                    self.assertEqual(self.rows("SELECT id FROM posts"), [])
                    self.assertEqual(self.request("GET", "/posts").json(), [])
                    successful = executor.submit(
                        self.request, "POST", "/categories", {"name": "Waits"}
                    )
                    self.assertTrue(second_writer_started.wait(5))
                    self.assertFalse(successful.done())
                finally:
                    release.set()
                self.assert_client_error(failed.result(timeout=5))
                self.assertEqual(successful.result(timeout=5).status_code, 200)
        self.assertEqual(len(writers), 2)
        self.assertIsNot(writers[0], writers[1])
        self.assertIsNot(writers[0], db._db)
        self.assertIsNot(writers[1], db._db)
        self.assertEqual(self.rows("SELECT id FROM posts"), [])
        self.assertEqual(self.rows("SELECT name FROM categories"), [("Waits",)])

    def test_concurrent_duplicate_slug_has_one_winner(self):
        def create(index):
            return self.request(
                "POST", "/posts", {"title": f"Title {index}", "slug": "one-winner"}
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(create, range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(self.rows("SELECT COUNT(*) FROM posts"), [(1,)])

    def test_cancelled_transaction_rolls_back_and_closes_its_connection(self):
        async def cancel_write():
            reader = await db.get_db()
            with self.assertRaises(asyncio.CancelledError):
                async with db.write_transaction() as writer:
                    self.assertIsNot(writer, reader)
                    await writer.execute(
                        "INSERT INTO categories (name, slug) VALUES ('cancelled', 'cancelled')"
                    )
                    self.assertEqual(await reader.execute_fetchall("SELECT id FROM categories"), [])
                    raise asyncio.CancelledError()
            with self.assertRaisesRegex(ValueError, "no active connection"):
                await writer.execute("SELECT 1")
            self.assertFalse(reader.in_transaction)

        self.client.portal.call(cancel_write)
        self.assertEqual(self.rows("SELECT id FROM categories"), [])
        self.assertEqual(
            self.request("POST", "/categories", {"name": "After cancellation"}).status_code, 200
        )

    def test_session_writers_never_use_shared_reader(self):
        original_execute = db.aiosqlite.Connection.execute
        writers = []

        async def execute(connection, sql, parameters=()):
            if sql.startswith(("INSERT INTO sessions", "DELETE FROM sessions")):
                writers.append(connection)
            return await original_execute(connection, sql, parameters)

        async def session_writes():
            token = await session.create_session(1)
            await session.delete_session(token)
            await session.cleanup_expired_sessions()
            reader = await db.get_db()
            self.assertFalse(reader.in_transaction)
            self.assertTrue(all(writer is not reader for writer in writers))

        with patch.object(db.aiosqlite.Connection, "execute", execute):
            self.client.portal.call(session_writes)
        self.assertEqual(len(writers), 3)
        self.assertEqual(len({id(writer) for writer in writers}), 3)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM sessions"), [(1,)])

    def test_expired_session_is_removed(self):
        async def expire():
            token = await session.create_session(1)
            async with db.write_transaction() as connection:
                await connection.execute(
                    "UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00' WHERE token = ?",
                    (token,),
                )
            return token

        token = self.client.portal.call(expire)
        response = self.client.get(
            "/api/admin/me", headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(self.rows("SELECT token FROM sessions WHERE token = ?", (token,)), [])

    def test_login_validation_and_invalid_credentials(self):
        for body in ({}, {"username": None, "password": "valid"}, {"username": " ", "password": "valid"},
                     {"username": "admin", "password": None}, {"username": "admin", "password": ""}):
            with self.subTest(body=body):
                self.assert_client_error(self.client.post("/api/admin/login", json=body))
        for username, password in (("admin", "incorrect"), ("unknown", "test-password")):
            response = self.client.post(
                "/api/admin/login", json={"username": username, "password": password}
            )
            self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM sessions"), [(1,)])

    def test_non_integrity_database_errors_are_not_reported_as_duplicates(self):
        with patch.object(db.aiosqlite, "connect", side_effect=sqlite3.OperationalError("storage unavailable")):
            for endpoint in ("/categories", "/tags", "/posts"):
                with self.subTest(endpoint=endpoint):
                    with self.assertRaisesRegex(sqlite3.OperationalError, "storage unavailable"):
                        self.request("POST", endpoint, {"title": "valid", "name": "valid"})


if __name__ == "__main__":
    unittest.main()
