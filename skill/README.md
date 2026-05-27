# GamePlatform Skill 索引

本目录收录 gameplatform 框架的开发参考文档，按主题分文件存放。

| 文件 | 内容 |
|------|------|
| [architecture.md](architecture.md) | 框架架构、模块职责、线程模型、Per-Player State |
| [protocol.md](protocol.md) | WebSocket 消息协议完整参考（类型、字段、流程） |
| [add-game.md](add-game.md) | 接入新游戏的完整清单、代码模板 |
| [frontend.md](frontend.md) | Vue 3 前端开发规范（Pinia store、渲染器组件、路由） |
| [debugging.md](debugging.md) | 常见问题排查、历史 Bug 记录、快速诊断命令 |
| [deploy.md](deploy.md) | 生产部署指南（环境依赖 + Nginx + SSL + systemd） |

## 技术栈概要

- **后端**：Python 3.10+ / FastAPI / uvicorn / aiosqlite / bcrypt
- **前端**：Vue 3 / Vue Router 4 / Pinia / Vite 8 / Marked
- **数据库**：SQLite (WAL mode)
- **部署**：Nginx 反代 + systemd + Let's Encrypt

> `GamePlatfrom_dev_skill.md` 为精简速查版（保留兼容），完整内容在本目录各文件中。
