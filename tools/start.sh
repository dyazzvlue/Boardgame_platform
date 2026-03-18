#!/usr/bin/env bash
# tools/start.sh — 快速启动 GamePlatform 服务器
# 用法:
#   ./tools/start.sh                        # 默认端口 8000，Manila 路径自动推断
#   ./tools/start.sh --port 9000            # 自定义端口
#   MANILA_PATH=/custom/path ./tools/start.sh
#
# 必须在 gameplatform 根目录或其子目录下运行。

set -e

# ── 找到 gameplatform 根目录 ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 默认参数 ─────────────────────────────────────────────────────────────────
PORT=8000
RELOAD=""
HOST="0.0.0.0"

# ── 解析参数 ─────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)    PORT="$2";   shift 2 ;;
        --reload)  RELOAD="--reload"; shift ;;
        --host)    HOST="$2";   shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── 推断 MANILA_PATH ──────────────────────────────────────────────────────────
if [[ -z "$MANILA_PATH" ]]; then
    CANDIDATE="$(cd "$GP_ROOT/.." && pwd)/Manila"
    if [[ -d "$CANDIDATE" ]]; then
        export MANILA_PATH="$CANDIDATE"
    else
        echo "❌ 未找到 Manila 目录，请手动设置 MANILA_PATH 环境变量："
        echo "   MANILA_PATH=/path/to/Manila $0"
        exit 1
    fi
fi

echo "┌─────────────────────────────────────────────┐"
echo "│          GamePlatform 启动中...              │"
echo "├─────────────────────────────────────────────┤"
echo "│  根目录:     $GP_ROOT"
echo "│  Manila:     $MANILA_PATH"
echo "│  监听:       http://$HOST:$PORT"
echo "│  热重载:     ${RELOAD:-(关闭)}"
echo "└─────────────────────────────────────────────┘"
echo ""

cd "$GP_ROOT"
exec uvicorn framework.server:app \
    --host "$HOST" \
    --port "$PORT" \
    $RELOAD
