# GamePlatform

泛用多人联机桌游平台框架。通过 WebSocket 支持多玩家实时联机，游戏逻辑以插件形式接入，框架本身不感知任何游戏细节。

> **本仓库**：[https://github.com/dyazzvlue/Boardgame_platform](https://github.com/dyazzvlue/Boardgame_platform)  
> **马尼拉游戏仓库**：[https://github.com/dyazzvlue/Boardgame_manila](https://github.com/dyazzvlue/Boardgame_manila)

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [架构说明](#架构说明)
- [接入新游戏](#接入新游戏)
- [WebSocket 消息协议](#websocket-消息协议)
- [接入游戏列表](#接入游戏列表)

---

## 功能特性

- **多游戏支持**：游戏以插件形式注册，框架透传通信，零侵入游戏逻辑
- **浏览器客户端**：无需安装，打开浏览器即可游玩
- **房间系统**：6 位房间码 + 可选密码，支持 3–N 人同时游玩
- **观战模式**：任意人数观战，实时同步游戏状态
- **断线 AI 接管**：玩家断线后自动切换为 AI，游戏继续进行
- **全量状态广播**：每次操作后向所有人同步完整游戏状态

---

## 快速开始

### 安装

```bash
cd gameplatform
pip install -e .
```

依赖：`fastapi`、`uvicorn[standard]`、`websockets`（均已在 `pyproject.toml` 中声明）。

### 启动服务器

**推荐使用 `tools/` 目录下的脚本**（Manila 与本仓库在同级目录时自动推断路径）：

```bash
# 生产模式（对外开放，端口 8000）
bash tools/start.sh

# 自定义端口
bash tools/start.sh --port 9000

# 手动指定 Manila 路径
MANILA_PATH=/path/to/Manila bash tools/start.sh
```

也可直接调用 uvicorn：

```bash
MANILA_PATH=/path/to/Manila uvicorn framework.server:app --host 0.0.0.0 --port 8000
```

在浏览器访问 `http://<服务器IP>:8000`，即可进入大厅。

### 本地开发

```bash
# 热重载，仅绑定 localhost
bash tools/dev.sh

# 等价于：
MANILA_PATH=../Manila uvicorn framework.server:app --reload --host 127.0.0.1 --port 8000
```

---

## 项目结构

```
gameplatform/
├── pyproject.toml                      # 包声明与依赖
├── tools/
│   ├── start.sh                        # 快速启动脚本（生产模式）
│   └── dev.sh                          # 开发模式启动（--reload）
└── framework/
    ├── __init__.py
    ├── core/                           # 抽象接口层（不含任何游戏逻辑）
    │   ├── base_game.py                # AbstractGame — 游戏插件必须实现
    │   ├── base_bridge.py              # AbstractBridge — 通信桥接口
    │   ├── base_player.py              # AbstractPlayer — 玩家描述符
    │   └── protocol.py                 # MsgType / ErrorCode 常量
    ├── room.py                         # 房间生命周期管理
    ├── net_bridge.py                   # AbstractBridge 的 WebSocket 实现
    ├── server.py                       # FastAPI 入口（WS 路由 + 静态文件）
    ├── games/
    │   ├── __init__.py                 # 游戏注册表（_GAME_MODULES 字典）
    │   └── manila/
    │       └── plugin.py               # Manila 插件注册（GAME_CLASS = ManilaGame）
    └── static/                         # Web 前端静态文件
        ├── index.html                  # 大厅页面
        ├── lobby.js                    # WebSocket 连接管理 + 大厅逻辑
        └── games/
            └── manila.js               # Manila 的 Canvas 渲染器 + 操作 UI
```

---

## 架构说明

### 整体数据流

```
浏览器                          服务器 (FastAPI)
  │  WebSocket JSON               │
  │ ─── join/create ─────────────►│  RoomRegistry.create/get()
  │ ◄── room (房间状态) ──────────│
  │                               │  game_thread 启动 game.run()
  │ ◄── state (全量状态) ─────────│  game.get_state() → broadcast
  │ ◄── request (你的操作) ───────│  bridge.ask(player_idx, kind, data)
  │ ─── response (操作值) ────────►│  bridge.receive_response() → 解阻塞
  │ ◄── state (更新后状态) ────────│
```

### 线程模型

- **asyncio 事件循环**（主线程）：处理所有 WebSocket 收发，驱动 `bridge.broadcast_loop()`
- **game 线程**（daemon）：同步执行 `game.run()`，需要玩家输入时调用 `bridge.ask()` 阻塞
- **桥接机制**：`threading.Event` + `asyncio.run_coroutine_threadsafe()` 实现线程安全的阻塞/唤醒

### 三个核心接口

| 接口 | 说明 |
|------|------|
| `AbstractGame` | 游戏插件入口：`setup()` / `run()` / `get_state()` / `on_player_disconnected()` |
| `AbstractBridge` | 通信桥：`ask()` 阻塞等待玩家操作，`log()` 广播日志，`broadcast_state()` 广播状态 |
| `AbstractPlayer` | 玩家描述符：`name` / `player_idx` / `is_human` / `connected` |

---

## 接入新游戏

最小改动量：新建 4 个文件。

### Step 1：游戏 repo 内新建 `online/adapter.py`

```python
from framework.core import AbstractGame

class MyGame(AbstractGame):
    GAME_ID      = "mygame"
    GAME_NAME    = "我的游戏"
    MIN_PLAYERS  = 2
    MAX_PLAYERS  = 4

    def setup(self, player_names: list, human_flags: list) -> None:
        # 初始化游戏对象，此时 self.bridge 已注入
        ...

    def run(self) -> None:
        # 同步游戏主循环
        # 需要玩家操作时：val = self.bridge.ask(player_idx, "my_kind", {...})
        # 状态变更后：self.bridge.broadcast_state()
        ...

    def get_state(self) -> dict:
        # 返回 JSON 可序列化的完整状态
        return {"phase": ..., "players": [...], ...}

    def on_player_disconnected(self, player_idx: int) -> None:
        self._players[player_idx].is_human = False
```

### Step 2：游戏 repo 内新建 `online/state.py`

实现 `serialize_context()` 或直接在 `get_state()` 中返回 dict，将游戏对象转为 JSON 可序列化结构。

### Step 3：`gameplatform/framework/games/mygame/plugin.py`

```python
import sys, os
_GAME_PATH = os.environ.get("MYGAME_PATH", "/path/to/MyGame")
if _GAME_PATH not in sys.path:
    sys.path.insert(0, _GAME_PATH)

from online.adapter import MyGame
GAME_CLASS = MyGame
```

### Step 4：注册到 `framework/games/__init__.py`

```python
_GAME_MODULES: dict[str, str] = {
    "manila":  "framework.games.manila.plugin",
    "mygame":  "framework.games.mygame.plugin",  # ← 新增
}
```

### Step 5：`framework/static/games/mygame.js`

实现 `class MyGameRenderer`，与 `ManilaRenderer` 结构相同：

```javascript
class MyGameRenderer {
  constructor(container, myIdx, respond) { ... }
  onState(ctx)              { /* 更新 Canvas */ }
  onRequest(idx, kind, data){ /* 渲染操作 UI */ }
  onGameOver(result)        { /* 显示结算 */ }
}
```

在 `lobby.js` 的 `initGameUI()` 中注册：

```javascript
} else if (gameId === 'mygame') {
    gameRenderer = new MyGameRenderer(container, myIdx, ...);
}
```

---

## WebSocket 消息协议

所有消息均为 JSON 对象，包含 `type` 字段。

### Server → Client

| type | 字段 | 说明 |
|------|------|------|
| `game_list` | `games: [{id, name, min_players, max_players, cover}]` | 可用游戏列表 |
| `room` | `code, game_id, player_count, players, spectators, started, your_idx` | 房间状态变更 |
| `state` | `game_id, context: {...}` | 全量游戏状态广播 |
| `request` | `player_idx, kind, data: {...}` | 需要指定玩家操作 |
| `log` | `text, style` | 日志条目 |
| `game_over` | `game_id, result: {...}` | 游戏结束 |
| `error` | `code, msg` | 错误（密码错误/房间不存在等） |
| `pong` | — | 心跳响应 |

### Client → Server

| type | 字段 | 说明 |
|------|------|------|
| `list` | — | 拉取游戏列表 |
| `create` | `game, name, player_count, password` | 创建房间 |
| `join` | `room, name, password, spectate` | 加入房间或观战 |
| `response` | `kind, value` | 玩家操作响应 |
| `ping` | — | 心跳 |

### 错误码（`error.code`）

| code | 说明 |
|------|------|
| `wrong_password` | 密码错误 |
| `room_not_found` | 房间不存在 |
| `room_full` | 房间已满 |
| `game_started` | 游戏已开始，不接受新玩家 |
| `invalid_msg` | 消息格式错误 |

---

## 接入游戏列表

| 游戏 | GAME_ID | 人数 | 状态 | 仓库 |
|------|---------|------|------|------|
| 马尼拉 | `manila` | 3–5 | ✅ 已接入 | [Boardgame_manila](https://github.com/dyazzvlue/Boardgame_manila) |
| c_g 卡牌 | `cards` | TBD | 🔲 规划中 | — |
