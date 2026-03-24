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

```python
import sys, os

_PATH = os.environ.get(
    "MYGAME_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "MyGame")
)
if os.path.realpath(_PATH) not in sys.path:
    sys.path.insert(0, os.path.realpath(_PATH))

from online.adapter import MyGame  # noqa: E402
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
