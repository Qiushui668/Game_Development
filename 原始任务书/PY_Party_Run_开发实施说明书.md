# PY Party Run｜第一阶段开发实施说明书

**项目代号：PY Party Run · 彩虹冲刺**\
**版本：V1.0（先做单人可玩的跑酷原型，再扩展最多5人联机）**

## 1. 项目目标与范围

开发一款运行在现代浏览器中的3D多人障碍赛网页游戏。玩家进入网页后可以单人快速开始，也可以创建房间邀请朋友。玩家控制圆润卡通角色在赛道跑动、跳跃、躲避障碍、跨越平台、通过检查点并抵达终点。

### V1.0范围

-   PC浏览器优先；Chrome/Edge为首要测试环境。
-   3D、第三人称跟随视角。
-   最少1人开始，最多5人同房。
-   单人快速开始、创建房间、房间码加入。
-   WASD/方向键移动，空格跳跃；鼠标调整视角。
-   第一张完整赛道；移动障碍、旋转横杆、摆锤、弹跳板。
-   检查点、掉落复活、计时、排名、终点和结算。
-   本阶段不开发答题、商城、复杂装扮、手机触控适配。

### 开发原则

1.  每阶段完成并测试后再推进，不一次生成全项目。
2.  使用程序生成的几何模型，优先验证玩法。
3.  先保证逻辑正确，再打磨美术。
4.  单人模式不依赖服务器，必须独立可运行。
5.  多人架构提前预留；避免最后临时拼接。
6.  每个模块有清晰职责，配置集中管理，避免巨型文件。

## 2. 技术栈与架构

  ------------------------------------------------------------------------------------------
  模块                    技术                    职责
  ----------------------- ----------------------- ------------------------------------------
  Web UI                  Vue 3 + TypeScript      首页、大厅、HUD、菜单、结算

  开发工具                Vite                    开发服务器、热更新、构建

  3D渲染                  Three.js                场景、模型、摄像机、灯光、赛道、障碍

  物理                    Rapier 3D               重力、碰撞、角色运动与障碍反馈

  后端（联机阶段）        Python + FastAPI +      房间、比赛状态、玩家同步
                          WebSocket               

  状态管理                Pinia（可选/推荐）      UI及房间状态

  路由                    Vue Router（推荐）      首页、大厅、游戏、结算页面

  数据存储                SQLite（后期）          成绩、房间记录、玩家资料；原型阶段可不接
  ------------------------------------------------------------------------------------------

**架构边界：**
Vue不负责每帧绘制游戏；Three.js不负责房间业务逻辑；Rapier不负责UI。单人和多人共享Game
Runtime、角色控制器、赛道、障碍、摄像机和HUD，差异在状态来源及网络同步层。

## 3. 环境准备与初始化

### 环境要求

-   Node.js LTS、npm
-   Python 3.11或3.12（联机后端阶段）
-   VS Code或Cursor
-   Chrome或Edge
-   Git

### 创建前端项目

``` bash
npm create vite@latest py-party-run -- --template vue-ts
cd py-party-run
npm install
npm install three @dimforge/rapier3d-compat
npm install -D @types/three
npm run dev
```

建议后续按需安装
`pinia`、`vue-router`、`lucide-vue-next`。首版不要堆叠大量UI、动画或游戏框架依赖。

## 4. 推荐目录结构

