# PY Party Run · 彩虹冲刺

## 第一阶段开发实施说明书 · V1.1

| 项 | 内容 |
| --- | --- |
| 版本 | V1.1（在 V1.0 基础上按本机实测环境与三阶段路线修订） |
| 日期 | 2026-11-20 |
| 基线文档 | PY_Party_Run_开发实施说明书 V1.0 |
| 目标平台 | Windows 本机 + Chrome / Edge（PC 浏览器优先） |
| 交付形态 | 单机原型 → 局域网 2–5 人 → 上线 2–8 人 |

---

## 0. 变更摘要（V1.0 → V1.1）

| # | 项目 | V1.0 | V1.1 | 变更原因 |
| --- | --- | --- | --- | --- |
| 1 | 重力 | 未定义（会被默认成 −9.81） | `gravityY = -24`，下落倍率 1.15 | −9.81 + 初速 8.5 得到跳高 3.68 m、跳距 12.1 m，关卡缺口 2–5 m 形同虚设 |
| 2 | 跳跃手感 | 只有初速 8.5 | 初速 9.5 + coyote 0.1 s + jump buffer 0.1 s | 平台跳跃的容错与"按下就跳"的响应 |
| 3 | 物理权威 | "服务端校验位置与完成时间" | 客户端权威物理 + 服务端裁判 | Python 端没有等价 Rapier，无法复算位置，"权威物理"落不了地 |
| 4 | 多人后端 | 直接上 FastAPI | 局域网用 `websockets` 中继 → 上线换 FastAPI 外壳 | 局域网阶段零新依赖，协议不变只换外壳 |
| 5 | 人数 | 最多 5 人 | 局域网 2–5，上线 2–8，容量参数化 | 分阶段验收，5→8 只改常量 |
| 6 | 性能目标 | 60 FPS，最低 30 FPS | 30 FPS 基线 + P99 帧时间 ≤ 50 ms | GT 610 / 1 GB 显存，60 FPS 不可达；"不卡顿"要看长尾不是均值 |
| 7 | 阶段顺序 | A–G 线性 | C（镜头调优）并入 B；新增性能基线与协议冻结 | 避免"角色→镜头→再调手感"三次返工 |
| 8 | 已知坑 | 无 | 附录 A 列 12 条必踩项 | 减少调试时间 |
| 9 | 环境 | "Node LTS 等泛描述" | 实测清单 + npm 缓存迁移 + 浏览器渲染路径检查 | 本机实测 2026-11-20 |

**不变的部分**：坐标约定、赛道尺寸、障碍类型与分区、检查点位置、UI 布局、Git 与里程碑策略、AI 协作约定。

---

## 1. 项目目标与范围

### 1.1 目标

开发运行在现代浏览器中的 3D 多人障碍赛网页游戏。玩家进入网页后可以单人快速开始，也可以创建房间邀请朋友。控制圆润卡通角色在赛道跑动、跳跃、躲避障碍、跨越平台、通过检查点并抵达终点。

### 1.2 三阶段路线（每阶段独立验收，不通过不进入下一阶段）

| 阶段 | 人数 | 服务端 | 关键交付 | 验收门 |
| --- | --- | --- | --- | --- |
| ① 单机 | 1 | 无 | 完整闭环：首页→倒计时→跑酷→掉落复活→终点→结算→重开 | 门①：闭环可玩 + P99 ≤ 50 ms |
| ② 局域网 | 2–5 | 本机 / 局域网 Python 中继 | 房间码、房主、开始同步、位置同步、名次、断线 | 门②：5 人同房不掉帧、同步平滑、房主转移正确 |
| ③ 上线 | 2–8 | 公网 wss + FastAPI | 容量参数化、远端 LOD、部署与回滚 | 门③：8 人可玩、弱网（100 ms / 2% 丢包）不崩 |

### 1.3 本阶段不做

答题、商城、复杂装扮、手机触控适配、账号体系、数据库持久化（后期再接 SQLite）。

### 1.4 开发原则

1. 每阶段完成并测试后再推进，不一次生成全项目。
2. 使用程序生成的几何模型，优先验证玩法。
3. 先保证逻辑正确，再打磨美术。
4. 单人模式不依赖服务器，必须独立可运行。
5. 每个模块职责单一，配置集中在一个 `GameConfig.ts`。
6. **先修环境再写代码**：渲染路径不通时，所有帧率结论都是假的。

---

## 2. 本机开发环境（实测 2026-11-20）

| 组件 | 实测值 | 状态 |
| --- | --- | --- |
| 操作系统 | Windows（本地机） | — |
| CPU / 内存 | i5-12400F / 31.8 GB | 充裕 |
| Node.js | v22.13.1 · `E:\Program Files\nodejs`（已在 Machine PATH） | 可用（Vite 需 ≥ 20.19） |
| npm | 10.9.2 · registry = `https://registry.npmmirror.com/` | 可用 |
| npm 缓存 | `E:\npm-cache`（已固化到用户级 `.npmrc`） | 已迁移 |
| Python | 3.11.5 · `D:\Python\Python311`（已在 User PATH）；项目内已有空 `.venv` | 可用，后端依赖未装 |
| Git | 2.49.0 · `D:\Program Files\Git\cmd` | 可用 |
| 编辑器 | VS Code · `D:\Microsoft VS Code` | 可用 |
| 浏览器 | Chrome 157.0.8103 / Edge 157 | 可用 |
| 显卡 | GeForce GT 610 · 1 GB 显存 · 驱动 388.13（2018） | **主要瓶颈** |
| 磁盘 | E: 约 65 GB 可用 / C: 约 10 GB 可用 | E 盘够用，C 盘偏紧 |

### 2.1 npm 缓存迁移（已完成，含环境变量说明）

**结论：改用用户级配置文件，不依赖环境变量，因此在 cmd / PowerShell / Git Bash 中行为一致。**

写入 `C:\Users\Administrator\.npmrc`：

```ini
cache=E:\npm-cache
registry=https://registry.npmmirror.com/
```

要点：

