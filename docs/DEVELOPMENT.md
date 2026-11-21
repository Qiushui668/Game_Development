# 开发指南

## 1. 环境

| 依赖 | 版本 | 位置 |
| --- | --- | --- |
| Node | v22.13.1 | `E:\Program Files\nodejs`（已在 Machine PATH） |
| npm | 10.9.2 | 同上 |
| npm 缓存 | `E:\npm-cache` | 用户级 `C:\Users\Administrator\.npmrc` |
| Python | 3.11.5 | `D:\Python\Python311` |
| 项目虚拟环境 | `.venv`（pip 26.3 / setuptools 84.2.1 / websockets 17.4） | `E:\DoubaoWork\Game_Development\.venv` |

### 必须遵守的环境约定

- **所有 Python 模块装进项目 `.venv`**，不装全局。
- 调用 Python 只用 `.\.venv\Scripts\python.exe`；直接敲 `python` 可能解析到别的解释器。
- npm 缓存已迁到 E 盘。若在代理/CI 型 shell 里执行，需显式指定：
  ```powershell
  $env:NPM_CONFIG_CACHE='E:\npm-cache'
  ```
  普通 cmd / PowerShell / Git Bash 下 `.npmrc` 生效，无需额外设置。
- 本机命令统一走 PowerShell 5.1：`&&` / `||` 不可用，用 `;` 或 `if ($?) { }`；没有 `head` / `touch` / `mkdir -p`。

## 2. 常用命令

```powershell
npm install          # 安装前端依赖
npm run dev          # 开发服务器 http://localhost:5173（strictPort）
npm run build        # vue-tsc --noEmit && vite build
npm run typecheck    # 仅类型检查
npm run preview      # 预览 dist
```

后端（阶段 B 起）：

```powershell
.\.venv\Scripts\python.exe backend\server.py
```

## 3. 目录结构

```
Game_Development/
├─ index.html
├─ package.json / tsconfig.json / vite.config.ts
├─ src/
│  ├─ main.ts / App.vue
│  ├─ views/GameView.vue
│  ├─ styles/global.css
│  ├─ components/game/   GameCanvas.vue / DebugOverlay.vue / RaceHud.vue（计时·倒数·结算）/ QuizPanel.vue（F 提示·题面·冻结倒计时）
│  ├─ game/
│  │  ├─ core/   GameConfig / GameLoop / GameState / Game
│  │  ├─ scene/  SceneManager / Materials / Lighting / Environment / World / QuizWalls（答题空气墙）
│  │  ├─ actor/  JellyBean（程序化果冻人）/ PlayerController（Rapier 胶囊角色）/ FollowCamera（第三人称镜头）
│  │  ├─ physics/ ObstacleField（障碍布局 + 命中判定，纯 TS，服务端可复用）
│  │  ├─ quiz/   QuizSystem（墙位 / 抽题 / 冻结读秒，纯 TS，服务端可复用）
│  │  ├─ combat/ AttackSystem（出招状态机 + 轻击 3 次/重击 1 次击倒规则，纯 TS，服务端可复用）
│  │  ├─ audio/  Music（单条 audio 循环 + 答题 duck）
│  │  ├─ data/   questions.ts（由 `tools/build_questions.py` 从 Excel 生成，勿手改）
│  │  ├─ input/  Input（键鼠 + Pointer Lock + 跳跃/F/左右键攻击的边沿触发）
│  │  └─ utils/  MathUtils
│  └─ types/     network.ts（协议冻结）
├─ public/audio/ danzai.mp3（背景音乐）
├─ backend/      阶段 B 的 Python 服务端
├─ docs/         PERFORMANCE / NETWORK_PROTOCOL / DEVELOPMENT
├─ tools/        perf_probe.py（性能/截图探针）/ verify_m2.py（手感 8 项）/ verify_m3.py（击退 5 项）/ verify_m4.py（音乐 + 答题 12 项）/ verify_m5.py（攻击 9 项）/ verify_m6.py（护栏圆角顶 + 答题中断）/ build_questions.py（Excel → TS）
└─ .venv/
```

