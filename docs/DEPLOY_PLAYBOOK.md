# 部署方案手册（从 PY Party Run 的实战抽出来的通用流程）

这份文档解决两个问题：**这次是怎么部署起来的**，以及**以后任何项目照着哪几步走**。
面向"没有自己的服务器、也不想一上来就花钱"的场景，最后会给出三种典型项目的现成配方。

---

## 一、这次是怎么起来的（复盘）

### 1. 起点：本来只打算在局域网玩

`npm run lan` 起两个东西：Vite（`5173`，前端）+ `node server/index.mjs`（`8000`，房间服务），
同一台机器上打开 `http://<内网IP>:5173` 即可。这时候"部署"这个词是不存在的——只有一个开发机。

### 2. 想上公网，先撞到三道墙

| 墙 | 具体表现 | 结论 |
| --- | --- | --- |
| ① 应用是"两半" | 前端静态、房间服务要常驻 Node，Vercel/Netlify 的 Serverless 撑不住 WebSocket 长连接 | 必须拆开托管，或让服务端自己出前端 |
| ② 免费档开始要卡 | Render 免费 Blueprint 弹 "Add Card：$1 预授权验证身份" | 不想绑卡就得换路线 |
| ③ 平台的能力边界 | Hugging Face Spaces 免费账号已不能建 Docker/Gradio Space（需订阅），只有 Static Space 免费 | HF 这条路排除 |

### 3. 三次方案演进

| 版本 | 打算怎么做 | 结果 |
| --- | --- | --- |
| v1 | 前端 Vercel + 房间服务 Render 免费 Blueprint，用 `VITE_ROOM_SERVER` 把两边粘起来 | 配置写好但卡在绑卡，未上线 |
| v2 | 本机房间服务 + Cloudflare 临时隧道，前端仍放 Vercel | 可行，但每次重启要改环境变量并重新部署前端，太麻烦 |
| v3（最终） | **服务端同源托管前端**：`server/index.mjs` 直接出 `dist/`，页面与 `/ws` 同一个域名 → 一条隧道、一个网址、零配置 | 已上线并验证 |

### 4. v3 成立的关键洞察

> 部署里最贵的成本不是服务器，是"**两半之间的地址**"。

前端与后端分开部署，就必然要处理：跨域、`http`/`ws` 与 `https`/`wss` 的混合内容、两边的域名互填、改一处要重新构建另一处。
只要让**服务端顺便把静态文件也发出来**，这些全都消失：

- 页面地址 = 服务地址 → `/ws` 用同源 `wss://<当前域名>/ws`，不用配置；
- 隧道/容器/任何域名换掉，前端一个字节都不用重新构建；
- 少一个平台、少一次登录、少一个要维护的环境变量。

代价是：失去 CDN 边缘缓存、静态流量也走你的机器。**个人项目、教学演示、内网级用户量，这个代价可以忽略。**

### 5. 上线过程中真实踩到的坑（都已修掉，留作前车之鉴）

| 坑 | 症状 | 正确做法 |
| --- | --- | --- |
| `render.yaml` 用了 JS 块注释 `/** */` | Blueprint 解析失败 | YAML 注释只有 `#` |
| `npm ci --omit=dev` | 若 `ws` 在 devDependencies 会运行时崩溃 | 运行时依赖必须在 `dependencies`；`package-lock.json` 必须入库 |
| 脚本无 BOM 存 UTF-8 | Windows PowerShell 按 GBK 解码中文 → 假语法错误 | 含中文的 `.ps1` 用 **UTF-8 with BOM** |
| 复用同一份日志文件 | 文件被占用，`-Force` 删不掉，脚本中断 | 每次运行用独立文件名（带时间戳） |
| 隧道刚建就去探活 | 边缘路由未生效，首次 `/health` 失败 | 5 次重试 × 5 s |
| 短时间反复开隧道 | 卡在 `Requesting new quick Tunnel` | Cloudflare 限流，等几分钟 |
| SPA 深链接 404 | 刷新 `/room/xxx` 打不开 | 未知路径回退 `index.html` |
| 目录穿越 | `/../package.json` 读到源码 | 归一化后校验前缀，越界直接回退首页 |

### 6. 现在的成品长什么样

