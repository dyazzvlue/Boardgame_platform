#!/usr/bin/env bash
# tools/start.sh — 快速启动 GamePlatform 服务器
# 用法:
#   ./tools/start.sh                        # 默认端口 8000，游戏路径自动推断
#   ./tools/start.sh --port 9000            # 自定义端口
#   MANILA_PATH=/custom/path ./tools/start.sh
#
# 游戏路径优先级：环境变量 > games.conf 中声明的 local_dir_name（与 gameplatform 平级）
# 可从任意目录运行；PYTHON 可指定虚拟环境的解释器。
#   使用 --public 参数才会绑定 0.0.0.0（生产环境应由 Nginx 反代，不需要此参数）。

set -e

# ── 找到 gameplatform 根目录 ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT_DIR="$(cd "$GP_ROOT/.." && pwd)"
GAMES_CONF="$SCRIPT_DIR/games.conf"
PYTHON="${PYTHON:-python3}"
cd "$GP_ROOT"

# ── 默认参数 ─────────────────────────────────────────────────────────────────
PORT=8000
RELOAD=""
HOST="127.0.0.1"   # 默认仅本地监听，由 Nginx 反代；--public 才绑定 0.0.0.0

# ── 解析参数 ─────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)    PORT="$2";   shift 2 ;;
        --reload)  RELOAD="--reload"; shift ;;
        --host)    HOST="$2";   shift 2 ;;
        --public)  HOST="0.0.0.0"; shift ;;  # 直接暴露，仅开发/局域网使用
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── 读取 games.conf，自动推断各游戏路径 ─────────────────────────────────────
GAME_PATH_SUMMARY=""
MISSING_GAMES=""

if [[ -f "$GAMES_CONF" ]]; then
    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        read -r game_id env_var dir_name git_url <<< "$line"
        [[ -z "$env_var" || -z "$dir_name" ]] && continue

        # 若环境变量未设置，尝试自动推断
        if ! val="$(printenv "$env_var")"; then
            val=""
        fi
        if [[ -z "$val" ]]; then
            candidate="$PARENT_DIR/$dir_name"
            if [[ -d "$candidate" ]]; then
                export "$env_var"="$candidate"
                val="$candidate"
            fi
        fi

        # 收集路径状态用于打印
        if [[ -n "$val" ]]; then
            GAME_PATH_SUMMARY+="│  ${env_var}:  $val"$'\n'
        else
            GAME_PATH_SUMMARY+="│  ${env_var}:  ❌ 未找到（游戏 $game_id 将不可用）"$'\n'
            MISSING_GAMES+=" $game_id"
        fi
    done < "$GAMES_CONF"
else
    GAME_PATH_SUMMARY="│  ⚠  未找到 games.conf，跳过路径推断"$'\n'
fi

echo "┌─────────────────────────────────────────────┐"
echo "│          GamePlatform 启动中...              │"
echo "├─────────────────────────────────────────────┤"
echo "│  根目录:     $GP_ROOT"
printf "%s" "$GAME_PATH_SUMMARY"
echo "│  监听:       http://$HOST:$PORT"
echo "│  热重载:     ${RELOAD:-(关闭)}"
echo "└─────────────────────────────────────────────┘"

if [[ -n "$MISSING_GAMES" ]]; then
    echo ""
    echo "⚠  以下游戏目录未找到，对应游戏启动时将报错：$MISSING_GAMES"
    echo "   可运行 tools/fetch-games.sh 来克隆缺失的游戏 repo。"
fi

# ── 预检：尝试加载各游戏插件，打印结果 ──────────────────────────────────────
echo ""
echo "── 游戏加载检查 ─────────────────────────────────"
if "$PYTHON" - << 'PYEOF'
import sys
from framework.games import get_game_class, list_games
games = list_games()
failed = False
for g in games:
    try:
        get_game_class(g['id'])
        print(f"  ✔  {g['id']:12s}  {g['name']}  ({g['min_players']}–{g['max_players']} 人)")
    except (ImportError, OSError, RuntimeError) as exc:
        failed = True
        print(f"  ✘  {g['id']:12s}  {exc}", file=sys.stderr)
sys.exit(1 if failed else 0)
PYEOF
then
    LOAD_RESULT=0
else
    LOAD_RESULT=1
fi

echo "─────────────────────────────────────────────────"
echo ""

if [[ $LOAD_RESULT -ne 0 ]]; then
    echo "⚠  部分游戏加载失败，服务器仍会启动，但失败的游戏将无法运行。"
    echo ""
fi

cd "$GP_ROOT"
exec "$PYTHON" -m uvicorn framework.server:app \
    --host "$HOST" \
    --port "$PORT" \
    --log-level warning \
    $RELOAD
