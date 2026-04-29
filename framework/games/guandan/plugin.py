"""framework/games/guandan/plugin.py"""
import os, sys

_GUANDAN_PATH = os.environ.get(
    "GUANDAN_PATH",
    os.path.realpath(os.path.join(os.path.dirname(__file__), "../../../../GuanDan")))
_real = os.path.realpath(_GUANDAN_PATH)
_parent = os.path.dirname(_real)

_CONFLICT_NAMES = [
    'GuanDan', 'GuanDan.constants', 'GuanDan.card', 'GuanDan.player',
    'GuanDan.rules', 'GuanDan.game', 'GuanDan.ai', 'GuanDan.ui',
    'GuanDan.online', 'GuanDan.online.adapter', 'GuanDan.online.state',
]
_saved = {k: sys.modules[k] for k in _CONFLICT_NAMES if k in sys.modules}
for k in _CONFLICT_NAMES:
    sys.modules.pop(k, None)
if _parent not in sys.path:
    sys.path.insert(0, _parent)

from GuanDan.online.adapter import GuandanGame  # noqa: E402

for k in list(sys.modules.keys()):
    if k == "GuanDan" or k.startswith("GuanDan."):
        sys.modules["_guandan_" + k] = sys.modules.pop(k)
sys.modules.update(_saved)

GAME_CLASS = GuandanGame
