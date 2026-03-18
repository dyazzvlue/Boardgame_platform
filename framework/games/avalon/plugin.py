"""framework/games/avalon/plugin.py — 阿瓦隆游戏插件"""
import os, sys

_AVALON_PATH = os.environ.get("AVALON_PATH",
    os.path.realpath(os.path.join(os.path.dirname(__file__), "../../../../Avalon")))

# ── 1. 保存其他游戏（如 Manila）已缓存的同名模块，加载完后恢复 ─────────────
_CONFLICT_NAMES = [
    "constants", "player", "game", "ai", "board", "ship", "market",
    "rules", "logger",
    "online", "online.state", "online.adapter", "online._ui_shim",
]
_saved = {k: sys.modules[k] for k in _CONFLICT_NAMES if k in sys.modules}

# ── 2. 清除冲突缓存，把 Avalon 路径插到最前 ───────────────────────────────
for k in _CONFLICT_NAMES:
    sys.modules.pop(k, None)
if _AVALON_PATH not in sys.path:
    sys.path.insert(0, _AVALON_PATH)

# ── 3. 加载 Avalon 适配器（Avalon 各模块以 Python 对象形式驻留内存）─────────
from online.adapter import AvalonGameAdapter  # noqa: E402

# ── 4. 把 Avalon 的通用名模块移到私有命名空间，避免污染 online.* 等 ─────────
for k in list(sys.modules.keys()):
    if k == "online" or k.startswith("online."):
        sys.modules["_avalon_" + k] = sys.modules.pop(k)
for k in ["constants", "player", "game", "ai"]:
    if k in sys.modules:
        sys.modules["_avalon_" + k] = sys.modules.pop(k)

# ── 5. 恢复其他游戏的同名模块（Manila 等继续正常工作）────────────────────
sys.modules.update(_saved)

GAME_CLASS = AvalonGameAdapter