1. **`.npmrc` 的生效与 shell 无关**。npm 解析 userconfig 的路径来自操作系统用户目录（`%USERPROFILE%`），不是 shell 决定的。已在 `cmd.exe` 中实测：`npm config get cache` → `E:\npm-cache`，`npm view three version` 正常返回，`E:\npm-cache\_cacache` 正常增长。
2. **优先级**：命令行参数 > 环境变量（`NPM_CONFIG_CACHE`）> 项目级 `.npmrc` > 用户级 `.npmrc` > 内置默认。当前用户级与系统级都**没有**设置 `npm_config_cache`，所以由 `.npmrc` 生效。
3. **不要**为了迁移去设置系统环境变量 `NPM_CONFIG_CACHE`：一旦设置，它会盖掉 `.npmrc`，且换用户/换机器时行为不一致，排查困难。
4. 缓存只是 tarball 缓存；`node_modules` 仍然安装在项目目录（本项目在 E 盘），不会被写到 C 盘。
5. 若 C 盘继续告急，可再迁全局安装目录（可选，本项目暂不需要）：

```bat
npm config set prefix E:\npm-global
:: 然后把 E:\npm-global 加入用户 PATH
```

6. 回滚方式：删除 `.npmrc` 中 `cache` 一行，或执行 `npm config delete cache`。

### 2.2 浏览器渲染路径（写代码前必须确认）

已开启 Chrome「使用计算机的图形加速」。仍需一次人工确认：

1. 打开 `chrome://gpu`；
2. 查看 `WebGL` 一行是否为 `Hardware accelerated`；
3. 若显示 `SwiftShader` / `Software only`：说明处于远程桌面会话（RDP 不暴露真实显卡）或驱动未加载 → 到物理屏幕前复测，或启动参数加 `--use-angle=d3d11`；
4. 记录结果，写入 `docs/PERFORMANCE.md` 的测试环境栏。

**2026-11-20 实测结论：加速正常，走硬件 D3D11，未回落软件渲染。**

| 项 | 实测值 |
| --- | --- |
| 渲染器 | `ANGLE (NVIDIA, NVIDIA GeForce GT 610 (0x0000104A) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| 厂商 | `Google Inc. (NVIDIA)` |
| 版本 | `WebGL 2.0 (OpenGL ES 3.0 Chromium)` |
| 最大纹理边长 | 16384 |
| 同步回读耗时 | 300 次 clear + readPixels 共 41.7 ms（约 0.14 ms/次） |
| 会话类型 | `Console`（非远程桌面）；`nvlddmkm` 驱动服务运行中 |
| 显示器 | 2 个 1920×1080，其中含向日葵虚拟显示器 `OrayIddDriver Device` |

注意两点：

1. 改动加速开关后，**主实例必须完全退出 Chrome 再重启**才按新设置运行，仅关标签页不算；
2. `Local State` 里 `performance_class_gpu_id = 1414:8c`（Microsoft Basic Render Driver）是切换前的旧记录，不代表当前状态；
3. 若日后"设置没变但突然很卡"，优先怀疑向日葵虚拟显示器被当成主屏——此时把窗口拖到 NVIDIA 主屏或断开虚拟屏再测。

**判定口径**：GT 610 + 1 GB 显存按 **1280×720 渲染、pixelRatio = 1、无实时阴影** 设计，目标 **30 FPS 稳定**，不以 60 FPS 为验收线。

### 2.3 Python 环境注意

- 用户终端中 `python` 指向 `D:\Python\Python311`（3.11.5）——与文档要求一致。
- 在自动化执行环境中，`python` 可能被沙箱解释器（3.13）接管；后端命令一律用 `py -3.11` 或项目内 `.venv\Scripts\python.exe`，避免装错版本。
- 局域网阶段只需 `websockets`（已装 13.0），**不需要** FastAPI。
- 上线阶段再安装：`pip install fastapi uvicorn[standard]`。

---

## 3. 技术栈与架构

| 模块 | 技术 | 职责 |
| --- | --- | --- |
| Web UI | Vue 3 + TypeScript | 首页、大厅、HUD、菜单、结算 |
| 构建 | Vite | 开发服务器、热更新、构建 |
| 3D 渲染 | Three.js | 场景、模型、摄像机、灯光、赛道、障碍的**显示** |
| 物理 | Rapier 3D（`@dimforge/rapier3d-compat`） | 重力、碰撞、角色运动、障碍反馈 |
| 状态与路由 | Pinia（推荐）/ Vue Router | 应用级状态与页面切换（**不参与每帧循环**） |
| 局域网后端 | Python + `websockets`（asyncio） | 房间、广播、倒计时、名次汇总 |
| 上线后端 | Python + FastAPI + WebSocket | 同上的外壳升级 + 部署配套 |
| 数据 | SQLite（后期） | 成绩、房间记录（原型阶段不接） |

### 3.1 分层边界

```
┌────────────── UI 层（Vue）──────────────┐   10 Hz 节流读写
│ 首页 / 大厅 / HUD / 结算 / 菜单           │
└───────────────┬─────────────────────────┘
                │ 只读取快照，不驱动帧循环
┌────────────── Game Runtime（纯 TS）──────┐
│ Physics（Rapier）· PlayerController      │ 固定步 1/60
│ RaceSystem · RespawnSystem · Obstacles   │ 零 GC 分配
└───────────────┬─────────────────────────┘
                │ 只输出位置/朝向/动画参数
┌────────────── 渲染层（Three.js）─────────┐
│ Scene · PlayerVisual · Camera · 特效      │ 每帧 rAF，只读状态
└───────────────┬─────────────────────────┘
                │ 仅多人阶段
