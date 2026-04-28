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
showSection('lobby')         // 游戏大厅
showSection('room-waiting')  // 等待室
showSection('game-wrap')     // 游戏界面
```

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
<script src="/static/games/mygame.js?v=1773881881000"></script>
```
每次修改文件后**更新版本号**（同步更新 `index.html` 和 `lobby.js` 中的引用）。

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