``` text
py-party-run/
├── public/ (models/, textures/, sounds/, icons/)
├── src/
│   ├── main.ts / App.vue
│   ├── views/ (HomeView.vue, LobbyView.vue, GameView.vue, ResultView.vue)
│   ├── components/
│   │   ├── game/ (GameCanvas.vue, GameHUD.vue, GameCountdown.vue, GameMenu.vue, PlayerInfo.vue)
│   │   └── lobby/ (RoomCode.vue, PlayerList.vue, ReadyButton.vue)
│   ├── game/
│   │   ├── core/ (Game.ts, GameLoop.ts, GameConfig.ts, GameState.ts)
│   │   ├── scene/ (SceneManager.ts, World.ts, Lighting.ts, Environment.ts)
│   │   ├── player/ (Player.ts, PlayerController.ts, PlayerPhysics.ts, PlayerAnimator.ts, PlayerState.ts)
│   │   ├── camera/ (FollowCamera.ts)
│   │   ├── map/ (RaceMap.ts, TrackBuilder.ts, TrackSection.ts, Checkpoint.ts, FinishLine.ts)
│   │   ├── obstacles/ (Obstacle.ts, MovingBlock.ts, RotatingBar.ts, Pendulum.ts, BouncePad.ts)
│   │   ├── systems/ (InputSystem.ts, PhysicsSystem.ts, CollisionSystem.ts, RespawnSystem.ts, RaceSystem.ts, ProgressSystem.ts)
│   │   └── utils/ (MathUtils.ts, Cleanup.ts)
│   ├── multiplayer/ (NetworkClient.ts, NetworkState.ts, RoomService.ts, PlayerSync.ts, Interpolation.ts)
│   ├── stores/ (playerStore.ts, roomStore.ts, gameStore.ts)
│   ├── router/ (index.ts)
│   ├── styles/ (global.css, game.css, ui.css)
│   └── types/ (game.ts, player.ts, network.ts)
├── backend/ (main.py, requirements.txt, app/room_manager.py, websocket_manager.py, game_manager.py, models.py, config.py, tests/)
├── docs/ (DEVELOPMENT.md, NETWORK_PROTOCOL.md)
└── README.md
```

模块职责：`Game.ts`初始化/启动/停止；`Player.ts`创建和销毁角色；`PlayerController.ts`移动与跳跃；`PlayerPhysics.ts`物理；`FollowCamera.ts`镜头；`RaceMap.ts`组合地图；`TrackBuilder.ts`生成赛道；障碍模块各自实现；`RespawnSystem.ts`掉落复活；`RaceSystem.ts`比赛流程；`ProgressSystem.ts`进度排名；`NetworkClient.ts`网络连接；`RoomService.ts`房间业务。

## 5. 坐标与场景规格

统一坐标：X左右、Y上下、Z前后；起点Z=0，终点Z=-180，向前跑时Z逐渐减小。所有模块遵循同一坐标约定。

### 环境风格

-   蓝色天空；青色赛道；粉色/紫色障碍；紫色护栏；蓝紫色低多边形山体。
-   柔和太阳光，轻量阴影，低多边形糖果风。
-   第一版使用程序生成装饰，暂不依赖外部3D模型。

### 初始尺寸（统一配置，可调）

  参数                       初始值
  ------------------ --------------
  赛道宽度                       18
  起点平台长度                   15
  赛道总长度                    180
  地面厚度                        1
  玩家高度参考                  1.8
  玩家碰撞半径参考             0.45
  护栏高度                      1.0
  护栏宽度                      0.5
  平台高度变化             0.5--1.5
  缺口长度                     2--5
  检查点间距           约40--60单位

尺寸需与实际Rapier
Collider定义校准；不要将胶囊半高与总高混淆导致浮空或穿地。

### 场景层级

``` text
GameScene
├── Sky / BackgroundMountains / MainLighting
├── RaceTrack (StartPlatform, Section_01...Section_05, FinishPlatform)
├── Obstacles / Checkpoints / Player / OtherPlayers / Camera
```

## 6. 玩家角色与运动

### 角色模型

首版用Three.js几何体组合：圆润胶囊身体、两手臂、两腿、两颗眼睛；颜色可配置，材质为柔和高光塑料/软胶感。视觉模型与物理碰撞体分离。

结构参考：`PlayerRoot → PhysicsBody + VisualRoot(Body, Face/Eyes, Arms, Legs)`。视觉动画不得改变物理碰撞主体。

