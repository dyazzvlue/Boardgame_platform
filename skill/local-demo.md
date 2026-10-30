# 本地演示与复现指南

本指南将最初会话目录中的演示入口整理为仓库内的可复用工具，不依赖某台机器的
绝对路径、特定会话 ID 或预先保存的账号密码。仅供本机开发试用，不代替生产部署。

## 1. 环境准备

使用平台及五个游戏仓库配套的 `opt_dev0` 版本。
游戏目录布局及完整实现提交对应关系见 [优化记录](./optimization-opt_dev0.md)。

在平台根目录运行：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -e .

# 使用 frontend/.nvmrc 指定的 Node 版本；未安装 nvm 时自行选择兼容的 Node。
cd frontend
npm ci
npm run build
cd ..
```

不要在已有同名虚拟环境中盲目重新初始化；已有环境可直接激活后安装依赖。
`python3 -m venv` 缺少 ensurepip 时，应先安装对应 Python 版本的 venv 支持。
本工具不自动克隆游戏、安装软件、创建系统服务或开放防火墙。

## 2. 启动

```bash
source .venv/bin/activate
python tools/serve-local-demo.py
```

默认仅监听 `127.0.0.1:8000`，可访问：

| 入口 | 地址 |
|---|---|
| 首页 | <http://127.0.0.1:8000/> |
| 示例文章 | <http://127.0.0.1:8000/post/local-preview> |
| 游戏大厅 | <http://127.0.0.1:8000/game> |
| 管理后台 | <http://127.0.0.1:8000/admin/login> |
| 站点地图 | <http://127.0.0.1:8000/sitemap.xml> |

首次启动生成 12 篇公开文章、1 篇草稿、2 个分类、2 个标签及 `demo-admin` 管理账号。
文章内容与最初本地演示一致，覆盖表格、图片、分类、标签及分页。

密码为每个新演示库随机生成，不打印到服务日志，不在仓库中提供固定密码。
在自己的终端查看：

```bash
cat framework/data/local-demo/admin-password.txt
```

该文件仅允许当前用户读写。不要把密码粘贴到代码、提交记录或公开问题中；
不再试用时停止服务，公开部署应按 [生产部署指南](./deploy.md) 创建正式管理员。

自定义端口或将演示数据存放到仓库外：

```bash
python tools/serve-local-demo.py --port 8001 --data-dir "$HOME/.local/share/gameplatform-demo"
```

可通过 `--help` 查看参数。`PUBLIC_BASE_URL` 和 `GAMEPLATFORM_DB_PATH` 会在本演示进程内
覆盖为对应的本地地址和演示数据库，不影响父终端或其他服务。
命令可从其他目录启动，只需使用正确的脚本路径与已安装依赖的解释器。

## 3. 数据隔离、持久化与重启

默认数据位置为平台的 `framework/data/local-demo/`，已由 Git 忽略：

```text
local-demo/
├── .gameplatform-local-demo  本工具创建的数据目录标记
├── blog.db                  独立博客数据库
├── admin-password.txt       本机随机生成的管理密码，权限 0600
└── uploads/                 演示上传文件
```

- 同一目录再次启动时保留文章修改、上传文件和原密码，不重复插入种子数据。
- 演示的 `/static/uploads/` 路由和上传写入均指向本目录，不读写正式上传目录。
- 不覆盖 `framework/data/blog.db`，也不读取正式站点的管理员或文章。
- 已有目录非空但缺少合法标记，或标记目录缺少必要文件时，工具会报错停止。
  不要手工添加标记绕过检查，应恢复完整备份或使用新的空目录。
- 旧会话演示库仍保留原处，不自动移动、复制或导入；本工具首次启动默认创建新演示库。
  因旧库没有本工具的所有权标记，不能直接把旧库目录作为参数使用。
- 若希望重新体验初始数据，指定一个新的空 `--data-dir`；本工具没有自动清库选项。
  清理旧数据前先停止对应进程并确认路径和备份。

自定义数据目录建议放在仓库外。即便默认数据和密码文件已忽略，
也不要使用 `git add -f` 强制提交任何实际运行数据。

## 4. VS Code 任务

仓库提供 [vscode-tasks.example.json](../tools/vscode-tasks.example.json)。

1. 用 VS Code 打开平台仓库作为工作区根目录。
2. 通过 Python 扩展选择已安装项目依赖的虚拟环境解释器。
3. 把示例任务合并到自己的 `.vscode/tasks.json`；已有任务不要覆盖。
4. 运行任务 `Local website demo`。示例使用 `${workspaceFolder}` 与
   `${command:python.interpreterPath}`，不含开发者机器路径。
5. 查看任务终端输出，通过其中的本地地址和密码文件路径试用。

如果工作区打开的是包含六个仓库的父目录，需要把示例中的脚本路径改为
`${workspaceFolder}/Boardgame_platform/tools/serve-local-demo.py`，
将 cwd 改为 `${workspaceFolder}/Boardgame_platform`，或把平台添加为多根工作区文件夹后运行任务。

远程 SSH / 容器工作区中，可在 VS Code“端口”面板转发演示端口；
维持本机监听即可，不需要将服务绑定到 `0.0.0.0`。

任务不设置开机自启。停止任务或在终端按 `Ctrl+C` 可关闭服务，
重启同一目录会继续使用已有演示数据。
端口已被占用时选择其他端口，不自动停止其他进程。

## 5. 建议试用清单

- 首页分页、分类与标签过滤、浏览器前进后退。
- 直接打开文章；禁用 JavaScript 后仍能阅读正文并点击列表分页。
- 查看标题、canonical、分享元信息与 sitemap。
- 登录后台，编辑和预览 Markdown；保存、发布或撤回后刷新文章确认即时生效。
- 上传图片，确认 URL 可访问且文件只写入演示 uploads。
- 创建游戏房间，添加 AI、开始游戏；刷新恢复座位，主动离房后不再自动恢复。
- 五个游戏的规则与实际操作可继续按各自 README 试用。

自动回归使用另一套独立临时数据，不依赖这个持久化演示库：

```bash
pip install -r requirements.txt -e '.[test]'
bash tools/test-startup.sh
cd frontend
npx playwright install chromium
npm run test:e2e
```

演示脚本的初始化、重启保护、目录隔离和任务示例测试位于
[test_local_demo.py](../tests/test_local_demo.py)。
依赖或构建缺失时应先按提示准备，不要把错误当作空站点继续使用。