┌────────────── 网络层（ws）──────────────┐
│ NetworkClient · PlayerSync · Interpolation│ 15–20 Hz
└──────────────────────────────────────────┘
```

### 3.2 三条硬约束（写进代码注释，评审时检查）

1. **物理层不得 `import` three 或任何 DOM API**。`PlayerPhysics` 只接收 `{ input, dt }`，输出 `{ pos, rot, grounded, state }`。这样将来若要"服务器权威物理"，可以整份搬到 Node 端复用。
2. **游戏循环不写 Vue 响应式状态**。每帧只写普通对象；HUD 以 10 Hz 拉取快照。
3. **单人/多人共用同一套 Runtime**，差异只在"输入与状态来源"：单人 = 本地输入；多人 = 本地输入 + 远端插值。

### 3.3 服务端职责边界（V1.1 明确）

| 做 | 不做 |
| --- | --- |
| 房间创建/加入/退出、房主与转移、容量校验 | 复算玩家物理位置 |
| 服务器单调时钟：倒计时、开赛时间、名次时间差 | 权威判定跳跃/碰撞结果 |
| `checkpoint` 顺序递增校验、`finish` 只认一次 | 反作弊级回放校验 |
| 广播 `player_state`、汇总 `leaderboard` | 客户端位置纠偏（V1 不做） |

---

## 4. 推荐目录结构

```
py-party-run/
├── public/                      # 后续放 models/ textures/ sounds/ icons（首版几乎为空）
├── src/
│   ├── main.ts  App.vue
│   ├── views/                   HomeView.vue LobbyView.vue GameView.vue ResultView.vue
│   ├── components/
│   │   ├── game/                GameCanvas.vue GameHUD.vue GameCountdown.vue
│   │   │                        GameMenu.vue PlayerInfo.vue DebugOverlay.vue
│   │   └── lobby/               RoomCode.vue PlayerList.vue ReadyButton.vue
│   ├── game/
│   │   ├── core/                Game.ts GameLoop.ts GameConfig.ts GameState.ts
│   │   ├── scene/               SceneManager.ts World.ts Lighting.ts Environment.ts Materials.ts
│   │   ├── player/              Player.ts PlayerController.ts PlayerPhysics.ts
│   │   │                        PlayerState.ts PlayerAnimator.ts PlayerInput.ts
│   │   ├── camera/              FollowCamera.ts
│   │   ├── map/                 RaceMap.ts TrackBuilder.ts TrackSection.ts
│   │   │                        Checkpoint.ts FinishLine.ts
│   │   ├── obstacles/           ObstacleBase.ts MovingBlock.ts RotatingBar.ts
│   │   │                        Pendulum.ts BouncePad.ts
│   │   ├── systems/             PhysicsSystem.ts RaceSystem.ts RespawnSystem.ts
│   │   │                        ProgressSystem.ts CarryingSystem.ts
│   │   └── utils/               MathUtils.ts ObjectPool.ts Cleanup.ts
│   ├── multiplayer/             NetworkClient.ts RoomService.ts PlayerSync.ts
│   │                            Interpolation.ts Protocol.ts
│   ├── stores/                  playerStore.ts roomStore.ts gameStore.ts
│   ├── router/  styles/  types/  game.ts player.ts network.ts
├── backend/
│   ├── main.py                  # 局域网阶段：websockets 服务（默认 :8000）
│   ├── app/                     room_manager.py protocol.py config.py
│   ├── server_fastapi.py        # 上线阶段外壳，复用 app/
│   ├── requirements.txt
│   └── tests/
├── docs/                        DEVELOPMENT.md NETWORK_PROTOCOL.md PERFORMANCE.md
├── .env.example  .gitignore  README.md
```

规则：**配置只有一份** `GameConfig.ts`；不按模块建配置文件。`Game.ts` 只做装配与生命周期，不写玩法逻辑。

---

## 5. 坐标与场景规格

统一坐标：**X 左右、Y 上下、Z 前后**；起点 `Z = 0`，终点 `Z = -180`，前进方向为 Z 递减。

### 5.1 环境风格

蓝色天空；青色赛道；粉色/紫色障碍；紫色护栏；蓝紫色低多边形山体。柔和太阳光，轻阴影感，低多边形糖果风。首版全部程序生成，不依赖外部模型与贴图。

### 5.2 尺寸参数（统一配置）

| 参数 | 初始值 | 说明 |
| --- | --- | --- |
| 赛道宽度 | 18 | 单位 = 米 |
| 起点平台长度 | 15 | Z 0 → −15 |
| 赛道总长度 | 180 | Z 0 → −180 |
| 地面厚度 | 0.5 | 碰撞体厚度，中心 y = −0.25（**勿用 1.0 厚 + 顶面 y=0**，易与胶囊半高混淆） |
| 玩家高度参考 | 1.8 | 胶囊总高 |
| 玩家碰撞半径 | 0.45 | 胶囊半径 |
| 护栏高度 / 宽度 | 1.0 / 0.5 | — |
| 平台高度变化 | 0.5–1.5 | 与跳跃能力匹配（见 §6.3） |
| 缺口长度 | 2–5 | 最大缺口须 < 水平跳距 5.5 m |
| 检查点间距 | 40–60 | CP1 −40 / CP2 −100 / CP3 −130 |

### 5.3 场景层级

```
GameScene
├── Sky / BackgroundMountains
├── Lighting（1 DirectionalLight + 1 HemisphereLight）
├── RaceTrack（StartPlatform, Section_01 … Section_05, FinishPlatform）
├── Obstacles / Checkpoints
├── PlayerRoot（PhysicsBody + VisualRoot）/ OtherPlayers
└── FollowCamera
```

---

## 6. 玩家角色与运动

### 6.1 角色模型

Three.js 几何体组合：圆润胶囊身体、两手臂、两腿、两颗眼睛；颜色可配置；材质为柔和高光塑料感（`MeshLambertMaterial`）。

```
PlayerRoot
├── PhysicsBody（不可见，Rapier 胶囊）
└── VisualRoot（Body / Face / Eyes / Arms / Legs）
```

视觉动画只能改变 `VisualRoot`，不得修改碰撞体。

### 6.2 物理实现选型

**采用 Rapier `KinematicCharacterController`**（推荐），而不是"动态刚体 + 速度控制"：

- 优点：无穿模、无站立抖动、坡度/台阶参数可控、跳跃判定干净；
- 代价：**站上移动/旋转平台时不会被自动带走**，必须手动补偿（见 C-04 / 附录 A-3）。

参数建议：`up = +Y`、`maxSlopeClimbAngle ≈ 50°`、`minSlopeSlideAngle ≈ 40°`、`snapToGround ≈ 0.3`、`applyImpulsesToDynamicBodies = false`。

### 6.3 运动参数（V1.1 定稿，集中写在 `GameConfig.ts`）

```ts
export const PHYSICS = {
  gravityY: -24,              // 关键：不是 -9.81
  fixedStep: 1 / 60,
  maxSubSteps: 2,             // 单帧最多补 2 步，掉帧时不做追帧螺旋
  fallGravityMultiplier: 1.15,// 下落段重力 -27.6，着陆更利落（可设 1.0）
};

