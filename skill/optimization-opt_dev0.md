# opt_dev0 — 本次网站优化与跨仓库变更记录

记录日期：2026-10-30。范围为平台和五个游戏仓库本次累计的三批优化，
包括最后完成的博客正文预渲染、SEO、图片加载优化及回归验收。
六个仓库分别从原有 `main` 创建本地分支 `opt_dev0`，保留原分支提交不变。
本次只创建本地提交，未推送远端、未合并到 `main`、未部署线上服务。

## 1. 仓库与实现提交对应关系

下表的“实现提交”可用于定位实际代码；本记录和 README 入口另作平台文档提交，
因此平台分支最终 HEAD 是文档提交，其父提交为下列平台实现提交。

| 仓库 | 本地目录 | 分支 | 优化前基线 | 实现提交 | 实现文件数 |
|---|---|---|---|---|---:|
| [Boardgame_platform](https://github.com/dyazzvlue/Boardgame_platform) | `Boardgame_platform` | `opt_dev0` | `f0edcf077dcd` | `63eedc2184aa` | 71 |
| [Boardgame_Avalon](https://github.com/dyazzvlue/Boardgame_Avalon) | `Avalon` | `opt_dev0` | `3db1be10b3dd` | `e2f993c644aa` | 7 |
| [Boardgame_guandan](https://github.com/dyazzvlue/Boardgame_guandan) | `GuanDan` | `opt_dev0` | `8fd72c2f6ab2` | `a7e9bc086af3` | 3 |
| [Boardgame_IncanGold](https://github.com/dyazzvlue/Boardgame_IncanGold) | `IncanGold` | `opt_dev0` | `5cc40c0d7a89` | `7991f3d13841` | 6 |
| [Boardgame_manila](https://github.com/dyazzvlue/Boardgame_manila) | `Manila` | `opt_dev0` | `8c031f672806` | `b46e3f065e8a` | 12 |
| [Boardgame_transfercard](https://github.com/dyazzvlue/Boardgame_transfercard) | `TransCard` | `opt_dev0` | `188f43646b0c` | `9cc83028c120` | 13 |

完整实现提交号：

```text
Boardgame_platform   63eedc2184aaac8e411e83de2afb2065e55a7581
Boardgame_Avalon     e2f993c644aad9014fdcc2588e31bd6ab42e6f66
Boardgame_guandan    a7e9bc086af320b1fdb95cecc9d748bdd2e40684
Boardgame_IncanGold  7991f3d13841dde921cae4552a00be86628d2618
Boardgame_manila     b46e3f065e8a9de355706fe2ebc0e694995d73b2
Boardgame_transfercard 9cc83028c1201f6de00cc19cca8a27980bac6be8
```

游戏包加载契约发生配套调整，六个实现版本必须一起使用。
分支名不是不可变版本，复现或部署时应核对上述提交号，不能仅确认分支同名。

## 2. 第一批：游戏隔离、房间生命周期及断线恢复

### 2.1 平台共享加载器与多游戏隔离

- 新增 [framework/games/loader.py](../framework/games/loader.py)，
  以 `boardgame_<game_id>` 独立包名加载游戏，通过锁保护加载过程，
  检查已加载包的来源，初始化失败时清理对应包注册。
- 五个插件统一使用共享加载器，不再各自篡改通用顶层模块或 `sys.path`。
  路径仍支持环境变量覆盖，默认读取平台同级游戏目录。
- 游戏核心改为支持包内相对导入，并保留原有 CLI 使用的直接导入路径。
  需要独立包的游戏增加根目录包初始化文件。
- 马尼拉与印加宝藏取消模块级“当前 UI shim”指针，按对局注入 UI bridge；
  马尼拉和转牌消除联机运行时对进程 stdout 或全局随机种子的修改。

插件入口：
[avalon](../framework/games/avalon/plugin.py)、
[guandan](../framework/games/guandan/plugin.py)、
[incan_gold](../framework/games/incan_gold/plugin.py)、
[manila](../framework/games/manila/plugin.py)、
[transcard](../framework/games/transcard/plugin.py)。

### 2.2 房间与游戏线程回收

- [room.py](../framework/room.py) 维护成员连接、断线截止时间、恢复凭证及离房处理状态。
  等待室离房释放席位并重新编号；进行中的游戏保持玩家索引稳定，避免操作错位。
- 房主离开后转移控制权；回到等待室时清理 AI 和上一局状态。
- [server.py](../framework/server.py) 统一处理显式离房、断线宽限到期、房间关闭与停服清理。
  无真人房间及时移出注册表，取消倒计时、广播及断线计时任务。
- [net_bridge.py](../framework/net_bridge.py) 提供 `GameStopped` 协作取消，
  结束房间时唤醒仍在等待的操作，包括无限回合时限的请求。
  已终止对局不能覆盖新一局的状态或结果。
- 游戏实例创建或 setup 失败时不发布“已开局”状态，也不留下新增 AI、
  `starting` 标志或错误倒计时；WebSocket 发送失败进入统一断线处理。

### 2.3 断线宽限、恢复与操作确认

- 新增 `ROOM_RECONNECT_GRACE_SECONDS`，默认 30 秒，范围 0–600；
  0 表示立即按离线处理。宽限期内保留座位，回合截止时间不会因重连延长。
- 服务端为成员单独发送恢复凭证，前端仅保存到 `sessionStorage`，
  不把凭证放到 URL、共享房间状态或其他玩家消息里。
- `resume` 恢复原座位，重新同步房间、本人视图、未完成请求或终局结果。
  另一页面接管连接后，旧页面停止反复抢回连接。
- `leave_room` 表示主动离房，立即清除恢复资格；观战者断线直接离房。
- 请求携带 `request_id` 和绝对 `expires_at`。
  `response_ack` 确认提交，拒绝旧请求、错误身份和过期响应；
  重复提交仅确认，不重复执行操作。
- 操作请求只发给对应玩家；玩家视图由服务端分别序列化，观战者仅见公开信息。
- [frontend/src/stores/game.js](../frontend/src/stores/game.js) 管理有界退避重连、
  心跳、连接和 ACK 超时、恢复状态、操作截止时间及错误提示。
  普通状态广播不清除仍待确认的操作。
- [GameLobby.vue](../frontend/src/views/game/GameLobby.vue) 与
  [GameRoom.vue](../frontend/src/views/game/GameRoom.vue) 接通恢复、分享房间地址、
  主动离房、房主状态和不可操作时的反馈。
- [ManilaGame.vue](../frontend/src/components/games/ManilaGame.vue) 按新请求初始化竞拍与摆船输入，
  校验最低报价、整数及可负担金额；发送失败保留输入。

协议字段与使用约定详见 [protocol.md](./protocol.md)。

## 3. 五个游戏仓库的具体改动

### 阿瓦隆 / Avalon

- 核心、AI、玩家和联机适配器使用正确的包内依赖，增加根包初始化文件。
- 玩家角色说明取自引擎中的 `ROLE_DESCRIPTIONS`，修正原先错误的导入来源。
- 未初始化、观战索引 `-1` 和越界索引只返回公开视图，不把负索引解释为最后一位玩家。
- 正常玩家仍可看到自己的角色、阵营和夜晚可见信息；其他角色遵守公开时机。
- 更新 README，说明包名、路径配置、CLI/GUI 兼容与平台回归入口。

### 掼蛋 / GuanDan

- 适配器改用包内相对导入，不再插入外部搜索路径。
- 在状态序列化阶段过滤手牌，而不是先构造所有手牌再从结果删除。
- 默认 `get_state()` 和观战状态不含手牌；玩家状态仅含本人的手牌。
  适配器未初始化时可以安全请求公开视图。
- 新增 README，记录 CLI 入口、联机包契约及玩家视图约定。

### 印加宝藏 / IncanGold

- 引擎 `Game(..., ui_bridge=...)` 使用实例 UI，GUI 和联机模式显式传入 bridge。
- 删除 `online/_ui_shim.py` 及其全局当前对局指针。
- 断线 AI 接管只更新所属对局的玩家与 shim，不影响同游戏另一房间。
- 使用独立包加载并增加根包初始化文件；保留原 CLI/GUI 入口及每局随机源。
- 更新 README 的架构、目录和回归说明。

### 马尼拉 / Manila

- 引擎支持 `ui_bridge`、`rng`、`log` 和 `save_logs` 实例参数。
- UI、日志、市场洗牌、AI 决策、摆船默认选择和骰子使用本局依赖，
  不再替换全局 `ui`、重定向进程 stdout 或调用全局 `random.seed()`。
- 联机模式不写本地对局日志；CLI 保留终端输出及默认日志保存行为。
- GUI 显式注入 bridge 与按种子创建的随机源，断线转换 AI 时沿用本局随机源。
- 删除 `online/_ui_shim.py`，补齐包内导入、包初始化及 README。

### 转牌 / TransCard

- 引擎和牌库支持注入随机源，洗牌、牌效果、偷牌与 AI 决策使用本局 `random.Random`。
- 适配器移除路径注入和全局随机重新播种，未 setup 时明确报错。
- 缺省、无效索引及观战序列化仅返回公开信息，正常玩家仅看到自己的手牌。
- 核心、规则、效果、UI 和适配器支持包内导入，保留原 CLI 入口。
- `test/simulate.py` 不再吞掉引擎异常，避免把异常中止的对局记作正常统计。
- 效果牌测试注入确定性随机源，新增 README 与根包初始化文件。

## 4. 第二批：博客一致性、前端请求状态与构建约束

### 4.1 写事务与请求校验

- [framework/db/__init__.py](../framework/db/__init__.py) 为每个 HTTP 写入提供独立事务连接，
  成功提交，异常或取消时回滚并关闭；共享连接用于读取。
- [framework/auth/session.py](../framework/auth/session.py) 的 session 创建、删除和过期清理
  同样使用独立写事务，避免登录或登出交叉提交另一个请求尚未完成的修改。
- [framework/blog/models.py](../framework/blog/models.py) 为登录、文章、分类和标签定义请求模型。
  校验非空名称、slug、严格布尔、正整数关联 ID，以及 PATCH 中的显式 null；
  允许清空分类，保持 Markdown 原始空白不被自动裁剪。
- [admin_routes.py](../framework/blog/admin_routes.py) 使用统一写事务，
  唯一键冲突返回 409，关联及数据约束错误返回明确客户端错误；
  不把普通数据库异常误报为重复名称。标签 ID 去重，失败更新完整回滚。
- bcrypt 登录校验放在线程池执行，避免阻塞事件循环。

### 4.2 前端错误与竞态

- 新增 [http.js](../frontend/src/lib/http.js)，统一 JSON、multipart、鉴权 cookie、
  网络和 HTTP 错误、FastAPI 校验详情、空响应及无法解析的响应处理。
- 请求 scope 同时使用 AbortController 和序号保护，即使旧传输忽略取消，
  其成功、失败或 finally 也不能覆盖新页面状态。
- 博客列表、分类、文章详情和管理后台列表、分类、登录、统计、编辑器均接入
  明确的 loading、错误和重试状态，不把读取失败伪装成空内容或保存成功。
- 编辑器的加载、保存和图片上传分别管理取消与状态，路由切换和卸载后不执行过期写入，
  保存失败保留用户内容，防止重复提交。
- [blogQuery.js](../frontend/src/lib/blogQuery.js) 统一 URL 分页及过滤值解析；
  筛选链接从第一页开始，分页保留过滤条件，前进后退恢复正确请求。

涉及的管理页面：
[Categories.vue](../frontend/src/views/admin/Categories.vue)、
[Dashboard.vue](../frontend/src/views/admin/Dashboard.vue)、
[Login.vue](../frontend/src/views/admin/Login.vue)、
[PostEditor.vue](../frontend/src/views/admin/PostEditor.vue)、
[PostList.vue](../frontend/src/views/admin/PostList.vue)。

### 4.3 构建和启动入口

- Node 约束统一为 22.12+（22.x）或 24+，通过
  [.nvmrc](../frontend/.nvmrc) 固定 22.22.1，
  [check-node.mjs](../frontend/tools/check-node.mjs) 在安装、开发和构建前校验。
- 同步 [package.json](../frontend/package.json) 和锁文件，部署使用 `npm ci`；
  增加单元测试、Playwright 浏览器测试及 DOMPurify。
- 同步 [pyproject.toml](../pyproject.toml) 与
  [requirements.txt](../requirements.txt)，加入请求模型、服务端 Markdown 和 HTML 清洗依赖，
  并提供测试依赖组。
- [start.sh](../tools/start.sh) 支持 `PYTHON` 指定解释器，按配置推断游戏路径并预检插件。
- [deploy.sh](../tools/deploy.sh) 使用统一 Node 检查、锁文件安装和幂等数据库初始化，
  systemd 模板提示配置正式站点地址。
- [test-startup.sh](../tools/test-startup.sh) 统一运行临时数据库后端测试和前端单元测试。

## 5. 第三批：查询、正文 SSR、SEO 与图片优化

### 5.1 查询

- [公开列表 API](../framework/blog/routes.py) 批量读取当前页标签，
  非空页在 1、10、50 篇文章时均固定 3 次 SELECT；空页 2 次，不执行无意义标签查询。
- 分类和标签过滤保留原返回结构；公开标签数量排除草稿关联。
- 排序追加文章 ID，确保相同创建时间下分页稳定。
- 数据库增加公开列表和分类排序的组合索引，以及按标签查询关联的索引；
  实际执行计划验证默认列表使用组合索引，不额外创建临时排序 B-tree。
- 幂等初始化保留已有文章及索引，不清空现有数据库。

### 5.2 正文与首屏数据

- [pages.py](../framework/blog/pages.py) 按请求生成首页、分类、文章的 HTML，
  禁用 JavaScript 仍可读正文、列表和分页链接；无需额外 Node 常驻服务。
- [rendering.py](../framework/blog/rendering.py) 使用 MarkdownIt 渲染并以 Bleach 清洗 HTML。
  公开 API 和 HTML 共用文章读取、`content_html` 和摘要。
- 草稿、不存在的文章和不存在的分类返回真实 404，并标记不索引。
- 首屏 JSON bootstrap 安全转义，避免文章中的脚本结束标签突破数据边界。
  Vue 仅消费与当前 URL 匹配的一次性数据，首页、分类和详情不重复请求首屏 API。
- 等待 Vue Router 就绪再挂载；通过构建 manifest 补齐页面与依赖 CSS，
  博客样式按根类命名空间组织，使无 JS 首屏和 Vue 页面共享样式。
- 发布、编辑、删除和撤回直接反映当前数据库，无需重建前端。
  HTML、robots 和 sitemap 使用 `Cache-Control: no-store`。

### 5.3 SEO

- 输出标题、description、canonical、Open Graph、Twitter 和文章 BlogPosting JSON-LD，
  保留发布时间及修改时间，兼容 SQLite 原有无时区时间的 UTC 表示。
- [blogPage.js](../frontend/src/lib/blogPage.js) 在 SPA 导航后同步元信息；
  进入游戏或后台清除文章结构化数据、分享图和发布时间，避免沿用上一文章。
- `/sitemap.xml` 仅列举已发布文章及有公开文章的分类；`/robots.txt` 限制后台、
  API 和游戏房间路径抓取。
- `PUBLIC_BASE_URL` 采用显式配置的 HTTP(S) 站点源地址，不信任请求 Host。
  未配置时页面仍可用、sitemap 返回 503；非法配置在启动时报错。
- 修正前端入口 favicon 路径，保留游戏及后台 SPA 路由。

### 5.4 图片与客户端 Markdown

- 列表封面和正文图片使用 lazy loading、async decoding，
  文章首屏封面使用 eager loading 和高 fetch priority。
- 封面输出宽高及 CSS 比例，正文保留合法图片尺寸，移动端限制溢出。
- [images.js](../frontend/src/lib/images.js) 与服务端图片 URL 校验排除危险协议、
  控制字符、歧义网络路径和非法端口；异常可选封面不阻断文章与元信息。
- [markdown.js](../frontend/src/lib/markdown.js) 统一文章和后台预览的 DOMPurify 清洗，
  包括 API 返回的 HTML；上传插入 Markdown 时转义文件名中的特殊字符。
- 图片上传保留原始文件，最多读取 5 MB 上限加一字节；
  未加入外站图片抓取、自动转码、缩略图或 CDN，避免改变原资源语义。

## 6. 验证记录

验收环境：Linux，Python 3.12.7，Node.js 22.22.1，npm 9.2.0，
Playwright Chromium。提交前在 `opt_dev0` 上再次运行以下测试：

| 验证 | 结果 | 关键覆盖 |
|---|---:|---|
| 平台后端 unittest | 70 项通过 | 事务隔离、回滚、请求校验、查询次数和索引、SSR/SEO、五游戏隔离、房间与 WebSocket |
| 前端 Node 单元测试 | 69 项通过，0 跳过 | 取消与竞态、错误和重试、分页、重连、ACK、马尼拉输入、图片 URL、Node 约束 |
| Playwright Chromium | 13 项通过 | 无 JS、首屏不重复请求、SPA 元信息、草稿 404、实时编辑撤回、Markdown 清洗、移动端、后台预览、游戏恢复与接管 |
| 转牌效果牌 pytest | 13 项通过 | 实例随机源变更后的效果行为 |
| Vite 生产构建 | 通过 | 完整 dist 与 manifest 已生成 |
| 编辑器诊断、补丁格式、部署脚本语法 | 通过 | 无新增诊断，`git diff --check`、`bash -n` 通过 |

平台测试文件：
[test_blog_admin.py](../tests/test_blog_admin.py)、
[test_blog_queries.py](../tests/test_blog_queries.py)、
[test_blog_pages.py](../tests/test_blog_pages.py)、
[test_game_plugins.py](../tests/test_game_plugins.py)、
[test_room_lifecycle.py](../tests/test_room_lifecycle.py)。

前端测试位于 [tests](../frontend/tests/)，浏览器测试位于
[blog.spec.js](../frontend/e2e/blog.spec.js) 与 [game.spec.js](../frontend/e2e/game.spec.js)；
[playwright.config.js](../frontend/playwright.config.js) 和
[serve-browser-tests.py](../tools/serve-browser-tests.py) 自动启动独立临时数据服务，
不复用已有端口或正式数据。

通用复验命令（激活已安装依赖的 Python 虚拟环境）：

```bash
# 在平台根目录
pip install -r requirements.txt -e '.[test]'
cd frontend && npm ci && npm run build && cd ..
bash tools/test-startup.sh
cd frontend
npx playwright install chromium
npm run test:e2e

# 在 TransCard 根目录
python -m pytest -q test/test_effects.py
```

上述结果不表示已在全部支持 Python/Node 版本运行兼容矩阵，
也不表示完成五个游戏全部 GUI 的人工游玩或线上负载测试。

## 7. 本地演示与不提交的内容

- 本次另在本机 `127.0.0.1:8000` 启动独立演示服务，准备 12 篇公开文章、1 篇草稿，
  2 个分类、2 个标签和临时管理账号；页面、后台登录、游戏列表和 WebSocket 心跳已核验。
- 演示数据库、上传文件和账号密码保存在仓库外的独立目录，不写入正式站点数据。
  本地服务通过 VS Code 后台任务运行，未设置开机自启。
- 演示启动脚本、任务配置和运行环境属于本机试用配置，不随这六个实现提交发布。
  本记录不保存账号密码、session token 或其他运行凭证。
- 不提交虚拟环境、`node_modules`、构建 dist、测试报告、浏览器缓存、数据库、
  上传文件和日志；生产构建按锁文件重新生成。

## 8. 部署及回退注意事项

1. 六仓库改动目前只在本地 `opt_dev0`。尚未推送前，其他机器不能从远端取得这些版本。
   既有拉取脚本不会自动选择这组提交；不要混用平台优化分支与旧游戏适配器。
2. 正式部署前备份数据库及上传目录，记录当前六仓库版本，再协调更新到对应实现提交。
3. 重新安装后端依赖、以 `npm ci` 构建前端，完整部署 dist 及 `.vite/manifest.json`。
   缺少构建时明确报错，不回退旧版页面。
4. 设置 `PUBLIC_BASE_URL=https://实际域名`；反代/CDN 不覆盖 HTML 的 no-store，
   哈希静态资源仍可长缓存。宽限期可通过 `ROOM_RECONNECT_GRACE_SECONDS` 调整。
5. 房间状态仍在进程内存中；重启会中止对局，不能直接增加 uvicorn workers 横向扩展。
6. 如需回退，平台和五个游戏应协调回到表中原基线；先停止相关实例并备份更新后的数据，
   不在含未提交修改的工作区执行破坏性回退。本次未执行回退或修改任何原 `main` 提交。

进一步说明见 [architecture.md](./architecture.md)、[frontend.md](./frontend.md)、
[protocol.md](./protocol.md) 和 [deploy.md](./deploy.md)。