```
玩家浏览器
   │  https://xxx.trycloudflare.com
   ▼
Cloudflare 临时隧道（免费、无账号）
   │
   ▼
node server/index.mjs（本机 :8000）
   ├── GET /            → dist/index.html
   ├── GET /assets/*    → dist 资源（immutable 长缓存）
   ├── GET /health      → {"ok":true,...}
   ├── GET /rooms       → 公开房间列表
   └── WS  /ws          → 房间状态中继
```

日常只有三条命令：`tools\tunnel.ps1`（启动）、`-Status`（查网址）、`-Stop`（停止）。

---

## 二、以后新项目的通用流程（7 步）

> 顺序是有讲究的：**先把"运行形态"定死，再选平台**。反过来（先挑平台再改代码）会返工。

### 第 0 步：先回答四个问题

1. 谁用、用多久？（自己/同事 → 演示级；公开用户 → 生产级）
2. 有没有**必须常驻**的东西？（长连接 WebSocket、内存状态、定时任务、本地文件）
3. 有没有可用的卡 / 域名？（决定能不能用 Render、Cloudflare named tunnel 这类）
4. 出问题能接受多久不可用？（演示 5 分钟 vs 生产 5 秒）

这四个答案直接决定后面走哪条路，**不要跳过**。

### 第 1 步：把程序"可部署化"（12-Factor 的最小版）

不管以后放哪，代码里先保证这几条，平台换了也不用改：

- **端口来自环境变量**：`const PORT = Number(process.env.PORT ?? 8000)`；不要写死。
- **监听 `0.0.0.0`**，不要 `127.0.0.1`（容器/隧道里的 localhost 不是你以为了那个）。
- **所有外部地址、密钥来自环境变量**，不硬编码；本地留 `.env.example` 模板并入库。
- **提供一个健康检查端点** `/health`，返回 `{ok:true,...}`。平台要靠它判断"活没活"。
- **日志打到 stdout/stderr**，不要只写本地文件（平台靠收集 stdout）。
- **无状态优先**：状态尽量外置（数据库/缓存）；做不到就明确写"重启会丢"。

### 第 2 步：把"构建"和"运行"分开

- 构建：`npm run build` → 产物目录（`dist/`），**产物不入库**（`.gitignore`）。
- 运行：`npm start` / `node server/index.mjs`，只依赖生产依赖。
- 两条命令能在**干净目录**里跑通，才算可部署：
  ```bash
  rm -rf node_modules && npm ci && npm run build && npm start
  ```
  本项目的验证方式就是：只拷 `package.json` + `package-lock.json` + `server/` 到临时目录跑 `npm ci --omit=dev`，确认 `/health`、`/rooms`、`/ws` 都正常。

### 第 3 步：写一个 Dockerfile（即使现在不用）

它是**可移植的保险**：任何支持容器的平台（Oracle、自建 VM、各种 PaaS）都能直接跑，不用再学一套配置。

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server/index.mjs"]
```

验证：`docker build -t app . && docker run -p 8000:8000 app` → 浏览器打开 `localhost:8000`。

### 第 4 步：选平台（决策树）

```
你的应用有没有"必须常驻的进程 / 长连接"？
├── 没有（纯静态 / 只是前端调第三方 API）
│     → Vercel / Netlify / Cloudflare Pages / GitHub Pages（都免费、都不要卡）
│
├── 有，而且你不想绑卡
│     ├── 愿意让服务端顺便托管前端？ → 本机 + Cloudflare 临时隧道（本项目的方案，最快）
│     └── 要永久地址？             → Cloudflare Workers + Durable Objects（要改代码）
│                                   或 Deno Deploy（要改运行时代码，约半天）
│
├── 有，且可以绑卡
│     ├── 想零运维、能接受 15 分钟冷休眠 → Render 免费 Web Service / Blueprint
│     └── 要不休眠、要自定义域名        → Oracle Cloud Always Free（2 台 AMD 或 ARM 共 ~2 核 12G）
│
└── 生产级、要 SLA
      → 付费 PaaS（Render Starter 起 / Fly.io / Railway）或云主机 + 域名 + 证书
```

判断"有没有必须常驻"的一句话标准：**关掉这个进程，用户手里的页面是不是立刻就不工作了？** 是 → 常驻。

### 第 5 步：域名、HTTPS 与 WebSocket

三条硬规则，违反任何一条都会出现"页面能开、功能全废"：

1. **页面是 https，WebSocket 就只能是 `wss://`**。写 `ws://` 会被浏览器当混合内容拦掉。
2. **不要在代码里硬编码域名**。地址解析按优先级：运行时参数/环境变量 → 构建期变量 → 同源兜底。本项目是 `?room=` → `VITE_ROOM_SERVER` → 同源。
3. **端口写进地址前先想清楚**：`https://domain/ws` 和 `wss://domain:8000/ws` 是两回事，隧道/容器/CDN 通常只暴露 80/443。

