# GamePlatform — 框架架构

## 总览

gameplatform 是一个泛用多人联机桌游平台 + 个人博客系统，使用 FastAPI + WebSocket + Vue 3 提供服务，
游戏逻辑以**插件形式**独立接入。框架本身不包含任何游戏逻辑。

```
浏览器 (Vue SPA)
  │  HTTP (REST API)
  │  WebSocket (/ws)
  ▼
server.py (FastAPI)
  ├── /api/blog/*        博客公开 API
  ├── /api/admin/*       管理后台 API (需 session 认证)
  ├── /ws                WebSocket 游戏逻辑
  ├── /assets/*          Vite 构建产物
  ├── / /post/* /category/*  博客 HTML + JSON bootstrap
  ├── /sitemap.xml /robots.txt  搜索引擎入口
  └── /*                 游戏/后台 SPA fallback → dist/index.html
       ↕
  NetBridge ←→ game.run()（daemon 线程）
       ↕
  Room / RoomRegistry
```

---

## 目录结构

```
gameplatform/
├── pyproject.toml          Python 包配置 + 依赖声明
├── requirements.txt        锁定版本依赖
├── skill/                  开发参考文档（本目录）
├── tools/
│   ├── deploy.sh           一键部署脚本
│   ├── start.sh            启动服务器
│   ├── dev.sh              开发模式（后端 + 前端热更新）
│   ├── fetch-games.sh      拉取/更新游戏 repo
│   └── games.conf          游戏注册配置
└── framework/
    ├── server.py           FastAPI 入口，WebSocket/REST 路由，SPA fallback
    ├── room.py             Room / RoomMember / RoomRegistry 数据模型
    ├── net_bridge.py       AbstractBridge 的网络实现（线程↔asyncio 桥）
    ├── cli.py              CLI 命令（init-db / create-admin）
    ├── __main__.py         python -m framework 入口
    ├── core/
    │   ├── base_game.py    AbstractGame 抽象基类（含 get_state_for_player）
    │   ├── base_bridge.py  AbstractBridge 抽象基类
    │   └── protocol.py     MsgType / ErrorCode 常量
    ├── db/
    │   └── __init__.py     SQLite 连接管理 + 表结构（blog.db）
    ├── auth/
    │   ├── __init__.py     bcrypt 密码哈希
    │   ├── session.py      session token 管理
    │   └── deps.py         FastAPI 依赖注入（require_admin）
    ├── blog/
    │   ├── routes.py       公开博客 API（GET /api/blog/*）
    │   ├── pages.py        博客 HTML、SEO、站点地图与首屏数据
    │   ├── rendering.py    Markdown 渲染、HTML 清洗和图片属性
    │   └── admin_routes.py 管理 CRUD API（POST /api/admin/*）
    ├── games/
    │   ├── __init__.py     游戏注册表
    │   └── <game_id>/      各游戏插件
    └── static/
        └── dist/           Vite 构建输出（index.html + assets/）

frontend/                   Vue 3 前端源码
├── package.json            Node.js 依赖（vue, vue-router, pinia, marked, vite）
├── vite.config.js          构建配置（输出到 ../framework/static/dist）
├── index.html              SPA 入口
└── src/
    ├── main.js             Vue app 创建
    ├── router.js           路由配置
    ├── stores/game.js      Pinia WebSocket 状态管理
    ├── style.css           全局样式
    ├── components/
    │   ├── blog/           博客组件（PostCard, Pagination）
    │   └── games/          游戏渲染器（5个 Vue 组件）
    └── views/
        ├── BlogHome.vue    博客首页
        ├── PostDetail.vue  文章详情
        ├── CategoryView.vue 分类页
        ├── admin/          管理后台视图
        └── game/           游戏大厅 + 房间
```

---

## 核心模块职责

### `server.py`
- HTTP / WebSocket 入口
- 维护全局 `RoomRegistry` 和事件循环引用
- 集成 blog/admin router
- 博客页面路由优先于 SPA catch-all；游戏/后台返回带非索引元信息的 `dist/index.html`
- REST API：`GET /api/games`、`GET /api/rules/{game_id}`

### `net_bridge.py`（`NetBridge`）
- 继承 `AbstractBridge`
- `ask(player_idx, kind, data)` — 阻塞式发 REQUEST，等待 RESPONSE
- `broadcast_state()` — 调用 `_schedule_per_player()`，为每个玩家发送定制状态
- `_schedule_per_player()` — 遍历在线成员，调用 `game.get_state_for_player(idx)`

### `core/base_game.py`
- `AbstractGame` 抽象基类
- 新增 `get_state_for_player(player_idx)` — 可选覆盖，默认调用 `get_state()`
- 用于 Avalon（隐藏他人角色）、GuanDan（隐藏他人手牌）等需要信息隔离的游戏

### `db/__init__.py`
- SQLite + WAL 模式 + foreign_keys
- 表：admin_users, categories, posts (含 pinned), tags, post_tags, sessions
- HTTP 写操作和 Session 写入使用各自的事务连接，异常或取消时回滚；共享连接用于读取，避免请求间交叉提交
- 公开列表批量查询当前页标签，非空页固定三次 SELECT；组合索引覆盖公开列表和分类排序

### `blog/` + `auth/`
- 完整的博客 CRUD + session 认证
- bcrypt 密码哈希，HTTP-only cookie session
- 博客页面由 FastAPI 预渲染正文和元信息，通过 JSON bootstrap 交给 Vue；游戏和管理页面保留 SPA
- 服务端和客户端 Markdown 均清洗 HTML，站点地图仅枚举公开文章

---

## 线程模型

```
asyncio 事件循环（主线程）
  │
  ├─ ws_endpoint()         — 每个 WebSocket 连接的协程
  ├─ broadcast_loop       — 发送游戏线程生成的玩家视图快照
  └─ _start_countdown()    — 满员倒计时

daemon 线程（每局游戏一个）
  └─ game.run()            — 同步调用 bridge.ask()，阻塞等待
```

---

## Per-Player State 机制

```python
# base_game.py
def get_state_for_player(self, player_idx: int) -> dict:
    """默认返回 get_state()，子类可覆盖。"""
    return self.get_state()
```

`broadcast_state()` 遍历所有在线成员，对每个成员调用 `get_state_for_player(member.player_idx)`，
单独发送 STATE 消息。这保证了：
- Avalon：每人只看到自己的角色和夜晚情报
- GuanDan：每人只看到自己的手牌
- TransCard：每人只看到自己的手牌
- Manila/IncanGold：所有人看到相同状态

---

## 设计原则

1. **框架不感知游戏逻辑**：`framework/core/` 零 import 游戏模块
2. **游戏不感知 WebSocket**：游戏插件只通过 `AbstractBridge` 接口通信
3. **单机模式零影响**：游戏 repo 原有代码不受 `online/` 目录影响
4. **Per-player 状态**：`broadcast_state()` 为每个玩家发送定制视图
5. **断线恢复**：默认 30 秒宽限期内恢复座位和未完成请求，超时才切换 AI；显式离房立即接管，全员离开后回收房间
6. **前后端分离**：Vue SPA 通过 REST API + WebSocket 与后端交互
