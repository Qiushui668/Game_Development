import RAPIER from '@dimforge/rapier3d-compat'
import { MATCH, PHYSICS, TRACK } from '@/game/core/GameConfig'
import { GameLoop } from '@/game/core/GameLoop'
import { SceneManager } from '@/game/scene/SceneManager'
import { Lighting } from '@/game/scene/Lighting'
import { Environment } from '@/game/scene/Environment'
import { GameWorld } from '@/game/scene/World'
import { disposeMaterials } from '@/game/scene/Materials'
import { Input } from '@/game/input/Input'
import { PlayerController } from '@/game/actor/PlayerController'
import { JellyBean } from '@/game/actor/JellyBean'
import { FollowCamera } from '@/game/actor/FollowCamera'
import { percentile } from '@/game/utils/MathUtils'

export interface PerfSnapshot {
  fps: number
  avgMs: number
  p99Ms: number
  maxMs: number
  drawCalls: number
  triangles: number
  samples: number
  speed: number
  grounded: boolean
  stunned: boolean
}

const FRAME_WINDOW = 300

/**
 * 游戏总装配：渲染器 / 灯光 / 环境 / 物理世界 / 玩家 / 帧循环。
 * 只负责生命周期与装配，不承载玩法规则。
 */
export class Game {
  private manager: SceneManager | null = null
  private lighting: Lighting | null = null
  private environment: Environment | null = null
  private world: GameWorld | null = null
  private physics: RAPIER.World | null = null
  private loop: GameLoop | null = null
  private input: Input | null = null
  private player: PlayerController | null = null
  private jelly: JellyBean | null = null
  private followCam: FollowCamera | null = null

  private readonly frameTimes: number[] = []
  private ready = false
  private disposed = false

  constructor(private readonly container: HTMLElement) {}

  get isReady(): boolean {
    return this.ready
  }

  async init(): Promise<void> {
    const manager = new SceneManager(this.container)
    this.manager = manager
    this.lighting = new Lighting(manager.scene)
    this.environment = new Environment(manager.scene)

    // wasm 初始化放在 Loading 阶段，避免跑到障碍前才编译
    await RAPIER.init()

    const physics = new RAPIER.World({ x: 0, y: PHYSICS.gravityY, z: 0 })
    physics.timestep = PHYSICS.fixedStep
    this.physics = physics

    const world = new GameWorld(physics)
    this.world = world
    manager.scene.add(world.group)

    // 玩家：脚底从 0.35 m 落下，避免第一帧就卡在地面里
    const spawn = { x: 0, y: 0.35, z: MATCH.spawnZ }
    const player = new PlayerController(physics, spawn)
    const jelly = new JellyBean()
    jelly.group.position.set(spawn.x, spawn.y, spawn.z)
    manager.scene.add(jelly.group)
    this.player = player
    this.jelly = jelly

    this.followCam = new FollowCamera(manager.camera)
    this.input = new Input(manager.canvas)

    this.loop = new GameLoop(PHYSICS.fixedStep, PHYSICS.maxSubSteps, this.onFixedUpdate, this.onRender)
    this.ready = true

    if (import.meta.env.DEV) {
      Object.assign(window, {
        __PPR: {
          ready: true,
          getPerf: () => this.getPerf(),
          getPlayer: () => this.player?.read() ?? null,
          /** 调试取景：性能探针用它拍特写，不参与玩法 */
          setCamera: (pos: [number, number, number], target: [number, number, number]) => {
            const cam = this.manager?.camera
            if (!cam) return
            cam.position.set(pos[0], pos[1], pos[2])
            cam.lookAt(target[0], target[1], target[2])
          },
          /** 自动化验收用：持续注入移动意图（绕过键盘），jump 为一次性 */
          stepInput: (x: number, y: number, jump: boolean, sprint = false) => {
            this.debugAxes = { x, y, sprint }
            if (jump) this.debugJump = true
          },
          releaseInput: () => {
            this.debugAxes = null
          },
          teleport: (x: number, y: number, z: number) => {
            this.player?.teleport(x, y, z)
            this.followCam?.snap()
          },
          /** 调试：环绕视角（degree），用于正面验收角色 */
          setOrbit: (yawDeg: number, pitchDeg = 9) => {
            const cam = this.followCam
            if (!cam) return
            cam.yaw = (yawDeg * Math.PI) / 180
            cam.pitch = (pitchDeg * Math.PI) / 180
            cam.snap()
          },
          /** 自动验收用：读障碍角度与关卡参数 */
          getObstacles: () =>
            this.world
              ? {
                  sweeperAngles: [...this.world.obstacles.sweepAngles],
                  rollAngles: [...this.world.obstacles.rollAngles],
                }
              : null,
          getTrack: () => ({ length: TRACK.length, finishZ: TRACK.finishZ, spawnZ: MATCH.spawnZ }),
        },
      })
    }
  }

