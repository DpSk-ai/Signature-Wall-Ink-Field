# 墨场 Ink Field · Signature Wall

折页手札风格的实时互动签名墙。微信扫描大屏统一活动码，先进入墨场欢迎页，再前往学校二课签到或留下数字签名。手机、大屏和管理后台使用同一套纸色、墨线与朱印。

## 配置学校二课入口

在 `/admin` 登录，打开「学校二课入口」，选择一种方式并保存。大屏二维码始终指向本场墨场的 `/`，主办方更换学校链接时无需重印统一码。

| 主办方材料 | 后台选择 | 参与者看到的入口 |
|---|---|---|
| 可在微信网页打开的官方 HTTPS 地址 | 官方 HTTPS 链接 | 点击「前往二课签到」，在当前窗口打开学校页面 |
| 学校生成的 PNG 或 JPEG 二维码 | 从二维码识别链接 | 识别出 HTTPS 后使用完整地址，并保留二维码备用；其他内容直接展示原码 |
| 专用协议、动态码，或学校要求从原码进入 | 仅展示官方二维码 | 长按识别或保存后，使用学校支持的方式扫码 |
| 尚未收到学校入口 | 暂不发布 | 欢迎页说明当前状态，第二步仍可进入 |

上传前可裁掉照片中与活动无关的部分，保留二维码及白边。链接、参数和原码只在运行时由管理员配置，存入活动 SQLite 库中的独立表。请勿将它们放入源码、截图、提交或公开问题。参与者打开入口时会收到本场配置的链接或二维码。

学校页面自行处理登录和签到。使用微信的返回操作可回到墨场，点击「留下你的名字」进入 `/sign`。墨场仅提示是否打开过学校入口，数字签名可以独立提交。墨场的暂停、回执、记录与导出都只针对数字署名。

## Windows 11 启动

使用 64 位 Windows 11、Node.js 24 LTS x64 和随 Node 安装的 npm。完整解压 ZIP，例如放在较短的路径 `C:\Events\InkField`。在包含 `package.json` 的目录打开 PowerShell。首次安装需要网络访问 npm 和原生 SQLite 模块的预编译包，字体和笔顺数据已经随源码提供。

```powershell
node --version
npm.cmd ci
npm.cmd run build
$env:ADMIN_SECRET = [System.Net.NetworkCredential]::new('', (Read-Host '设置本场管理员密码' -AsSecureString)).Password
npm.cmd start
```

保留这个窗口。Fastify 在 8787 端口同时提供生产页面、API、WebSocket 和字体。管理员密码保存在当前进程环境中，每次打开新终端时重新设置；使用原密码可继续现有管理员会话。用 Ctrl+C 停止服务。

### 接入现场网络

1. 让电脑和手机连接到可互访的同一局域网。在电脑运行 `ipconfig`，找到活动网络适配器的 IPv4 地址。若现场网络启用了客户端隔离，请使用允许设备互访的活动网络。
2. 在大屏浏览器用**电脑的局域网地址**打开墙。例如主机为 `192.168.1.20`，打开 `http://192.168.1.20:8787/wall`，按 F11 全屏。二维码指向打开这张墙时使用的源地址。若以 localhost 打开，手机扫描后会访问手机自身。
3. 手机也可以直接打开 `http://192.168.1.20:8787/`。管理页为 `http://192.168.1.20:8787/admin`。如 Windows 首次弹出防火墙提示，允许 Node 在活动所用专用网络接入。
4. 用一个姓名完成签到，核对手机回执、大屏笔迹与人数。管理页可暂停、恢复、重播、隐藏、搜索、导出 CSV 或 PNG。现场保留一个大屏页面打开以驱动队列。

### 数据与升级

默认使用 `data/signature-wall.db`。仓库默认忽略运行时数据目录。测试使用临时数据库及虚构署名。需要全新场次时，可在启动前给 `$env:SIGNATURE_DATA_DIR` 设置一个新的空目录，例如 `C:\Events\SCU-Live-Data`。后续启动始终指向同一目录。

迁移已有部署时，先停止该实例，完整备份原 `data` 目录（含存在的 WAL 与 SHM），将 `SIGNATURE_DATA_DIR` 指向备份副本进行核对。首次启动会按需添加两行署名的断行字段。保留姓名、字体 ID、可见性、状态、时间和坐标。后台“清空全部署名”会删除当前数据库的记录。

### 开发与复测

```powershell
npm.cmd run dev
```

开发前端默认 5173，API 默认 8787。Vite 代理 `/api` 和 `/ws`。可用 `PORT` 设置后端端口，或设置 `HOST=127.0.0.1` 仅在本机测试。现场部署使用上面的生产启动方式。原 LAYOUT_SCALE 环境变量仍可为新署名设置字号上限（0.4–1），未设置时采用墨场的分区字号。

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:api
npm.cmd run test:backend
npx.cmd playwright install chromium
npm.cmd run test:check-in
npm.cmd run test:e2e
npm.cmd run test:exhibit
node tests/exhibit-controls.mjs
```

浏览器测试需要先完成生产构建，随后自建临时目录、数据库和随机端口。可通过 `CHROMIUM_PATH` 指定已有兼容 Chromium 可执行文件。结果写入 `tests/reports` 与 `tests/artifacts`。字体和笔顺采用同源按需加载，浏览器测试完成后不需要 Playwright 即可运行现场服务。

### 常见启动问题

- 原生数据库模块无法安装时，核对 `node -p "process.arch"` 为 `x64`，并使用 Node 24。网络无法取得预编译文件时，需要可用的 Python 与 Visual Studio C++ Build Tools 供 node-gyp 编译，再运行 `npm.cmd ci`。
- 端口占用时，在 PowerShell 设置 `$env:PORT='8788'` 后重新启动，并使用新端口访问大屏和管理页。
- 字库加载失败时，页面提供重试。缺少姓名所需字形时会提示补字，签名前可在画布上核对。
- 手机签到后尚未书写时，检查大屏连接状态、后台动画开关和队列。重开大屏会从 SQLite 快照继续。

## 交付导航

| 内容 | 路径 |
|---|---|
| 当前折页手札与统一入口 | 本文「配置学校二课入口」、`src/Welcome.tsx`、`src/board.ts` |
| 上一版展场视觉的设计档案 | `docs/DESIGN.md` |
| 字体授权、覆盖、来源和散列 | `docs/FONTS.md`、`docs/font-ledger.json`、`public/fonts/<id>/` |
| 当前验收结果（运行测试后生成） | `tests/reports/`；二课流程见 `tests/check-in.mjs` |
| 手机与各密度大屏截图、4K 实际导出 | `tests/artifacts/` |
| 上一版本的交付档案 | `docs/CHANGES.md`、`docs/source.patch`、`docs/changed-files.tsv` |
