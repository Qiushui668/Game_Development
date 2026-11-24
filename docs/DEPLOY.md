# 云部署说明（B2.1）

## 方案 0（不绑卡、10 分钟）：本机 + Cloudflare 临时隧道

现在的 Render 免费 Blueprint 要 **$1 预授权验证身份**（不扣费，但要卡）。完全不想绑卡时走这条。全部操作都在仓库根目录执行：

| 做什么 | 命令 |
| --- | --- |
| 启动（构建→起服务→开隧道→打印网址） | `powershell -NoProfile -ExecutionPolicy Bypass -File tools\tunnel.ps1` |
| 看状态 / 当前网址 | `powershell -NoProfile -ExecutionPolicy Bypass -File tools\tunnel.ps1 -Status` |
| 停止（关隧道 + 关服务） | `powershell -NoProfile -ExecutionPolicy Bypass -File tools\tunnel.ps1 -Stop` |

启动脚本做的事：起「整站服务」（`dist/` 静态 + `/ws` 房间服务同一个进程）、下载 `cloudflared`（只在首次）、开一条临时隧道，最后打印：

```
  把这个网址发给朋友（手机/电脑都能开）：
  https://xxxx-xxxx-xxxx.trycloudflare.com
```

**为什么网址每次重启都变**：`*.trycloudflare.com` 是 Cloudflare 的无账号临时隧道，域名由云端随机分配，进程一停就释放。变更流程是「停 → 起 → 复制新网址发出去」，前端不用重新构建（页面与 `/ws` 同源，代码里没有任何写死的域名）。脚本同时把网址写进 `tools\_tunnel_url.txt`，忘了复制可以 `-Status` 再看一次，或从 `tools\_tunnel_8000_*.log` 里 grep `trycloudflare`。

**卡在"起整站服务"之后不动了？** 那是隧道这一步在等网址，脚本以前会静默等满 2 分钟。现在改成：cloudflared **进程一退出就立刻报错**，并打印它自己的 stderr、隧道日志路径和末尾几行。两种典型原因：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 日志停在 `Requesting new quick Tunnel...`，进程随后消失 | Cloudflare 对该出口的**临时隧道创建限流**（同一天反复建多条最容易中） | 等 5–10 分钟再启动；同时只保留一条隧道（脚本启动前会关掉同端口的旧隧道） |
| 进程在跑但 2 分钟没网址 | 到 `region*.v2.argotunnel.com` 的 UDP/TCP 不通 | 看日志 precheck 段哪一项不是 PASS；换网络/VPN 后重试 |

之所以只需要一个地址：`server/index.mjs` 已经**同源托管前端**——`dist/index.html` 存在时，除 `/health`、`/rooms`、`/ws` 之外的 GET 都从 `dist/` 出（`/assets/*` 带 `immutable` 缓存，未知路径回退 `index.html`）。页面与 `/ws` 同源，前端 `defaultRoomUrl()` 直接落到 `wss://<当前域名>/ws`，**不用配 `VITE_ROOM_SERVER`、也不用部署 Vercel**。

四条使用常识：

1. **这台电脑要一直开着、别睡眠**，服务与隧道都跑在它上面（关掉 `node` / `cloudflared` 就断）。只停隧道、留服务（局域网还能玩）就手动结束 `cloudflared` 进程，别用 `-Stop`。
2. **隧道重启地址会变**（`*.trycloudflare.com` 每次随机）。变了就重跑启动命令拿新链接。
3. **谁拿到链接都能进房间**（没有房间密码），只发熟人。
4. 免费临时隧道是 Cloudflare 的"quick tunnel"，够课堂演示 / 朋友试玩；短时间内反复重开会触发限流（日志停在 `Requesting new quick Tunnel`），等几分钟再试。想要固定地址就绑自己的域名做 named tunnel（也要注册 Cloudflare，但不要卡）。

---

## 方案 0.5（推荐长期用）：固定域名 = 具名隧道（named tunnel）

临时隧道的域名每次随机，是因为它在 Cloudflare 那边"无账号、无归属"。一旦你的域名**托管在 Cloudflare**（NS 指向 Cloudflare），就能建一条**具名隧道**，域名写死，每次启动都是同一个网址，而且没有 quick tunnel 那套创建配额。