### 物理与控制初始值

  参数                       建议初值
  ---------------------- ------------
  移动速度                          7
  冲刺速度（后续可选）             10
  加速度                           30
  减速度                           24
  空中控制比例                   0.45
  跳跃初速度                      8.5
  最大下落速度                    -25
  击退速度参考                  6--12
  倒地时间参考             0.8--1.2秒
  复活无敌时间                    1秒

参数仅为手感调试起点；集中在配置文件，避免散落在多个脚本。

### 移动要求

-   WASD及方向键：前后左右；方向相对摄像机计算。
-   有加速度与减速度，停止后适度滑行。
-   转向响应迅速；空中可有限调整。
-   不穿平台；跳跃仅在Grounded触发；落地恢复跳跃权限。

### 跳跃与状态机

状态建议：Idle、Running、Jumping、Falling、Knockback、Respawning、Finished。使用统一状态机管理合法转换，不用多个互相矛盾的布尔值拼状态。Space跳跃；检测离地、最高点、下落和落地；空中不能重复跳。

### 动画

首版程序动画：跑步腿部交替摆动、手臂摆动、身体轻微上下弹；跳跃抬臂；撞击倾斜；复活和胜利动作。动画只影响VisualRoot。

## 7. 第三人称摄像机

摄像机在角色后方略高，主要观察赛道前方；平滑跟随，跳跃和掉落时避免剧烈抖动。鼠标拖动调整视角，后续可使用Pointer
Lock；Esc释放鼠标。滚轮缩放为可选。

  参数                        初始建议
  ------------ -----------------------
  后方距离                           7
  高度                               4
  俯角                         15--25°
  鼠标灵敏度     约0.003（按实现标定）
  俯仰限制                   -15°至55°

验收：角色始终可见；镜头平滑、不穿地；移动方向随视角一致；鼠标旋转不引发移动异常。

## 8. 地图：Rainbow Rush

第一版采用固定地图，不随机生成，以便调试、碰撞测试和调整难度。

  区域     Z范围        内容             难度
  -------- ------------ ---------------- ------
  起跑区   0至-15       起跑平台         低
  第一关   -15至-40     横向推杆         低
  第二关   -40至-65     旋转横杆         中
  第三关   -65至-100    跳跃平台/缺口    中
  第四关   -100至-130   摆锤组合         高
  第五关   -130至-160   弹跳板/平台      高
  终点区   -160至-180   冲刺与终点拱门   低

### 分区设计

-   **起跑区：**宽18、长15；粉白格纹、起跑线、明确前进指引，玩家生成位置分散。
-   **横向推杆：**3--4个障碍，左右往复，范围有限、速度不同，观察时机通过。初始参考：B1长度4/宽2/范围±5/速度2；B2长度5/宽2/范围±4/速度2.5；B3长度3/宽2/范围±6/速度3。
-   **旋转横杆：**1--2根，长度约12，离地参考0.6，绕垂直轴旋转，可跳跃/避让，碰撞击退；碰撞与视觉旋转同步。
-   **跳跃平台：**4--6个平台，间隙与高度变化，至少有相对安全通道，掉落回CP1或CP2。
-   **摆锤：**2--3个，摆动角度与速度不同，观察节奏通过，撞击击飞。
-   **弹跳平台：**2个，触发向上速度，可带前向冲量，方向提示明显。
-   **终点：**彩色拱门、地面箭头；触发停止计时、胜利效果和结算。

## 9. 障碍系统规范

障碍统一接口建议包含：`create()`、`update(deltaTime)`、`getPosition()`、`getCollider()`、`handleCollision(player)`、`reset()`、`dispose()`。每个障碍具备ID、类型、初始位置、运动参数、碰撞区域、启用状态、更新/重置/销毁逻辑。

### 横向推杆

-   左右往复、范围与速度可配置，到边界反向。
-   使用deltaTime或物理时间步，不能依赖帧数。
-   撞击后击退；不会移动出赛道；可重置。

### 旋转横杆

