#!/usr/bin/env bash
set -euo pipefail

GP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEARNING_REPO="${LEARNING_REPO:-$(dirname "$(dirname "$GP_ROOT")")/dy_docs_and_skills}"
TARGET="$GP_ROOT/framework/static/learning"
if [[ ! -f "$LEARNING_REPO/tools/learning/build.cjs" ]]; then
    printf 'Set LEARNING_REPO to the dy_docs_and_skills checkout.\n' >&2
    exit 1
fi

npm --prefix "$LEARNING_REPO/tools/learning" ci --no-audit --no-fund
STAGE="$(mktemp -d "$GP_ROOT/framework/static/.learning-build-XXXXXX")"
PREVIOUS="$STAGE-previous"
cleanup() {
    if [[ -d "$PREVIOUS" && ! -d "$TARGET" ]]; then
        mv "$PREVIOUS" "$TARGET"
    fi
    rm -rf "$STAGE" "$PREVIOUS"
}
trap cleanup EXIT
node "$LEARNING_REPO/tools/learning/build.cjs" --site-dir "$STAGE"
if [[ -e "$TARGET" ]]; then
    mv "$TARGET" "$PREVIOUS"
fi
mv "$STAGE" "$TARGET"
printf 'Learning site published to %s\n' "$TARGET"
