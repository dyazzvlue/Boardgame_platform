#!/usr/bin/env bash
# Validate plugins, HTTP/WebSocket lifecycles, and the current Vue build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON="${PYTHON:-python3}"
cd "$GP_ROOT"

if [[ ! -f framework/static/dist/index.html ]]; then
    echo "Missing Vue production build. Run: cd frontend && npm ci && npm run build" >&2
    exit 1
fi

"$PYTHON" -m unittest discover -s tests -p 'test_*.py' -v
npm --prefix frontend test
