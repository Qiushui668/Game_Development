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
├─ server/index.mjs         房间服务端（Node 22 + ws：房间 / 中继 / 裁判）
├─ scripts/dev.mjs          一键联调：Vite(0.0.0.0) + 房间服务，打印局域网地址
├─ src/
│  ├─ main.ts / App.vue（首页 ⇄ 游戏 视图切换）
│  ├─ views/     HomeView.vue（昵称门 → 单人 / 多人入口）/ GameView.vue
│  ├─ styles/global.css
│  ├─ components/
│  │  ├─ home/   RoomLobby.vue（房间号·玩家位 2–8·房主开始·离开）
│  │  └─ game/   GameCanvas.vue / DebugOverlay.vue / RaceHud.vue（血条·击杀·计时·倒数·结算·多人榜单）/ QuizPanel.vue
│  ├─ net/       RoomClient.ts（WebSocket 封装）/ roomStore.ts（房间响应式状态 + 游戏事件总线）
│  ├─ game/
│  │  ├─ core/   GameConfig / GameLoop / GameState / Game / Profile（昵称与配色的本地记忆）
│  │  ├─ scene/  SceneManager / Materials / Lighting / Environment / World / QuizWalls（答题空气墙）
│  │  ├─ actor/  JellyBean（程序化果冻人）/ PlayerController（Rapier 胶囊角色）/ FollowCamera（第三人称镜头）/ NameTag（头顶两行 Sprite：血条 + 血量数字 + 昵称）
│  │  ├─ net/    RemotePlayer（远端果冻人 + 100 ms 插值缓冲 + 自己的名牌与血条）
│  │  ├─ physics/ ObstacleField（扫地杆/滚轴/地刺/摆锤布局 + 命中判定，纯 TS，服务端可复用）/ TileField（方格桥：随机角色 + 塌陷/回弹状态机，纯 TS）
│  │  ├─ quiz/   QuizSystem（墙位 / 抽题 / 冻结读秒，纯 TS，服务端可复用）
│  │  ├─ combat/ AttackSystem（出招状态机 + 击倒规则 + 判定距离）/ Health（血量与伤害表，纯 TS）
│  │  ├─ audio/  Music（单条 audio 循环 + 答题 duck）/ Sfx（击杀音效，元素池支持连杀叠加）
│  │  ├─ data/   questions.ts（由 `tools/build_questions.py` 从 Excel 生成，勿手改）
│  │  ├─ input/  Input（键鼠 + Pointer Lock + 跳跃/F/左右键攻击的边沿触发）
│  │  └─ utils/  MathUtils
│  └─ types/     network.ts（协议 v4：位置 / 血量 `h` / 攻击 / 死亡 / 榜单）
├─ public/audio/ danzai.mp3（背景音乐）/ kill.mp3（1杀音效）
├─ docs/         PERFORMANCE / NETWORK_PROTOCOL / DEVELOPMENT
├─ tools/        smoke_room.mjs（服务端协议 23 项）/ verify_m7.py（双客户端 31 项）/ verify_m8.py（B1.5 14 项）/ verify_m9.py（B1.6 17 项）/ perf_probe.py / verify_m2…m6.py / build_questions.py
└─ .venv/
```

> 阶段 B 的服务端改用 Node（与前端同仓同栈，`npm run lan` 一条命令起两进程），V1.1 原计划的 Python `websockets` 服务端不再使用。


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
| 联机命中判定"背后打人" / 明明在面前却打不到 | 角色朝向 `facing` **只跟着水平速度走**（静止帧保持上一朝向），相机转了身子不转 | 判定用 `state.yaw`（身体朝向）而不是相机朝向：攻击要打出命中，得先朝对方动一下；测试脚本里先 `stepInput` 一小段把身子转过去再瞬移 |
| 轻击连打把对手推出攻击范围 | 轻击也用 `applyKnockback`（5.5 m/s + 0.9 s 硬直） | 拆出 `applyFlinch`：轻击只推 1.6 m/s、不进硬直；重击才用大击退，第三下倒地由 `applyStun` 清零横速 |
| 双客户端自动化里第二个页面掉到 1 FPS | 同一个 Chrome 的后台标签被 rAF 降频 | 起**两个独立 Chrome 进程**（各自 profile / 调试端口 / 窗口位置），并带 `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion` |
| 开局倒计时两边不同步 | 各自从进入游戏那一刻开始倒数（init 快慢不同） | 服务器下发相对时长 `startsInMs`，3 s 后再广播 `game_started`，客户端收到就 `forceMatchStart()`；`init` 还没跑完时用 `pendingNetStart` 补发 |
| 首页先展示后老验收脚本全挂 | `window.__PPR` 只在进游戏后才有 | `verify_m2…m6` 在等待循环里先点一次 `.mode.solo`（见各脚本注释） |
| 加了昵称门后老脚本全挂在"点单人游戏" | 首页第一屏变成昵称输入，`.mode.solo` 不存在 | 等待循环里先填 `.gate-input` + 点 `.gate-go` 再点 `.mode.solo`（`perf_probe.ENTER_SOLO_JS` 统一封装） |
| 站在地刺里一下掉 60 血 | 伤害没跟击退的 0.35 s 冷却联动，每帧都在扣 | `applyDamage` 只在 `applyKnockback` 返回 true 时调用（一次接触一次伤害） |
| 地刺把人顶在原地连吃 | 击退速度只有 10.5×0.55，跳不出 3 m 长的刺阵 | 地刺击退给足（10.5 m/s + 3.2 上抛），一次接触就把人顶出刺阵 |
| 轻击 3 下打死人后"倒地计数"归零，M6 断言变红 | `onDeath` 里把 `selfHits` 也 reset 了 | 倒地计数是"本局被打倒几次"的统计，死亡不清，只在重开一局时复位 |
| 远端死亡后滑 300 m 回起点 | 100 ms 插值缓冲把"瞬移"当成位移 | `player_died` 到达时清空该远端的采样缓冲（`snapToSpawn`），下一包直接落到起点 |
| 方格桥的回弹弹不到十几米（实测只有 4–8 m） | 桥后面 1.3–3 m 就是栏架/答题墙的**实体碰撞**，人被弹到 4 m 处撞墙停住（地刺/滚轴/扫地杆只有判定没有碰撞，不挡人） | 桥位改成"身后 12 m 内没有实体障碍"的空档：`-47.7..-56.3`（身后是 -34 栏架，留 13 m）、`-239.7..-248.9`（身后 -226 栏架，留 13 m）、`-263..-272`（身后 -250 栏架，留 13 m） |
| 验收脚本量回弹只有 8–9 m，纯推却能量到 12 m | 脚本 `teleport` 到格子后先 `sleep(120)` 再记"起点"，可这 120 ms 里人已经被弹出 3.4 m 了 | 起点必须取**格子本身的坐标**（`dz = 当前 z − 格子 z`），别取"弹飞后的当前坐标" |
| 方格桥把赛道地面切成 4 段后，地面 UV 出现接缝 | 原 UV 按单段平面算（0–1 → 贴图 2×2 格） | `floorPlane` 的 UV 改成**世界坐标**（`u = x/3`、`v = z/3`），切几段都对齐 |

## 6. Git

- 主分支 `main`，小步提交，提交信息中文 + 阶段前缀，例如 `M1: 框架与场景骨架`。
- 里程碑打 tag：`m1`、`m2`……
- `dist/`、`node_modules/`、`.venv/` 不入库。
