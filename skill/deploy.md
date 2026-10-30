# GamePlatform — 部署指南

## 架构概览

```
互联网
  │  443 (HTTPS/WSS)
  ▼
Nginx（SSL 终止 + 反向代理 + 速率限制）
  │  127.0.0.1:8000 (HTTP/WS)
  ▼
uvicorn / GamePlatform（仅本地监听）
  │
  ├── /api/blog/*    博客 REST API
  ├── /api/admin/*   管理后台 API
  ├── /ws            WebSocket 游戏逻辑
  ├── /assets/*      Vite 构建产物
  ├── /post/* 等     博客正文与列表预渲染
  ├── /sitemap.xml   已发布页面的站点地图
  └── /*             游戏/后台 SPA fallback
```

生产环境中 uvicorn 只监听 `127.0.0.1`，所有外部流量经 Nginx 进入。

---

## 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Python | 3.10+ | FastAPI + asyncio |
| Node.js | 22.12+（22.x）或 24+ | 前端构建，固定版本见 `frontend/.nvmrc` |
| npm | 9+ | 随 Node.js 安装 |
| Git | 2.x | 克隆代码 |
| Nginx | 1.18+ | 反向代理（生产） |

---

## 一键部署

使用自动部署脚本（适用于 Ubuntu/Debian）：

```bash
git clone https://github.com/dyazzvlue/Boardgame_platform.git gameplatform
cd gameplatform
bash tools/deploy.sh
```

脚本会自动完成以下步骤：
1. 检查 Python/Node.js 版本
2. 创建 Python 虚拟环境并安装依赖
3. 克隆所有游戏 repo
4. 安装前端依赖并构建
5. 初始化数据库
6. 创建管理员账号（交互式输入）
7. 生成 systemd 服务文件

详见 `tools/deploy.sh` 源码。

---

## 手动部署步骤

### 1. 系统依赖（Ubuntu/Debian）

```bash
sudo apt update && sudo apt install -y \
    python3 python3-venv python3-pip \
    nginx certbot python3-certbot-nginx \
    git curl ufw

# 另行安装 Node.js LTS 或 nvm；克隆后按 frontend/.nvmrc 选择版本。

# 防火墙
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 2. 克隆代码

```bash
cd /srv
git clone https://github.com/dyazzvlue/Boardgame_platform.git gameplatform
cd gameplatform
# 若使用 nvm：
cd frontend && nvm install && nvm use && cd ..
```

### 3. Python 环境

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .  # 安装框架本身（可选，方便 CLI 使用）
```

### 4. 拉取游戏 repo

```bash
bash tools/fetch-games.sh
```

游戏 repo 会被克隆到 `gameplatform/` 的同级目录下。

### 5. 构建前端

```bash
cd frontend
npm ci
npm run build    # 输出到 ../framework/static/dist/
cd ..
```

### 6. 初始化数据库

```bash
source .venv/bin/activate
python -m framework init-db        # 创建 blog.db 及表结构
python -m framework create-admin   # 交互式创建管理员账号
```

### 7. 配置 Nginx

```nginx
server {
    listen 80;
    server_name game.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/gameplatform /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 8. SSL 证书

```bash
sudo certbot --nginx -d game.example.com
```

### 9. Systemd 服务

```ini
# /etc/systemd/system/gameplatform.service
[Unit]
Description=GamePlatform Server
After=network.target