想让前端能"换地址不重新构建"，就把地址做成**运行时**读取（查询参数/配置文件/接口返回），而不是 `import.meta.env` 这类构建期常量。

### 第 6 步：上线自测清单（照抄，逐条打勾）

**服务层**

- [ ] `GET /health` 返回 200 且内容是预期 JSON
- [ ] 日志能在平台控制台看到（说明 stdout 被收集）
- [ ] 环境变量在平台上确实生效（改一个值能观察到行为变化）
- [ ] 进程崩溃能被平台拉起（或明确知道不会）

**页面层**

- [ ] 首页 200，`#app` / 主脚本加载成功
- [ ] 静态资源带正确 `Content-Type` 与缓存头（`/assets/*` 可长缓存，`index.html` 必须 `no-cache`）
- [ ] 刷新一个深链接不 404（SPA 回退）
- [ ] 反向探测：`/../package.json` 之类拿不到源码

**联机层（有长连接才测）**

- [ ] 从公网能完成一次真实握手：`wss://<域名>/ws` → 收到 `hello`/`open` 帧
- [ ] 两个客户端互相能看到对方的移动/状态
- [ ] 断网/切页/后台回来后能自动恢复（本项目为此加了 `visibilitychange` 重同步 + 掉线红条）

**外部可见性**

- [ ] 手机 4G（不走公司 Wi‑Fi）也能打开
- [ ] 别人发来的截图/报错能复现

### 第 7 步：上线之后（运维三件事）

1. **知道它在哪、怎么停**：进程名、端口、日志路径。本项目就是 `node server/index.mjs` + `cloudflared`，`-Status` 一眼看到 pid。
2. **知道它何时会死**：免费档休眠、隧道地址失效、Cloudflare 限流、本机睡眠——写进文档，别靠记忆。
3. **知道它的代价**：时长、流量、并发上限。演示级不要为 5 分钟的展示买一年服务器。

---

## 三、三种典型项目的现成配方

### 类型 A：纯前端（Vue/React 静态站、作品集、讲义）

```
构建：npm run build → dist/
托管：Vercel / Netlify / Cloudflare Pages（免费、不要卡）
注意：环境变量是构建期注入，改了要重新部署；深链接回退要配
时间：10 分钟
```

### 类型 B：前端 + 普通 HTTP API（表单、数据看板）

```
方案一（最省事）：单个 Node 进程同时出 dist + API → 任意容器/PaaS/VM
方案二（想用免费 CDN）：前端 Pages + 后端 Render/Cloud Run（绑卡）或 Workers（要改造）
注意：CORS（或干脆同源）、健康检查、数据库连接池在 Serverless 下会耗尽
时间：半天
```

### 类型 C：实时联机（本项目这种 WebSocket / 房间）

```
必须常驻 + 长连接 → 排除纯 Serverless
免费不绑卡：本机 + Cloudflare 临时隧道（演示级）/ Deno Deploy（永久但改代码）
免费要绑卡：Render 免费档（会休眠）/ Oracle 免费 VM（最好的长期白嫖）
关键：wss、心跳、断线重连、重启丢房间要提前告知用户
时间：1 天（含改造与验证）
```

---

## 四、把项目交出去之前的最小文档

一个能长期活着的项目，`docs/DEPLOY.md` 至少要能回答：

1. 它由哪几部分组成，各自跑在什么上；
2. 三条命令：启动、查状态、停止；
3. 网址/端口从哪来，变了怎么办；
4. 平台限制（休眠、限流、时长、并发）；
5. 已知会丢什么（重启丢房间、临时域名会变）；
6. 出问题先看哪里（`/health`、日志、进程、端口）。

本项目的 `docs/DEPLOY.md` 与 `tools/tunnel.ps1` 就是这份内容的落地形态——照着抄结构即可。

---

## 五、一句话总结

> 部署的本质不是"找服务器"，而是**把程序切成"可重复构建的产物 + 一个能常驻的进程 + 一套固定的地址规则"**。
> 这三件事定好，平台只是最后一个填空；定不好，换哪个平台都会返工。
