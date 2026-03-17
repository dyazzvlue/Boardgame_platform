"""
framework/games/manila/plugin.py
将 Manila 游戏注册到 gameplatform 框架。
GAME_CLASS 指向 Manila 目录下 online/adapter.py 中的 ManilaGame。
"""
import sys, os

# 将 Manila 项目目录加入 sys.path
_MANILA_PATH = os.environ.get(
    "MANILA_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "Manila")
)
_real = os.path.realpath(_MANILA_PATH)
if _real not in sys.path:
    sys.path.insert(0, _real)

from online.adapter import ManilaGame  # noqa: E402

GAME_CLASS = ManilaGame
