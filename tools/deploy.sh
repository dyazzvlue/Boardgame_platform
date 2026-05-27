#!/usr/bin/env bash
# tools/deploy.sh — GamePlatform 一键部署脚本
# 适用于 Ubuntu/Debian 系统，假设从刚刚 clone 好的 repo 开始
#
# 用法:
#   cd gameplatform
#   bash tools/deploy.sh
#
# 可选参数:
#   --skip-nginx    不生成 Nginx 配置
#   --skip-systemd  不生成 systemd 服务文件
#   --dev           开发模式（不安装 Nginx/systemd，绑定 0.0.0.0）

set -e

# ── 颜色输出 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 参数解析 ──────────────────────────────────────────────────────────────────
SKIP_NGINX=0
SKIP_SYSTEMD=0
DEV_MODE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-nginx)   SKIP_NGINX=1; shift ;;
        --skip-systemd) SKIP_SYSTEMD=1; shift ;;
        --dev)          DEV_MODE=1; SKIP_NGINX=1; SKIP_SYSTEMD=1; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── 定位项目根目录 ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$GP_ROOT"

echo ""
echo "┌─────────────────────────────────────────────┐"
echo "│       GamePlatform 部署脚本                  │"
echo "├─────────────────────────────────────────────┤"
echo "│  项目目录: $GP_ROOT"
echo "│  模式:     $([ $DEV_MODE -eq 1 ] && echo '开发' || echo '生产')"
echo "└─────────────────────────────────────────────┘"
echo ""

# ── Step 1: 检查系统依赖 ─────────────────────────────────────────────────────
info "检查系统依赖..."

# Python
if ! command -v python3 &>/dev/null; then
    err "未找到 python3，请安装 Python 3.10+：\n  sudo apt install python3 python3-venv python3-pip"
fi
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
if [[ $PY_MAJOR -lt 3 || ($PY_MAJOR -eq 3 && $PY_MINOR -lt 10) ]]; then
    err "Python 版本过低: $PY_VER (需要 >= 3.10)"
fi
ok "Python $PY_VER"

# Node.js
if ! command -v node &>/dev/null; then
    err "未找到 node，请安装 Node.js 18+：\n  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -\n  sudo apt install -y nodejs"
fi
NODE_VER=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [[ $NODE_MAJOR -lt 18 ]]; then
    err "Node.js 版本过低: $NODE_VER (需要 >= 18)"
fi
ok "Node.js $NODE_VER"

# npm
if ! command -v npm &>/dev/null; then
    err "未找到 npm"
fi
ok "npm $(npm -v)"

# Git
if ! command -v git &>/dev/null; then
    err "未找到 git"
fi
ok "Git $(git --version | awk '{print $3}')"

echo ""

# ── Step 2: Python 虚拟环境 ──────────────────────────────────────────────────
info "设置 Python 虚拟环境..."

if [[ ! -d ".venv" ]]; then
    python3 -m venv .venv
    ok "虚拟环境已创建: .venv/"
else
    ok "虚拟环境已存在: .venv/"
fi

source .venv/bin/activate
ok "已激活虚拟环境 ($(python --version))"

# ── Step 3: 安装 Python 依赖 ─────────────────────────────────────────────────
info "安装 Python 依赖..."
pip install --upgrade pip -q
pip install -r requirements.txt -q
pip install -e . -q
ok "Python 依赖安装完成"
echo ""

# ── Step 4: 拉取游戏 repo ────────────────────────────────────────────────────
info "拉取游戏 repo..."
bash tools/fetch-games.sh
echo ""

# ── Step 5: 构建前端 ─────────────────────────────────────────────────────────
info "构建前端..."

if [[ ! -d "frontend" ]]; then
    warn "未找到 frontend/ 目录，跳过前端构建"
else
    cd frontend
    npm install --silent
    npm run build
    cd "$GP_ROOT"
    ok "前端构建完成 → framework/static/dist/"
fi
echo ""

# ── Step 6: 初始化数据库 ─────────────────────────────────────────────────────
info "初始化数据库..."

