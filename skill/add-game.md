# GamePlatform — 接入新游戏

## 完整清单

### 1. 游戏 repo 侧（`online/` 目录）

- [ ] `online/__init__.py` — 空文件
- [ ] `online/state.py` — 序列化辅助函数（将游戏内部对象转为 JSON-safe dict）
- [ ] `online/adapter.py` — `class MyGame(AbstractGame)` 完整实现

### 2. gameplatform 框架侧

- [ ] `framework/games/<game_id>/__init__.py` — 空文件
- [ ] `framework/games/<game_id>/plugin.py` — 注册 `GAME_CLASS`
- [ ] `framework/games/__init__.py` — 在 `_GAME_REGISTRY` 中添加条目（含 name / min_players / max_players / cover / module）
- [ ] `framework/static/games/<game_id>.js` — `class MyGameRenderer`，文件末尾注册到 `_RENDERERS`

### 3. 部署侧

- [ ] 启动命令中设置 `<GAME_ID大写>_PATH` 环境变量（或用 `tools/start.sh`）
- [ ] `tools/games.conf` 末尾添加一行：`<game_id>  <ENV_VAR>  <DirName>  <git_url_or_local>`

---

## 代码模板

### `online/adapter.py`

```python
try:
    from framework.core.base_game import AbstractGame
except ImportError:
    class AbstractGame:
        bridge = None
        def setup(self, names, flags): pass
        def run(self): pass
        def get_state(self): return {}
        def on_player_disconnected(self, idx): pass

class MyGame(AbstractGame):
    GAME_ID      = "mygame"
    GAME_NAME    = "我的游戏"
    MIN_PLAYERS  = 2
    MAX_PLAYERS  = 4
    COVER_IMAGE  = ""

    def setup(self, player_names: list, human_flags: list) -> None:
        self._names = player_names
        self._is_human = human_flags

    def run(self) -> None:
        # 同步执行，在 daemon 线程中运行
        # ask() 返回 None 时必须处理（超时 / 离线）
        val = self.bridge.ask(0, "my_action", {"choices": [1, 2, 3]})
        if val is None:
            val = 1  # 默认值
        self.bridge.log(f"玩家选择了 {val}")
        self.bridge.broadcast_state()
        self.bridge.broadcast_game_over({"winner": self._names[0]})

    def get_state(self) -> dict:
        return {
            "phase": "playing",
            "players": [
                {"name": n, "is_human": h}
                for n, h in zip(self._names, self._is_human)
            ]
        }

    def on_player_disconnected(self, player_idx: int) -> None:
        if player_idx < len(self._is_human):
            self._is_human[player_idx] = False
```

---

### `framework/games/<game_id>/plugin.py`

> ⚠ 必须使用模块隔离模式，否则多游戏并存时 `sys.modules` 会互相污染导致 ImportError。

```python
import os, sys

_PATH = os.environ.get(
    "MYGAME_PATH",
    os.path.realpath(os.path.join(os.path.dirname(__file__), "../../../../MyGame"))
)
_real = os.path.realpath(_PATH)

# 1. 保存其他游戏已缓存的同名模块
_CONFLICT_NAMES = [
    "online", "online.state", "online.adapter", "online._ui_shim",
    "constants", "player", "game", "ai",  # 按实际顶层模块列出
]
_saved = {k: sys.modules[k] for k in _CONFLICT_NAMES if k in sys.modules}
for k in _CONFLICT_NAMES:
    sys.modules.pop(k, None)
if _real not in sys.path:
    sys.path.insert(0, _real)

# 2. 加载本游戏
from online.adapter import MyGame  # noqa: E402

# 3. 移入私有命名空间，避免污染后续游戏
for k in list(sys.modules.keys()):
    if k == "online" or k.startswith("online."):
        sys.modules[f"_mygame_{k}"] = sys.modules.pop(k)
for k in ["constants", "player", "game", "ai"]:
    if k in sys.modules:
        sys.modules[f"_mygame_{k}"] = sys.modules.pop(k)

# 4. 恢复其他游戏的缓存
sys.modules.update(_saved)

GAME_CLASS = MyGame
```

---

### `framework/games/__init__.py` 注册

```python
_GAME_REGISTRY: dict[str, dict] = {
    'manila': {
        'module':      'framework.games.manila.plugin',
        'name':        '马尼拉',
        'min_players': 3,
        'max_players': 5,
        'cover':       '',
    },
    # ↓ 添加新游戏
    'mygame': {
        'module':      'framework.games.mygame.plugin',
        'name':        '我的游戏',
        'min_players': 2,
        'max_players': 4,
        'cover':       '',
    },
}
```

`list_games()` 直接从 `_GAME_REGISTRY` 构造列表，**不做任何 import**；
`get_game_class(game_id)` 只在游戏真正启动时才 `importlib.import_module()`。

---

### `framework/static/games/<game_id>.js`

