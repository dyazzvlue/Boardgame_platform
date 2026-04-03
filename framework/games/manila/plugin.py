"""framework/games/manila/plugin.py"""
import os, sys

_MANILA_PATH = os.environ.get(
    "MANILA_PATH",
    os.path.realpath(os.path.join(os.path.dirname(__file__), "../../../../Manila"))
)
_real = os.path.realpath(_MANILA_PATH)

# ── 保存其他已缓存的同名模块，加载后恢复，防止污染 ─────────────────────────
_CONFLICT_NAMES = ['online', 'online.state', 'online.adapter', 'online._ui_shim', 'constants', 'player', 'game', 'ai', 'board', 'ship', 'market', 'rules', 'logger', 'i18n']
_saved = {k: sys.modules[k] for k in _CONFLICT_NAMES if k in sys.modules}
for k in _CONFLICT_NAMES:
    sys.modules.pop(k, None)
if _real not in sys.path:
    sys.path.insert(0, _real)

from online.adapter import ManilaGame  # noqa: E402

# ── 将本游戏模块移入私有命名空间，恢复其他游戏的缓存 ──────────────────────
for k in list(sys.modules.keys()):
    if k == "online" or k.startswith("online."):
        sys.modules["_manila_" + k] = sys.modules.pop(k)
for k in ['constants', 'player', 'game', 'ai', 'board', 'ship', 'market', 'rules', 'logger', 'i18n']:
    if k in sys.modules:
        sys.modules["_manila_" + k] = sys.modules.pop(k)
sys.modules.update(_saved)

GAME_CLASS = ManilaGame
