"""
framework/auth/session — Session 管理（创建、验证、销毁）。
Token 存储在 SQLite sessions 表中。
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import bcrypt

from ..db import get_db

SESSION_EXPIRE_HOURS = 24 * 7  # 7 天


def hash_password(password: str) -> str:
    """哈希密码。"""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """验证密码。"""
    return bcrypt.checkpw(password.encode(), hashed.encode())


async def create_session(user_id: int) -> str:
    """为用户创建新 session，返回 token。"""
    db = await get_db()
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=SESSION_EXPIRE_HOURS)
    await db.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        (token, user_id, expires.isoformat())
    )
    await db.commit()
    return token


async def verify_session(token: str) -> dict | None:
    """验证 token 有效性，返回用户信息或 None。"""
    if not token:
        return None
    db = await get_db()
    row = await db.execute_fetchall(
        """SELECT s.user_id, s.expires_at, u.username
           FROM sessions s JOIN admin_users u ON s.user_id = u.id
           WHERE s.token = ?""",
        (token,)
    )
    if not row:
        return None
    user_id, expires_at, username = row[0]
    expires = datetime.fromisoformat(expires_at)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        await delete_session(token)
        return None
    return {'user_id': user_id, 'username': username}


async def delete_session(token: str) -> None:
    """删除 session（登出）。"""
    db = await get_db()
    await db.execute("DELETE FROM sessions WHERE token = ?", (token,))
    await db.commit()


async def cleanup_expired_sessions() -> None:
    """清理所有过期 session。"""
    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    await db.commit()
