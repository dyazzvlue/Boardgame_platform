# GamePlatform — 调试经验与常见问题

## 快速诊断工具

```bash
# 1. 运行启动测试（推荐第一步）
bash tools/test-startup.sh

# 2. 手动测试游戏加载
cd gameplatform
MANILA_PATH=../Manila AVALON_PATH=../Avalon python3 -c "
from framework.games import list_games
for g in list_games(): print(g)
"

# 3. 检查 lobby.js 语法健康度
python3 -c "
import re
c = open('framework/static/lobby.js').read()
print('Lines:', len(c.splitlines()))
print('Braces: {', c.count('{'), '} ', c.count('}'))
broken = re.findall(r'textContent\s*=\s*;', c)
print('Broken assignments:', broken or 'none')
"

# 4. 直接测试 WebSocket 游戏列表响应
python3 -c "
import asyncio, websockets, json
async def t():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        await ws.send(json.dumps({'type': 'list'}))
        print(await asyncio.wait_for(ws.recv(), timeout=3))
asyncio.run(t())
"
```

---

## 问题：游戏列表显示"加载中..."永不更新

**症状：** 页面加载后 `#game-list` 始终显示"加载中..."，无游戏卡片。

**排查步骤：**
1. 打开浏览器开发者工具 → Console，查看是否有 `SyntaxError`
2. Network 面板过滤 WS，确认 `/ws` 是否连接成功
3. 在 Console 输入 `ws`，若为 `null` 说明脚本执行失败

**历史根因：** 用 bash heredoc (`<< 'EOF'`) 写入 JS 文件时，反引号模板字符串被
bash 当作命令替换执行，字符串内容丢失，产生 `textContent = ;` 这类空赋值语法错误，
导致整个脚本静默失败。

**修复规则：**
- 写入含反引号的 JS 文件，必须用 Python 脚本操作，不能用 bash heredoc
- 或将模板字符串改为字符串拼接：
  ```javascript
  // 安全写法
  timerEl.textContent = '⏳ ' + name + ' 的回合';
  ```

**预防：** 每次修改 `lobby.js` 后运行语法检查：
```bash
python3 -c "
c = open('framework/static/lobby.js').read()
import re; broken = re.findall(r'textContent\s*=\s*;', c)
print('BRACES:', c.count('{'), c.count('}'), '| BROKEN:', broken or 'none')
"
```

---

## 问题：修改 lobby.js 后浏览器不更新

**原因：** 浏览器缓存了 `lobby.js`，只要 `index.html` 中的版本号不变就不重新请求。

**立即解决：** 浏览器强制刷新 `Ctrl+Shift+R`

**正确做法：** 每次修改前端文件后更新 `index.html` 中对应的版本号：
```python
path = 'framework/static/index.html'
c = open(path).read()
c = c.replace('lobby.js?v=旧版本号', 'lobby.js?v=新版本号')  # 用 Unix 时间戳
open(path, 'w').write(c)
```

---

## 问题：游戏路径未设置（游戏加载报错）

**症状：** 启动检查显示 `[FAIL] manila: ...`，或浏览器创建房间时错误。

**排查：**
```bash
env | grep -E "MANILA|AVALON"

# 确认目录是否平级存在
ls /path/to/Personal/Manila /path/to/Personal/Avalon
```

**解决：** 游戏目录须与 `gameplatform/` 平级，且目录名与 `tools/games.conf` 第3列一致。
路径不对时手动指定：
```bash
MANILA_PATH=/custom/path bash tools/start.sh
```
目录不存在时拉取：
```bash
bash tools/fetch-games.sh
```

---

## 问题：turn_timeout 设置无效

**历史 Bug：** `server.py` 的 CREATE handler 读取了 `turn_timeout` 字段但未传给
`_registry.create()`，所有房间均使用默认值 `30`。

**验证：**
```bash
grep "turn_timeout\|_registry.create" framework/server.py
```
正确输出应包含：
```python
timeout = int(data.get('turn_timeout', 30))
room = _registry.create(gid, count, pwd, turn_timeout=timeout)
```

---

## 问题：玩家断线后游戏线程卡死

**根因：** 旧版 `ask()` 使用无超时的 `Event.wait()`；`_handle_disconnect` 触发
但未调 `_response_event.set()`，导致游戏线程永久挂起。

**现有保障（两层）：**
1. `_handle_disconnect` / `handle_leave` 在标记断线后，若 `_pending_player_idx`
   匹配，立即 `self._response_event.set()`
2. `ask()` 使用 `wait(timeout=N)` 防止永久阻塞

**验证：**
```bash
grep -n "_response_event.set\|wait(timeout" framework/net_bridge.py
```

---

## 常见部署问题速查

| 现象 | 可能原因 | 快速验证 |
|------|---------|---------|
| 游戏列表"加载中" | lobby.js 语法错误 / 浏览器缓存 | 浏览器 Console 看 SyntaxError |
| WS 连接失败 | 服务器未启动 / 端口错误 | `ss -tlnp | grep 8000` |
| 游戏创建报 invalid_msg | 游戏插件加载失败 | `bash tools/test-startup.sh` |
| 超时不生效 | turn_timeout 未传给 registry | `grep turn_timeout server.py` |
| AI 接管后游戏卡住 | ask() 未解除阻塞 | `grep _response_event.set net_bridge.py` |
