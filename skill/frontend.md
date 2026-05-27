# GamePlatform — 前端开发规范

## 技术栈

- **Vue 3** (Composition API)
- **Vue Router 4** (Hash mode)
- **Pinia** (状态管理)
- **Vite 8** (构建工具)
- **Marked** (Markdown 渲染)

---

## 目录结构

```
frontend/
├── package.json
├── vite.config.js          输出到 ../framework/static/dist
├── index.html
└── src/
    ├── main.js             createApp + 插件安装
    ├── router.js           路由表
    ├── style.css           全局样式
    ├── stores/
    │   └── game.js         Pinia store（WebSocket + 游戏状态）
    ├── components/
    │   ├── blog/           BlogPostCard.vue, Pagination.vue
    │   └── games/          每个游戏一个 .vue 渲染器
    └── views/
        ├── BlogHome.vue    博客首页
        ├── PostDetail.vue  文章详情
        ├── CategoryView.vue 分类页
        ├── admin/          管理后台（Login, Dashboard, PostEditor）
        └── game/
            ├── GameLobby.vue   大厅（游戏列表 + 创建/加入房间）
            └── GameRoom.vue    房间（等待室 + 游戏进行）
```

---

## Pinia Store (`stores/game.js`)

### 状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `ws` | WebSocket | 当前连接 |
| `connected` | boolean | 连接状态 |
| `myIdx` | number | 本玩家座位号（-1 = 未入座） |
| `games` | array | 可用游戏列表 |
| `room` | object | 当前房间状态 |
| `gameState` | object | 最新游戏 STATE |
| `request` | object | 当前待响应的 REQUEST |
| `logs` | array | 游戏日志 |
| `gameOver` | object | 游戏结束数据 |
| `countdown` | object | 满员倒计时 |

### 动作

| 方法 | 说明 |
|------|------|
| `connect()` | 建立 WebSocket 连接 |
| `send(msg)` | 发送 JSON 消息 |
| `respond(kind, value)` | 发送 response 消息 |
| `createRoom(opts)` | 创建房间 |
| `joinRoom(roomId, name, password)` | 加入房间 |
| `startGame()` | 手动开始 |
| `addAi()` | 添加 AI |
| `leaveGame()` | 离开游戏（AI 接管） |
| `returnRoom()` | 返回大厅 |

### 消息路由

收到 WebSocket 消息后按 `type` 字段分发：

| type | 处理 |
|------|------|
| `game_list` | 更新 `games` |
| `room` | 更新 `room` + `myIdx` |
| `state` | 更新 `gameState`，清除 `request` |
| `request` | 更新 `request` |
| `log` | 追加到 `logs` |
| `game_over` | 设置 `gameOver` |
| `countdown` | 设置 `countdown` |
| `error` | 弹出错误信息 |

---

## 游戏渲染器组件

每个游戏在 `src/components/games/` 下有一个 `.vue` 文件：

```
Manila.vue
Avalon.vue
IncanGold.vue
GuanDan.vue
TransCard.vue
```

### 组件接口

```vue
<script setup>
import { useGameStore } from '@/stores/game'
const store = useGameStore()

// store.gameState  — 游戏状态（Per-Player，只含本玩家可见信息）
// store.request   — 当前请求 { idx, kind, data }
// store.myIdx     — 本玩家座位号
// store.room      — 房间信息（players 列表等）

// 响应操作：
// store.respond(kind, value)
</script>
```

### 注册

`GameRoom.vue` 中维护渲染器映射：

```javascript
const renderers = {
    manila: Manila,
    avalon: Avalon,
    incan_gold: IncanGold,
    guandan: GuanDan,
    transcard: TransCard,
}
```

通过 `room.game_id` 动态选择对应组件：

```vue
<component :is="renderers[room.game_id]" v-if="room.started" />
```

---

## 路由表

| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | BlogHome | 博客首页 |
| `/post/:id` | PostDetail | 文章详情 |
| `/category/:id` | CategoryView | 分类页 |
| `/game` | GameLobby | 游戏大厅 |
| `/game/room` | GameRoom | 游戏房间 |
| `/admin/login` | AdminLogin | 管理员登录 |
| `/admin` | AdminDashboard | 管理后台 |
| `/admin/post/new` | PostEditor | 新建文章 |
| `/admin/post/:id` | PostEditor | 编辑文章 |

---

## 构建与部署

```bash
cd frontend
npm install          # 安装依赖
npm run build        # 构建，输出到 ../framework/static/dist
npm run dev          # 开发模式（HMR，代理 API 到后端 8000 端口）
```

Vite 配置关键点：
- `base: './'` — 相对路径，适配任意部署根
- `build.outDir: '../framework/static/dist'` — 直接输出到后端静态目录
- 开发模式下 proxy `/api` 和 `/ws` 到 `http://localhost:8000`

---

## 开发流程

1. 启动后端：`bash tools/start.sh --public --reload`
2. 启动前端开发服务器：`cd frontend && npm run dev`
3. 访问 Vite dev server（通常 `http://localhost:5173`）
4. 前端通过 proxy 与后端 WebSocket/API 通信
5. 修改 `.vue` 文件后自动热更新

**生产部署**时只需构建前端（`npm run build`），后端直接服务 `dist/` 中的文件。

---

## 添加新游戏渲染器

1. 创建 `src/components/games/MyGame.vue`
2. 在 `GameRoom.vue` 的 `renderers` 映射中添加 `my_game: MyGame`
3. 根据该游戏的 `STATE` 和 `REQUEST` 格式实现 UI

渲染器只需读取 `store.gameState` / `store.request` 并调用 `store.respond(kind, value)`，
无需关心 WebSocket 连接管理。

---

## 常见坑

1. **Per-Player State**：`gameState` 只包含本玩家可见的信息，不同玩家看到的状态不同
2. **request 清除时机**：收到新 `state` 时自动清除 `request`，渲染器无需手动清除
3. **myIdx = -1**：观战者不会收到 `request`，但会收到 `state` 和 `log`
4. **Hash 路由**：使用 `createWebHashHistory()`，避免服务端路由配置问题
5. **Vite 缓存**：构建输出带 hash 文件名，无需手动管理缓存破坏
