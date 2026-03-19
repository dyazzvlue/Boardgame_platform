# GamePlatform — 框架架构

## 总览

gameplatform 是一个泛用多人联机桌游平台，使用 FastAPI + WebSocket 提供服务，
游戏逻辑以**插件形式**独立接入。框架本身不包含任何游戏逻辑。

```
浏览器 (WebSocket) ←→ server.py ←→ NetBridge ←→ game.run()（daemon 线程）
                         ↕
                       Room / RoomRegistry
```

---

## 目录结构

```
gameplatform/
├── pyproject.toml
├── skill/                  本目录：开发参考文档
└── framework/
    ├── server.py           FastAPI 入口，WebSocket 路由，房间生命周期
    ├── room.py             Room / RoomMember / RoomRegistry 数据模型
    ├── net_bridge.py       AbstractBridge 的网络实现（线程↔asyncio 桥）
    ├── core/
    │   ├── base_game.py    AbstractGame 抽象基类
    │   ├── base_bridge.py  AbstractBridge 抽象基类
    │   └── protocol.py     MsgType / ErrorCode 常量
    ├── games/
    │   ├── __init__.py     游戏注册表（_GAME_MODULES 字典）
    │   └── <game_id>/
    │       ├── __init__.py
    │       └── plugin.py   GAME_CLASS = MyGame
    └── static/
        ├── index.html      单页面应用骨架
        ├── lobby.js        大厅逻辑、WebSocket 核心、房间 UI、计时器
        └── games/
            └── <game_id>.js  游戏渲染器类
```

---

## 核心模块职责

### `server.py`
- 唯一的 HTTP / WebSocket 入口
- 维护全局 `RoomRegistry` 和事件循环引用
- 每条 WebSocket 消息经 `t = data.get('type')` 路由到对应处理块
- 游戏开始时在 `_start_game()` 中创建 `NetBridge`、注入 game、启动 daemon 线程

### `room.py`
- `RoomMember`：单个成员（ws / name / player_idx / connected / is_ai）
- `Room`：成员列表、房间状态（code / game_id / turn_timeout / started）
- `RoomRegistry`：线程安全的房间全局字典，`create()` 生成随机 6 位房间码

### `net_bridge.py`（`NetBridge`）
- 继承 `AbstractBridge`，是游戏线程与 asyncio 事件循环之间的**唯一通信通道**
- `ask(player_idx, kind, data)` — 阻塞式，向玩家发 REQUEST，等待 RESPONSE
  - 支持 `turn_timeout` 超时（`threading.Event.wait(timeout=N)`）
  - 超时或玩家离线后返回 `None`，游戏层自行处理
- `handle_leave(player_idx)` — 玩家主动离开，AI 接管；无真人时自动终局
- `_handle_disconnect(member)` — 断线处理，同样触发 AI 接管检查
- `_schedule(msg)` — 将消息通过 `run_coroutine_threadsafe` 放入广播队列

### `core/base_game.py` / `core/base_bridge.py`
- 纯抽象接口，`framework/core/` 内**不 import 任何游戏模块**
- 游戏插件只依赖这两个抽象类，不接触 FastAPI/asyncio

---

## 线程模型

```
asyncio 事件循环（主线程）
  │
  ├─ ws_endpoint()         — 每个 WebSocket 连接的协程
  ├─ broadcast_loop()      — 每个游戏房间一个协程，消费广播队列
  └─ _start_countdown()    — 满员倒计时协程

daemon 线程（每局游戏一个）
  └─ game.run()            — 同步调用 bridge.ask()，阻塞等待玩家操作
```

**关键规则：**
- `bridge.ask()` **只能**在游戏 daemon 线程内调用
- `bridge.log()` / `bridge.broadcast_state()` 可在任意线程调用
- `room.members` 的增删由 `room._lock` 保护
- 游戏线程通过 `threading.Event` 与 asyncio 事件循环同步

---

## 设计原则

1. **框架不感知游戏逻辑**：`framework/core/` 零 import 游戏模块
2. **游戏不感知 WebSocket**：游戏插件只通过 `AbstractBridge` 接口通信
3. **单机模式零影响**：游戏 repo 原有代码不受 `online/` 目录影响
4. **全量广播优先**：每次状态变更后调用 `bridge.broadcast_state()`，广播完整 `get_state()` 而非增量 diff
5. **断线 AI 接管**：玩家断线或主动离开后 AI 自动接管，游戏继续；全部玩家离线则自动终局

---

## 房间生命周期

```
CREATE → 加入等待 → 满员触发15s倒计时 → [手动START / 倒计时到0] → 游戏进行
                     ↑房主可以 ADD_AI                        ↓ LEAVE_GAME / 断线
                                                        AI 接管（game继续）
                                                        全员离线 → 自动终局
```

`room.started = True` 设置后游戏线程启动，不可回退。

---

## 已知限制

- 游戏结束后房间不会自动从 `RoomRegistry` 移除（需手动调用 `_registry.remove(code)`）
- 观战者加入时不主动推送当前 state，需等下一次 `broadcast_state()` 触发
- `ask()` 超时后返回 `None`，由游戏适配层决定行为（通常退化为默认值）
