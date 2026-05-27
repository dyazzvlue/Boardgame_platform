"""framework/blog — 博客模块。"""
from .routes import router as blog_router
from .admin_routes import router as admin_router

__all__ = ['blog_router', 'admin_router']
