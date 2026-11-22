# 墨场 Ink Field · Signature Wall

TRAE on Campus @四川大学 · AI Coding Hackathon 的实时互动签到墙。手机选字签名，大屏以参与者选中的字形原位书写，管理页控制活动并导出 4K 合影。

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

默认使用 `data/signature-wall.db`。包内数据库来自附件中已提交的 WAL 页，保留了其中 5 条记录及原坐标。测试产生的参与者仅存在于验收截图和隔离测试库。需要全新场次时，可在启动前给 `$env:SIGNATURE_DATA_DIR` 设置一个新的空目录，例如 `C:\Events\SCU-Live-Data`。后续启动始终指向同一目录。

迁移已有部署时，先停止该实例，完整备份原 `data` 目录（含存在的 WAL 与 SHM），将 `SIGNATURE_DATA_DIR` 指向备份副本进行核对。首次启动会按需添加两行署名的断行字段。保留姓名、字体 ID、可见性、状态、时间和坐标。后台“清空全部签到”会删除当前数据库的记录。

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
| 视觉探索与设计规范 | `docs/DESIGN.md` |
| 字体授权、覆盖、来源和散列 | `docs/FONTS.md`、`docs/font-ledger.json`、`public/fonts/<id>/` |
| 测试方法、失败修复与结果 | `docs/ACCEPTANCE.md`、`tests/reports/` |
| 手机与各密度大屏截图、4K 实际导出 | `tests/artifacts/` |
| 代码差异与完整文件变更表 | `docs/CHANGES.md`、`docs/source.patch`、`docs/changed-files.tsv` |
