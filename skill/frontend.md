# GamePlatform — 前端开发规范

## 技术栈

- **Vue 3** (Composition API)
- **Vue Router 4** (History mode)
- **Pinia** (状态管理)
- **Vite 8** (构建工具)
- **Marked** (Markdown 渲染)
- **DOMPurify** (客户端 Markdown HTML 清洗)
- **Node.js 22.12+（22.x）或 24+**，固定版本见 `frontend/.nvmrc`

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
| `connectionStatus` | string | 连接中、恢复中、已连接或恢复失败 |
| `pendingResponse` | string/null | 等待确认的请求编号 |
| `requestExpired` | boolean | 当前请求是否已到截止时间 |
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
| `respond(kind, value)` | 携带请求编号提交，收到 ACK 才清除操作 |
| `createRoom(gameId, name, password, playerCount, turnTimeout)` | 创建房间 |
| `joinRoom(roomId, name, password)` | 加入房间 |
| `startGame()` | 手动开始 |
| `addAI()` | 添加 AI |
| `leaveRoom()` | 明确离房并清除恢复凭证 |
| `leaveGame()` | 离开游戏（AI 接管） |
| `returnRoom()` | 对局结束后返回同一房间的等待室 |

### 消息路由

收到 WebSocket 消息后按 `type` 字段分发：

| type | 处理 |
|------|------|
| `game_list` | 更新 `games` |
| `room` | 更新 `room` + `myIdx` |
| `state` | 更新 `gameState`，不清除仍在等待的操作 |
| `request` | 更新 `request` |
| `response_ack` | 确认对应提交；成功后清除操作，拒绝时明确提示 |
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
| `/post/:slug` | PostDetail | 文章详情 |
| `/category/:slug` | CategoryView | 分类页 |
| `/game` | GameLobby | 游戏大厅 |
| `/game/:roomCode` | GameRoom | 游戏房间，刷新时尝试恢复本人座位 |
| `/admin/login` | AdminLogin | 管理员登录 |
| `/admin` | AdminDashboard | 管理后台 |
| `/admin/posts/new` | PostEditor | 新建文章 |
| `/admin/posts/:id/edit` | PostEditor | 编辑文章 |

---

## 构建与部署

```bash
cd frontend
npm ci               # 按锁文件安装依赖
npm test             # 请求状态、竞态和游戏生命周期回归
npm run build        # 构建，输出到 ../framework/static/dist
npm run dev          # 开发模式（HMR，代理 API 到后端 8000 端口）
```

Vite 配置关键点：
- 默认 `base: '/'` — 使用站点根路径，深层博客路由仍能加载资源
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

### 博客首屏与 Markdown

- `framework/blog/pages.py` 按请求生成博客 HTML，使用构建 manifest 补齐页面 CSS，禁用 JS 仍可阅读。
- `src/lib/blogPage.js` 消费与当前 URL 匹配的一次性 `blog-bootstrap`；不重复请求首屏数据。
  等待路由就绪后挂载 Vue，以免先用空路由清除服务端正文。
- 页面数据只写入当前请求序号，保持取消与竞态保护；后续导航通过 API 获取最新内容。
- `src/lib/markdown.js` 对文章与编辑器预览统一使用 DOMPurify，不要直接把 Marked 输出交给 `v-html`。
  服务端 API 提供的 `content_html` 也在浏览器清洗；正文图片统一 lazy/async。
- 文章元信息在数据就绪后同步；进入游戏或后台时删除文章 JSON-LD、分享图和发布时间。
- 博客样式使用组件根类命名空间，方便原始 SSR HTML 共用，不能依赖 Vue 编译生成的 scoped 属性。
- 运行 `npm run test:e2e` 覆盖无 JS、移动端、数据复用、SPA SEO、实时编辑撤回、Markdown 预览与游戏恢复。

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
2. **request 清除时机**：等待匹配的成功 ACK、新请求或终局；不要用普通状态广播清除正在等待的操作
3. **myIdx = -1**：观战者不会收到 `request`，但会收到 `state` 和 `log`
4. **History 路由**：博客由服务端预渲染，游戏/admin 由 SPA fallback 处理；不要改为 Hash 路由
5. **HTTP 状态**：复用 `src/lib/http.js` 的请求校验、取消和序号管理，错误不能伪装成空列表或保存成功
6. **断线恢复**：本人凭证只保存在 sessionStorage；收到 4001 表示另一页面已接管，不应循环抢回连接
5. **Vite 缓存**：构建输出带 hash 文件名，无需手动管理缓存破坏
