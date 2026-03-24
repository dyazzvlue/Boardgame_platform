# GamePlatform 开发偏好与编程规范

本文件记录 gameplatform 框架的设计决策、接口约定和开发规范，
供 AI 编程助手在此 repo 中工作时参考。

---

## 架构原则

1. **框架不感知游戏逻辑**：`framework/core/` 中的代码绝不 import 任何游戏模块。
2. **游戏不感知 WebSocket**：游戏插件（`adapter.py`）只通过 `AbstractBridge` 接口通信，不直接接触 FastAPI/asyncio。
3. **单机模式零影响**：游戏 repo 的原有代码（`gui_main.py` 等）不受 `online/` 目录影响，`online/` 中是软依赖（`try: from framework.core import ...`）。
4. **全量广播优先**：每次状态变更后调用 `bridge.broadcast_state()`，广播完整 `get_state()` 而非增量 diff，降低实现复杂度。

---

## 核心接口约定

### AbstractGame

```python
class MyGame(AbstractGame):
    GAME_ID: str        # 小写字母 + 数字，e.g. "manila"
    GAME_NAME: str      # 显示名，e.g. "马尼拉"
    MIN_PLAYERS: int
    MAX_PLAYERS: int
    COVER_IMAGE: str    # 相对于 static/games/ 的图片路径，可为空字符串

    bridge: AbstractBridge   # 由服务器在 setup() 前注入，勿在 __init__ 中使用

    def setup(self, player_names: list[str], human_flags: list[bool]) -> None: ...
    def run(self) -> None: ...          # 同步，在 daemon 线程中执行
    def get_state(self) -> dict: ...    # 必须 JSON 可序列化
    def on_player_disconnected(self, player_idx: int) -> None: ...
```

### AbstractBridge.ask() 的 `kind` 约定

- `kind` 是字符串，前端 JS 按 `kind` 决定渲染哪个操作 UI
- `data` 是 JSON dict，包含前端渲染所需数据（选项列表、当前状态等）
- 返回值类型由 `kind` 约定，不由框架强制

### get_state() 的返回格式建议

```python
{
    "phase": str,          # 当前阶段描述
    "round_num": int,
    "players": [
        {
            "name": str,
            "is_human": bool,
            "money": int,
            # ... 游戏自定义字段
        }
    ],
    # ... 其他游戏状态
}
```

---

## 线程安全规则

- `bridge.ask()` **只能**在 game 线程中调用，不能在 asyncio 协程中调用
- `bridge.log()` 和 `bridge.broadcast_state()` 可在任意线程调用（内部通过 `run_coroutine_threadsafe` 保证安全）
- `room.members` 的读写由 `room._lock` 保护，直接访问前须持锁

---

## 游戏插件 plugin.py 规范

```python
# framework/games/<game_id>/plugin.py
import sys, os

_PATH = os.environ.get("<GAME>_PATH", "/default/path")
if _PATH not in sys.path:
    sys.path.insert(0, _PATH)

from online.adapter import MyGame  # 游戏 repo 内
GAME_CLASS = MyGame                # 框架通过此变量发现插件
```

环境变量命名约定：`<GAME_ID大写>_PATH`，如 `MANILA_PATH`。

---

## 前端 JS 规范

每个游戏对应一个渲染器类，必须实现：

```javascript
class MyGameRenderer {
    constructor(container, myIdx, respond) {
        // container: DOM 元素；myIdx: 本玩家座位号；respond: (kind, value) => void
    }
    onState(ctx)              {}  // 收到 state 消息时调用
    onRequest(idx, kind, data){}  // 收到 request 消息时调用
    onGameOver(result)        {}  // 收到 game_over 时调用
}
```

在游戏 JS 文件**末尾**注册到 `_RENDERERS`：
```javascript
if (typeof _RENDERERS !== 'undefined') _RENDERERS['mygame'] = MyGameRenderer;
```
框架会在需要时懒加载脚本并从 `_RENDERERS` 取类实例化，**无需修改 `lobby.js`**。

---

## 添加新游戏的清单

- [ ] 游戏 repo：`online/__init__.py`（空文件）
- [ ] 游戏 repo：`online/state.py`（序列化函数）
- [ ] 游戏 repo：`online/adapter.py`（`class MyGame(AbstractGame)`）
- [ ] `framework/games/<id>/__init__.py`（空文件）
- [ ] `framework/games/<id>/plugin.py`（`GAME_CLASS = MyGame`）
- [ ] `framework/games/__init__.py`：在 `_GAME_REGISTRY` 中添加条目（含 name / min_players / max_players / cover / module）
- [ ] `framework/static/games/<id>.js`（`class MyGameRenderer`，**文件末尾** `_RENDERERS['<id>'] = MyGameRenderer;`）
- [ ] 服务器启动命令中设置 `<GAME>_PATH` 环境变量

> **无需**修改 `lobby.js` 或 `index.html`，游戏 JS 由懒加载机制自动注入。

---

## 已知限制与待办

- 房间在游戏结束后不会自动清理（待添加 `RoomRegistry.remove()` 调用）
- 观战者加入时不主动推送当前 state，需等下一次 broadcast 才能看到画面（可优化）
- `manila.js` 的 Canvas 渲染为功能性实现，布局与单机 pygame 版有差异
- `pirate_dest` 的 "港口/造船厂" 按钮目前均发送 `13`，需根据 track_len 和 docked_at 修正


> 详细文档见 `skill/` 目录（architecture / protocol / add-game / frontend）。

---

## 目录结构速查

```
gameplatform/
├── README.md               本文件
├── SKILL.md                开发规范（本文件）
├── pyproject.toml
└── framework/
    ├── core/               抽象接口（不含游戏逻辑）
    ├── room.py             房间管理
    ├── net_bridge.py       WebSocket 桥实现
    ├── server.py           FastAPI 服务器
    ├── games/              游戏插件注册表
    │   └── manila/
    └── static/             Web 前端
        └── games/
```
