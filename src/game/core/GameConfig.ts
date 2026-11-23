/**
 * 全局唯一配置。所有可调数值集中在此，禁止散落到各模块。
 * 数值依据：开发实施说明书 V1.1 §6.3 / §7 / §13
 */

/** 物理与步进 */
export const PHYSICS = {
  /** 关键：不是 -9.81。配 9.5 的跳跃初速得到 1.88 m 跳高 / 5.5 m 跳距 */
  gravityY: -24,
  fixedStep: 1 / 60,
  /** 单帧最多补的物理步数，掉帧时宁可慢放也不追帧 */
  maxSubSteps: 2,
  /** 下落段重力倍率，1.0 = 不区分上升/下落 */
  fallGravityMultiplier: 1.15,
} as const

/** 渲染预算与画质（30 FPS 基线，见 §13） */
export const RENDER = {
  /** 固定 1，不做高 DPI 渲染 */
  pixelRatio: 1,
  /** 渲染分辨率上限，超出部分用 CSS 拉伸 */
  maxWidth: 1280,
  maxHeight: 720,
  fov: 60,
  near: 0.1,
  /** 300 是给天空穹顶与远山留的余量，几何量不变，纯深度范围 */
  far: 300,
  fogNear: 170,
  fogFar: 420,
} as const

/** 赛道尺寸（单位：米） */
export const TRACK = {
  width: 18,
  /** Z 0 → -320，约 32 s（10 m/s）到 46 s（7 m/s）跑完 */
  length: 320,
  startZ: 0,
  finishZ: -320,
  /** 碰撞厚度，中心 y = -thickness/2 */
  groundThickness: 0.5,
  railHeight: 1,
  railWidth: 0.5,
  startPlatformLength: 15,
  finishPlatformLength: 6,
  /** 终点线之后的缓冲区长度，避免冲线后立刻掉进虚空 */
  runoff: 12,
} as const

/** 障碍（扫地杆 / 滚轴 / 地刺 / 摆锤）的判定与击退参数 */
export const OBSTACLE = {
  /** 扫地杆摆臂半径（判定与几何共用） */
  armRadius: 0.5,
  /** 被击中后的水平击退速度（滚轴 / 地刺 / 摆锤） */
  knockbackSpeed: 10.5,
  /** 扫地杆击退初速：横向 22 m/s + 0.9 s 硬直按指数衰减 ≈ 退 8 m（用户要求 7–8 m） */
  sweepKnockbackSpeed: 22,
  /** 扫地杆的上抛更高，飞出去看得见弧线 */
  sweepKnockbackHop: 4,
  /** 被击中时的上抛速度，给一个短促的离地感 */
  knockbackHop: 3.2,
  /** 硬直时长：这段时间输入无效，只能等速度衰减 */
  stunSeconds: 0.9,
  /** 同一次接触的重复命中间隔，防止贴边连击 */
  hitCooldown: 0.35,
  /** 被任何障碍命中统一扣的生命值 */
  damage: 10,
  /** 柱子转速整体倍率（用户要求"加快"） */
  sweepSpeedScale: 1.6,
} as const

/** 生命值规则（用户指定：满血 100，障碍 10，轻击 34，重击 70） */
export const HEALTH = {
  max: 100,
  obstacleDamage: OBSTACLE.damage,
  lightDamage: 34,
  heavyDamage: 70,
} as const

/**
 * 巨型拳击手套（用户 B1.8 需求）：挂在赛道左右两侧的墙上，
 * **只沿 Z 前后随机滑动、绝不左右移动**，随机探出拳头把玩家打飞。
 * 被打中 = 先扣光 100 血，再飞出去 1 s，然后从起点满血复活（记一次死亡）。
 */
export const GLOVE = {
  /** 拳套半径：视觉球体半径，也是判定球半径 */
  fistRadius: 1.5,
  /** 从墙面伸进赛道多少米（拳心最内侧到 x≈±2.5，中间留 1 m 以上的逃生缝） */
  reach: 6.5,
  /** 拳心离地高度 */
  fistY: 1.6,
  /** 一次完整出拳周期（秒）：蓄力 → 出拳 → 保持 → 收回 → 待机 */
  cycle: 4.2,
  /** 出拳到最外侧要多久（秒），给判定与视觉共用的比例换算 */
  extendFraction: 0.12,
  /** 只有拳头探出到这个比例以上才有判定（正在飞出的半程不判定） */
  hitMinExtend: 0.6,
  /** 被打飞的初速与上抛：34 m/s + 13 m/s 上抛，飞出赛道、落在起点平台上 */
  knockbackSpeed: 34,
  knockbackHop: 13,
  /** 飞行展示时长：飞出去这么久之后才回起点复活（先看飞，再淘汰） */
  flySeconds: 1,
} as const

