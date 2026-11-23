# GamePlatform — WebSocket 消息协议

所有消息均为 JSON，通过 `/ws` WebSocket 端点传输。

---

## 客户端 → 服务器

### `list` — 获取游戏列表
```json
{ "type": "list" }
```
响应：`game_list`

---

### `create` — 创建房间
```json
{
  "type": "create",
  "game": "manila",
  "name": "玩家1",
  "player_count": 4,
  "password": "",
  "turn_timeout": 30
}
```
- `turn_timeout`：每回合时限（秒），`0` = 不限制，默认 `30`
- 创建者自动成为房主（`host_idx`）
- 响应：`room`（含 `your_idx` 和仅属于该成员的 `resume_token`）

---

### `join` — 加入或观战
```json
{
  "type": "join",
  "room": "ABC123",
  "name": "玩家2",
  "password": "",
  "spectate": false
}
```
- `spectate: true` 时以观战者身份加入（`player_idx = -1`）
- 响应：`room`（广播给全房间）

---

### `add_ai` — 添加 AI（房主专属）
```json
{ "type": "add_ai" }
```
- 仅房主可调用，游戏未开始时有效
- 响应：`room`（广播）；满员后自动触发15s倒计时

---

### `start_game` — 立即开始（房主专属）
```json
{ "type": "start_game" }
```
- 取消倒计时，立即启动游戏
- 响应：`countdown { seconds: 0 }` + `room { started: true }`

---

### `response` — 回应操作请求
```json
{
  "type": "response",
  "request_id": "服务端生成的请求编号",
  "kind": "bid",
  "value": 5
}
```
- `kind` 必须与当前 `request` 消息的 `kind` 一致
- `value` 类型由各游戏的 `kind` 约定决定
- `request_id` 必须匹配当前请求；过期请求被拒绝，重复提交只确认，不重复执行
- 响应：`response_ack { request_id, accepted, msg }`；客户端收到成功确认后才清除操作

---

### `resume` — 恢复连接
```json
{ "type": "resume", "room": "ABC123", "token": "本人收到的 resume_token" }
```
- 断线宽限期默认 30 秒，通过 `ROOM_RECONNECT_GRACE_SECONDS` 设置（0–600 秒）
- 宽限期内不触发 AI 接管，原回合时限仍继续计时
- 成功后恢复原座位，依次同步 `room`、玩家视图、尚未完成的 `request` 或终局结果
- 客户端仅在当前浏览器会话保存恢复凭证，禁止放入 URL、日志或共享房间状态
- 超时或凭证无效返回 `error { code: "resume_expired" }`
- 观战者断开直接离房，重新观战需再次加入

---

### `leave_room` — 明确离房
```json
{ "type": "leave_room" }
```
- 等待室释放席位并转移房主；进行中的游戏立即由 AI 接管，不保留恢复资格
- 成功响应 `left_room`；所有真人离开后关闭房间、取消倒计时和广播任务

---

### `leave_game` — 主动离开游戏
```json
{ "type": "leave_game" }
```
- 游戏进行中有效，玩家离开后其位置由 AI 接管
- 若所有人类玩家均离开，游戏自动终止
- 服务器将该玩家从房间移除，不再接收其后续消息

---

### `ping`
```json
{ "type": "ping" }
```
响应：`pong`（每 15s 发送以保活）

---

## 服务器 → 客户端

### `game_list` — 游戏列表
```json
{
  "type": "game_list",
  "games": [
    {
      "id": "manila",
      "name": "马尼拉",
      "min_players": 3,
      "max_players": 5,
      "cover": ""
    }
  ]
}
```

---

### `room` — 房间状态（全量）
```json
{
  "type": "room",
  "code": "ABC123",
  "game_id": "manila",
  "player_count": 4,
  "host_idx": 0,
  "players": [
    { "name": "玩家1", "idx": 0, "connected": true, "is_ai": false },
    { "name": "AI-2",  "idx": 1, "connected": true, "is_ai": true  }
  ],
  "spectators": 0,
  "started": false,
  "turn_timeout": 30,
  "your_idx": 0,
  "resume_token": "仅当前成员的恢复凭证",
  "reconnect_grace_seconds": 30
}
```
- `your_idx` 仅在单独发给某玩家时携带
- `host_idx = -1` 表示房主已离线
- 玩家项的 `reconnecting: true` 表示正在宽限期内，尚未切换 AI

---

### `state` — 游戏状态（全量）
```json
{
  "type": "state",
  "game_id": "manila",
  "context": {}
}
```
- 前端调用 `gameRenderer.onState(msg.context)`

---

### `request` — 等待玩家操作
```json
{
  "type": "request",
  "request_id": "服务端生成的请求编号",
  "expires_at": 1780000000,
  "player_idx": 2,
  "kind": "bid",
  "data": { "current_bid": 3, "min_bid": 1 },
  "turn_timeout": 30
}
```
- `turn_timeout`：该回合时限（秒），`0` = 不限制；前端用于倒计时显示
- `expires_at` 为 Unix 秒数，`null` 表示无时限；重连后仍使用原截止时间
- 请求只发送给对应玩家，不广播操作数据给其他玩家或观战者
- 超时后服务器不等待，直接返回 `None`（游戏层处理）

---

### `log` — 日志消息
```json
{ "type": "log", "text": "玩家1 出价 5", "style": "bid" }
```

**内置 style 值：** `normal` / `header` / `section` / `warn` / `ai` / `bid` / `deploy` / `profit` / `dice`

---

### `countdown` — 满员倒计时
```json
{ "type": "countdown", "seconds": 12 }
```
- `seconds = 0` 表示取消倒计时

---

### `game_over` — 游戏结束
```json
{ "type": "game_over", "game_id": "manila", "result": {} }
```
- 前端调用 `gameRenderer.onGameOver(msg.result)`

---

### `error` — 错误响应
```json
{ "type": "error", "code": "room_not_found", "msg": "房间 XYZ 不存在" }
```

**ErrorCode：** `wrong_password` / `room_not_found` / `room_full` / `game_started` / `invalid_msg` / `not_your_turn` / `forbidden` / `resume_expired` / `room_closed` / `game_start_failed` / `game_busy` / `player_reconnecting`

---

## 典型消息流

```
Client                          Server
  │  → list                       │
  │  ← game_list                  │
  │  → create {game,name,...}      │
  │  ← room {your_idx:0}          │
  │    ...其他玩家加入...           │
  │  → start_game                 │
  │  ← countdown {seconds:0}      │
  │  ← room {started:true}        │
  │  ← state {context}            │
  │  ← request {kind,data,...}    │
  │  → response {kind,value}      │
  │  ← state {context}            │
  │      ... 游戏进行 ...          │
  │  ← game_over {result}         │
```