```javascript
class MyGameRenderer {
    /**
     * @param {HTMLElement} container  渲染目标容器
     * @param {number}      myIdx      本玩家座位号（0-based），观战者为 -1
     * @param {Function}    respond    (kind, value) => void
     */
    constructor(container, myIdx, respond) {
        this._el = container;
        this._myIdx = myIdx;
        this._respond = respond;
    }

    onState(ctx) {
        // 渲染完整游戏状态
        this._el.innerHTML = `<pre>${JSON.stringify(ctx, null, 2)}</pre>`;
    }

    onRequest(playerIdx, kind, data) {
        if (playerIdx !== this._myIdx) return;
        // 根据 kind 渲染操作 UI，完成后调用 this._respond(kind, value)
    }

    onGameOver(result) {
        this._el.innerHTML = `<h2>游戏结束</h2><pre>${JSON.stringify(result, null, 2)}</pre>`;
    }
}
```

---

### 游戏 JS 末尾注册渲染器

```javascript
// 在 class MyGameRenderer { ... } 定义之后，文件末尾添加：
if (typeof _RENDERERS !== 'undefined') _RENDERERS['mygame'] = MyGameRenderer;
```

`lobby.js` 的 `initGameUI(gameId)` 会自动从 `_RENDERERS[gameId]` 取类并实例化，
**无需修改 `lobby.js`，也无需在 `index.html` 中添加 `<script>` 标签**（懒加载自动处理）。

---

## Incan Gold 接入实例

下面是这次接入 `incan_gold` 时总结出来的一套最小可行模式，适合给类似“规则集中、前端按钮很少”的桌游复用。

### 目录落点

```text
IncanGold/
├── game.py
├── player.py
├── constants.py
├── ui.py
├── gui_main.py
├── gui/
│   ├── bridge.py
│   └── renderer.py
└── online/
    ├── adapter.py
    ├── state.py
    └── _ui_shim.py

gameplatform/framework/games/incan_gold/
└── plugin.py

gameplatform/framework/static/games/
└── incan_gold.js
```

### 适配器设计

Incan Gold 采用的是“核心规则只依赖 `ui` 模块”的模式：

- CLI 模式：真实使用 `ui.py`
- GUI 模式：在 `gui_main.py` 中把 `sys.modules['ui']` 指向 `gui.bridge`
- 联机模式：在 `online/adapter.py` 中把 `sys.modules['ui']` 指向 `online._ui_shim`

这种做法的好处是：

- `game.py` 不需要感知 FastAPI、WebSocket、pygame
- 三种入口共享同一套规则逻辑
- 后续改规则时基本只动 `game.py`

### 插件注册示例

`framework/games/__init__.py` 中的注册项：

```python
'incan_gold': {
    'module': 'framework.games.incan_gold.plugin',
    'name': '印加宝藏',
    'min_players': 3,
    'max_players': 8,
    'cover': '',
},
```

`framework/games/incan_gold/plugin.py`：

```python
import os
import sys

_INCAN_PATH = os.environ.get(
    'INCANGOLD_PATH',
    os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'IncanGold'),
)
_real = os.path.realpath(_INCAN_PATH)
if _real not in sys.path:
    sys.path.insert(0, _real)

from online.adapter import IncanGoldGame
GAME_CLASS = IncanGoldGame
```

### 联机状态最小集合

Incan Gold 前端真正依赖的状态字段是：

- `phase`
- `round_num`
- `table_gems`
- `artifacts_on_path`
- `hazards_seen_labels`
- `revealed_cards`
- `players`
- `result`

如果前端画面空白，先检查 `online/state.py` 和 `game.get_public_state()` 是否真的返回了这些字段。

### 前端渲染器接入要点

`incan_gold.js` 这次踩过的坑可以直接记住：

- 不要假设大厅提供全局 DOM helper，自己的文件里需要自带 helper
- 文件末尾必须注册到 `_RENDERERS`
- 如果懒加载脚本改了但浏览器没刷新，记得 bump `lobby.js` 里的 `?v=`

最小渲染器结构：

```javascript
class IncanGoldRenderer {
  constructor(container, myIdx, respond) { ... }
  onState(ctx) { ... }
  onRequest(playerIdx, kind, data) { ... }
  onGameOver(result) { ... }
}

if (typeof _RENDERERS !== 'undefined') {
  _RENDERERS['incan_gold'] = IncanGoldRenderer;
}
```

### 适合什么类型的游戏复用这套模式

这套 Incan Gold 接入方式特别适合：

- 单回合动作很少、按钮简单的桌游
- 核心状态是“完整快照”，而不是复杂局部增量 UI
- GUI / CLI / 联机都希望共用同一套规则引擎的项目

如果是像 Manila 那样 UI 和规则强耦合、交互种类很多的游戏，也能复用这个模式，但需要更厚的 `bridge/shim` 层。

---

## ask() 的 None 处理规范

`bridge.ask()` 在以下情况返回 `None`：

| 情况 | 原因 |
|------|------|
| 玩家断线 | `member.connected = False` |
| 玩家主动离开 | `handle_leave()` 触发 |
| 回合超时 | `threading.Event.wait(timeout=N)` 超时 |
| 目标是 AI | `member.is_ai = True`，直接跳过 |
| 游戏已终止 | `self._terminated = True` |

**游戏层必须对 `None` 做防御处理**，通常退化为合理的默认值。

---

## get_state() 推荐格式

```python
def get_state(self) -> dict:
    return {
        "phase": str,
        "round_num": int,
        "players": [
            {"name": str, "is_human": bool, ...}
        ],
        # 游戏自定义字段
    }
```