/**
 * 浮桥段（B2.0）：答完第 2 题（z=-136 的墙）到第 3 题（-196）之间，
 * 33 m 地面整体挖空，只剩 6 块横向左右摆动的浮桥；踩空 = 掉进虚空 → 回起点满血复活。
 */
export const BRIDGE = {
  /** 浮桥块数（用户要求 5–6 块，取 6） */
  count: 6,
  /** 单块尺寸（米）：宽 × 深；顶面与赛道齐平（y = 0） */
  width: 3.6,
  depth: 3.6,
  /** 板厚（碰撞厚度，也决定视觉板厚） */
  thickness: 0.5,
  /** 相邻两块中心距：3.6 板 + 1.9 缝，配合 5.5 m 跳距很从容 */
  pitch: 5.5,
  /** 第一块中心 z（在挖空段里，前面留 1.6 m 起跳距离） */
  firstZ: -145.4,
  /** 左右摆动中心：奇偶块左右错开，形成"折线过桥" */
  offsetX: 1.2,
  /** 横向摆动幅度（±米） */
  amplitudeX: 1.9,
  /** 一个完整左右往返的秒数 */
  periodSeconds: 5.2,
  /** 相邻块的相位差：让 6 块各自动，而不是整段一起平移 */
  phaseStep: 0.18,
  /**
   * 挖空段 z 范围：与方格网边界对齐（row 54 顶边 = 20-3*54 = -142，
   * row 64 底边 = 20-3*65 = -175），共 11 行 × 6 列 = 66 块方格被挖掉。
   */
  gapZStart: -142,
  gapZEnd: -175,
  /** 板面配色（奇偶交替，糖果风的两块"浮冰"） */
  tintA: 0x2fe6dd,
  tintB: 0xff9ad8,
} as const

/**
 * 赛道方格（随机消失 → 掉进虚空；随机回弹 → 往起点方向弹开）。
 * 整条主赛道都是同一张 3 m 网格，格子尺寸 / 材质完全一致，玩家看不出哪块有陷阱。
 */
export const TILE = {
  /** 方格边长：与棋盘贴图两格对齐，铺满 18 m 赛道正好 6 列 */
  cellSize: 3,
  /** 方格网覆盖的 z 范围：起点平台末端 +20 → 冲线后 2 m（-322） */
  zStart: 20,
  zEnd: -322,
  /** 终点前 7 m（<= -313）永远实心：不能在压线那一步掉下去 */
  safeFinishZ: -313,
  /** 每块方格的厚度：顶面与赛道顶面齐平（y = 0） */
  thickness: 0.26,
  /** 消失前的警示抖动：跑动能冲过去，站住就会掉 */
  trembleSeconds: 0.3,
  /** 抖动结束后的下坠动画时长 */
  dropSeconds: 0.55,
  /** 掉下去多深后整块隐藏 */
  dropDepth: 6,
  /** 消失后多久从下方长回来（随机区间，秒） */
  regrowMin: 6,
  regrowMax: 10,
  /** 长回来的升起时长 */
  riseSeconds: 0.45,
  /**
   * 整条赛道每块方格被抽成"会消失 / 会回弹"的概率，其余是实心。
   * 684 块里约 4% 消失、2.5% 回弹：跑一趟 114 行大概踩到 4–5 块消失、2–3 块回弹。
   */
  vanishChance: 0.04,
  bounceChance: 0.025,
  /** 回弹：往起点方向（+Z）的初速与上抛。31 m/s + 1.5 s 硬直 ≈ 弹回 12 m；
   *  上抛 12 m/s（最高约 3 m）让这段弧线能越过栏架 / 滚轴，不会被身后的障碍吃掉距离 */
  bounceSpeed: 31,
  bounceHop: 12,
  bounceStun: 1.5,
  /** 同一块回弹格的重复触发冷却 */
  bounceCooldown: 1.2,
  /** 回弹的压缩动画时长 */
  bumpSeconds: 0.3,
} as const


