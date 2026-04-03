"""
framework/games/transcard/plugin.py
将 TransCard 游戏注册到 gameplatform 框架。
"""
import sys, os

_TRANSCARD_PATH = os.environ.get(
    "TRANSCARD_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "TransCard")
)
_real = os.path.realpath(_TRANSCARD_PATH)
if _real not in sys.path:
    sys.path.insert(0, _real)

from online.adapter import TransCardGame  # noqa: E402

GAME_CLASS = TransCardGame