> 注意：V1.1 文档 §4 原写 `py-party-run/` 子目录，实际因 `.venv` 在根目录，应用代码直接放在仓库根。以本节为准。

## 4. 代码硬约束

1. **物理层纯 TS**：`src/game/core` 与未来 `physics/` 目录禁止 `import three`、禁止触碰 DOM。目的是将来能原样搬进 Node 做服务端复算。
2. **帧循环不碰响应式**：`GameLoop` 内禁止写 Pinia、禁止改 DOM；HUD 用 4 Hz 快照拉取（`GameCanvas.vue` 的 `setInterval`）。
3. **常量集中**：所有可调数值进 `GameConfig.ts`，不散落在模块里。
4. **共享材质**：`Materials.ts` 输出单例，禁止在循环里 `new THREE.MeshLambertMaterial`。
5. **静态几何 `matrixAutoUpdate = false`**，减少每帧矩阵计算。
6. **协议以 `src/types/network.ts` 为准**，改字段必须同步 `docs/NETWORK_PROTOCOL.md` 并升 `PROTOCOL_VERSION`。
7. **起点角色数量 = 本局玩家数**（`MATCH.playerSlots`，单机为 1）。联机阶段只给每个玩家换颜色（`JellyBean.setColor` + `CROWD_COLORS`），不重建几何。

