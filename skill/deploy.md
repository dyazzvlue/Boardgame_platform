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
  └── /*             SPA fallback (dist/index.html)
```

生产环境中 uvicorn 只监听 `127.0.0.1`，所有外部流量经 Nginx 进入。

---

## 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Python | 3.10+ | FastAPI + asyncio |
| Node.js | 18+ | 前端构建 |
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

# 安装 Node.js 20.x（通过 NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

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
npm install
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
cd frontend && npm install && npm run build && cd ..
sudo systemctl restart gameplatform
```

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