-   固定中心轴，旋转速度可配置。
-   碰撞体随视觉同步。
-   撞击反馈与方向合理；支持改变旋转方向。

### 摆锤

-   固定悬挂点；数学正弦摆动或物理铰链。
-   摆动角度有上限，碰撞击飞。
-   首版不需要绳索的复杂真实物理。

### 弹跳板

-   检测从上方触碰；施加向上冲量及可配置前向冲量。
-   有动画和短冷却，防止连续触发。

### 撞击反馈

短暂限制控制、按碰撞方向击退、视觉身体倾斜/旋转、恢复控制；避免无限连撞或永久失控。

## 10. 检查点、复活与比赛流程

### 检查点

-   CP1：第一关结束；CP2：跳跃平台结束；CP3：摆锤区域结束。
-   每个检查点有ID、触发区域、复活位置、激活状态、视觉提示和激活事件。

### 掉落复活

当玩家低于安全高度：禁用控制、播放掉落效果、统计掉落次数、取最近检查点、重置位置/速度/角速度/状态/动画/碰撞与跳跃状态，恢复控制并给予短暂无敌时间。防止连续触发。

### 比赛状态

Menu → Loading → Countdown → Racing → Respawning（必要时）→ Finished →
Result；Racing可暂停为Paused，恢复回Racing。状态转换必须合法。

比赛流程：加载地图与玩家、倒计时3/2/1/GO、开始计时、跑酷、掉落复活、到终点停止计时、显示结算；重开须重置地图、障碍、玩家和计时。

## 11. UI与交互

UI由Vue渲染，Three.js画布独立。UI避免遮挡赛道。

### 首页

-   游戏Logo、昵称输入、角色颜色选择。
-   快速开始、创建房间、加入房间。
-   操作说明、音量设置。
-   单人快速开始直接进入，不经过房间等待。

### HUD

-   左上昵称；顶部计时与进度；右上人数/排名；左下操作提示；中央倒计时/事件提示；右下暂停。
-   半透明、圆角、明亮风格，不能遮挡主要视野。

### 倒计时

中央显示3、2、1、GO，带放大/弹跳动画；倒计时期间锁定玩家，结束后解锁。

### 暂停

ESC打开继续、重新开始、操作说明、返回首页。多人中默认仅暂停自己的操作/UI，不暂停全房间，除非房主发起并且系统明确支持全房暂停。

### 结算

显示昵称、完成时间、排名、掉落次数、检查点信息（可选）、再来一局、返回首页。单人未完成时可退出或重开。

## 12. 多人房间与同步

多人是第二阶段，但早期设计预留接口。单人不依赖服务器；多人连接服务器并使用房间状态。

### 房间规则

  规则         要求
  ------------ --------------
  最少人数     1
  最大人数     5
  房间码       6位字符
  房主         创建者
  开始权限     房主
  游戏开始     房主手动开始
  加入方式     房间码
  游戏中加入   V1禁止
  游戏中退出   允许
  房主离开     自动转移
  空房间       自动销毁

房间状态：Waiting → Countdown → Racing →
Finished；Finished后可Rematch回Waiting或关闭。

### WebSocket事件

客户端事件：`create_room`（昵称/颜色）、`join_room`（房间码/昵称/颜色）、`leave_room`、`ready`、`start_game`、`player_input`（移动/跳跃/冲刺）、`checkpoint`、`finish`、`ping`。
服务端事件：`room_state`、`player_joined`、`player_left`、`countdown`、`game_started`、`player_state`、`checkpoint_updated`、`player_finished`、`leaderboard`、`game_finished`、`error`。

统一消息格式（建议）：事件名、房间ID、玩家ID、payload；所有输入校验、错误码和版本字段可在协议文档中补充。

### 同步策略

-   玩家输入按变化或固定频率发送。
-   初始测试状态同步约15--20次/秒。
-   服务端管理房间、比赛阶段和关键结果。
-   其他玩家显示使用插值缓冲。
-   断线保留短时重连窗口。
-   玩家完成后以服务器记录时间排序。