export const PLAYER = {
  height: 1.8, radius: 0.45,
  maxSpeed: 7, sprintSpeed: 10,
  accel: 30, decel: 24,
  airControl: 0.45,
  jumpVelocity: 9.5,          // 跳高 1.88 m，滞空 0.79 s，7 m/s 下水平 5.5 m
  maxFallSpeed: -25,
  coyoteTime: 0.10,           // 离地 0.1 s 内仍可起跳
  jumpBuffer: 0.10,           // 落地前 0.1 s 的跳跃输入被缓存
  knockbackSpeed: [6, 12],
  stunTime: [0.8, 1.2],
  respawnInvincible: 1.0,
};
```

校核（公式 `h = v²/2g`、`t = 2v/g`）：

| 方案 | 跳高 | 滞空 | 水平跳距（7 m/s） | 与关卡 |
| --- | --- | --- | --- | --- |
| 默认 −9.81 / 8.5 | 3.68 m | 1.73 s | 12.1 m | 一跳过两关，关卡失效 |
| **V1.1 −24 / 9.5** | **1.88 m** | **0.79 s** | **5.5 m** | 缺口 2–5 m 需要算时机 |

调参口径：想更"飘"就降 `gravityY` 到 −20；想更"实"就提到 −28，二者都在可用区间。改完必须跑一遍"跨缺口 + 上 1.5 m 平台"两个用例。

### 6.4 状态机

状态：`Idle / Running / Jumping / Falling / Knockback / Respawning / Finished`。

| 转换 | 条件 |
| --- | --- |
| Idle ↔ Running | 输入速度 > 0.2 |
| Running → Jumping | Jump 按下且 `grounded` 或处于 coyote 窗口 |
| Jumping → Falling | 竖直速度 ≤ 0 |
| Falling → Running/Idle | `snapToGround` 命中 |
| 任意 → Knockback | 被障碍击中（冷却内不可重复触发） |
| 任意 → Respawning | Y < −8 |
| Respawning → Idle | 复位完成且无敌时间开始 |
| 任意 → Finished | 触发终点 |

禁止用多个互相矛盾的布尔值拼状态。

### 6.5 跳跃细节

1. 起跳只在 `grounded || 处于 coyoteTime` 时允许；
2. 空中不可二次跳（不做二段跳）；
3. 落地立即清 `Falling`、恢复 `grounded`、清空缓冲；
4. 落地前一瞬间按下的跳跃由 `jumpBuffer` 在落地帧补发；
5. 所有时间用 `deltaTime` / 物理步累计，禁止依赖帧数。

### 6.6 动画

首版全程序动画：跑步腿部交替、手臂摆动、身体轻微上下弹；跳跃抬臂；撞击倾斜；复活与胜利动作。动画只作用于 `VisualRoot`，更新频率与渲染帧一致，但**不得**触发物理变更。

---

## 7. 第三人称摄像机

```ts
export const CAMERA = {
  distance: 7,        // 角色后方水平距离
  height: 4,          // 摄像机绝对高度
  targetHeight: 1.4,  // 注视点（角色胸口）
  pitchMin: -15, pitchMax: 55,   // 单位：度
  sensitivity: 0.003, // 按实现标定
  smooth: 0.12,       // 指数阻尼系数，dt 无关
  offsetYMin: 0.6,    // 防穿地下限
};
```

说明：`height 4 / distance 7 / targetHeight 1.4` 的实际注视俯角约 **20°**，与文档 15–25° 区间一致。

规则：

1. 鼠标视角用 **Pointer Lock**（点击画布锁定），`Esc` 释放；
2. `Esc` 会同时触发"退出鼠标锁定"，因此暂停菜单由 `pointerlockchange` 事件驱动，避免 Esc 双语义冲突；
3. 镜头平滑用指数阻尼 `p += (target - p) * (1 - exp(-k * dt))`，保证不同帧率下手感一致；
4. 镜头不得穿地：对地面做一次射线检测或强制 `y ≥ 0.6`；
5. 移动方向始终相对镜头水平方向计算，镜头俯仰不参与水平方向。

验收：角色始终在视野内；镜头平滑无抖；镜头不穿地；移动方向与视角一致。

---

## 8. 地图：Rainbow Rush（固定地图）

| 区域 | Z 范围 | 内容 | 难度 |
| --- | --- | --- | --- |
| 起跑区 | 0 → −15 | 起跑平台、格纹、起跑线 | 低 |
| 第一关 | −15 → −40 | 横向推杆 ×3 | 低 |
| 第二关 | −40 → −65 | 旋转横杆 ×1–2 | 中 |
| 第三关 | −65 → −100 | 跳跃平台 / 缺口 | 中 |
| 第四关 | −100 → −130 | 摆锤 ×2–3 | 高 |
| 第五关 | −130 → −160 | 弹跳板 + 平台 | 高 |
| 终点区 | −160 → −180 | 冲刺段 + 终点拱门 | 低 |

### 8.1 障碍初始参数

| 障碍 | 参数 |
| --- | --- |
| 推杆 B1 | 长 4 / 宽 2 / 行程 ±5 / 速度 2 |
| 推杆 B2 | 长 5 / 宽 2 / 行程 ±4 / 速度 2.5 |
| 推杆 B3 | 长 3 / 宽 2 / 行程 ±6 / 速度 3 |
| 旋转横杆 | 长 12（半长 6 < 赛道半宽 9）/ 离地 0.6 / 角速度 90°/s 可调 |
| 摆锤 | 摆角 ±35° / 周期 2.4 s / 正弦驱动 / 撞击击飞 |
| 弹跳板 | 向上 12 / 前向 4 / 冷却 0.5 s / 有触发动画 |

### 8.2 视觉要点

青色赛道、粉色障碍、紫色护栏、蓝色天空、低多边形远山、轻微雾效（`camera.far ≈ 220`，用雾隐藏远端，减少绘制）。

---

## 9. 障碍系统规范

统一接口：

```ts
interface ObstacleBase {
  id: string; type: string;
  create(scene: Three.Scene, world: RAPIER.World): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
  getCollider(): RAPIER.Collider;
  onPlayerHit(player: Player, normal: Vector3): void;
}
```

硬性规则：

1. 运动全部基于 `dt` 或物理步，不得按帧数推进；
2. 碰撞体为 **kinematic**，用 `setNextKinematicTranslation` / `setNextKinematicRotation` 驱动，保证碰撞与视觉同步；
3. 撞击反馈：限制控制 `stunTime`、沿碰撞法线击退 6–12 m/s、身体倾斜、恢复控制；设 0.5 s 冷却防止连撞；
4. 障碍不得移出赛道边界（推杆端点要夹紧）；
5. 每个障碍可 `reset()` 到初始相位，重开一局必须完全复位；
6. 碰撞体与视觉体的尺寸必须来自同一份参数。

---

## 10. 检查点、复活与比赛流程

### 10.1 检查点

| ID | 位置 | 复活点 |
| --- | --- | --- |
| CP1 | Z ≈ −40（第一关结束） | Z = −42，赛道中线 |
| CP2 | Z ≈ −100（跳跃平台结束） | Z = −102 |
| CP3 | Z ≈ −130（摆锤区结束） | Z = −132 |

每个检查点：触发区域（Box 触发体，不参与阻挡）、激活态、视觉提示（变色/粒子）、激活事件。

### 10.2 掉落与复活

触发条件：`player.y < -8`（或用 `world` 中判定掉出赛道）。

重置清单（缺一不可）：位置 → 速度 → 角速度 → 状态机 → 动画 → 碰撞体姿态 → `grounded` → 跳跃缓冲 → 掉落计数 +1 → 无敌 1 s → 恢复控制。必须防止同一帧内重复触发。

### 10.3 比赛状态

```
Menu → Loading → Countdown → Racing → (Paused ↔ Racing) → Finished → Result
                     ↑                    ↓
                Respawning ───────────────┘（回到 Racing）
