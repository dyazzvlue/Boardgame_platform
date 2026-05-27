# GamePlatform 开发偏好与编程规范

本文件记录 gameplatform 框架的设计决策、接口约定和开发规范，
供 AI 编程助手在此 repo 中工作时参考。

---

## 架构原则

1. **框架不感知游戏逻辑**：`framework/core/` 中的代码绝不 import 任何游戏模块。
2. **游戏不感知 WebSocket**：游戏插件（`adapter.py`）只通过 `AbstractBridge` 接口通信，不直接接触 FastAPI/asyncio。
3. **单机模式零影响**：游戏 repo 的原有代码（`gui_main.py` 等）不受 `online/` 目录影响，`online/` 中是软依赖（`try: from framework.core import ...`）。
4. **Per-Player State**：每次状态变更后调用 `bridge.broadcast_state()`，为每个玩家发送定制视图（通过 `get_state_for_player()`）。
5. **前后端分离**：Vue 3 SPA + REST API + WebSocket，Vite 构建输出到 `framework/static/dist/`。

---

## 技术栈

- **后端**：Python 3.10+ / FastAPI / uvicorn / aiosqlite / bcrypt
- **前端**：Vue 3 / Vue Router 4 (Hash) / Pinia / Vite 8 / Marked
- **数据库**：SQLite (WAL mode) — blog.db
- **部署**：Nginx 反代 + systemd + Let's Encrypt

---

## 核心接口约定

### AbstractGame

```python
class MyGame(AbstractGame):
    GAME_ID: str        # 小写字母 + 数字，e.g. "manila"
    GAME_NAME: str      # 显示名，e.g. "马尼拉"
    MIN_PLAYERS: int
    MAX_PLAYERS: int

    bridge: AbstractBridge   # 由服务器在 setup() 前注入

    def setup(self, player_names: list[str], human_flags: list[bool]) -> None: ...
    def run(self) -> None: ...                          # 同步，daemon 线程
    def get_state(self) -> dict: ...                    # JSON 可序列化
    def get_state_for_player(self, player_idx: int) -> dict: ...  # 可选覆盖
    def on_player_disconnected(self, player_idx: int) -> None: ...
```

### Per-Player State

```python
def get_state_for_player(self, player_idx: int) -> dict:
    """默认返回 get_state()，子类覆盖以隐藏对手信息。"""
    return self.get_state()
```

`broadcast_state()` 遍历在线成员，调用 `get_state_for_player(member.player_idx)` 为每人发送定制视图。

### AbstractBridge.ask() 的 `kind` 约定

- `kind` 是字符串，前端组件按 `kind` 决定渲染哪个操作 UI
- `data` 是 JSON dict，包含前端渲染所需数据
- 返回 `None` 表示超时/断线/AI，游戏层必须做防御处理

---

## 线程安全规则

- `bridge.ask()` **只能**在 game 线程中调用
- `bridge.log()` 和 `bridge.broadcast_state()` 可在任意线程调用（内部 `run_coroutine_threadsafe`）
- `room.members` 的读写由 `room._lock` 保护

---

## 前端渲染器规范

每个游戏对应一个 Vue 组件（`frontend/src/components/games/<GameName>.vue`）：

```vue
<script setup>
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()
const state = computed(() => store.gameState)
const request = computed(() => store.request)
const isMyTurn = computed(() => request.value && request.value.idx === store.myIdx)
</script>
```

在 `GameRoom.vue` 的 `renderers` 映射中注册：
```javascript
const renderers = { manila, avalon, incan_gold, guandan, transcard, mygame }
```

---

## 添加新游戏的清单

- [ ] 游戏 repo：`online/__init__.py`
- [ ] 游戏 repo：`online/state.py`（序列化函数）
- [ ] 游戏 repo：`online/adapter.py`（`class MyGame(AbstractGame)`）
- [ ] `framework/games/<id>/__init__.py`
- [ ] `framework/games/<id>/plugin.py`（`GAME_CLASS = MyGame`）
- [ ] `framework/games/__init__.py`：在 `_GAME_REGISTRY` 中添加条目
- [ ] `frontend/src/components/games/<GameName>.vue`（渲染器组件）
- [ ] `frontend/src/views/game/GameRoom.vue`：在 `renderers` 中注册
- [ ] `tools/games.conf`：添加 game_id / 环境变量 / 目录名 / git URL

---

## 目录结构速查

```
gameplatform/
├── README.md
├── pyproject.toml
├── requirements.txt
├── skill/                  开发参考文档
├── tools/                  脚本（deploy/start/dev/fetch-games）
├── frontend/               Vue 3 前端源码
│   └── src/
│       ├── stores/game.js      Pinia WebSocket store
│       ├── components/games/   游戏渲染器（.vue）
│       └── views/game/         大厅 + 房间视图
└── framework/
    ├── core/               抽象接口
    ├── db/                 SQLite 数据库
    ├── auth/               session 认证
    ├── blog/               博客 API
    ├── room.py             房间管理
    ├── net_bridge.py       WebSocket 桥（含 per-player broadcast）
    ├── server.py           FastAPI 入口 + SPA fallback
    ├── cli.py              CLI（init-db / create-admin）
    ├── games/              游戏插件注册表
    └── static/dist/        Vite 构建输出
```

> 详细文档见 `skill/` 目录各文件。
