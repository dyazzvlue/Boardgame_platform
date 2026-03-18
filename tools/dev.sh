#!/usr/bin/env bash
# tools/dev.sh — 开发模式启动（--reload，绑定 localhost）
# 用法:
#   ./tools/dev.sh
#   ./tools/dev.sh --port 9000

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/start.sh" --host 127.0.0.1 --reload "$@"