```

规则：倒计时 3/2/1/GO 期间锁定输入；到终点停止计时；重开必须重置地图、障碍相位、玩家、计时与掉落计数。

---

## 11. UI 与交互

| 区域 | 内容 |
| --- | --- |
| 首页 | Logo、昵称、角色颜色、快速开始、创建/加入房间、操作说明、音量 |
| HUD 左上 | 昵称 |
| HUD 顶部 | 计时 + 进度条 |
| HUD 右上 | 人数 / 排名 |
| HUD 左下 | 操作提示（几秒后淡出） |
| HUD 中央 | 倒计时、事件提示 |
| HUD 右下 | 暂停按钮 |
| 结算 | 昵称、完成时间、排名、掉落次数、再来一局、返回首页 |

规则：

1. **HUD 每帧不刷新**，以 10 Hz 从 Game Runtime 拉快照；Vue 不参与帧循环；
2. UI 半透明圆角，不遮挡赛道中央 40% 区域；
3. 暂停：ESC / 失去指针锁定触发；多人中只暂停自己的输入，不暂停全房。

---

## 12. 多人（分两阶段）

### 12.1 阶段②：局域网 2–5 人

- 后端：`backend/main.py`，基于 `websockets`（asyncio），监听 `0.0.0.0:8000`；
- 前端 dev 环境通过 Vite proxy 把 `/ws` 转发到 `ws://localhost:8000`，避免 CORS 与端口混乱；
- 客户端与服务端同协议，服务端只做房间与中继（见 §3.3）。

房间规则：

| 规则 | 值 |
| --- | --- |
| 人数下限 / 上限 | 1 / 5（配置项 `ROOM_CAPACITY`） |
| 房间码 | 6 位、大写字母 + 数字、排除易混字符（0/O/1/I） |
| 房主 | 创建者；离开后按加入顺序转移 |
| 开始权限 | 仅房主 |
| 游戏中加入 | 禁止（V1） |
| 空房间 | 30 s 无人生效后销毁 |

事件表（协议字段在 M1 冻结到 `src/types/network.ts`）：

| 方向 | 事件 | 关键字段 |
| --- | --- | --- |
| C→S | `create_room` | nickname, color |
| C→S | `join_room` | code, nickname, color |
| C→S | `leave_room` | — |
| C→S | `start_game` | — |
| C→S | `player_state` | t, p[x,y,z], r[yaw], s(state), a(animPhase) |
| C→S | `checkpoint` | index, t |
| C→S | `finish` | t |
| C→S | `ping` | t |
| S→C | `room_state` | code, hostId, capacity, players[] |
| S→C | `player_joined` / `player_left` | player |
| S→C | `countdown` | startsAt（服务器时钟）, seconds |
| S→C | `game_started` | startsAt |
| S→C | `player_state` | playerId, state |
| S→C | `leaderboard` | ordered[] |
| S→C | `error` | code, message |

同步策略：

1. 上行 `player_state` **20 Hz**（可降到 15 Hz）；
2. 下行按房间广播，8 人时服务端出口约 4.5 KB/s（28 B × 20 Hz × 8），带宽不是瓶颈；
3. 远端显示用**插值缓冲 100–120 ms（2 个 tick）**，渲染时在 `now - 120 ms` 的两帧之间线性插值；
4. 位置突变（复活/传送）不下发插值，直接切快照并清缓冲；
5. 进房/掉线用 `player_joined` / `player_left` 增删实体，不在帧循环里做集合增删。

### 12.2 阶段③：上线 2–8 人

| 变化点 | 做法 |
| --- | --- |
| 人数 5 → 8 | `ROOM_CAPACITY` 改常量 + 服务端容量校验；协议不变 |
| 后端外壳 | `server_fastapi.py`：同 `app/` 逻辑，改用 FastAPI WebSocket 路由 |
| 传输 | wss（TLS），同域反代 `/ws` → 后端，避免跨域预检 |
| 渲染压力 | 远端角色降 LOD：不画眼睛细节、关闭投影、减少动画更新频率（10 Hz 足够） |
| 弱网 | 心跳 5 s、断线 15 s 判定、重连保留 30 s 席位 |
| 部署 | 静态前端 + 反代（Caddy/Nginx），后端单进程 uvicorn（房间在内存） |
| 回滚 | 保留上一版静态包与后端版本号，一条命令切回 |

---

## 13. 性能预算与"不卡顿"规范

### 13.1 单帧预算（30 FPS 基线，33.3 ms）

| 项 | 预算 | 说明 |
| --- | --- | --- |
| 渲染提交（含 draw call） | 18 ms | 720p、无实时阴影、draw call < 80 |
| 物理（Rapier 固定步） | 4 ms | 1 步 + 最多 2 步补帧 |
| 逻辑 / 动画 / 网络 | 5 ms | 含 5 个角色程序动画 |
| 余量 | 6.3 ms | 抗抖动 |

### 13.2 渲染规则（逐条落实）