轻量原型允许客户端预测自己的运动，但服务端应校验输入和关键比赛事件。不要信任客户端随意上报位置、完成时间或检查点。正式竞技级网络物理（固定步进、服务器权威、预测/回滚等）可后续增强。

## 13. 开发阶段与任务清单

### 阶段A：3D框架

-   **A-01初始化：**Vue/TS/Vite、Three.js、Rapier、目录、GameCanvas、Game入口、SceneManager；运行无编译错误。
-   **A-02场景：**Scene、PerspectiveCamera、Renderer、背景、灯光、地面、测试立方体、窗口适配、资源清理；浏览器可见3D场景。
-   **A-03世界：**天空、低多边形山、赛道、起点/终点、护栏、装饰；明确前进方向。

### 阶段B：角色

-   **B-01模型：**胶囊身体、手臂、腿、眼睛、颜色配置、PhysicsBody与VisualRoot分离。
-   **B-02移动：**WASD、方向键、旋转、加减速、摄像机方向、空中控制；不瞬移、不穿地。
-   **B-03跳跃：**Grounded检测、Jump/Fall、落地、二次跳跃限制；跳跃高度稳定。
-   **B-04动画：**Idle/Run/Jump/Fall/Knockback/Respawn/Win；切换自然，不影响碰撞体。

### 阶段C：镜头与手感

-   **C-01摄像机：**跟随、平滑、鼠标视角、俯仰限制、防穿地；移动方向正确。
-   **C-02调优：**速度、加速度、摩擦、跳跃、空中控制、撞击、镜头参数；跨越简单平台稳定。

### 阶段D：地图与障碍

-   **D-01赛道：**TrackBuilder、平台、缺口、护栏、高低平台、起终点；碰撞正确。
-   **D-02推杆：**往复、边界、速度、碰撞、击退。
-   **D-03横杆：**旋转、碰撞、击退。
-   **D-04摆锤：**悬挂、摆动范围/周期、碰撞。
-   **D-05弹跳板：**触发、弹跳力、前向推力、冷却、动画。
-   **D-06复活：**检查点、掉落、复活、物理重置。

### 阶段E：UI与比赛

-   **E-01首页：**昵称、颜色、快速开始、创建/加入房间、说明、设置。
-   **E-02流程：**Loading、Countdown、Racing、Respawning、Finished、Result、Restart。
-   **E-03 HUD：**计时、进度、排名、操作提示、暂停、掉落统计。
-   **E-04结算：**完成时间、掉落次数、排名、重开、返回首页。

### 阶段F：多人

-   **F-01后端：**FastAPI、WebSocket、CORS、RoomManager、PlayerManager、Game状态；连接可用。
-   **F-02房间：**创建/加入/码/人数限制/房主/退出/转移/销毁；最多5人。
-   **F-03开始同步：**房主权限验证、倒计时、统一开始状态。
-   **F-04位置同步：**移动、跳跃、掉落、复活、完成、插值与延迟处理。
-   **F-05排名：**赛道进度排序，完成者按服务器时间排序。
-   **F-06断线：**心跳、断线检测、重连、房主转移；单人断线不影响房间。

### 阶段G：部署

-   前端构建与部署、后端服务器、WebSocket公网连接、配置环境变量、基础监控和线上测试。
-   交付可访问网址、部署说明和版本回滚方案。

## 14. AI辅助开发约定

每次只完成一个阶段或子任务；修改前阅读现有文件；不随意破坏已验收模块；涉及多模块改动先列方案；完成后报告修改文件、运行命令、测试方法、结果及遗留问题；Bug优先修复，不顺手扩展功能。

## 15. 可复制给AI的任务提示词

### Prompt 1：项目初始化

