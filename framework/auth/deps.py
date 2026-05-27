"""
framework/auth/deps — FastAPI 依赖注入。
用于保护管理后台路由。
"""
from __future__ import annotations

from fastapi import Request, HTTPException, status

from .session import verify_session


async def get_current_admin(request: Request) -> dict:
    """
    FastAPI 依赖：从 Cookie 或 Authorization 头提取 token 并验证。
    成功返回 {'user_id': int, 'username': str}，失败抛 401。
    """
    token = _extract_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录"
        )
    user = await verify_session(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已过期，请重新登录"
        )
    return user


def _extract_token(request: Request) -> str | None:
    """优先从 Cookie 取 token，其次从 Authorization Bearer 头取。"""
    token = request.cookies.get("session_token")
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None
