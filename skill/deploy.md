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
  ├── /static     静态文件
  ├── /           index.html
  └── /ws         WebSocket 游戏逻辑
```

生产环境中 uvicorn 只监听 `127.0.0.1`，所有外部流量经 Nginx 进入。

---

## 快速部署步骤

### 1. 服务器基础环境

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx ufw

# 防火墙：只开 22/80/443
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 2. 克隆代码并安装依赖

```bash
cd /srv
git clone https://github.com/dyazzvlue/gameplatform.git
cd gameplatform
bash tools/fetch-games.sh          # 拉取游戏 repo
pip install -r requirements.txt    # 安装锁定版本依赖
```

### 3. 配置 Nginx

```bash
# 替换域名占位符
sed 's/YOUR_DOMAIN/game.example.com/g' tools/nginx.conf \
  | sudo tee /etc/nginx/sites-available/gameplatform

sudo ln -s /etc/nginx/sites-available/gameplatform \
           /etc/nginx/sites-enabled/gameplatform
sudo nginx -t && sudo systemctl reload nginx
```

### 4. 申请 SSL 证书（Let's Encrypt）

```bash
sudo certbot --nginx -d game.example.com
# certbot 会自动修改 nginx.conf 中的证书路径并重载
```

### 5. 启动应用

```bash
cd /srv/gameplatform
bash tools/start.sh         # 默认监听 127.0.0.1:8000
```

推荐用 systemd 管理进程：

```ini
# /etc/systemd/system/gameplatform.service
[Unit]
Description=GamePlatform
After=network.target

[Service]
User=www-data
WorkingDirectory=/srv/gameplatform
ExecStart=/usr/bin/bash /srv/gameplatform/tools/start.sh
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

## 安全措施一览

本次实施的安全加固内容（开发阶段 → 生产就绪）：

| 措施 | 实现位置 | 说明 |
|------|---------|------|
| HTTPS/WSS | `tools/nginx.conf` | Nginx SSL 终止，支持 TLSv1.2/1.3 |
| 绑定本地地址 | `tools/start.sh` | 默认 `127.0.0.1`，不暴露到公网 |
| 连接速率限制 | `tools/nginx.conf` | 每 IP 并发连接 ≤20，请求 ≤30/min |
| 应用层限速 | `framework/server.py` | 每 IP 并发连接 ≤10，创建房间 ≤5/min |
| 房间数上限 | `framework/server.py` | 全局 MAX_ROOMS=50 |
| 输入校验 | `framework/server.py` | 所有字段长度截断 + 类型/范围检查 |
| 密码 bcrypt 存储 | `framework/room.py` | 密码不以明文存储，用 bcrypt hash |
| 异常不暴露 | `framework/server.py` | 客户端只收泛化错误，traceback 写服务端日志 |
| 关闭目录列表 | `framework/server.py` | `StaticFiles(html=False)` |

---

## start.sh 参数说明

| 参数 | 说明 |
|------|------|
| （默认） | 监听 `127.0.0.1:8000`，适合 Nginx 反代的生产环境 |
| `--public` | 监听 `0.0.0.0:8000`，用于局域网直接访问（测试/开发） |
| `--port N` | 指定端口 |
| `--reload` | 开启 uvicorn 热重载（仅开发） |
| `--host IP` | 手动指定绑定地址，覆盖默认 |

---

## 常见部署问题

### Nginx 502 Bad Gateway
uvicorn 未启动或监听地址不对。
```bash
systemctl status gameplatform
curl http://127.0.0.1:8000/    # 应返回 HTML
```

### WebSocket 连接被断开（1006）
检查 Nginx `proxy_read_timeout` 是否设为足够大的值（nginx.conf 已设 86400）。

### SSL 证书过期
```bash
sudo certbot renew --dry-run   # 测试续期
sudo certbot renew             # 实际续期
```

### 密码房间无法加入（加密升级后）
bcrypt 校验是计算密集型操作（约 100ms/次），这是正常的。如需提速可降低 bcrypt cost：
```python
# room.py: 将 gensalt() 改为 gensalt(rounds=10)（默认即为 12）
```

---

## 更新部署

```bash
cd /srv/gameplatform
git pull --ff-only
bash tools/fetch-games.sh      # 同步游戏 repo
pip install -r requirements.txt
sudo systemctl restart gameplatform
```
