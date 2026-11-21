import RAPIER from '@dimforge/rapier3d-compat'
import { MATCH, PHYSICS, TRACK } from '@/game/core/GameConfig'
import { GameLoop } from '@/game/core/GameLoop'
import { RaceStateMachine, type RaceState } from '@/game/core/GameState'
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
import { Music } from '@/game/audio/Music'
import { QuizSystem, QUIZ_GATES, type QuizPhase } from '@/game/quiz/QuizSystem'
import { AttackSystem, HitTracker, type AttackKind } from '@/game/combat/AttackSystem'

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

/** 比赛快照：HUD 以 10 Hz 拉取，避免每帧写响应式 */
export interface RaceSnapshot {
  state: RaceState
  /** 倒计时剩余秒（仅 Countdown 有效） */
  countdown: number
  /** 当前计时（毫秒）；完赛后停在成绩 */
  elapsedMs: number
  /** 已跑进度的 0..1 */
  progress: number
  /** 剩余距离（米） */
  remaining: number
  /** 本局成绩，未完赛为 null */
  finishMs: number | null
  /** 本次会话最好成绩 */
  bestMs: number | null
}

const FRAME_WINDOW = 300
/** 起跑倒数秒数 */
const COUNTDOWN_SECONDS = 3
/** 完赛到弹结算面板的停顿，让玩家看清终点 */
const RESULT_DELAY = 0.9