**前置条件**：域名必须是 Cloudflare 管理的站点（Dashboard 里状态 Active）。Cloudflare 官方口径：Tunnel 的域名必须由 Cloudflare 做权威解析（只有 Enterprise 能走非 Cloudflare NS 的 CNAME 接入）。免费域名（如 DigitalPlat 的 `*.qd.je`）只要面板允许改 NS，就能挂上去。

一次性步骤：

```powershell
# 1) Cloudflare 里 Add a site → 输入域名 → Free 计划 → 拿到两个 NS，去域名面板改 NS，等 Active
# 2) 本机登录（浏览器里选中该域名授权）
.\cloudflared.exe tunnel login

# 3) 建具名隧道（记下打印的 UUID）
.\cloudflared.exe tunnel create qiu

# 4) 让域名指到这条隧道（会在 Cloudflare 自动建 CNAME -> <UUID>.cfargotunnel.com）
.\cloudflared.exe tunnel route dns qiu qiushui.qd.je

# 5) 复制配置模板并填 UUID
copy cloudflared\config.example.yml cloudflared\config.yml
```

`cloudflared\config.yml` 长这样（`credentials-file` 指向 `%USERPROFILE%\.cloudflared\<UUID>.json`）：

```yaml
tunnel: qiu
credentials-file: C:\Users\<用户名>\.cloudflared\<UUID>.json
ingress:
  - hostname: qiushui.qd.je
    service: http://localhost:8000
  - service: http_status:404
```

日常三条（和临时隧道一致的使用体验，但网址固定）：

| 做什么 | 命令 |
| --- | --- |
| 启动（起服务 + 连具名隧道 + 校验 `/health`） | `powershell -NoProfile -ExecutionPolicy Bypass -File tools\tunnel_named.ps1` |
| 状态 / 固定网址 | `powershell ... -File tools\tunnel_named.ps1 -Status` |
| 停止 | `powershell ... -File tools\tunnel_named.ps1 -Stop` |

两条隧道怎么选：

| | 临时隧道 `tunnel.ps1` | 具名隧道 `tunnel_named.ps1` |
| --- | --- | --- |
| 网址 | 每次随机 `*.trycloudflare.com` | **固定你自己的域名** |
| 需要账号 | 不需要 | Cloudflare 账号 + 域名托管在 Cloudflare |
| 配额/限流 | 有（反复创建会被拒） | 无 |
| 证书 | Cloudflare 自动 | Cloudflare 自动（站点激活后几分钟生效） |
| 适合 | 临时给朋友看一眼 | 长期用、要发给别人收藏 |

注意：`cloudflared\config.yml`、`*.json` 凭据、`*.pem` 都在 `.gitignore` 里，不会进仓库；只有模板 `config.example.yml` 会被提交。

---

## 方案 1（有卡最省事）：前端 Vercel + 房间服务 Render 免费

这个项目是**两个东西**，也可以分开部署：

| 部分 | 跑什么 | 用什么托管 |
| --- | --- | --- |
| 前端 | `npm run build` 出来的 `dist/`（Three.js + Vue，纯静态） | Vercel / Netlify / Cloudflare Pages（免费、无需常驻、不要卡） |
| 房间服务 | `node server/index.mjs`（WebSocket 房间、`/health`、`/rooms`） | **必须能跑常驻 Node 进程**：Render 免费 Web Service / Oracle 免费 VM / 任意容器 |

> 关键点：**房间服务必须支持长连接 WebSocket**。Vercel / Netlify 的 Serverless 撑不住长连接，只能放前端。

### 0. 一个容器就能整站（Oracle / 任意 Docker 平台）

`Dockerfile` 已改成多阶段构建：构建阶段 `npm run build` 出 `dist/`，运行阶段只带生产依赖 + `dist` + `server`。

```bash
docker build -t ppr .
docker run -p 8000:8000 ppr        # http://localhost:8000 整站（含 /ws）
```

页面与 `/ws` 同源，这一路同样不需要 `VITE_ROOM_SERVER`。

### 1. 房间服务 → Render

1. 把仓库推到 GitHub（已提交即可）。
2. Render 控制台 → **New → Blueprint** → 选中仓库，它会读仓库根目录的 `render.yaml`：
   - 服务名 `ppr-room`，`runtime: node`，`plan: free`，启动命令 `node server/index.mjs`，健康检查 `/health`。
   - `region: singapore`（国内同学多就留这个；主要在北美改成 `oregon`）。
