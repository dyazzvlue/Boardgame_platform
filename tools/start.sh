#!/usr/bin/env bash
# tools/start.sh — 快速启动 GamePlatform 服务器
# 用法:
#   ./tools/start.sh                        # 默认端口 8000，游戏路径自动推断
#   ./tools/start.sh --port 9000            # 自定义端口
#   MANILA_PATH=/custom/path ./tools/start.sh
#
# 游戏路径优先级：环境变量 > games.conf 中声明的 local_dir_name（与 gameplatform 平级）
# 必须在 gameplatform 根目录或其子目录下运行。
#   使用 --public 参数才会绑定 0.0.0.0（生产环境应由 Nginx 反代，不需要此参数）。

set -e

# ── 找到 gameplatform 根目录 ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT_DIR="$(cd "$GP_ROOT/.." && pwd)"
GAMES_CONF="$SCRIPT_DIR/games.conf"

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
        if [[ -z "${!env_var}" ]]; then
            candidate="$PARENT_DIR/$dir_name"
            if [[ -d "$candidate" ]]; then
                export "$env_var"="$candidate"
            fi
        fi

        # 收集路径状态用于打印
        val="${!env_var}"
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
LOAD_OK=0
LOAD_FAIL=0

python3 - << 'PYEOF'
import sys, os
sys.path.insert(0, os.getcwd())
from framework.games import list_games
games = list_games()
for g in games:
    if 'error' in g:
        print(f"  ✘  {g['id']:12s}  {g['error']}")
    else:
        print(f"  ✔  {g['id']:12s}  {g['name']}  ({g['min_players']}–{g['max_players']} 人)")
sys.exit(1 if any('error' in g for g in games) else 0)
PYEOF
LOAD_RESULT=$?

echo "─────────────────────────────────────────────────"
echo ""

if [[ $LOAD_RESULT -ne 0 ]]; then
    echo "⚠  部分游戏加载失败，服务器仍会启动，但失败的游戏将无法运行。"
    echo ""
fi

cd "$GP_ROOT"
exec uvicorn framework.server:app \
    --host "$HOST" \
    --port "$PORT" \
    --log-level warning \
    $RELOAD