if [[ -f "blog.db" ]]; then
    ok "数据库已存在 (blog.db)，跳过初始化"
else
    python -m framework init-db
    ok "数据库已初始化"
fi
echo ""

# ── Step 7: 创建管理员账号 ───────────────────────────────────────────────────
info "创建管理员账号..."
echo "  如需创建/重置管理员账号，请运行："
echo "    source .venv/bin/activate"
echo "    python -m framework create-admin"
echo ""

# ── Step 8: Systemd 服务 ─────────────────────────────────────────────────────
if [[ $SKIP_SYSTEMD -eq 0 ]]; then
    info "生成 systemd 服务文件..."

    SERVICE_FILE="$GP_ROOT/tools/gameplatform.service"
    cat > "$SERVICE_FILE" << SERVICEEOF
[Unit]
Description=GamePlatform Server
After=network.target

[Service]
User=$(whoami)
WorkingDirectory=$GP_ROOT
Environment=PATH=$GP_ROOT/.venv/bin:/usr/bin:/bin
ExecStart=$GP_ROOT/.venv/bin/python -m uvicorn framework.server:app --host 127.0.0.1 --port 8000 --log-level warning
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

    ok "服务文件已生成: $SERVICE_FILE"
    echo "  安装服务："
    echo "    sudo cp $SERVICE_FILE /etc/systemd/system/"
    echo "    sudo systemctl daemon-reload"
    echo "    sudo systemctl enable --now gameplatform"
    echo ""
fi

# ── Step 9: Nginx 配置 ───────────────────────────────────────────────────────
if [[ $SKIP_NGINX -eq 0 ]]; then
    info "生成 Nginx 配置模板..."

    NGINX_FILE="$GP_ROOT/tools/nginx.conf"
    cat > "$NGINX_FILE" << 'NGINXEOF'
# GamePlatform Nginx 配置
# 用法:
#   1. 替换 YOUR_DOMAIN 为实际域名
#   2. sudo cp tools/nginx.conf /etc/nginx/sites-available/gameplatform
#   3. sudo ln -s /etc/nginx/sites-available/gameplatform /etc/nginx/sites-enabled/
#   4. sudo nginx -t && sudo systemctl reload nginx
#   5. sudo certbot --nginx -d YOUR_DOMAIN

# 速率限制
limit_req_zone $binary_remote_addr zone=gp_limit:10m rate=30r/m;
limit_conn_zone $binary_remote_addr zone=gp_conn:10m;

server {
    listen 80;
    server_name YOUR_DOMAIN;

    # 连接限制
    limit_conn gp_conn 20;

    # 静态资源（Vite 构建产物带 hash，可长缓存）
    location /assets/ {
        proxy_pass http://127.0.0.1:8000/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # API + SPA fallback
    location / {
        limit_req zone=gp_limit burst=10 nodelay;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINXEOF

    ok "Nginx 配置模板已生成: $NGINX_FILE"
    echo "  请编辑 $NGINX_FILE，将 YOUR_DOMAIN 替换为实际域名"
    echo ""
fi

# ── 完成 ──────────────────────────────────────────────────────────────────────
echo ""
echo "┌─────────────────────────────────────────────┐"
echo "│           ✔  部署完成！                      │"
echo "├─────────────────────────────────────────────┤"

if [[ $DEV_MODE -eq 1 ]]; then
    echo "│  开发模式启动："
    echo "│    source .venv/bin/activate"
    echo "│    bash tools/start.sh --public --reload"
    echo "│"
    echo "│  或使用 dev.sh（同时启动前后端）："
    echo "│    bash tools/dev.sh"
else
    echo "│  快速测试："
    echo "│    source .venv/bin/activate"
    echo "│    bash tools/start.sh --public"
    echo "│"
    echo "│  生产部署："
    echo "│    sudo systemctl start gameplatform"
    echo "│    访问 http://YOUR_DOMAIN"
fi

echo "└─────────────────────────────────────────────┘"
echo ""