  start(): void {
    this.loop?.start()
  }

  stop(): void {
    this.loop?.stop()
  }

  /** 供 HUD / DebugOverlay 以低频拉取的性能快照 */
  getPerf(): PerfSnapshot {
    const times = this.frameTimes
    const samples = times.length
    const avg = samples > 0 ? times.reduce((a, b) => a + b, 0) / samples : 0
    const sorted = [...times].sort((a, b) => a - b)
    const info = this.manager?.renderer.info
    const state = this.player?.read()
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      avgMs: avg,
      p99Ms: percentile(sorted, 0.99),
      maxMs: samples > 0 ? sorted[samples - 1] : 0,
      drawCalls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      samples,
      speed: state?.speed ?? 0,
      grounded: state?.grounded ?? true,
      stunned: state?.stunned ?? false,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loop?.stop()
    this.loop = null

    this.input?.dispose()
    this.input = null

    if (this.jelly && this.manager) {
      this.manager.scene.remove(this.jelly.group)
      this.jelly.dispose()
    }
    this.jelly = null
    this.player = null
    this.followCam = null

    if (this.world && this.manager) {
      this.manager.scene.remove(this.world.group)
      this.world.dispose()
    }
    this.world = null

    if (this.environment && this.manager) this.environment.dispose(this.manager.scene)
    this.environment = null

    if (this.lighting && this.manager) this.lighting.dispose(this.manager.scene)
    this.lighting = null

    this.physics?.free()
    this.physics = null

    this.manager?.dispose()
    this.manager = null

    disposeMaterials()
    this.frameTimes.length = 0
    this.ready = false
  }

  /** 自动化验收用的合成输入（仅 DEV） */
  private debugAxes: { x: number; y: number; sprint: boolean } | null = null
  private debugJump = false

  /** 固定物理步：算意图 → 步进物理 → 结算 → 装饰动画 */
  private readonly onFixedUpdate = (h: number): void => {
    const physics = this.physics
    const player = this.player
    if (!physics || !player) return

    let axes = { x: 0, y: 0, sprint: false }
    let jump = false
    if (this.debugAxes) {
      axes = { x: this.debugAxes.x, y: this.debugAxes.y, sprint: this.debugAxes.sprint }
      jump = this.debugJump
      this.debugJump = false
    } else if (this.input) {
      axes = this.input.readAxes()
      jump = this.input.consumeJump()
    }

    player.prepare(h, { ...axes, jump, yaw: this.followCam?.yaw ?? 0 })
    physics.step()
    player.sync(h)

    // 障碍判定放在物理结算之后：读到的是本步真实位置，不会穿过摆臂再判定
    const st = player.read()
    const hit = this.world?.obstacles.hit(st.x, st.y, st.z)
    if (hit) player.applyKnockback(hit)

    this.world?.update(h)
  }

  /** 渲染帧：鼠标视角 → 角色动画 → 相机 → 出图 */
  private readonly onRender = (dtReal: number): void => {
    this.frameTimes.push(dtReal * 1000)
    if (this.frameTimes.length > FRAME_WINDOW) this.frameTimes.shift()

    if (this.input && this.followCam) {
      const look = this.input.consumeLook()
      this.followCam.rotateLook(look.yaw, look.pitch)
    }

    if (this.player && this.jelly && this.followCam) {
      const state = this.player.read()
      this.jelly.update(dtReal, state)
      this.followCam.update(dtReal, state.x, state.y, state.z)
    }

    if (this.manager && this.environment) {
      this.environment.followCamera(this.manager.camera)
    }
    this.manager?.render()
  }
}