/** 答题 UI 快照：10 Hz 拉取，帧循环不触碰 Vue 响应式 */
export interface QuizSnapshot {
  phase: QuizPhase
  /** 正在答的墙号（1 起），未在答题为 null */
  gate: number | null
  gateTotal: number
  /** 已解开的墙数 */
  solved: number
  category: string
  text: string
  options: string[]
  /** 本题答错次数 */
  wrongCount: number
  /** 冻结剩余秒 */
  freezeLeft: number
  freezeTotal: number
  /** 站在墙前可按 F 时，返回墙号（1 起） */
  promptGate: number | null
  lastChoice: number | null
}

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
  private music: Music | null = null
  private audioGesture: (() => void) | null = null

  /** 答题玩法（抽题 / 冻结 / 已解开的墙） */
  private readonly quiz = new QuizSystem()
  /** 出招状态机（轻击 / 重击） */
  private readonly attack = new AttackSystem()
  /** 单机阶段没有敌人：先用一个纯规则靶子承接命中，联机时换成对目标玩家的判定 */
  private readonly practiceTarget = new HitTracker()

  private readonly frameTimes: number[] = []
  private readonly race = new RaceStateMachine()
  private raceTimeMs = 0
  private countdownLeft = COUNTDOWN_SECONDS
  private finishMs: number | null = null
  private bestMs: number | null = null
  private resultDelay = 0
  private spawnX = 0
  private spawnY = 0.35
  private spawnZ = MATCH.spawnZ
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
    this.spawnX = spawn.x
    this.spawnY = spawn.y
    this.spawnZ = spawn.z
    const player = new PlayerController(physics, spawn)
    const jelly = new JellyBean()
    jelly.group.position.set(spawn.x, spawn.y, spawn.z)
    manager.scene.add(jelly.group)
    this.player = player
    this.jelly = jelly

    this.followCam = new FollowCamera(manager.camera)
    this.input = new Input(manager.canvas)

    // 背景音乐：浏览器要求用户手势才能出声，首次点击/按键时启动
    this.music = new Music()
    const startAudio = (): void => this.music?.start()
    this.audioGesture = startAudio
    manager.canvas.addEventListener('pointerdown', startAudio, { once: true })
    window.addEventListener('keydown', startAudio, { once: true })

    this.loop = new GameLoop(PHYSICS.fixedStep, PHYSICS.maxSubSteps, this.onFixedUpdate, this.onRender)
    this.ready = true
    this.startCountdown()

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
          getRace: () => this.getRace(),
          getQuiz: () => this.getQuiz(),
          /** 自动化验收用：瞬移到第 i 面墙前 3 m（0 起） */
          teleportToGate: (i: number) => {
            const gate = QUIZ_GATES[Math.max(0, Math.min(QUIZ_GATES.length - 1, i))]
            this.player?.teleport(0, 0.35, gate.z + 3)
            this.followCam?.snap()
          },
          /** 自动化验收用：直接进入第 i 面墙的答题（0 起） */
          startQuiz: (i = 0) => {
            if (this.race.state === 'Racing') this.beginQuiz(i)
          },
          /** 自动化验收用：作答（下标对应 getQuiz().options） */
          answerQuiz: (choice: number) => this.answerQuiz(choice),
          /** 自动化验收用：答对 / 答错（自动挑选项） */
          answerCorrect: () => this.answerQuiz(this.quiz.correctIndex),
          answerWrong: () => {
            if (this.quiz.phase !== 'asking') return false
            const wrong = [0, 1, 2, 3].find((i) => i !== this.quiz.correctIndex) ?? 0
            return this.answerQuiz(wrong)
          },
          /** 自动化验收用：读墙位与是否已开 */
          getQuizWalls: () =>
            this.world
              ? this.world.quizWalls.walls.map((w) => ({
                  index: w.index,
                  z: w.z,
                  opened: w.opened,
                  visible: w.mesh.visible,
                }))
              : null,
          /** 自动化验收用：强制启动背景音乐（手动手势之外） */
          startMusic: () => this.music?.start(),
          /** 自动化验收用：一次性解开全部墙（测冲线用） */
          openAllGates: () => {
            for (let i = 0; i < QUIZ_GATES.length; i++) this.world?.openQuizGate(i)
          },
          getMusic: () => this.music?.snapshot() ?? null,
          /** 自动化验收用：出招（'light' | 'heavy'），返回是否真的起手 */
          attack: (kind: AttackKind) => this.tryAttack(kind),
          /** 自动化验收用：读攻击状态机 + 手臂角度（验证姿态真的动了） */
          getAttack: () => ({
            ...this.attack.snapshot(),
            armX: this.jelly ? this.jelly.armAngles() : null,
          }),
          /** 自动化验收用：读命中规则靶子的累计状态 */
          getCombat: () => this.practiceTarget.snapshot(),
          /** 自动化验收用：跳过 3 秒倒数，直接进入 Racing */
          startNow: () => {
            if (this.race.state === 'Countdown') {
              this.countdownLeft = 0
              this.race.set('Racing')
              this.raceTimeMs = 0
            }
          },
          /** 自动化验收用：结算面板出现后重开一局 */
          restartRace: () => this.restart(),
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

  /** 进入下一轮的起跑倒数：Menu/Result → Loading → Countdown */
  private startCountdown(): void {
    if (this.race.state === 'Menu' || this.race.state === 'Result') this.race.set('Loading')
    if (this.race.state === 'Loading') this.race.set('Countdown')
    this.raceTimeMs = 0
    this.finishMs = null
    this.resultDelay = 0
    this.countdownLeft = COUNTDOWN_SECONDS
  }

  /** 重新开一局：复位角色、障碍角度、答题墙与计时 */
  restart(): void {
    if (this.race.state !== 'Result') return
    this.quiz.reset()
    this.attack.reset()
    this.practiceTarget.reset()
    this.world?.resetQuizGates()
    this.music?.duck(false)
    this.input?.setClickLock(true)
    this.player?.teleport(this.spawnX, this.spawnY, this.spawnZ)
    this.followCam?.snap()
    this.world?.obstacles.reset()
    this.startCountdown()
  }

  /** 按 F 进入答题：抽一道题，锁输入、松开鼠标、压低音乐 */
  beginQuiz(gate: number): void {
    if (this.race.state !== 'Racing') return
    this.quiz.open(gate)
    this.race.set('Paused')
    this.debugAxes = null
    this.input?.exitLock()
    this.input?.setClickLock(false)
    this.music?.duck(true)
  }

  /**
   * 出招：只有 Racing 且上一招已经收完才起手。
   * 出招不锁移动 —— 边跑边打，符合派对跑酷的操作手感。
   */
  tryAttack(kind: AttackKind): boolean {
    if (this.race.state !== 'Racing') return false
    if (!this.attack.start(kind)) return false
    this.jelly?.playAttack(kind, this.attack.side)
    return true
  }

  /** 命中帧：闪冲击环；命中判定先记在规则靶子上（联机时改为对目标玩家） */
  private onAttackHit(kind: AttackKind): void {
    this.jelly?.impact(kind)
    this.practiceTarget.apply(kind)
  }

  /** UI / 调试作答；返回是否答对。答对即拆墙并恢复比赛 */
  answerQuiz(choice: number): boolean {
    if (this.quiz.phase !== 'asking' || this.quiz.activeGate === null) return false
    const gate = this.quiz.activeGate
    const correct = this.quiz.submit(choice)
    if (correct) {
      this.world?.openQuizGate(gate)
      this.music?.duck(false)
      this.input?.setClickLock(true)
      if (this.race.state === 'Paused') this.race.set('Racing')
      this.input?.requestLock()
    }
    return correct
  }

  /** 供 HUD 以 10 Hz 拉取的答题快照 */
  getQuiz(): QuizSnapshot {
    const q = this.quiz
    const st = this.player?.read()
    const reach = st ? q.gateInReach(st.z) : null
    return {
      phase: q.phase,
      gate: q.activeGate === null ? null : q.activeGate + 1,
      gateTotal: QUIZ_GATES.length,
      solved: q.solvedCount,
      category: q.question?.category ?? '',
      text: q.question?.text ?? '',
      options: q.options.slice(),
      wrongCount: q.wrongCount,
      freezeLeft: q.freezeLeft,
      freezeTotal: q.freezeTotal,
      promptGate: this.race.state === 'Racing' && q.phase === 'off' && reach !== null ? reach + 1 : null,
      lastChoice: q.lastChoice,
    }
  }

  /** 供 HUD 以 10 Hz 拉取的比赛快照 */
  getRace(): RaceSnapshot {
    const st = this.player?.read()
    const z = st?.z ?? this.spawnZ
    const total = Math.abs(this.spawnZ - TRACK.finishZ)
    const done = Math.max(0, this.spawnZ - z)
    return {
      state: this.race.state,
      countdown: Math.max(0, this.countdownLeft),
      elapsedMs: this.finishMs ?? this.raceTimeMs,
      progress: Math.min(1, done / total),
      remaining: Math.max(0, z - TRACK.finishZ),
      finishMs: this.finishMs,
      bestMs: this.bestMs,
    }
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

    if (this.manager && this.audioGesture) {
      this.manager.canvas.removeEventListener('pointerdown', this.audioGesture)
      window.removeEventListener('keydown', this.audioGesture)
    }
    this.audioGesture = null
    this.music?.dispose()
    this.music = null

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
  /** 自动化验收用：请求进入面前的答题墙 */
  private quizRequested = false

  /** 固定物理步：算意图 → 步进物理 → 结算 → 障碍判定 → 比赛状态 */
  private readonly onFixedUpdate = (h: number): void => {
    const physics = this.physics
    const player = this.player
    if (!physics || !player) return

    const state = this.race.state
    // 答题冻结读秒独立推进：Paused 期间也要走完 3 s 才换题
    this.quiz.tick(h)

    // 攻击状态机每步都走：出招动画要播完，命中帧在这里派发
    this.practiceTarget.tick(h)
    const hitKind = this.attack.tick(h)
    if (hitKind) this.onAttackHit(hitKind)

    if (state === 'Countdown') {
      this.countdownLeft -= h
      if (this.countdownLeft <= 0) {
        this.countdownLeft = 0
        this.race.set('Racing')
        this.raceTimeMs = 0
      }
    }
    // 答题期间计时继续累加：冻结 3 s 才有惩罚意义
    if (state === 'Racing' || state === 'Paused') this.raceTimeMs += h * 1000

    let axes = { x: 0, y: 0, sprint: false }
    let jump = false
    // 只有 Racing 才吃输入：倒数、完赛、结算阶段角色不动
    if (this.race.state === 'Racing') {
      if (this.debugAxes) {
        axes = { x: this.debugAxes.x, y: this.debugAxes.y, sprint: this.debugAxes.sprint }
        jump = this.debugJump
        this.debugJump = false
      } else if (this.input) {
        axes = this.input.readAxes()
        jump = this.input.consumeJump()
      }
      // 鼠标左键 / 右键：轻击 / 重击（只有指针锁定时才会入队）
      const atk = this.input ? this.input.consumeAttack() : null
      if (atk) this.tryAttack(atk)
      // 墙前按 F 开答（读的是本步之前的位置，够用：墙前 6 m 都能触发）
      if (this.quiz.phase === 'off') {
        const gate = this.quiz.gateInReach(player.read().z)
        const want = this.quizRequested || (this.input ? this.input.consumeInteract() : false)
        this.quizRequested = false
        if (want && gate !== null) this.beginQuiz(gate)
      }
    } else {
      this.debugJump = false
      this.quizRequested = false
      this.input?.consumeJump()
      this.input?.consumeInteract()
      this.input?.consumeAttack()
    }

    player.prepare(h, { ...axes, jump, yaw: this.followCam?.yaw ?? 0 })
    physics.step()
    player.sync(h)

    // 障碍判定放在物理结算之后：读到的是本步真实位置，不会穿过摆臂再判定
    const st = player.read()
    if (this.race.state === 'Racing' || this.race.state === 'Respawning') {
      const hit = this.world?.obstacles.hit(st.x, st.y, st.z)
      if (hit) player.applyKnockback(hit)
    }

    // 终点：脚底越过 finishZ 即完赛，并急停，避免顺着速度冲下终点平台
    if (this.race.state === 'Racing' && st.z <= TRACK.finishZ) {
      this.finishMs = this.raceTimeMs
      this.race.set('Finished')
      this.resultDelay = 0
      player.halt()
      this.debugAxes = null
      if (this.bestMs === null || this.finishMs < this.bestMs) this.bestMs = this.finishMs
    }
    if (this.race.state === 'Finished') {
      this.resultDelay += h
      if (this.resultDelay >= RESULT_DELAY) this.race.set('Result')
    }

    // 答题 Paused 期间世界也一起冻结：倒计时读秒时障碍不转、扫地杆不扫
    if (this.race.state !== 'Paused') this.world?.update(h)
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