/** 角色（M2 使用，先定格，避免后续改动协议与手感基准） */
export const PLAYER = {
  height: 1.8,
  radius: 0.45,
  maxSpeed: 7,
  sprintSpeed: 10,
  accel: 30,
  decel: 24,
  airControl: 0.45,
  jumpVelocity: 9.5,
  maxFallSpeed: -25,
  /** 离地后仍可起跳的宽限窗口 */
  coyoteTime: 0.1,
  /** 落地前按下的跳跃会被缓存 */
  jumpBuffer: 0.1,
  knockbackSpeedMin: 6,
  knockbackSpeedMax: 12,
  stunTimeMin: 0.8,
  stunTimeMax: 1.2,
  respawnInvincible: 1.0,
  /** 掉落到该高度触发复活 */
  fallRespawnY: -8,
} as const

/** 第三人称镜头（M2 使用） */
export const CAMERA = {
  distance: 6.4,
  height: 4,
  targetHeight: 1.35,
  pitchMin: -15,
  pitchMax: 55,
  sensitivity: 0.003,
  smooth: 0.12,
  offsetYMin: 0.6,
} as const

/** 对局参数 */
export const MATCH = {
  /** 起点站位数 = 本局玩家数。单机阶段为 1；联机阶段改为房间容量，颜色按 CROWD_COLORS 分配 */
  playerSlots: 1,
  /** 多人时相邻站位间距（米） */
  slotSpacing: 2.4,
  /** 起跑线位置（Z 轴） */
  spawnZ: 3.5,
} as const

/** 配色（糖果风，参考 Fall Guys 的低多边形饱和度） */
export const COLORS = {
  /** 天空渐变的上下两端 */
  skyTop: 0x1fb4ff,
  skyBottom: 0xc8f4ff,
  sky: 0x7ad4ff,
  /** 雾色取近地平线的浅色，避免远景出现色带断层 */
  fog: 0xc4efff,

  /** 地面棋盘格的两色 */
  checkerCyan: 0x2fe6dd,
  checkerPink: 0xff7fc8,

  /** 起步 / 终点平台底色 */
  start: 0xff9ad8,
  finish: 0x9d8bff,

  /** 护栏与装饰 */
  rail: 0xff6ed1,
  railDark: 0x9b46d6,

  /** 障碍：条纹栏架 / 旋转扫地杆 / 滚轴 */
  hurdle: 0xff5fa8,
  hurdleStripe: 0xffd9ef,
  sweeper: 0xff8dd6,
  pin: 0xff6cc0,

  /** 终点皇冠 */
  crown: 0xfff07a,

  /** 远山的两档紫 */
  mountainLight: 0xbfc9ff,
  mountainDeep: 0x8e9bf5,

  /** 远景底座与云 */
  ground: 0x8fd8ff,
  cloud: 0xffffff,

  /** M1 测试方块 */
  test: 0xff5c94,

  /** 果冻人：身体 / 脸 / 眼睛 */
  jellyBody: 0x2fe0d6,
  jellyFace: 0xfdf3e6,
  jellyEye: 0x10242c,

  /** 攻击命中冲击环：浅击偏冷白、重击偏暖黄，都要在青粉棋盘上跳出来 */
  impactLight: 0xf4ffff,
  impactHeavy: 0xffd84d,

  /** 地刺：金属紫尖刺 + 深色底板（在青粉棋盘上立刻辨认） */
  spike: 0xb06bff,
  spikeBase: 0x5b3a86,

  /** 大摆锤：紫色锤头 + 亮黄锤柄横杆 */
  pendulum: 0x8a4dff,
  pendulumArm: 0xffd84d,

  /** 巨型拳击手套：糖果红拳套 + 奶白袖口 + 金色挂钩 */
  glove: 0xff4f74,
  gloveDark: 0xc92a4a,
  gloveCuff: 0xfff4e8,
  gloveMount: 0xffd84d,
} as const

/** 起点人群的果冻小人配色 */
export const CROWD_COLORS = [
  0xff3f8b, 0x22d0c8, 0x7a5cff, 0x35e07a, 0xff8a3d, 0x3fb6ff, 0xffd23f, 0xd24bff,
  0x36e0b0, 0xff5f5f, 0x5b6bff, 0x9ee83c,
] as const

