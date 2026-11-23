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
npm run lan          # 一键联调：Vite(0.0.0.0) + 房间服务，打印局域网地址
npm run server       # 只起房间服务（ws://localhost:8000/ws，GET /rooms）
npm run build        # vue-tsc --noEmit && vite build
npm run typecheck    # 仅类型检查
npm run preview      # 预览 dist
```

验收（全部用项目 `.venv` 的 Python；本机 Bash 不可用，只能 PowerShell，`&&` 不认，用 `;`）：

```powershell
.\.venv\Scripts\python.exe tools\verify_b18.py     # B1.8 浏览器验收 32 项（含退出守卫 / 中途加入 / 全员结算 / 多人页 / 拳套）
node tools\smoke_room_b18.mjs                      # B1.8 协议层 23 项（纯 WS，不用浏览器）
.\.venv\Scripts\python.exe tools\verify_m2.py      # 老回归 m2…m6 / m8 / m9 逐个跑
.\.venv\Scripts\python.exe tools\verify_m7.py      # 双客户端联机 30+ 项（起两个独立 Chrome）
```

## 3. 目录结构

```
Game_Development/
├─ index.html
├─ package.json / tsconfig.json / vite.config.ts
├─ server/index.mjs         房间服务端（Node 22 + ws：房间 / 中继 / 裁判）
├─ scripts/dev.mjs          一键联调：Vite(0.0.0.0) + 房间服务，打印局域网地址
├─ src/
│  ├─ main.ts / App.vue（首页 ⇄ 游戏 视图切换；挂 `exitGuard` 拦截返回手势）
│  ├─ app/      exitGuard.ts（鼠标侧键 / Alt+← / Backspace / popstate 哨兵 / beforeunload）
│  ├─ views/     HomeView.vue（昵称门 → 单人 / 多人入口；多人页左建房 / 右输号 / 下方房间列表）/ GameView.vue
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
│  │  ├─ physics/ ObstacleField（扫地杆/滚轴/地刺/摆锤/**巨型拳套**布局 + 命中判定，纯 TS，服务端可复用）/ TileField（全赛道 684 块方格：逐格随机身份 + 塌陷/回弹状态机 + 浮桥段固定挖空 `gap`，纯 TS）/ BridgeField（答题墙 2→3 之间 6 块浮桥：三角波匀速往返 + 奇偶镜像起步的位置函数，与"载人"位移，纯 TS，服务端可复用）
│  │  ├─ quiz/   QuizSystem（墙位 / 抽题 / 冻结读秒，纯 TS，服务端可复用）
│  │  ├─ combat/ AttackSystem（出招状态机 + 击倒规则 + 判定距离）/ Health（血量与伤害表，纯 TS）
│  │  ├─ audio/  Music（单条 audio 循环 + 答题 duck）/ Sfx（击杀音效，元素池支持连杀叠加）
│  │  ├─ data/   questions.ts（由 `tools/build_questions.py` 从 Excel 生成，勿手改）
│  │  ├─ input/  Input（键鼠 + Pointer Lock + 跳跃/F/左右键攻击的边沿触发）
│  │  └─ utils/  MathUtils
│  └─ types/     network.ts（协议 v6：位置 / 血量 `h` / 攻击 / 死亡 / 榜单 / 房间阶段 / 中途加入 / 全员结算 / 再来一局 / 个人回大厅 `inLobby` / 房间列表）
├─ public/audio/ danzai.mp3（背景音乐）/ kill.mp3（1杀音效）
├─ docs/         PERFORMANCE / NETWORK_PROTOCOL / DEVELOPMENT / layout_b20.html（赛道障碍俯视图，由 tools/gen_layout_map_b20.py 从真实布局生成）/ bridge_swing.html（浮桥 x(t) 实测轨迹）
├─ tools/        smoke_room.mjs（服务端协议 23 项）/ smoke_room_b18.mjs（服务端 26 项）/ verify_m7.py（双客户端 31 项）/ verify_m8.py（B1.5 14 项）/ verify_m9.py（B1.6 17 项）/ verify_b18.py（B1.8+B1.9 39 项）/ verify_b20.py（B2.0 31 项）/ probe_swing_b20.py（浮桥轨迹采样）/ gen_swing_chart_b20.py（轨迹图）/ perf_probe.py / dump_layout_b19.py / dump_layout_b20.py / gen_layout_map.py / verify_m2…m6.py / build_questions.py
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
| 方格桥的回弹弹不到十几米（实测只有 4–8 m） | 回弹方向后面 1.3–3 m 就是栏架/答题墙的**实体碰撞**，人被弹到 4 m 处撞墙停住（地刺/滚轴/扫地杆只有判定没有碰撞，不挡人） | B1.6 曾把 3 段桥挪到"身后 12 m 内没有实体障碍"的空档；B1.7 陷阱散落到全赛道后无法再挑空档 → 验收脚本改用 `setTileRole` 把回弹格钉在空档（z≈-17.5）量力，实战中撞墙截断属于正常现象 |
| 验收脚本量回弹只有 8–9 m，纯推却能量到 12 m | 脚本 `teleport` 到格子后先 `sleep(120)` 再记"起点"，可这 120 ms 里人已经被弹出 3.4 m 了 | 起点必须取**格子本身的坐标**（`dz = 当前 z − 格子 z`），别取"弹飞后的当前坐标" |
| 方格桥把赛道地面切成 4 段后，地面 UV 出现接缝 | 原 UV 按单段平面算（0–1 → 贴图 2×2 格） | `floorPlane` 的 UV 改成**世界坐标**（`u = x/3`、`v = z/3`），切几段都对齐 |
| 陷阱格一眼就能认出来（青/粉渐变 + 暖黄回弹格） | 方格用了实例色，回弹格另染暖黄 | B1.7 整条赛道换成 684 块方格：**所有格子共用同一个材质、同一张棋盘贴图、同一尺寸同一高度**，`InstancedMesh` 不开 `instanceColor`，`getTileRender()` 里断言 `hasMap && !usesInstanceColor` |
| 随机陷阱只有 3 段桥、位置固定 | 桥段坐标写死（`TILE_ZONES`） | B1.7 去掉"桥段"，`TILE_GRID` 6×114 = 684 块逐格独立随机（消失 4% / 回弹 2.5%），陷阱自然散到整条赛道；只留两处保底：起点平台 z 0..20 与终点前 7 m（`safeFinishZ -313`） |
| 真方格地面后，老回归脚本边走边随机塌陷 → 必然挂 | 老脚本默认踩的都是实心格 | `Game.clearTiles()`（`World.clearTileTraps()`）把全场改回实心，m2–m8、`perf_probe` 在"就绪后"各调一次；m9 用 `setTileRole(index, role)` 把格子钉到指定位置 |
| 有人掉线 / 按了浏览器返回 → 整个房间都玩不了 | 旧服务端 `leaveRoom` 直接把房间打回 lobby 并广播 `back_to_lobby`，其他人被踢回首页 | B1.8：`leave_room` **只删人**，不改阶段、不清榜单，只剩 0 人才解散；房主顺延给 `members[0]` |
| 鼠标点一下就被"返回"带走 | 跑酷要一直按左右键，鼠标侧键 / 触控板左右滑 / `Alt+←` 都是浏览器后退 | 新增 `src/app/exitGuard.ts`：`auxclick`/`mouseup`(button 3·4)、`Alt+←`/`Alt+→`、`Backspace`、`history` 哨兵 + `popstate` 全部拦下并给提示；`beforeunload` 只在房间/比赛中提示 |
| 一个人冲线后，没跑完的人被晾在原地 | 旧逻辑只给冲线者弹结算 | B1.8 服务器第一个 `finish` 广播 `race_over`；客户端 `Game.endMatch()` 用 `race.force('Result')` 把**所有人**拉进结算（没跑完的显示"未完成"） |
| 结算页只有"回房间"，没法连续开局 | 旧版要靠房主再点开始 | 结算页两个按钮：「返回房间」发 `back_to_lobby`、「再来一局」发 `rematch`；服务器统计全票后自动 `startGame()`（lobby / results 都能开），客户端收到 `countdown` 调 `Game.resetRound()` 复位 |
| 比赛中进不来人 / 进来后不知道跑了多久 | 旧版 `join_room` 直接拒 `GAME_IN_PROGRESS` | B1.8 允许 `countdown`/`racing` 加入（≥8 人才 `ROOM_FULL`），给新人补 `game_state {state, elapsedMs}`；老玩家收 `player_joined` 调 `Game.addPeer()` 补远端 |
| 昵称每次刷新都要重填 | 只记了名字、没记时间 | `Profile` 加 `ppr:nicknameAt` 时间戳，`nicknameFresh()/nicknameLeftMs()` 判 1 小时有效期；有效期内首页直接跳过昵称门，过期回门且输入框仍为空 |
| 随机出拳的拳头"看着在但打不到" | 视觉与判定各算一套相位 | 拳套只保留**一份**定义：`ObstacleField.GLOVES/gloveZ/glovePunch/gloveFist`，`World.update()` 直接读 `obstacles.gloves` 摆模型，`hit()` 用同一个 `gloveFist` 判球-胶囊距离 |
| 拳套打飞后还想接着跑 | 淘汰只做了击退 | 命中带 `eliminate: true`：`Game.eliminatePlayer()` 记滞空 1 s（`GLOVE.flySeconds`）→ `respawnFromElimination()` 回起点满血 + 广播 `died{killerId:null}`，这 1 s 里不吃输入 |
| 拳套看着像"棒棒糖"（细杆顶个球，不像拳击手套） | 手臂半径 0.46 对上 1.5 m 的拳套太细；本体只有一颗球，没有指节/拇指/宽袖口 | 手臂加粗到 0.82（粗机械臂），本体加 4 道指节小球 + 拇指，袖口加宽到 0.72R / 0.95R 并加两道束带；待机时整只缩在墙面，出拳才整只探出 |
| 拳套静止时悬在跑道半空、看着没挂在墙上 | 旧视觉给拳心加了 0.9 m 固定内推，判定却按"拳心贴墙" | 视觉与判定统一用 `shift = extend × reach − wind × 0.8`：0 时整只收进墙里，手臂长度 = `shift − 0.9R`，露不出来就 `visible = false` |
| 拳套淘汰要"扣满 100 血"但走 `applyDamage` 会瞬移 | `applyDamage` 命中就 `onDeath` 立即传送，1 s 飞行过程根本看不到 | `Game.eliminatePlayer()` 直接 `health.damage(HEALTH.max,'obstacle')` 把血扣光（写 `damageLog`、闪红、死亡数 +1）再飞；`respawnFromElimination()` 用 `health.reset()`（不是 `voidFall()`，避免死亡数重复 +1） |
| 一个人点「返回房间」，整房人全被踢回大厅 | 旧 `back_to_lobby` 是"整房 reset + 全场广播" | 服务端只把自己标 `inLobby`、清自己的 `rematch`，`back_to_lobby` **只发本人**，另广播 `room_state`（带 `inLobby`）与 `rematch_status`；全员 `inLobby` 才把 `room.state` 落回 `lobby`。客户端按 `self.inLobby || state==='lobby'` 决定回不回首页，否则结算页上的人会被别人一脚踢回首页 |
| 回大厅的人还算在"再来一局"分母里 → 永远开不了下一局 | 投票总数把不在结算页的人也算上了 | `broadcastRematchStatus` / `everyoneWantsRematch` 只统计 `!inLobby` 的人（分母剔除回大厅者）；`startGame` 开局前把所有人 `inLobby = false`，回大厅的人也一起被带回赛道 |
| 起跑道拳套和旋转柱子 / 栏架 / 大摆锤叠在一起 | 4 只拳套的 z 是按赛道长度均分的，没有和既有障碍对表；`reach` 7 m 时拳心最内到 x≈±2，中线只剩 0.2 m | 4 只重排到 `-11 / -139.9 / -183.5 / -243.6`（右→左→右→左，起跑那只贴右墙、避开 -22 扫地杆从 -15.8 起扫的区域），`reach` 降到 6.5（中线留 ≥0.55 m）；扫地杆 4 从 -166 挪到 -168.5（原与 -160 摆锤只差 0.3 m）；新增 `ObstacleField.layoutBands()/layoutConflicts()` 把扫地杆扫掠圆、滚轴、地刺、摆锤摆幅、栏架、拳套全探出矩形、答题墙都投影到 z 轴，验收里断言两两不重叠（eps 0.05 m），并把 4 只的滑幅按缝隙收窄（2.2 / 1.0 / 2.2 / 2.6），最近间隙提到 ≥0.8 m |
| 拳套淘汰后"复活了还自己往前滑十几米" | 被打飞的同时身上还叠着别的推力（击退 / 回弹速度），`respawnFromElimination()` 只 teleport + `applyStun`，残余横速在复活后才生效 | 复活前先 `player.halt()` 把横速清零再 teleport（m9 里"推人 31 m/s + 拳套当场打飞"实测会从起点滑到 z≈14.4） |
| m9 的"回弹初速"量点突然多飞 2.5 m（12.33 → 14.84，命中 hp 变 0） | 起跑道拳套挪到右墙 z≈-11 后，老量点 (1.5, -8) 正好落在它的出拳范围里，"纯速度衰减"被人打飞打断 | 量点固定走左半边 `x=-4.5`（拳套只探到 x≥1）；消失格同理钉在 `idxAt(-4.5, -11.5)` |
| B2.0：自机颜色永远是青色，别人看自己却是自己选的色 | `Game` 初始化里 `if (this.net) jelly.setColor(0x2fe0d6)` 把自机身体颜色写死；单机时连自己的 `NameTag` 都不用存档色；远端 `RemotePlayer` 却老老实实用 `peer.color` | 自机颜色统一走 `ownColor = normalizeColor(net?.color) \|\| recallOrPickColor()`，身体、头顶名牌、网络上报三处同一个 hex；`Profile` 新增 `normalizeColor / randomCrowdColor / recallOrPickColor`（没存档就随机一个并 `saveColor`），服务端 `cleanColor` 也改成随机兜底 |
| B2.0：存档字段被 TS 收窄成字面量类型报 TS2322 | `private ownColorHex = COLORS.jellyBody` 在 `as const` 下被推成 `3137750` 字面量 | 显式写 `private ownColorHex: number = COLORS.jellyBody` |
| B2.0：浮桥上的角色站着不动就掉下去（kinematic 平台不带着走） | `KinematicCharacterController` 只解碰撞、不继承平台速度（与"移动平台带不走角色"同一个根因） | `BridgeField.carryDelta()` 每步算出"人是否站在板上 + 本步 dx"，`Game.onFixedUpdate` 在 `player.prepare` 前调 `player.carryX(dx)`（只平移、不动速度）；验收里 2.5 s 平台走 1.3–1.7 m（0.67 m/s），人的横向漂移 < 0.1 m |
| B2.0：6 块浮桥只建了一次 geometry，dispose 时把整段桥一起删掉 | `buildBridge()` 里 6 块板共用同一份几何体，`dispose()` 里按块 `geo.dispose()` | 共享几何体只在 `World.dispose()` 里随世界一起释放，单块不做 dispose |
| B2.0 调整：浮桥要"1 左 2 右交叉起步 + 匀速扫、到边界立刻反向" | 原来用 `sin()` 相位错开：速度两头慢中间快、相邻两块落差只有 2.4 m，且起步姿态不可控（受 `elapsed` 影响） | `positionOf` 换成三角波 `u = phase<0.5 ? 1-4*phase : -3+4*phase`，板心 `x = side·swingX·u`，`side = i%2 ? +1 : -1`；`travelSeconds=3`、`swingX=2`。`reset()` 把相位归零 → 每局开局必是「1/3/5 最左、2/4/6 最右」；`BRIDGE.offsetX / amplitudeX / periodSeconds / phaseStep` 全部删除 |
| B2.0 调整：删掉旧摆动字段后 typecheck 挂住 | `Game.getBridge()` 调试钩子还在读 `BRIDGE.amplitudeX / periodSeconds / offsetX`（这些常量已不存在） | 钩子同步成 `swingX / travelSeconds`，并新增 `resetBridge()` 钩子（验收脚本靠它把相位归零、断言"1 左 2 右"起步姿态） |
| B2.0 调整：验收脚本采样撞上折返点误判 | 三角波在边界处速度瞬间反号，只取两个时刻容易正好落在折返点 | `verify_b20.py` 改成每 100 ms 采样 6.6 s（覆盖一个完整往返），再断言"转向点都出现在 ±2 m 附近""每步位移稳定""相邻两块 x 互为相反数""横向落差 ≤4 m 且存在对齐窗口" |
| B2.0：挖空的格子还会被抽签 / 被 `clearTiles` 改成实心，人又能站上去 | `TileField` 的 reset / 保底 fill / `clearSpecial` / `probe` 都按索引遍历 | 新增 `readonly gap: boolean[]`（`def.z` 落在 `BRIDGE.gapZEnd..gapZStart` 之间），`isGap()` 的格子在 reset / fill / probe / update / setRole / visual 里全部跳过，`buildTiles()` 也不给它建碰撞体；`snapshot()` 多一个 `gap` 字段供验收断言 |

## 6. Git

- 主分支 `main`，小步提交，提交信息中文 + 阶段前缀，例如 `M1: 框架与场景骨架`。
- 里程碑打 tag：`m1`、`m2`……
- `dist/`、`node_modules/`、`.venv/` 不入库。