你是一名资深Web 3D游戏开发工程师，协助开发PY Party
Run网页障碍赛。目标为单人可玩、后续最多5人联机。技术栈Vue
3、TypeScript、Vite、Three.js、Rapier；后端未来Python/FastAPI/WebSocket。请先检查当前结构，只执行初始化任务：创建/完善目录，创建GameCanvas.vue、Game.ts、SceneManager.ts，初始化Scene、PerspectiveCamera、WebGLRenderer、基础灯光、地面和测试立方体，支持窗口适配与资源销毁。保持模块化；不要开发角色、障碍、联机、房间、答题。编码前说明文件计划；完成后列文件、运行方法、验收测试及未实现内容。验收为浏览器展示可正常运行的3D场景。

### Prompt 2：角色控制

阅读现有Game、SceneManager、物理初始化，不重写项目。使用Three.js几何体创建圆润角色（身体、手臂、腿、眼睛），颜色可配置；视觉与物理分离。Rapier创建刚体和胶囊碰撞体，重力、地面检测、旋转限制。WASD/方向键移动，Space跳跃；移动方向相对摄像机；具有加减速、空中有限控制；只允许落地跳跃；不能穿地。创建/完善Player、PlayerController、PlayerPhysics、PlayerState、InputSystem等必要模块，按现有结构适配。参数集中管理。只开发角色控制；完成后报告文件与测试。

### Prompt 3：第三人称摄像机

阅读现有代码，不重写已完成模块。实现玩家后方略高的平滑跟随摄像机；鼠标拖动调整视角，俯仰限制，窗口适配；跳跃/掉落时镜头自然，不抖；移动方向随摄像机。后方距离7、高度4、俯角15--25度等作为可调初值。验收：跟随自然、鼠标可靠、镜头不穿地、移动方向一致。不要开发障碍或联机。

### Prompt 4：地图与障碍

基于现有项目开发固定地图Rainbow
Rush。赛道长180、宽18；起点Z=0、终点Z=-180；分区为起跑、推杆、旋转横杆、跳台、摆锤、弹跳板、终点。视觉采用青色地面、粉色障碍、紫色护栏、蓝色天空和低多边形山，程序生成。障碍独立模块，支持update/reset/dispose；使用deltaTime或固定物理步。碰撞与视觉运动一致，玩家可跑完全程。不要重写Player、Physics、Camera；完成后列文件和测试。

### Prompt 5：检查点与比赛流程

阅读现有代码，开发CP1第一关结束、CP2跳跃平台结束、CP3摆锤区域结束；检测触碰并保存复活位置。掉落时禁用控制、播放效果、统计次数、回到最近检查点、重置位置/速度/角速度/状态/动画/碰撞/跳跃状态，恢复控制并给予短暂无敌。比赛状态Menu、Loading、Countdown、Racing、Respawning、Paused、Finished、Result；状态转换合法。完成计时、终点、结算、重开重置。模块化，不开发联机。

### Prompt 6：多人房间

为现有项目开发最多5人的多人房间，后端Python/FastAPI/asyncio/WebSocket，前端Vue/TS/Three.js。实现创建6位房间码、加入/退出、人数限制、昵称/颜色、玩家列表、房主权限、房主开始、房主转移、空房清理。定义统一事件协议：客户端create_room/join_room/leave_room/ready/start_game/player_input/ping；服务端room_state/player_joined/player_left/countdown/game_started/player_state/player_finished/leaderboard/game_finished/error。同步移动、跳跃、掉落、复活、完成，插值显示，断线重连。校验房主、房间人数、消息频率、关键比赛状态，不能信任客户端任意位置/完成时间。用两个浏览器验证创建加入、同步移动、比赛、退出。只开发联机，不增加新玩法。

## 16. 单人和多人模式的架构要求

**不要将单人模式改造成依赖网络的模式。** - Solo：本地Game
Runtime、本地物理、本地计时，不需要服务器或WebSocket。 -
Multiplayer：连接服务器、房间状态、同步玩家、服务器管理关键比赛状态。 -
两者共享玩家控制器、角色模型、摄像机、赛道、障碍、HUD和复活系统。

