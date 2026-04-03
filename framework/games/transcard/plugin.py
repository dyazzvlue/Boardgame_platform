"""framework/games/transcard/plugin.py"""
import os, sys

_TRANSCARD_PATH = os.environ.get(
    "TRANSCARD_PATH",
    os.path.realpath(os.path.join(os.path.dirname(__file__), "../../../../TransCard"))
)
_real = os.path.realpath(_TRANSCARD_PATH)

# ── 保存其他已缓存的同名模块，加载后恢复，防止污染 ─────────────────────────
_CONFLICT_NAMES = ['online', 'online.state', 'online.adapter', 'online._ui_shim', 'constants', 'card', 'player', 'game', 'rules', 'effects', 'ai']
_saved = {k: sys.modules[k] for k in _CONFLICT_NAMES if k in sys.modules}
for k in _CONFLICT_NAMES:
    sys.modules.pop(k, None)
if _real not in sys.path:
    sys.path.insert(0, _real)

from online.adapter import TransCardGame  # noqa: E402

# ── 将本游戏模块移入私有命名空间，恢复其他游戏的缓存 ──────────────────────
for k in list(sys.modules.keys()):
    if k == "online" or k.startswith("online."):
        sys.modules["_transcard_" + k] = sys.modules.pop(k)
for k in ['constants', 'card', 'player', 'game', 'rules', 'effects', 'ai']:
    if k in sys.modules:
        sys.modules["_transcard_" + k] = sys.modules.pop(k)
sys.modules.update(_saved)

GAME_CLASS = TransCardGame
