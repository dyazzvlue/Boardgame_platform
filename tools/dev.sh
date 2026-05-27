#!/usr/bin/env bash
# tools/dev.sh — 开发模式：后端 uvicorn (--reload) + 前端 vite dev server
# 用法: ./tools/dev.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
FRONTEND="$ROOT/frontend"

# Start backend
echo "🚀 Starting backend (uvicorn --reload)..."
"$SCRIPT_DIR/start.sh" --host 127.0.0.1 --reload &
BACKEND_PID=$!

# Start frontend dev server
if [ -d "$FRONTEND" ] && [ -f "$FRONTEND/package.json" ]; then
    echo "🎨 Starting frontend (vite dev)..."
    cd "$FRONTEND" && npx vite --host 127.0.0.1 --port 5173 &
    FRONTEND_PID=$!
fi

# Trap SIGINT/SIGTERM to kill both
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

echo ""
echo "  Backend:  http://127.0.0.1:8000"
echo "  Frontend: http://127.0.0.1:5173 (with API proxy)"
echo ""

wait
