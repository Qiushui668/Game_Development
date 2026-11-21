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

/** 障碍（扫地杆 / 滚轴）的判定与击退参数 */
export const OBSTACLE = {
  /** 扫地杆摆臂半径（判定与几何共用） */
  armRadius: 0.5,
  /** 被击中后的水平击退速度 */
  knockbackSpeed: 10.5,
  /** 被击中时的上抛速度，给一个短促的离地感 */
  knockbackHop: 3.2,
  /** 硬直时长：这段时间输入无效，只能等速度衰减 */
  stunSeconds: 0.9,
  /** 同一次接触的重复命中间隔，防止贴边连击 */
  hitCooldown: 0.35,
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
} as const

/** 起点人群的果冻小人配色 */
export const CROWD_COLORS = [
  0xff3f8b, 0x22d0c8, 0x7a5cff, 0x35e07a, 0xff8a3d, 0x3fb6ff, 0xffd23f, 0xd24bff,
  0x36e0b0, 0xff5f5f, 0x5b6bff, 0x9ee83c,
] as const

