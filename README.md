# GamePlatform

泛用多人联机桌游平台 + 个人博客系统。  
使用 FastAPI + WebSocket + Vue 3 构建，游戏逻辑以插件形式接入，框架本身不感知任何游戏细节。

> **本仓库**：[https://github.com/dyazzvlue/Boardgame_platform](https://github.com/dyazzvlue/Boardgame_platform)

桌游规则来源：https://andyventure.com/boardgame/

---

## 功能特性

- **多游戏支持**：游戏以插件形式注册，框架透传通信，零侵入游戏逻辑
- **Vue 3 前端**：SPA 架构，Vite 构建，组件化游戏渲染器
- **Per-Player State**：每个玩家只看到自己可见的信息（角色、手牌等）
- **博客系统**：内置 Markdown 博客，支持分类、标签、置顶
- **博客正文预渲染**：FastAPI 输出可直接阅读的文章 HTML，Vue 接管交互，支持文章元信息和站点地图
- **管理后台**：文章 CRUD、分类管理，session 认证
- **房间系统**：6 位房间码 + 可选密码，支持多人同时游玩
- **观战模式**：任意人数观战，实时同步游戏状态
- **断线恢复**：默认保留座位 30 秒，自动重连恢复状态，超时后由 AI 接管
- **满员自动开始**：房间满员后倒计时自动开始

---

## 快速开始

### 环境要求

- Python >= 3.10
- Node.js 22.12+（22.x）或 24+，推荐使用 `frontend/.nvmrc` 固定的 LTS 版本
- Git

### 一键部署

```bash
git clone https://github.com/dyazzvlue/Boardgame_platform.git gameplatform
cd gameplatform
bash tools/deploy.sh
```

### 手动安装

```bash
# 1. Python 环境
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. 拉取游戏 repo
bash tools/fetch-games.sh

# 3. 构建前端
cd frontend
npm ci
npm run build
cd ..

# 4. 初始化数据库
python -m framework init-db
python -m framework create-admin

# 5. 启动
bash tools/start.sh --public
```

访问 `http://<IP>:8000` 即可使用。

### 开发模式

```bash
# 终端 1：后端（热重载）
source .venv/bin/activate
bash tools/start.sh --public --reload

# 终端 2：前端（HMR）
cd frontend
npm run dev
```

前端开发服务器（通常 `http://localhost:5173`）会代理 API/WebSocket 到后端。

### 回归验证

```bash
pip install -r requirements.txt -e '.[test]'
cd frontend && npm ci && npm run build && cd ..
bash tools/test-startup.sh
```

测试使用临时数据库，不写入现有博客数据。可通过 `PYTHON=/path/to/venv/bin/python`
为启动和验证脚本指定解释器。五个游戏仓库必须与平台一起更新；旧适配器不支持新的包隔离。

浏览器回归（需先激活已安装测试依赖的 Python 虚拟环境）：

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

浏览器测试自动启动仅本地监听的临时服务，使用独立数据库和测试账号，
不会连接线上服务或复用已有端口。

博客生产部署应设置 `PUBLIC_BASE_URL=https://你的域名`，用于 canonical、分享元信息和
`/sitemap.xml`。预渲染由现有 Python 服务完成，不需要额外运行 Node.js 服务。
Markdown 在服务端和浏览器端均清洗 HTML；脚本、事件属性和危险链接不会作为可执行内容输出。
首页、分类、文章页在禁用 JavaScript 时仍可阅读；Vue 复用首屏数据，后续导航再请求 API。
页面包含 description、canonical、Open Graph、Twitter 和文章结构化数据；切换到游戏或后台会清除文章元信息。
封面预留显示尺寸，列表与正文图片延迟加载、异步解码，文章首屏封面优先加载。
发布、编辑、删除、撤回立即读取数据库生效，不必重建前端；HTML 与站点地图不缓存。
未配置 `PUBLIC_BASE_URL` 时页面仍可用，但站点地图返回 503，避免将请求 Host 当作正式域名。

---

## 项目结构

```
gameplatform/
├── framework/
│   ├── server.py           FastAPI 入口（REST + WebSocket + SPA）
│   ├── room.py             房间管理
│   ├── net_bridge.py       WebSocket 通信桥
│   ├── cli.py              CLI 命令（init-db / create-admin）
│   ├── core/               抽象接口（base_game, base_bridge, protocol）
│   ├── db/                 SQLite 数据库
│   ├── auth/               session 认证
│   ├── blog/               博客 API
│   ├── games/              游戏插件注册
│   └── static/dist/        前端构建输出
├── frontend/               Vue 3 前端源码
├── tools/
│   ├── deploy.sh           一键部署脚本
│   ├── start.sh            启动服务器
│   ├── dev.sh              开发模式
│   ├── fetch-games.sh      拉取游戏 repo
│   └── games.conf          游戏注册配置
├── skill/                  开发参考文档
├── pyproject.toml          Python 包配置
└── requirements.txt        锁定版本依赖
```

---

## 接入游戏列表

| 游戏 | game_id | 人数 | 仓库 |
|------|---------|------|------|
| 马尼拉 | `manila` | 3–5 | [Boardgame_manila](https://github.com/dyazzvlue/Boardgame_manila) |
| 阿瓦隆 | `avalon` | 5–10 | [Boardgame_Avalon](https://github.com/dyazzvlue/Boardgame_Avalon) |
| 印加宝藏 | `incan_gold` | 3–8 | [Boardgame_IncanGold](https://github.com/dyazzvlue/Boardgame_IncanGold) |
| 掼蛋 | `guandan` | 4 | [Boardgame_guandan](https://github.com/dyazzvlue/Boardgame_guandan) |
| 变换卡牌 | `transcard` | 3–6 | [Boardgame_transfercard](https://github.com/dyazzvlue/Boardgame_transfercard) |

---

## 开发文档

详细开发文档位于 `skill/` 目录：

| 文件 | 内容 |
|------|------|
| [architecture.md](skill/architecture.md) | 框架架构、模块职责、线程模型 |
| [protocol.md](skill/protocol.md) | WebSocket 消息协议完整参考 |
| [add-game.md](skill/add-game.md) | 接入新游戏的完整清单 |
| [frontend.md](skill/frontend.md) | Vue 前端开发规范 |
| [deploy.md](skill/deploy.md) | 生产部署指南 |
| [debugging.md](skill/debugging.md) | 常见问题排查 |
| [optimization-opt_dev0.md](skill/optimization-opt_dev0.md) | 本次三批优化、六仓库实现提交对应关系、验收结果与部署注意事项 |

---

## 部署

详见 [skill/deploy.md](skill/deploy.md) 或直接运行：

```bash
bash tools/deploy.sh
```

脚本支持选项：
- `--dev` — 开发模式（跳过 Nginx/systemd）
- `--skip-nginx` — 不生成 Nginx 配置
- `--skip-systemd` — 不生成 systemd 服务文件

---

## License

MIT