[Service]
User=www-data
WorkingDirectory=/srv/gameplatform
Environment=PATH=/srv/gameplatform/.venv/bin:/usr/bin:/bin
ExecStart=/srv/gameplatform/.venv/bin/python -m uvicorn framework.server:app --host 127.0.0.1 --port 8000 --log-level warning
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gameplatform
```

---

## start.sh 参数说明

| 参数 | 说明 |
|------|------|
| （默认） | 监听 `127.0.0.1:8000`，适合 Nginx 反代的生产环境 |
| `--public` | 监听 `0.0.0.0:8000`，用于局域网直接访问（测试/开发） |
| `--port N` | 指定端口 |
| `--reload` | 开启 uvicorn 热重载（仅开发） |
| `--host IP` | 手动指定绑定地址 |

---

## 更新部署

```bash
cd /srv/gameplatform
source .venv/bin/activate
git pull --ff-only
bash tools/fetch-games.sh      # 同步游戏 repo
pip install -r requirements.txt
cd frontend && npm ci && npm run build && cd ..
sudo systemctl restart gameplatform
```

更新前应先备份数据库和上传目录，记录平台与五个游戏仓库的提交号。
本次插件包隔离需要六个仓库配套更新，不能只替换平台代码。
部署后执行 `bash tools/test-startup.sh`；测试依赖可通过
`pip install -r requirements.txt -e '.[test]'` 安装。

### 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `GAMEPLATFORM_DB_PATH` | `framework/data/blog.db` | 数据库位置；测试/预发布请使用独立路径 |
| `ROOM_RECONNECT_GRACE_SECONDS` | `30` | 玩家断线保留座位秒数，范围 0–600，0 表示立即 AI 接管 |
| `PUBLIC_BASE_URL` | 未配置 | 生产必设实际 HTTPS 站点源地址（不含路径），用于 canonical、分享 URL 和站点地图 |

宽限期内回合时限仍继续计时，恢复凭证仅保存在当前浏览器会话。主动离房不享受宽限期。
房间仍保存在内存中，部署重启会中止对局；不要直接增加 uvicorn workers。

### 博客正文预渲染

首页、分类页和文章页由 FastAPI 返回已渲染 HTML，随后由 Vue 接管交互，不需要 Node.js 常驻服务。
前端构建同时输出 `.vite/manifest.json`，供服务端选择对应页面的 CSS；更新时必须部署整套构建产物。
缺少构建时应先执行 `npm ci && npm run build`，不能依赖旧版静态页面回退。

在 systemd 的 `[Service]` 中配置实际域名，例如：

```ini
Environment=PUBLIC_BASE_URL=https://blog.example.com
Environment=ROOM_RECONNECT_GRACE_SECONDS=30
```

配置后重新加载并重启服务。检查文章 URL 的原始响应应包含正文，而不只是空的挂载节点；
草稿文章应返回 404，`/sitemap.xml` 仅包含公开页面，`/robots.txt` 禁止抓取管理后台。
发布、编辑和撤回文章无需重新构建前端，服务端读取当前数据库生成页面。
HTML、robots 和站点地图带 `Cache-Control: no-store`；不要在反代/CDN 中覆盖此设置，
否则已撤回的正文可能继续对外显示。`/assets/` 的哈希资源仍可长期缓存。
未配置正式域名时使用相对 canonical，不信任请求 Host，站点地图明确返回 503；
配置了非法协议、路径、查询串或用户信息时服务会在启动时报错。

图片保留原始上传内容，不拉取或转码外站图片。列表封面和正文图设置 `loading="lazy"`、
`decoding="async"`，首屏封面设置 `fetchpriority="high"`；封面尺寸及 CSS 比例避免布局跳动。
Markdown HTML 中合法的图片宽高会保留；上传仍限制 5 MB，服务端最多读取上限加一字节。

---

## 安全措施

| 措施 | 实现位置 | 说明 |
|------|---------|------|
| HTTPS/WSS | Nginx | SSL 终止，TLSv1.2/1.3 |
| 绑定本地 | start.sh | 默认 `127.0.0.1` |
| 连接限速 | Nginx | 每 IP 并发 ≤20，请求 ≤30/min |
| 应用限速 | server.py | 每 IP 并发 ≤10，建房 ≤5/min |
| 房间上限 | server.py | MAX_ROOMS=50 |
| 输入校验 | server.py | 字段长度截断 + 类型检查 |
| 密码哈希 | room.py | bcrypt hash |
| session 认证 | auth/ | bcrypt + HTTP-only cookie |
| 异常不暴露 | server.py | 泛化错误返回客户端 |

---

## 常见问题

### Nginx 502 Bad Gateway
uvicorn 未启动或监听地址不对：
```bash
systemctl status gameplatform
curl http://127.0.0.1:8000/
```

### WebSocket 断连 (1006)
检查 Nginx `proxy_read_timeout` 是否设为 86400。

### 前端页面空白
确认前端已构建：`ls framework/static/dist/index.html`

### 数据库未初始化
```bash
python -m framework init-db
```

### SSL 证书过期
```bash
sudo certbot renew
```
