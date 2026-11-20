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
  far: 220,
  fogNear: 90,
  fogFar: 220,
} as const

/** 赛道尺寸（单位：米） */
export const TRACK = {
  width: 18,
  /** Z 0 → -180 */
  length: 180,
  startZ: 0,
  finishZ: -180,
  /** 碰撞厚度，中心 y = -thickness/2 */
  groundThickness: 0.5,
  railHeight: 1,
  railWidth: 0.5,
  startPlatformLength: 15,
  finishPlatformLength: 6,
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
  distance: 7,
  height: 4,
  targetHeight: 1.4,
  pitchMin: -15,
  pitchMax: 55,
  sensitivity: 0.003,
  smooth: 0.12,
  offsetYMin: 0.6,
} as const

/** 配色（低多边形糖果风） */
export const COLORS = {
  sky: 0x8fd2ff,
  track: 0x35d6c8,
  start: 0xf6d6e4,
  finish: 0xc9c2f2,
  rail: 0x8b5cf6,
  obstacle: 0xff7fb2,
  mountain: 0x6d7bd6,
  test: 0xff5c94,
} as const