1. `antialias: false`；`renderer.setPixelRatio(1)`；渲染分辨率上限 1280×720（更大窗口用 CSS 放大）；
2. **不做实时阴影**：角色用贴地圆片（blob，128 px 贴图）表达落地感；如需阴影，只保留 1 个 DirectionalLight 的 1024 阴影贴图并限制投射对象；
3. 灯光只有 1 个 DirectionalLight + 1 个 HemisphereLight，不用 PointLight / SpotLight；
4. 材质用 `MeshLambertMaterial`（比 MeshStandard 便宜一档），全场景共享材质实例；
5. 静态赛道用 `BufferGeometryUtils.mergeGeometries` 合批，重复装饰用 `InstancedMesh`；
6. `camera.far ≈ 220` + 雾，远景直接不画；
7. 关闭 tone mapping、后期处理、透明叠加材质；
8. 纹理总量 < 4 MB，单张 ≤ 512×512（首版可零纹理，纯色 + 顶点色）。

### 13.3 循环规则

1. 物理固定步 1/60 + accumulator，单帧最多 2 步，掉帧时宁可慢放也不追帧；
2. **帧循环内零分配**：`Vector3` / `Quaternion` / 临时数组全部预分配（`ObjectPool` / 模块级 `TEMP`）；
3. HUD 10 Hz 拉快照；`visibilitychange` 隐藏时停 rAF；
4. 不在帧循环里读写 DOM、不改 Vue 状态、不 `new` 材质/几何。

### 13.4 首帧与预热

1. `RAPIER.init()` 与地图构建放在 Loading 屏；
2. 进赛道前执行 `renderer.compile(scene, camera)` 预热着色器；
3. 音频用 Web Audio 预解码 `AudioBuffer`，禁止在游戏里 `new Audio()`；
4. 首局前跑 1 次"隐藏预渲染"，避免第一次见到障碍时编译卡顿。

### 13.5 验收标准（"不卡顿"的量化定义）

- 连续跑 3 分钟：**P99 帧时间 ≤ 50 ms**；
- 除首次加载外，**任何单帧 ≤ 100 ms**（无 >100 ms 尖峰）；
- 帧率不低于 25 FPS，且**不出现周期性的"两帧一变"抖动**；
- 5 人同房（局域网）时上述指标不变。

### 13.6 DebugOverlay（M1 就要有）

显示并每 0.5 s 更新：`FPS`、`frame avg / P99`、`physics steps`、`draw calls`、`triangles`、`player pos / state / grounded`、`net in/out B/s`、`remote players`。可按键开关。

---

## 14. 阶段任务清单

> 每个任务只交付一件事；完成即报告：修改文件、运行命令、验收方法、结果、遗留问题。

### 阶段 A：框架与性能基线（M1）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| A-01 | Vite + Vue3 + TS 脚手架；安装 `three`、`@dimforge/rapier3d-compat`、`@types/three` | `npm run dev` 无编译错误 |
| A-02 | `GameCanvas.vue` + `Game.ts` + `SceneManager`：Scene / PerspectiveCamera / WebGLRenderer / 基础灯光 / 地面 / 测试立方体 / 窗口适配 / dispose | 浏览器可见 3D 场景 |
| A-03 | 世界雏形：天空、低多边形远山、赛道、起终点、护栏 | 前进方向清晰 |
| A-04 | `DebugOverlay` + `docs/PERFORMANCE.md` 记录本机基线（720p、无阴影、实测 FPS/P99/draw calls） | 有可对比的性能数字 |
| A-05 | 冻结 `src/types/network.ts` 与 `docs/NETWORK_PROTOCOL.md` 事件字段 | 按 §12.1 事件表逐条对齐 |

### 阶段 B：角色、镜头与手感（M2）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| B-01 | 角色几何体（胶囊 + 四肢 + 眼睛），`PhysicsBody` / `VisualRoot` 分离 | 可配置颜色，碰撞体不随动画变 |
| B-02 | `PlayerPhysics` + KinematicCharacterController + 输入系统；WASD/方向键、相对镜头、加减速、空中控制 | 不瞬移、不穿地、不抖动 |
| B-03 | 跳跃与状态机（coyote 0.1 s、buffer 0.1 s、二段跳禁用） | 跳高稳定在 1.8–1.9 m |
| B-04 | 程序动画（Idle/Run/Jump/Fall/Knockback/Respawn/Win） | 切换自然，不影响碰撞 |
| B-05 | `FollowCamera` + Pointer Lock + 俯仰限制 + 防穿地 | 镜头平滑、不穿地、方向一致 |
| B-06 | 手感调参：跨越 5 m 缺口、上 1.5 m 平台、连续撞击恢复 | 三个用例全部通过并记录参数 |

### 阶段 C：地图与障碍（M3）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| C-01 | `TrackBuilder`：起跑平台、5 段赛道、缺口、护栏、终点拱门；静态几何合批 | 全程碰撞正确，draw call 达标 |
| C-02 | 推杆（3 组，参数 §8.1）：往复、边界夹紧、碰撞击退 | 碰撞与视觉同步，无穿出赛道 |
| C-03 | 旋转横杆：kinematic 旋转、同步、击退 | 高速旋转下仍能正确碰撞 |
| C-04 | **移动平台携带**：站上推杆/横杆时，按平台位移补偿角色位置 | 站上移动平台不被甩下、不下沉 |
| C-05 | 摆锤（正弦驱动，不用真实绳索） | 摆角/周期正确，击飞合理 |
| C-06 | 弹跳板：上方触碰判定、向上 + 前向冲量、冷却、动画 | 不连跳、方向提示明显 |

### 阶段 D：检查点与比赛流程（M3）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| D-01 | 检查点触发与激活表现 | 复活点正确 |
| D-02 | 掉落检测 + 复活全量重置（§10.2 清单） | 无重复触发、无残留速度 |
| D-03 | 比赛状态机（含 Paused） | 非法转换被断言拦截 |
| D-04 | 计时、终点判定、结算数据 | 时间误差 < 50 ms |

### 阶段 E：UI 与单机闭环（M4）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| E-01 | 首页（昵称、颜色、快速开始、说明、设置） | 单人直接进场，不经大厅 |
| E-02 | HUD（10 Hz 快照）、操作提示、掉落计数 | 不遮挡主视野 |
| E-03 | 倒计时 3/2/1/GO + 输入锁 | 输入在 GO 帧解锁 |
| E-04 | 暂停（指针锁定丢失触发）、结算、再来一局 | 重开后所有状态复位 |
| E-05 | 提交门①：完整跑通一局并附 P99 实测数据 | 门①通过 |