## 5. 已验证的坑

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 画面跳/瞬移 | 追帧 | `maxSubSteps = 2`，丢积压步 |
| 移动平台带不走角色 | `KinematicCharacterController` 不自动携带 | 每帧手动加平台位移（阶段 C） |
| 帧时间尖刺 | 着色器编译 / wasm 初始化 | 一次性，可预热 |
| 首次加载慢 | 主包 4.9 MB（three + Rapier wasm） | 发版前考虑 `manualChunks` |
| pip 触发整页刷新 | Vite 监听 `.venv` | 已在 `vite.config.ts` 的 `server.watch.ignored` 排除 |
| draw call 暴涨 | `BoxGeometry` 配 6 面材质数组 = 每块 6 个 draw | 地形改用「平面 + 实体块」拆分 |
| 突然变卡 | 向日葵虚拟显示器抢主屏 | 排查 `OrayIddDriver Device` |
| 贴地视角地板糊成纯粉块 | 贴图 `anisotropy = 1`，掠射角直跳最高 mip | checker / stripe 设 `anisotropy = 8` |
| 角色后脑出现白边 | 平面圆盘脸板贴在椭球上，顶部必然突出 | 脸改成微凸椭球（半径 0.36、scale 1.15/1.05/0.92），边缘自然收进身体 |
| 阴面脸部发灰 | Lambert 只吃光照方向 | 脸材质加 `emissive` 0.3 保住奶油色 |
| `npm run build` 报 exit 1 但其实成功 | PowerShell 把自带的 stderr 告警算作失败 | 判成功看 `✓ built in`，或 `*>` 重定向后读日志 |
| 拍不到角色腾空截图 | 注入跳跃后 220 ms 就落地 | `setInterval` 每 900 ms 触发一次跳跃再截 |
| 障碍"看得见撞不到" | 扫地杆/滚轴只有视觉没有判定 | `ObstacleField` 与视觉共用同一份布局和角度，物理步后统一判定 |
| 延长赛道后撞进山体 | 远山坐标写死，有一峰在 x=0/z=−285 | 山头按赛道长度生成，全部摆到 \|x\| ≥ 65 m |
| 滚轴挡住整条路 | 顶面 1.7 m 高于跳高 1.8 m 的可用余量 | 半径 0.65 / 轴心 0.67，顶面 1.32 m，可跳可绕 |
| 初始化白屏 `illegal race state transition` | 状态机只允许相邻转换 | `Menu → Loading → Countdown` 两步走，不能直跳 |
| 完赛后人在起点 | 冲线时横速 10 m/s 冲出终点平台掉进虚空触发复活 | 冲线调 `PlayerController.halt()` 清横速 + 终点后铺 12 m 缓冲地 |
| 空气墙上的白字糊在天空里 | 用 `material.opacity` 做半透明，序号底板跟着一起透 | 透明度写进贴图 alpha（玻璃 0.2 / 底板 0.9），`material.opacity` 固定 1，开门时才整体淡出 |
| 墙前角色被地形挡住 | 第 1 面墙原本落在坡脊（-70）后 6 m，相机压在坡脊上、角色下半身被坡挡住 | 墙移到 -78（坡脊后 8 m），镜头落在坡脊之后 |
| 第 4 面墙前被扫地杆反复扫中 | 墙位 -268 与 -262 的摆臂扫掠圆重叠 | 墙移到 -280，离扫掠边界 ≥ 6 m |
| 题库答案 43% 都是 B | 源表答案分布集中，直接按原序出题会被背下来 | 抽题后打乱选项顺序（`QuizSystem.issue`），正确项跟随重排 |
| 答题时鼠标点不了选项 | Pointer Lock 期间光标不可见 | 进答题先 `Input.exitLock()`，答对后在点击事件里 `requestLock()` 恢复视角 |
| 跳上护栏从墙侧绕过答题墙 | 护栏只有 1 m 高（跳高 1.88 m），墙宽只到赛道边（17.6 m），护栏顶（x≈±9.25）在墙碰撞体之外 | 画面墙宽改为 `(9 + 0.5 + 0.6) × 2 = 20.2 m`、高 4.6 m（盖住护栏）；**碰撞体单独加宽到 32 m**，堵住"斜跳出赛道再从墙后落回"的空中绕过路线 |
| 答题期间比赛计时是否停 | 若停表，冻结 3 s 就没有惩罚 | `Paused` 也累加 `raceTimeMs`；同时冻结世界（障碍角度不推进） |
| 攻击抬手看起来像"侧平举" | 手臂静息角是 128° 斜下外张，只绕 X 轴转时手臂始终横向，抬不到头上 | 攻击姿态拆成两段：绕 Z 收臂（左臂负、右臂正，符号写反会直接埋进身体）+ 绕 X 前挥；抬臂时手臂整体拉长 1.15–1.35 倍，短手才能探出圆身体 |
| 重击举臂时手臂"消失" | 肩关节在 x=±0.46，落在半径 0.6 的椭球体内，原长 0.62 的手举到竖直整只被身体吞掉 | 同上的拉长 + 只举到 50° 斜上方；判定仍按 1 s 举臂、1.0 s 命中 |
| 右键弹浏览器菜单 | `contextmenu` 默认行为 | 画布上 `contextmenu.preventDefault()`；未 Pointer Lock 时左右键不当作攻击，避免开局第一下就出招 |
| 冲击环在青粉棋盘上看不见 | 环色取了同色系（青/粉） | 单开 `COLORS.impactLight`（冷白）与 `impactHeavy`（暖黄） |
| 圆角顶护栏还是能站上去沿护栏跑 | 胶囊+运动学控制器不模拟侧翻：无论圆柱顶还是 54° 屋脊，只要法线竖直就能一路"骑"下去（实测改完照样走到墙前） | 碰撞照旧用「方柱 + 54° 屋脊」（爬不上也站不平），再加一条玩法规则：脚底离地 > 0.4 m 且 \|x\| > 8.5 就朝赛道内滑落（`PlayerController.slipOffRail`） |
| 被别的玩家打倒时答题还继续 | 答题是 Paused，没人管外界命中 | `Game.hitPlayer` 累计轻击/重击，倒地时 `interruptQuiz()`：题作废、墙不拆、退回 Racing、眩晕 1 s，HUD 闪"被击倒！" |

## 6. Git

- 主分支 `main`，小步提交，提交信息中文 + 阶段前缀，例如 `M1: 框架与场景骨架`。
- 里程碑打 tag：`m1`、`m2`……
- `dist/`、`node_modules/`、`.venv/` 不入库。