3. 部署完成后拿到地址，形如 `https://ppr-room-xxxx.onrender.com`。先自测：
   - `https://ppr-room-xxxx.onrender.com/health` 应返回 `{"ok":true,...}`
   - `https://ppr-room-xxxx.onrender.com/rooms` 应返回 `{"rooms":[]}`
4. 免费档的限制（2026 年现状）：
   - **15 分钟没有任何流量会休眠，醒来约 1 分钟**。有人连着 WebSocket 就算流量，所以只要房里有人就不会睡；第一个进房的人可能要等约 1 分钟。
   - 每月 750 小时，一个服务 7×24 常驻约 720 小时，刚好够一个房间服务用。
   - 免费档不给自定义域名（要用自己的域名就升级，或改用 Oracle / Cloudflare）。

### 2. 前端 → Vercel（或 Netlify / Cloudflare Pages）

1. Vercel → **Add New → Project** → 选同一个仓库：Framework 会自动识别 **Vite**，构建命令 `npm run build`，输出目录 `dist`。
2. **必须加一个环境变量**（否则前端还会去连它自己那台机器的 8000 端口）：

   | Key | Value |
   | --- | --- |
   | `VITE_ROOM_SERVER` | `https://ppr-room-xxxx.onrender.com`（上一步拿到的地址，**写 https，别写 ws**） |

   代码里会把它自动转成 `wss://…/ws`；页面是 https，写 `ws://` 会被浏览器当混合内容拦掉。
3. 部署完打开 `https://你的项目.vercel.app`，首页 → 多人 → 建房，把房间号发给朋友即可。

> 换房间服务地址时，改 `VITE_ROOM_SERVER` 后**重新部署一次**（Vite 的环境变量是构建期注入的）。

### 3. 自测清单（部署完必须过一遍）

```powershell
# 房间服务活着
curl https://ppr-room-xxxx.onrender.com/health
# 房间列表跨域可读（服务端已带 access-control-allow-origin: *）
curl https://ppr-room-xxxx.onrender.com/rooms
```

浏览器里：两个人分别打开前端链接 → 一个建房、一个输房间号 → 能互相看到移动 / 出拳 / 血量 / 结算。
如果「别人不动、打不到人」，先看游戏画面顶部有没有红条——有红条就是 WebSocket 断了（换网络或等房间服务醒过来）。

## 备选方案

### A. Oracle Cloud Always Free（最接近"自己的服务器"，但要会开机器）

- 免费额度：2 台 AMD 微型机（1/8 OCPU、1 GB），或 ARM Ampere A1 合计 1500 OCPU 小时 + 9000 GB 小时/月（约 2 核 12 GB 常驻）。
- 一台小 VM 足够跑「前端 dist + 房间服务」：

  ```bash
  # Ubuntu 22.04，装 node 20 后
  git clone <你的仓库> && cd Game_Development
  npm ci --omit=dev
  PORT=8000 node server/index.mjs     # 用 systemd / pm2 保活
  ```

- 前端可以同机用 `npx serve dist`，也可以挂 Cloudflare 免费 CDN 套一层 HTTPS（WebSocket 也走代理）。
- 优点：不休眠、可自定义域名、带宽稳定；缺点：注册/审核麻烦，机器可能被回收，需要自己维护。

### B. Cloudflare Workers + Durable Objects（长期最省钱，但要改代码）

- 免费档 2026 年已支持 Durable Objects（SQLite 后端），WebSocket 也支持。
- 但现有 `server/index.mjs` 是**单进程内存状态机**（`rooms` Map + `ws` 连接），搬进 DO 需要把「一个房间 = 一个 DO 实例」重写一遍，估计 1–2 天工作量。除非你要长期白嫖高并发，否则先用 Render。

### C. Hugging Face Spaces（Docker）

- 免费 2 vCPU / 16 GB，能跑本仓库自带的 `Dockerfile`，适合演示；但只有单端口、实例可能被重启，房间会清空。

## 部署后的两个已知变化

1. **不再是"局域网"**：拿到链接的人都能进房间（当前没有房间密码），公开链接请只发给熟人。
2. **延迟**：房间服务在 singapore 时国内约 60–90 ms，北美西海岸约 150–200 ms。20 Hz 位置包在这个量级仍然能玩，但拳套/攻击判定会略有延迟感（判定是客户端权威）。
