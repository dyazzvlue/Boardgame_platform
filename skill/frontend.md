# GamePlatform — 前端开发规范

## 文件结构

```
framework/static/
├── index.html          骨架 HTML，包含各 section 和静态样式
├── lobby.js            大厅核心逻辑（WebSocket、房间 UI、工具函数）
└── games/
    └── <game_id>.js    各游戏的渲染器类
```

---

## lobby.js 全局状态

| 变量 | 类型 | 说明 |
|------|------|------|
| `ws` | WebSocket | 当前 WebSocket 连接 |
| `myIdx` | number | 本玩家座位号（-1 = 观战或未入座） |
| `selectedGame` | string | 当前选中的游戏 ID |
| `currentRoom` | object | 最新的房间状态（来自 `room` 消息） |
| `gameRenderer` | object | 当前游戏渲染器实例 |

---

## 消息路由 handleMsg(msg)

| type | 行为 |
|------|------|
| `game_list` | 渲染游戏卡片列表 |
| `room` | 更新 `currentRoom`；未开始→等待室；已开始→初始化游戏 UI |
| `countdown` | 显示/更新满员倒计时 banner |
| `state` | 调用 `gameRenderer.onState()`，**清除回合计时器** |
| `request` | 调用 `gameRenderer.onRequest()`，**启动回合计时器** |
| `log` | 追加日志到 `#log-panel` |
| `game_over` | 调用 `gameRenderer.onGameOver()`，**清除回合计时器** |
| `error` | 弹出错误提示 |

---

## 渲染器接口规范

```javascript
class MyGameRenderer {
    constructor(container, myIdx, respond) {
        // container: HTMLElement
        // myIdx: 本玩家座位号（观战者为 -1）
        // respond: (kind, value) => void
    }
    onState(ctx)               {}
    onRequest(idx, kind, data) {}
    onGameOver(result)         {}
}
```

在 `lobby.js` 的 `initGameUI()` 中注册，在 `index.html` 中引入对应 `<script>` 标签。

---

## 回合计时器 API

`request` 消息到来时自动启动，`state` / `game_over` 时自动清除，**渲染器通常无需干预**。

| 函数 | 说明 |
|------|------|
| `_startTurnTimer(playerIdx, timeoutSecs)` | 启动倒计时；`0` = 仅显示玩家名 |
| `_clearTurnTimer()` | 清除计时器和显示 |
| `_getPlayerName(playerIdx)` | 从 `currentRoom.players` 查玩家名 |

计时器显示在 `#turn-timer`（`#game-top-bar` 内），剩余 ≤5s 变红。

---

## 离开游戏

游戏界面顶部工具栏 `#game-top-bar`：
- 左侧：`#turn-timer` — 回合倒计时
- 右侧：🚪「离开游戏」按钮 → 调用 `leaveGame()`

```javascript
function leaveGame() {
    if (!confirm('确认离开游戏？你的位置将由 AI 接管。')) return;
    ws.send(JSON.stringify({ type: 'leave_game' }));
    _clearTurnTimer();
    gameRenderer = null;
    showSection('lobby');
}
```

---

## 页面 Section 切换

```javascript
showSection('home')          // 首页（默认落地页）
showSection('lobby')         // 游戏大厅（创建/加入房间）
showSection('room-waiting')  // 等待室
showSection('game-wrap')     // 游戏界面
showSection('rules')         // 游戏规则页
```

### 首页与规则页

页面加载后默认显示 `#home`（个人站点风格），`connect()` 在后台建立 WS 连接。

| 函数 | 说明 |
|------|------|
| `showHome()` | 切换到首页，更新游戏数量统计 |
| `enterLobby()` | 切换到大厅；若 WS 未连接则自动 `connect()` |
| `showRules()` | 切换到规则页，fetch `/api/games` 渲染游戏卡片列表 |
| `loadRule(gameId)` | fetch `/api/rules/{gameId}`，用 `marked.parse()` 或内置 `_simpleMd()` 渲染 |

### REST API（规则页使用）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/games` | GET | 返回游戏列表 JSON（同 WS `game_list` 的 `games` 数组） |
| `/api/rules/{game_id}` | GET | 返回 `{game_id, name, markdown}`；404 表示无规则文件 |

规则 markdown 来自各游戏 repo 的 `rules.md`（或 `rule.md`），路径在 `_GAME_REGISTRY` 的 `rules_file` 字段中配置。

