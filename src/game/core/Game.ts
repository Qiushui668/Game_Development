import RAPIER from '@dimforge/rapier3d-compat'
import { PHYSICS } from '@/game/core/GameConfig'
import { GameLoop } from '@/game/core/GameLoop'
import { SceneManager } from '@/game/scene/SceneManager'
import { Lighting } from '@/game/scene/Lighting'
import { Environment } from '@/game/scene/Environment'
import { GameWorld } from '@/game/scene/World'
import { disposeMaterials } from '@/game/scene/Materials'
import { percentile } from '@/game/utils/MathUtils'

export interface PerfSnapshot {
  fps: number
  avgMs: number
  p99Ms: number
  maxMs: number
  drawCalls: number
  triangles: number
  samples: number
}

const FRAME_WINDOW = 300

/**
 * 游戏总装配：渲染器 / 灯光 / 环境 / 物理世界 / 帧循环。
 * 只负责生命周期与装配，不承载玩法逻辑。
 */
export class Game {
  private manager: SceneManager | null = null
  private lighting: Lighting | null = null
  private environment: Environment | null = null
  private world: GameWorld | null = null
  private physics: RAPIER.World | null = null
  private loop: GameLoop | null = null

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

    this.loop = new GameLoop(PHYSICS.fixedStep, PHYSICS.maxSubSteps, this.onFixedUpdate, this.onRender)
    this.ready = true

    if (import.meta.env.DEV) {
      Object.assign(window, {
        __PPR: {
          ready: true,
          getPerf: () => this.getPerf(),
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
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      avgMs: avg,
      p99Ms: percentile(sorted, 0.99),
      maxMs: samples > 0 ? sorted[samples - 1] : 0,
      drawCalls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      samples,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loop?.stop()
    this.loop = null

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

  /** 固定物理步：先步进物理，再把位姿与装饰动画同步给渲染层 */
  private readonly onFixedUpdate = (h: number): void => {
    if (!this.physics) return
    this.physics.step()
    this.world?.update(h)
  }

  /** 渲染帧：只记录帧时间、跟随相机 + 出图，不做玩法逻辑 */
  private readonly onRender = (dtReal: number): void => {
    this.frameTimes.push(dtReal * 1000)
    if (this.frameTimes.length > FRAME_WINDOW) this.frameTimes.shift()
    if (this.manager && this.environment) {
      this.environment.followCamera(this.manager.camera)
    }
    this.manager?.render()
  }
}
