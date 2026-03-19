#!/usr/bin/env bash
# tools/test-startup.sh — 验证 GamePlatform 可以正确启动并加载游戏
#
# 用法:
#   ./tools/test-startup.sh
#   MANILA_PATH=/custom/path ./tools/test-startup.sh
#
# 通过所有检查: 退出码 0；任一失败: 退出码 1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT_DIR="$(cd "$GP_ROOT/.." && pwd)"
GAMES_CONF="$SCRIPT_DIR/games.conf"

PASS=0; FAIL=0

ok()   { echo "  [OK]  $*"; (( PASS++ )); }
fail() { echo "  [FAIL] $*"; (( FAIL++ )); }

echo ""
echo "=== GamePlatform 启动前检查 ==========================="

# ── 1. Python 依赖 ────────────────────────────────────────────────────────────
echo ""
echo "-- 依赖 -----------------------------------------------"
for pkg in uvicorn fastapi; do
    if python3 -c "import $pkg" 2>/dev/null; then ok "$pkg 已安装"
    else fail "$pkg 未安装 (pip install $pkg)"; fi
done
if python3 -c "import websockets" 2>/dev/null; then ok "websockets 已安装"
else echo "  [WARN] websockets 未安装, 跳过 WS 测试"; WS_SKIP=1; fi
if python3 -c "import bcrypt" 2>/dev/null; then ok "bcrypt 已安装"
else fail "bcrypt 未安装 (pip install bcrypt)"; fi

# ── 2. 游戏目录 ────────────────────────────────────────────────────────────────
echo ""
echo "-- 游戏目录 -------------------------------------------"
if [[ -f "$GAMES_CONF" ]]; then
    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        read -r game_id env_var dir_name git_url <<< "$line"
        [[ -z "$env_var" ]] && continue
        if [[ -z "${!env_var}" ]]; then
            cand="$PARENT_DIR/$dir_name"
            [[ -d "$cand" ]] && export "$env_var"="$cand"
        fi
        val="${!env_var}"
        if [[ -n "$val" && -d "$val" ]]; then ok "$game_id: $val"
        else fail "$game_id: 目录未找到 (请设置 $env_var 或运行 fetch-games.sh)"; fi
    done < "$GAMES_CONF"
else
    fail "games.conf 不存在: $GAMES_CONF"
fi

# ── 3. 游戏插件加载 ────────────────────────────────────────────────────────────
echo ""
echo "-- 游戏插件加载 ----------------------------------------"
cd "$GP_ROOT"
LOAD_OUT=$(python3 -c "
import sys, os
sys.path.insert(0, os.getcwd())
from framework.games import list_games
all_ok = True
for g in list_games():
    if 'error' in g:
        print('[FAIL] ' + g['id'] + ': ' + g['error'])
        all_ok = False
    else:
        print('[OK]   ' + g['id'] + ': ' + g['name'] + ' (' + str(g['min_players']) + '-' + str(g['max_players']) + ' humans)')
sys.exit(0 if all_ok else 1)
" 2>&1)
LOAD_RC=$?
echo "$LOAD_OUT" | sed 's/^/  /'
if [[ $LOAD_RC -eq 0 ]]; then (( PASS++ )); else (( FAIL++ )); fi

# ── 4. 前端文件语法检查 ────────────────────────────────────────────────────────
echo ""
echo "-- 前端文件 -------------------------------------------"
LOBBY="$GP_ROOT/framework/static/lobby.js"
if [[ -f "$LOBBY" ]]; then
    JS_CHECK=$(python3 -c "
import re, sys
c = open('framework/static/lobby.js').read()
opens = c.count('{'); closes = c.count('}')
broken = re.findall(r'textContent\s*=\s*;', c)
if opens != closes:
    print('FAIL brace mismatch: { ' + str(opens) + ' } ' + str(closes))
    sys.exit(1)
elif broken:
    print('FAIL empty assignments (broken template literals): ' + str(broken[:3]))
    sys.exit(1)
else:
    print('OK lobby.js: ' + str(len(c.splitlines())) + ' lines, braces balanced')
    sys.exit(0)
" 2>&1)
    JS_RC=$?
    echo "  $JS_CHECK"
    if [[ $JS_RC -eq 0 ]]; then (( PASS++ )); else (( FAIL++ )); fi
else
    fail "lobby.js 不存在"
fi
[[ -f "$GP_ROOT/framework/static/index.html" ]] && ok "index.html 存在" || fail "index.html 不存在"

# ── 5. WebSocket 端到端测试 ────────────────────────────────────────────────────
if [[ -z "$WS_SKIP" ]]; then
    echo ""
    echo "-- WebSocket 端到端 ------------------------------------"
    TEST_PORT=18099
    python3 -m uvicorn framework.server:app --host 127.0.0.1 --port "$TEST_PORT" \
        > /tmp/gp_test_srv.log 2>&1 &
    SRV_PID=$!
    sleep 3

    WS_OUT=$(python3 -c "
import asyncio, websockets, json, sys
PORT = $TEST_PORT
async def run():
    errors = []
    try:
        async with websockets.connect('ws://127.0.0.1:' + str(PORT) + '/ws') as ws:
            await ws.send(json.dumps({'type': 'list'}))
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if m.get('type') == 'game_list' and m.get('games'):
                ids = [g['id'] for g in m['games'] if 'error' not in g]
                print('OK game_list: ' + str(ids))
            else:
                print('FAIL game_list: ' + str(m)); errors.append(1)

            first_id = m.get('games', [{}])[0].get('id', 'manila')
            await ws.send(json.dumps({'type':'create','game':first_id,'name':'T','player_count':3,'password':'','turn_timeout':30}))
            m2 = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            if m2.get('type') == 'room' and m2.get('code'):
                print('OK create room: code=' + m2['code'] + ' turn_timeout=' + str(m2.get('turn_timeout')))
            else:
                print('FAIL create room: ' + str(m2)); errors.append(1)
    except Exception as e:
        print('FAIL connection: ' + str(e)); errors.append(1)
    return len(errors) == 0
ok = asyncio.run(run())
sys.exit(0 if ok else 1)
" 2>&1)
    WS_RC=$?
    kill $SRV_PID 2>/dev/null; wait $SRV_PID 2>/dev/null || true
    echo "$WS_OUT" | sed 's/^/  /'
    if [[ $WS_RC -eq 0 ]]; then (( PASS++ )); else (( FAIL++ )); fi
fi

# ── 汇总 ──────────────────────────────────────────────────────────────────────
echo ""
echo "======================================================="
echo "  结果:  通过 $PASS  失败 $FAIL"
echo "======================================================="
echo ""
[[ $FAIL -gt 0 ]] && exit 1 || exit 0