---

## 创建房间表单字段

| 元素 ID | 说明 | 协议字段 |
|---------|------|---------|
| `create-name` | 玩家名 | `name` |
| `create-count` | 人数 | `player_count` |
| `create-pwd` | 密码 | `password` |
| `create-timeout` | 回合时限 | `turn_timeout`（30 / 60 / 0，默认 30） |

---

## 日志 style 约定

`_autoStyle()` 按文本内容自动推断：

| style | 触发正则 |
|-------|---------|
| `header` | `/^\s*第\s*\d+\s*轮/` |
| `section` | `/^──/` 或 `/^▌/` 或 `/^►/` |
| `warn` | `/⚠\|warn\|断线\|超时\|离开\|异常/` |
| `ai` | `/AI\|🤖/` |
| `bid` | `/港务长\|竞拍\|bid/` |
| `deploy` | `/部署\|工人\|派遣/` |
| `profit` | `/利润\|收益\|入账/` |
| `dice` | `/掷骰子\|骰子/` |

---

## 静态资源版本号

引入新游戏脚本时需加版本查询串（Unix 时间戳）破坏浏览器缓存：
```html
<script src="/static/games/mygame.js?v=1777580001"></script>
```
每次修改文件后**更新版本号**（同步更新 `index.html` 和 `lobby.js` 中的引用）。

第三方库（如 `marked.min.js`）也放在 `static/` 下本地提供，避免 CDN 依赖。

**路径必须使用绝对路径**（以 `/` 开头）。相对路径 `static/games/...` 在 URL
包含子路径时会解析到错误位置导致 404。

---

## 常见坑

1. **`myIdx` 更新时机**：仅当消息携带 `your_idx` 字段时才更新，
   广播的 `room` 消息对每个客户端携带各自的 `your_idx`

2. **`gameRenderer` 空指针防御**：`handleMsg` 中所有调用均有 `gameRenderer &&` 短路，
   渲染器不必担心被过早调用

3. **`respond` 闭包**：在 `initGameUI` 内创建，绑定最新的 `ws` 引用，
   不要在外部缓存此函数

4. **`_loadedScripts` 缓存 rejected promise**：`_loadGameScript` 若不清理失败的
   Promise，一旦预加载失败（代理 403、网络抖动），该游戏界面将永远无法加载。
   **修复**：创建 Promise 后立即 `.catch(() => { delete _loadedScripts[gameId]; })`。

5. **`_gameLoading` 永久为 true**：渲染器构造函数若抛异常且没有 try-catch，
   `_gameLoading` 不会重置，所有后续 `state`/`request`/`game_over` 消息
   进入 `_msgQueue` 永不回放，游戏界面卡死。
   **修复**：`new RendererCls(...)` 放在 try-catch 内，`_gameLoading = false` 无条件执行。

6. **队列回放中异常中断后续消息**：`initGameUI` 回放 `_msgQueue` 时，若某条
   `state` 消息触发的 `onState()` 抛出异常，`for` 循环中断，后面的 `request`
   消息永远不会被处理。表现为：信息区和玩家区正常显示，但手牌和操作按钮不出现。
   **修复**：回放循环中每条消息用 `try-catch` 包裹；渲染器的 `onState`/`onRequest`/
   `onGameOver` 也建议加 try-catch 并 `console.error`，避免静默失败。

7. **`initGameUI` 重入**：若快速连续收到两条 `room(started=true)` 消息，
   `initGameUI` 被调用两次，第二次会重置 `_msgQueue=[]` 清空缓冲消息。
   **修复**：入口加 `if (_gameLoading) return;` 防止重入。

8. **CSS `display:none` 与 JS `el.style.display = ''` 冲突**：若 CSS 对元素设了
   `display:none`，JS 中用 `el.style.display = ''` 清除 inline style 后会回退到
   CSS 的 `none`，元素仍然不可见。**修复**：显式设为 `el.style.display = 'block'`。

9. **CDN 不可达导致库未定义**：外部 CDN（如 `cdn.jsdelivr.net`）在企业网络/代理
   环境下可能无法访问，导致库（如 `marked`）未加载。
   **修复**：将第三方库下载到 `static/` 本地提供；JS 中用 `typeof lib !== 'undefined'`
   做可用性检测后再调用，并提供 fallback。
