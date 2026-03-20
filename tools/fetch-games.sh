#!/usr/bin/env bash
# tools/fetch-games.sh — 根据 games.conf 克隆或更新所有游戏 repo
#
# 用法:
#   ./tools/fetch-games.sh              # 克隆/更新全部游戏
#   ./tools/fetch-games.sh manila       # 只处理 manila
#   ./tools/fetch-games.sh manila avalon
#
# 游戏 repo 克隆到 gameplatform 平级目录，例如：
#   /path/to/Personal/Manila/
#   /path/to/Personal/Avalon/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GAMES_CONF="$SCRIPT_DIR/games.conf"
PARENT_DIR="$(cd "$GP_ROOT/.." && pwd)"

if [[ ! -f "$GAMES_CONF" ]]; then
    echo "❌ 未找到配置文件: $GAMES_CONF"
    exit 1
fi

# 过滤参数：若指定了游戏 ID，则只处理这些
FILTER=("$@")

ok_count=0
skip_count=0
fail_count=0

echo "┌─────────────────────────────────────────────┐"
echo "│        GamePlatform 游戏 Repo 同步           │"
echo "├─────────────────────────────────────────────┤"
echo "│  配置文件:  $GAMES_CONF"
echo "│  目标目录:  $PARENT_DIR"
echo "└─────────────────────────────────────────────┘"
echo ""

while IFS= read -r line; do
    # 跳过空行和注释
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    read -r game_id env_var dir_name git_url <<< "$line"

    # 若指定了过滤列表，跳过不在列表中的游戏
    if [[ ${#FILTER[@]} -gt 0 ]]; then
        found=0
        for f in "${FILTER[@]}"; do
            [[ "$f" == "$game_id" ]] && found=1 && break
        done
        [[ $found -eq 0 ]] && continue
    fi

    target="$PARENT_DIR/$dir_name"

    echo "── $game_id ─────────────────────────────────"
    echo "   目录: $target"
    echo "   Repo: $git_url"

    if [[ -d "$target/.git" ]]; then
        echo "   ↻  已存在，执行 git pull..."
        if git -C "$target" pull --ff-only; then
            echo "   ✔  更新成功"
            ok_count=$((ok_count + 1))
        else
            echo "   ⚠  pull 失败（可能有本地修改），跳过"
            fail_count=$((fail_count + 1))
        fi
    else
        echo "   ↓  首次克隆..."
        if git clone "$git_url" "$target"; then
            echo "   ✔  克隆成功"
            ok_count=$((ok_count + 1))
        else
            echo "   ✘  克隆失败"
            fail_count=$((fail_count + 1))
        fi
    fi
    echo ""
done < "$GAMES_CONF"

echo "────────────────────────────────────────────"
echo "  完成: ✔ $ok_count  ✘ $fail_count"
[[ $fail_count -gt 0 ]] && exit 1 || exit 0