### 阶段 F：局域网 2–5 人（M5–M6）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| F-01 | `backend/main.py`（websockets）+ `RoomManager` + 心跳 | `python -m backend.main` 可起，两个浏览器可连 |
| F-02 | 创建/加入/房间码/容量/退出/房主转移/空房销毁 | 第 6 人被拒绝 |
| F-03 | 房主开始 → 统一倒计时 → 统一开赛（服务器时钟） | 两端开赛时间差 < 50 ms |
| F-04 | 位置同步 20 Hz + 远端插值 100–120 ms + 复活瞬移处理 | 移动平滑，无瞬移闪烁 |
| F-05 | 检查点顺序校验、完成时间、名次（进度优先） | 名次与画面一致 |
| F-06 | 断线检测、重连窗口、房主异常转移 | 断开不崩房 |
| F-07 | 提交门②：5 人同房实测记录 | 门②通过 |

### 阶段 G：上线 2–8 人（M7）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| G-01 | `server_fastapi.py` 外壳迁移（复用 `app/`） | 协议零改动可跑 |
| G-02 | `ROOM_CAPACITY = 8` + 远端 LOD / 关投影 | 8 人房间帧率不低于 25 FPS |
| G-03 | 部署：静态包 + wss 反代 + 环境变量 | 公网可访问 |
| G-04 | 弱网测试（100 ms 延迟 / 2% 丢包） | 可玩，不崩，位置不发散 |
| G-05 | 监控（连接数、房间数、错误率）与回滚文档 | 一键回滚验证通过 |

---

## 15. 测试计划

### 15.1 单机（门①）

| 项目 | 预期 |
| --- | --- |
| 启动 | 进入首页无报错，2 s 内可点击开始 |
| 移动 | 方向相对镜头正确，松键有适度滑行 |
| 跳跃 | 跳高 1.8–1.9 m；空中不可二跳；落地可跳 |
| 地面/平台 | 不穿透、可站立、上 1.5 m 平台顺利 |
| 缺口 | 2 m 稳过，5 m 需助跑起跳 |
| 障碍 | 碰撞与视觉同步；击退后可恢复控制 |
| 掉落/复活 | 回到最近检查点，速度/状态全清 |
| 终点/计时 | 时间误差 < 50 ms |
| 重开 | 障碍相位、计时、掉落次数全部复位 |
| 性能 | 连续 3 分钟 P99 ≤ 50 ms，无 >100 ms 尖峰 |

### 15.2 局域网（门②）

| 项目 | 预期 |
| --- | --- |
| 创建/加入 | 房间码 6 位可用，错误码提示明确 |
| 1 / 2 / 5 人 | 均可开始；第 6 人被拒 |
| 同步 | 远端移动平滑，无抖动/瞬移 |
| 掉落/复活 | 状态同步，远端不出现"幽灵" |
| 名次/终点 | 顺序一致，完成时间取自服务器时钟 |
| 退出/房主离开 | 房间更新，房主自动转移 |
| 断线/重连 | 30 s 内可回，房间不崩 |

### 15.3 上线（门③）

| 项目 | 预期 |
| --- | --- |
| 8 人同房 | 帧率 ≥ 25 FPS，同步正常 |
| 弱网 | 100 ms / 2% 丢包下可玩 |
| 重启后端 | 客户端给出明确断开提示并允许重进 |
| 容量超限 | 第 9 人收到明确错误码 |

---

## 16. Git 与版本管理

```bat
git init
git add .
git commit -m "M1: 3D scene + perf overlay + protocol frozen"
```

- 每个里程碑一个可回退 tag：`M1`…`M7`，另打 `gate1/gate2/gate3` 标记验收通过点；
- 每次让 AI 改代码前先 commit，改完对比 diff；
- 分支建议：`feature/scene`、`feature/player`、`feature/camera`、`feature/map`、`feature/obstacles`、`feature/ui`、`feature/lan-multiplayer`、`feature/online`；
- `.gitignore` 必须含：`node_modules/`、`dist/`、`.venv/`、`__pycache__/`、`*.log`、`.env`。

---

## 17. 里程碑与交付

| 里程碑 | 交付 | 验收 |
| --- | --- | --- |
| M1 | 3D 场景 + 性能基线 + 协议冻结 | 门① 前置：场景可跑、数字可查 |
| M2 | 角色/移动/跳跃/镜头/手感参数 | 三个手感用例通过 |
| M3 | 地图、5 类障碍、检查点、复活 | 单人可通关 |
| M4 | 首页、HUD、倒计时、暂停、结算、重开 | **门①：单机闭环 + P99 达标** |
| M5 | 房间码、创建/加入、容量、房主、开始 | 2 人可同房竞速 |
| M6 | 同步、插值、名次、断线 | **门②：5 人平滑** |
| M7 | FastAPI 外壳、8 人、部署、监控、回滚 | **门③：公网 8 人可玩** |

---

## 18. AI 辅助开发约定

### 18.1 对话约定

1. 每次只做一个阶段或一个子任务；
2. 改之前先读现有文件，不重写已验收模块；
3. 涉及 3 个以上模块的改动，先给方案再动手；
4. 完成后必须报告：改了哪些文件、怎么运行、怎么验收、结果如何、遗留什么；
5. Bug 优先修，不顺手加功能；
6. 不许引入新的第三方库（除已完成阶段明确列出的）。

### 18.2 六条硬约束（每次提示词都要带上）

```
1) 物理层禁止 import three / DOM；只接受 {input, dt}，输出位姿与状态。
2) 重力用 gravityY=-24，跳跃初速 9.5，含 coyoteTime/jumpBuffer 各 0.1s。
3) 帧循环内零分配；HUD 走 10Hz 快照，禁止每帧写 Pinia / 改 DOM。
4) 不做实时阴影；antialias=false；pixelRatio=1；渲染封顶 1280×720。
5) 移动/旋转平台必须手动携带角色（KinematicCharacterController 不会自动带走）。
6) 任何人数字段变化必须同步更新 src/types/network.ts 与 docs/NETWORK_PROTOCOL.md。
```

### 18.3 分阶段提示词模板