## 17. 性能与质量目标

  指标           目标/策略
  -------------- ----------------------------------
  目标帧率       60 FPS；最低可接受30 FPS
  房间人数       最多5人
  网络同步初值   15--20次/秒测试
  模型           低多边形、简化几何
  阴影           限制实时阴影物体
  材质           共享材质，避免重复创建
  物理           固定或稳定时间步，限制碰撞复杂度

避免每帧创建对象/材质、资源未释放、游戏循环频繁DOM查询、过多透明材质、全场实时阴影、每帧发送大量网络数据、远端角色瞬移。优化以实际性能测量为依据。

## 18. 测试计划

### 单人测试

  项目        预期
  ----------- ----------------------
  启动        正常进入
  移动        方向正确、响应稳定
  跳跃        可跳，空中不可二次跳
  地面/平台   不穿透、可站立
  障碍        碰撞与击退正常
  掉落/复活   触发并返回正确检查点
  终点/计时   正常结束、时间准确
  重开        所有状态重置

### 多人测试

  项目             预期
  ---------------- ------------------------
  创建/加入房间    成功
  1人房间          可开始
  2人及5人         正常；第6人拒绝
  移动/跳跃        角色同步平滑
  掉落/复活        状态同步
  排名/终点        顺序一致、完成时间可信
  退出/房主离开    房间更新、房主转移
  延迟/断线/重连   不崩溃，合理恢复或退出

## 19. Git版本管理建议

每完成一个里程碑保存可回退版本：

``` bash
git init
git add .
git commit -m "M1: Initialize 3D scene"
```

后续示例：`M2: Add player controller`、`M3: Build race map and obstacles`。建议分支：main、feature/3d-scene、feature/player-controller、feature/camera、feature/race-map、feature/obstacles、feature/respawn、feature/game-ui、feature/multiplayer。AI改动可能破坏已完成模块，Git回退非常重要。

## 20. 里程碑与交付

  里程碑   交付                                 验收
  -------- ------------------------------------ ------------------
  M1       3D天空、地面、赛道、灯光、测试物体   3D场景运行
  M2       角色、移动、跳跃、摄像机、物理       可操控角色
  M3       地图、障碍、检查点、复活、终点       单人可通关
  M4       首页、HUD、暂停、计时、结算、重开    单人闭环
  M5       房间码、创建/加入、最多5人、开始     多人大厅
  M6       同步、排名、掉落、终点、断线处理     多人竞速
  M7       部署、线上测试、配置与回滚文档       可访问的测试版本

## 21. 第一天任务：M1验收清单

-   [ ] 创建Vue 3 + TypeScript + Vite项目
-   [ ] 安装Three.js和Rapier
-   [ ] 创建GameCanvas
-   [ ] 创建3D场景
-   [ ] 蓝色天空背景
-   [ ] 青色地面
-   [ ] 简单跑道
-   [ ] 粉色测试障碍
-   [ ] 摄像机与灯光
-   [ ] 浏览器运行正常
-   [ ] Git保存M1版本

第一阶段画面目标：蓝色天空、远处低多边形山体、青色跑道、粉色障碍、紫色护栏和明显3D纵深。视觉尚未达到参考图也可以进入下一阶段。

## 22. 最终路线与开发策略

**第一部分：核心**------3D世界、角色、移动、跳跃、摄像机、物理。\
**第二部分：跑酷内容**------赛道、障碍、检查点、复活、终点、结算。\
**第三部分：多人**------房间、房间码、5人、同步、排名、联机竞赛。\
**第四部分：上线**------优化、测试、部署、邀请好友；后续再融入Python题库玩法。

建议坚持"先做小而完整、能跑能跳能撞能掉能复活"的原型，再扩建。项目最大的风险是过早追求完整糖豆人规模，耗费大量时间在美术和复杂联机架构，尚未验证核心手感。
