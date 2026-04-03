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

## 问题：首次打开页面时创建房间提示"请选择游戏"

**症状：** 通过域名首次打开大厅，立即点击"创建房间"会报"请选择游戏"；等待几秒后恢复正常。

**根因：** 页面 HTML 已经加载完，但 WebSocket 连接尚未建立，或首个 `game_list` 消息还没返回。旧版大厅会在 `selectedGame` 仍为空时直接允许点击创建。

**现有修复：**
- 大厅初始状态下禁用"创建房间"按钮
- 收到 `game_list` 后才设置默认游戏并启用按钮
- 断线重连时重置 `selectedGame` 和按钮状态

**仍然等待较久时的排查：**
```bash
# 服务器本机检查应用是否正常
curl http://127.0.0.1:8000/

# 如已安装 websockets，可直接验证本机 WS 首包
python3 - <<'PY'
import asyncio, json, websockets
async def main():
    async with websockets.connect('ws://127.0.0.1:8000/ws') as ws:
        await ws.send(json.dumps({'type': 'list'}))
        print(await asyncio.wait_for(ws.recv(), timeout=3))
asyncio.run(main())
PY
```

若本机快、域名慢，则基本可判定是 Nginx/Caddy/CDN 层的 WebSocket 握手或代理配置问题。

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
| 游戏创建报 invalid_msg | 游戏 ID 未在 `_GAME_REGISTRY` 注册 | `python3 -c "from framework.games import list_games; print(list_games())"` |
| 超时不生效 | turn_timeout 未传给 registry | `grep turn_timeout server.py` |
| AI 接管后游戏卡住 | ask() 未解除阻塞 | `grep _response_event.set net_bridge.py` |
| start.sh 退出码 1 | 端口 8000 已被占用 | `ss -tlnp | grep 8000` 确认并 kill |

---

## 常见服务器端代码陷阱

### 陷阱 1：`ws_endpoint` 内使用 `msg.get()` 而非 `data.get()`

`ws_endpoint` 中收到的 JSON 已解析为 `data`，**不叫 `msg`**：

```python
# ❌ NameError
game_id = msg.get('game_id')

# ✅ 正确
game_id = data.get('game_id')
```

### 陷阱 2：使用 `_send(ws, {...})` 而非 `send({...})`

`ws_endpoint` 内有局部闭包 `send = lambda d: ...`，**直接用 `send()`**，
不要调用模块级的 `_send(ws, ...)`（该函数不存在或在不同作用域）：

```python
# ❌ NameError
await _send(ws, {"type": "error", "code": "forbidden"})

# ✅ 正确
await send({"type": "error", "code": "forbidden"})
```

### 陷阱 3：在 async 处理器中做阻塞 import

`ws_endpoint` 是 asyncio 协程，在其中调用 `importlib.import_module()` 会
**阻塞整个事件循环**，导致所有 WebSocket 连接卡顿：

```python
# ❌ 阻塞事件循环
game_cls = importlib.import_module(module_path)

# ✅ 用静态 _GAME_REGISTRY 做验证，延迟 import 只在 _start_game() 中发生
if game_id not in _GAME_REGISTRY:
    await send({"type": "error", "code": "invalid_msg"})
    return
```


---

## 问题：多游戏并存时某个游戏加载报 ImportError / 拿到错误的类

**症状：**
```
cannot import name 'IncanGoldGame' from 'online.adapter'
(/home/.../Manila/online/adapter.py)
```
即 `incan_gold` 插件 import 到了 Manila 的 `online.adapter`。

**根因：**
多个游戏都有 `online/adapter.py`，Python 将第一个加载的版本缓存到 `sys.modules['online.adapter']`。
后续插件执行 `from online.adapter import XxxGame` 直接命中缓存，拿到的是别的游戏的模块。

**修复：plugin.py 必须使用模块隔离模式（参考 Avalon）**

```python
import os, sys

_PATH = os.environ.get("MYGAME_PATH", ...)
_real = os.path.realpath(_PATH)

# 1. 保存其他游戏已缓存的同名模块
_CONFLICT_NAMES = [
    "online", "online.state", "online.adapter", "online._ui_shim",
    "constants", "player", "game", "ai",   # 游戏自身的顶层模块
]
_saved = {k: sys.modules[k] for k in _CONFLICT_NAMES if k in sys.modules}
for k in _CONFLICT_NAMES:
    sys.modules.pop(k, None)

if _real not in sys.path:
    sys.path.insert(0, _real)

# 2. 加载本游戏适配器（此时 online.adapter 指向本游戏）
from online.adapter import MyGame  # noqa: E402

# 3. 将本游戏模块移入私有命名空间
for k in list(sys.modules.keys()):
    if k == "online" or k.startswith("online."):
        sys.modules[f"_mygame_{k}"] = sys.modules.pop(k)
for k in ["constants", "player", "game", "ai"]:
    if k in sys.modules:
        sys.modules[f"_mygame_{k}"] = sys.modules.pop(k)

# 4. 恢复其他游戏的缓存
sys.modules.update(_saved)

GAME_CLASS = MyGame
```

**验证方法（测试所有加载顺序）：**
```python
from framework.games import _cache, get_game_class
_cache.clear()
for gid in ['incan_gold', 'transcard', 'manila']:
    cls = get_game_class(gid)
    print(gid, '->', cls.__name__)
```
所有游戏 class 名称必须对应正确，不得串行。

**tools/games.conf 也需要添加新游戏行：**
```
mygame  MYGAME_PATH  MyGame  https://github.com/...
```
格式：`<game_id>  <env_var>  <local_dir_name>  <git_url_or_local>`