**Prompt 1（M1 · 框架与基线）**
> 你是资深 Web 3D 游戏工程师。项目：PY Party Run，Vue3 + TS + Vite + Three.js + Rapier3D(compat)，单人优先、后续联机。只做初始化：建立目录结构；`GameCanvas.vue`、`Game.ts`、`SceneManager.ts`；初始化 Scene / PerspectiveCamera / WebGLRenderer / 灯光 / 地面 / 测试立方体；窗口适配与 dispose；`DebugOverlay` 显示 FPS/P99/draw calls/triangles；`GameConfig.ts` 只放常量。硬约束见上文六条（先给物理与重力常量占位）。不要做角色、障碍、联机。完成后列出文件、运行命令、验收方法与本机实测性能数字。

**Prompt 2（M2 · 角色与镜头）**
> 阅读现有 Game/SceneManager，不重写项目。用几何体建角色（胶囊+四肢+眼睛），`PhysicsBody` 与 `VisualRoot` 分离；Rapier `KinematicCharacterController` + 胶囊碰撞体；WASD/方向键相对镜头移动，加减速与空中控制；跳跃按 §6.3 参数（含 coyote/buffer），只允许地面起跳；实现状态机；实现 `FollowCamera`（Pointer Lock、俯仰限制、防穿地、指数阻尼）。不要做障碍与联机。完成后给出三个手感用例的实测结果。

**Prompt 3（M3 · 地图与障碍）**
> 基于现有项目实现固定地图 Rainbow Rush（Z 0 → −180，宽 18，7 个分区）。程序生成几何，静态部分合批（`mergeGeometries`），重复装饰用 `InstancedMesh`。实现推杆/旋转横杆/摆锤/弹跳板，全部 kinematic 驱动、参数见 §8.1，接口见 §9。**必须实现 C-04 移动平台携带**。不要重写 Player/Physics/Camera。

**Prompt 4（M3 · 检查点与流程）**
> 实现 CP1(−40)/CP2(−100)/CP3(−130)、掉落检测（y < −8）与复活全量重置、比赛状态机、计时与终点。重开必须复位障碍相位与所有计数。不要做联机。

**Prompt 5（M4 · UI 与闭环）**
> 实现首页、HUD（10 Hz 快照）、倒计时、暂停（由 pointerlockchange 触发）、结算、再来一局。结算展示时间/排名/掉落次数。完成后给出门①的完整验收记录（含 P99 数据）。

**Prompt 6（M5–M6 · 局域网）**
> 为现有项目实现最多 5 人局域网房间：Python `websockets` 服务（`backend/main.py` + `RoomManager`），6 位房间码、创建/加入/退出、容量校验、房主转移、空房销毁、服务器时钟统一起跑。客户端 20 Hz 上报 `player_state`，远端插值 100–120 ms，复活瞬移不走插值。检查点顺序校验、完成时间与名次由服务端计算。用两个浏览器验证创建/加入/同步/退出/房主转移。

**Prompt 7（M7 · 上线）**
> 复用 `app/` 逻辑，新增 FastAPI 外壳 `server_fastapi.py`；`ROOM_CAPACITY` 改为 8；远端角色降 LOD 并关闭投影；提供 wss 反代配置、环境变量样例、部署与回滚文档。用 8 个客户端做一次容量与弱网验证。

---

## 附录 A. 已知坑清单（必读）

| # | 坑 | 表现 | 对策 |
| --- | --- | --- | --- |
| A-1 | 用默认重力 −9.81 | 一跳三层楼，关卡失效 | `gravityY = -24` |
| A-2 | 动态刚体做角色 | 站立抖动、上台阶卡住、穿模 | 用 `KinematicCharacterController` |
| A-3 | 站上移动平台被甩下 | 角色停在原地、平台从脚下滑走 | `CarryingSystem`：把平台本帧位移补偿给角色 |
| A-4 | 可变 dt 跑物理 | 击退/跳跃在不同帧率下不一致 | 固定步 1/60 + accumulator，最多补 2 步 |
| A-5 | 每帧写 Pinia / 改 DOM | 帧率恒定下降、GC 抖动 | 10 Hz 快照 |
| A-6 | 帧循环里 new Vector3 | 周期性掉帧（GC） | 模块级 TEMP 复用 |
| A-7 | 首次遇到障碍卡一下 | 明显 1 帧长卡（着色器编译） | Loading 里 `renderer.compile()` |
| A-8 | `rapier3d` 而非 `rapier3d-compat` | Vite 下 wasm 加载报错 | 用 `@dimforge/rapier3d-compat` + `await RAPIER.init()` |
| A-9 | 实时阴影开满 | 720p 直接掉到 15 FPS | blob shadow |
| A-10 | Esc 双语义 | 既退鼠标锁定又开暂停，状态错乱 | 由 `pointerlockchange` 统一驱动暂停 |
| A-11 | 复活只重置位置 | 残留速度导致"复活即飞出" | 按 §10.2 清单全量重置 |
| A-12 | 协议字段边写边改 | 联调反复返工 | M1 冻结 `network.ts` |

## 附录 B. 环境处置记录

| 项 | 处置 | 验证 |
| --- | --- | --- |
| npm 缓存写 C 盘 | 写入用户级 `.npmrc`：`cache=E:\npm-cache` | cmd 中 `npm config get cache` → `E:\npm-cache`；`npm view` 后 `E:\npm-cache\_cacache` 增长 |
| npm registry | 保留 `https://registry.npmmirror.com/` | `npm view three version` 正常 |
| Chrome 图形加速 | 已开启，主实例已重启 | 实测 WebGL 走 ANGLE/NVIDIA D3D11，非 SwiftShader（详见 §2.2） |
| Python 版本混淆 | 统一用 `py -3.11` 或 `.venv\Scripts\python.exe` | `.venv\pyvenv.cfg` → 3.11.5 |
| 后端依赖 | 局域网阶段只需 `websockets`（已装）；上线阶段再装 fastapi/uvicorn | — |

## 附录 C. 关键命令速查

```bat
:: 前端
npm create vite@latest py-party-run -- --template vue-ts
cd py-party-run
npm install
npm install three @dimforge/rapier3d-compat
npm install -D @types/three
npm run dev

:: 局域网后端（阶段 F）
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.venv\Scripts\python.exe -m backend.main

:: 上线后端（阶段 G）
.venv\Scripts\python.exe -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 8000
```

---

*文档结束 · V1.1*
