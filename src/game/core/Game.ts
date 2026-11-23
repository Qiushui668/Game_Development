import RAPIER from '@dimforge/rapier3d-compat'
import { HEALTH, MATCH, OBSTACLE, PHYSICS, PLAYER, TILE, TRACK } from '@/game/core/GameConfig'
import { GameLoop } from '@/game/core/GameLoop'
import { RaceStateMachine, type RaceState } from '@/game/core/GameState'
import { SceneManager } from '@/game/scene/SceneManager'
import { Lighting } from '@/game/scene/Lighting'
import { Environment } from '@/game/scene/Environment'
import { GameWorld } from '@/game/scene/World'
import { disposeMaterials } from '@/game/scene/Materials'
import { Input } from '@/game/input/Input'
import { PlayerController, type PlayerState } from '@/game/actor/PlayerController'
import { JellyBean } from '@/game/actor/JellyBean'
import { FollowCamera } from '@/game/actor/FollowCamera'
import { percentile } from '@/game/utils/MathUtils'
import { Music } from '@/game/audio/Music'
import { Sfx } from '@/game/audio/Sfx'
import { QuizSystem, QUIZ_GATES, type QuizPhase } from '@/game/quiz/QuizSystem'
import {
  AttackSystem,
  COMBAT_RULES,
  HitTracker,
  type AttackKind,
} from '@/game/combat/AttackSystem'
import { HealthState } from '@/game/combat/Health'
import { NameTag } from '@/game/actor/NameTag'
import { TILE_ZONES } from '@/game/physics/TileField'
import { parseColor, recallColor, recallNickname } from '@/game/core/Profile'
import { RemotePlayer } from '@/game/net/RemotePlayer'
import type { ClientEvent, NetAttackKind, PlayerStatePayload } from '@/types/network'

/** 多人局接入点：由 GameCanvas 把房间连接包成这几个回调交给 Game */
export interface NetConfig {
  /** 服务器分配的玩家 id */
  selfId: string
  /** 自己的昵称（渲染在头顶） */
  nickname: string
  /** 自己的配色（名牌描边用） */
  color: string
  /** 自己的站位序号 0..7 */
  slot: number
  /** 房间人数（决定起跑线站位宽度） */
  playerCount: number
  /** 其他人：id + 昵称 + 色号 + 站位 */
  peers: { id: string; nickname: string; color: string; slot: number }[]
  send: (ev: ClientEvent) => void
}

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

/** 生命值 / 击杀快照：HUD 10 Hz 拉取 */
export interface StatusSnapshot {
  hp: number
  maxHp: number
  /** 本局击杀数（只有把别人打到 0 才计） */
  kills: number
  /** 本局死亡次数 */
  deaths: number
  /** 受击/死亡提示剩余秒（>0 时 HUD 抖动/闪红） */
  hurtFlash: number
  /** 死亡复活提示剩余秒 */
  deathFlash: number
  /** 连续击杀计时（>0 时 HUD 显示"击杀！"） */
  killFlash: number
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
  /** 答题被击倒打断时的短暂提示 */
  interrupted: boolean
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
  private sfx: Sfx | null = null
  private audioGesture: (() => void) | null = null

  /** 生命值（满血 100，障碍 -10，轻击 -34，重击 -70） */
  private readonly health = new HealthState()
  /** 本局击杀数 */
  private kills = 0
  /** 头顶名牌（自己的；远端的归 RemotePlayer 自己管） */
  private ownTag: NameTag | null = null
  private hurtFlashT = 0
  private deathFlashT = 0
  private killFlashT = 0
  /** 最近 20 次伤害（调试/验收看每次扣了多少） */
  private readonly damageLog: Array<{ amount: number; cause: string; hpAfter: number; dead: boolean }> = []

  /** 答题玩法（抽题 / 冻结 / 已解开的墙） */
  private readonly quiz = new QuizSystem()
  /** 出招状态机（轻击 / 重击） */
  private readonly attack = new AttackSystem()
  /** 单机阶段没有敌人：先用一个纯规则靶子承接命中，联机时换成对目标玩家的判定 */
  private readonly practiceTarget = new HitTracker()
  /** 自己被打中的计数（轻击 3 次 / 重击 1 次倒地），单机阶段由调试钩子触发 */
  private readonly selfHits = new HitTracker()
  /** 答题被打断后的提示剩余时间 */
  private interruptFlashT = 0

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

  /** 多人局：其他人一个果冻人一个，位置完全由网络驱动 */
  private readonly remotes = new Map<string, RemotePlayer>()
  /** 状态上报节流：20 Hz */
  private netAccum = 0
  /** 自己已经向服务器报过完赛（防止重复上报） */
  private netFinishSent = false
  /** 服务器开跑令比 init 先到：init 末尾补发 */
  private pendingNetStart = false

  constructor(
    private readonly container: HTMLElement,
    private readonly net: NetConfig | null = null,
  ) {}

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
    // 多人局按站位号横向错开（站位宽度随人数变化，8 人时最外侧 ±8.4 m，仍在赛道内）
    const spawn = { x: this.slotX(this.net?.slot ?? 0, this.net?.playerCount ?? 1), y: 0.35, z: MATCH.spawnZ }
    this.spawnX = spawn.x
    this.spawnY = spawn.y
    this.spawnZ = spawn.z
    const player = new PlayerController(physics, spawn)
    const jelly = new JellyBean()
    if (this.net) jelly.setColor(0x2fe0d6)
    jelly.group.position.set(spawn.x, spawn.y, spawn.z)
    manager.scene.add(jelly.group)
    this.player = player
    this.jelly = jelly

    // 头顶昵称 + 血条：单人也显示（用户要求"昵称显示在人物头上"，血条挂在昵称上面）
    const ownName = this.net?.nickname ?? recallNickname() ?? ''
    const ownColor = this.net?.color ?? recallColor()
    const tag = new NameTag(ownName, parseColor(ownColor, 0x2fe0d6), HEALTH.max)
    tag.attachTo(jelly.group)
    this.ownTag = tag

    // 其他人：一个玩家一个果冻人，只换色，几何共用；名牌用各自昵称
    if (this.net) {
      for (const peer of this.net.peers) {
        this.addRemote(peer)
      }
    }

    this.followCam = new FollowCamera(manager.camera)
    this.input = new Input(manager.canvas)

    // 背景音乐：浏览器要求用户手势才能出声，首次点击/按键时启动
    this.music = new Music()
    this.sfx = new Sfx()
    const startAudio = (): void => this.music?.start()
    this.audioGesture = startAudio
    manager.canvas.addEventListener('pointerdown', startAudio, { once: true })
    window.addEventListener('keydown', startAudio, { once: true })

    this.loop = new GameLoop(PHYSICS.fixedStep, PHYSICS.maxSubSteps, this.onFixedUpdate, this.onRender)
    this.ready = true
    this.startCountdown()
    if (this.pendingNetStart) {
      this.pendingNetStart = false
      this.forceMatchStart()
    }

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
                  spikeRise: [...this.world.obstacles.spikeRise],
                  pendulumAngles: [...this.world.obstacles.pendulumAngles],
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
          /** 自动化验收用：生命值 / 击杀快照 */
          getStatus: () => this.getStatus(),
          /** 自动化验收用：头顶昵称 + 血条（文字 / 血量数字 / 离地高度 / 是否可见） */
          getNameTag: () =>
            this.ownTag
              ? {
                  ...this.ownTag.snapshot(),
                  parent: this.ownTag.sprite.parent === this.jelly?.group,
                }
              : null,
          /** 自动化验收用：方格桥全量快照（角色 / 相位 / 坐标 / 碰撞）+ 随机批次号 */
          getTiles: () =>
            this.world
              ? {
                  assignmentId: this.world.tiles.assignmentId,
                  zones: TILE_ZONES.map((z) => ({ ...z })),
                  tiles: this.world.tiles.snapshot(),
                }
              : null,
          /** 自动化验收用：本轮调过的关键参数（击退力度 / 回弹力度 / 随机概率） */
          getTuning: () => ({
            knockbackSpeed: OBSTACLE.knockbackSpeed,
            sweepKnockbackSpeed: OBSTACLE.sweepKnockbackSpeed,
            sweepKnockbackHop: OBSTACLE.sweepKnockbackHop,
            sweepSpeedScale: OBSTACLE.sweepSpeedScale,
            tileBounceSpeed: TILE.bounceSpeed,
            tileBounceStun: TILE.bounceStun,
            tileVanishChance: TILE.vanishChance,
            tileBounceChance: TILE.bounceChance,
          }),
          /** 自动化验收用：按给定初速推自己一把（量击退距离，不扣血） */
          pushPlayer: (dirX: number, dirZ: number, speed: number, hop = 0, stun?: number) =>
            this.player?.applyKnockback({ dirX, dirZ, speed, hop, stun }) ?? false,
          /** 自动化验收用：重新随机方格桥角色（不用等整局重开） */
          rerollTiles: () => {
            this.world?.resetTiles()
            return this.world ? this.world.tiles.assignmentId : null
          },
          /** 自动化验收用：远端玩家头顶血条读到的血量（验证对方血量可见） */
          getRemotes: () =>
            [...this.remotes.entries()].map(([id, r]) => ({
              id,
              hp: r.health,
              ...r.position,
            })),
          /** 自动化验收用：读击杀音效的播放次数（验证 1杀.mp3 真的被调用） */
          getSfx: () => this.sfx?.snapshot() ?? null,
          /** 自动化验收用：直接扣血（cause 决定来源标签） */
          damage: (amount: number, cause: 'obstacle' | 'light' | 'heavy' = 'obstacle') =>
            this.applyDamage(amount, cause, null),
          /** 自动化验收用：把自己打空血，走完整死亡复活流程 */
          killSelf: () => this.applyDamage(HEALTH.max, 'obstacle', null),
          /** 自动化验收用：回满血（不改位置，不回起点） */
          resetHealth: () => {
            this.health.reset()
            return this.health.hp
          },
          /** 自动化验收用：最近的伤害流水（每次扣了多少、来源、剩余血量） */
          getDamageLog: () => this.damageLog.map((d) => ({ ...d })),
          /** 自动化验收用：模拟收到别人的死亡广播（killerId 传自己 id 才算击杀） */
          peerDied: (playerId: string, killerId: string | null) => this.applyPeerDeath(playerId, killerId),
          /** 自动化验收用：出招（'light' | 'heavy'），返回是否真的起手 */
          attack: (kind: AttackKind) => this.tryAttack(kind),
          /** 自动化验收用：读攻击状态机 + 手臂角度（验证姿态真的动了） */
          getAttack: () => ({
            ...this.attack.snapshot(),
            armX: this.jelly ? this.jelly.armAngles() : null,
          }),
          /** 自动化验收用：读命中规则靶子的累计状态 */
          getCombat: () => this.practiceTarget.snapshot(),
          /** 自动化验收用：模拟"被别的玩家打中"（联机前的规则验证入口） */
          hitPlayer: (kind: AttackKind) => this.hitPlayer(kind),
          getSelfHits: () => this.selfHits.snapshot(),
          /** 自动化验收用：多人局信息（关闭联机时为 null） */
          getNet: () =>
            this.net
              ? {
                  selfId: this.net.selfId,
                  slot: this.net.slot,
                  playerCount: this.net.playerCount,
                  peers: this.net.peers.map((p) => p.id),
                  remotes: [...this.remotes.entries()].map(([id, r]) => ({ id, ...r.position })),
                  finishSent: this.netFinishSent,
                }
              : null,
          /** 自动化验收用：服务器发令开跑 */
          forceStart: () => this.forceMatchStart(),
          /** 自动化验收用：模拟收到别人的位置包 / 出招 / 命中 */
          pushRemoteState: (id: string, payload: PlayerStatePayload) => this.applyRemoteState(id, payload),
          remoteAttack: (id: string, kind: NetAttackKind, side: number) => this.playRemoteAttack(id, kind, side),
          takeHit: (kind: NetAttackKind, fromX: number, fromZ: number, fromId = '') =>
            this.receiveNetHit(kind, fromX, fromZ, fromId),
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
    this.netFinishSent = false
  }

  /** 起跑线站位：按人数居中排开，最外侧不超过赛道内缘 */
  private slotX(slot: number, count: number): number {
    if (count <= 1) return 0
    const half = (count - 1) / 2
    const x = (slot - half) * MATCH.slotSpacing
    const limit = TRACK.width / 2 - PLAYER.radius - 0.3
    return Math.max(-limit, Math.min(limit, x))
  }

  /** 加一个远程玩家（换色不重建几何） */
  private addRemote(peer: { id: string; nickname: string; color: string; slot: number }): void {
    if (this.remotes.has(peer.id) || !this.manager) return
    const color = parseColor(peer.color, 0xff3f8b)
    const x = this.slotX(peer.slot, this.net?.playerCount ?? 1)
    const remote = new RemotePlayer(peer.id, color, [x, 0.35, MATCH.spawnZ], peer.nickname)
    this.manager.scene.add(remote.jelly.group)
    this.remotes.set(peer.id, remote)
  }

  /** 有人离开或重排站位：把他的角色拿掉 */
  removeRemote(playerId: string): void {
    const remote = this.remotes.get(playerId)
    if (!remote) return
    this.manager?.scene.remove(remote.jelly.group)
    remote.dispose()
    this.remotes.delete(playerId)
  }

  /** 收到别人的位置包（20 Hz） */
  applyRemoteState(playerId: string, payload: PlayerStatePayload): void {
    this.remotes.get(playerId)?.push(payload, performance.now())
  }

  /** 别人出招：照着播动画 */
  playRemoteAttack(playerId: string, kind: NetAttackKind, side: number): void {
    this.remotes.get(playerId)?.playAttack(kind, side)
  }

  /**
   * 自己被别人打中（由服务器转发）。轻击 −34、重击 −70，同时保留原有击退与硬直：
   * 轻击累计 3 次 / 重击 1 次倒地眩晕 1 s（此时血量通常也已见底）。
   */
  receiveNetHit(
    kind: NetAttackKind,
    fromX: number,
    fromZ: number,
    fromId = '',
  ): { down: boolean; interrupted: boolean } {
    const st = this.player?.read()
    if (this.player && st) {
      const dx = st.x - fromX
      const dz = st.z - fromZ
      const len = Math.hypot(dx, dz) || 1
      const dirX = dx / len
      const dirZ = dz / len
      // 轻击只推一小步（不进硬直），重击才是大击退 + 硬直
      if (kind === 'heavy') {
        this.player.applyKnockback({ dirX, dirZ, speed: 8, hop: 2.4 })
      } else {
        this.player.applyFlinch(dirX, dirZ, 1.6)
      }
    }
    return this.hitPlayer(kind, fromId || null)
  }

  /** 服务器发令开跑：本地倒数立刻收尾，全场同一帧起跑 */
  forceMatchStart(): void {
    // Game 还没 init 完（RAPIER 编译中）时先记下来，等 init 末尾再补
    if (this.race.state === 'Menu' || this.race.state === 'Loading') {
      this.pendingNetStart = true
      return
    }
    if (this.race.state === 'Countdown') {
      this.countdownLeft = 0
      this.raceTimeMs = 0
      this.race.set('Racing')
    }
  }

  /** 打包本机状态：20 Hz 上报，字段按协议压短 */
  private buildStatePayload(st: PlayerState): PlayerStatePayload {
    const s: PlayerStatePayload['s'] = st.stunned
      ? 'knock'
      : !st.grounded
        ? st.verticalSpeed > 0
          ? 'jump'
          : 'fall'
        : st.speed > 0.4
          ? 'run'
          : 'idle'
    return {
      t: Math.round(performance.now()),
      p: [st.x, st.y, st.z],
      r: st.yaw,
      s,
      a: Math.min(1, st.speed / PLAYER.sprintSpeed),
      // 血量随位置包一起发：别人据此在自己的头顶血条上看到我的血量
      h: Math.round(this.health.hp),
    }
  }

  /**
   * 命中判定：本地算出打了谁，再把 targetId 报给服务器转发。
   * 判定只认"够近 + 大致面朝对方 + 落差不大"，避免背后隔空打人。
   */
  private resolveNetHit(kind: AttackKind): void {
    const net = this.net
    const st = this.player?.read()
    if (!net || !st || this.remotes.size === 0) return
    const reach = kind === 'heavy' ? COMBAT_RULES.heavyReach : COMBAT_RULES.lightReach
    const cosLimit = Math.cos((COMBAT_RULES.hitHalfAngleDeg * Math.PI) / 180)
    const fx = -Math.sin(st.yaw)
    const fz = -Math.cos(st.yaw)
    let best: { id: string; dist: number } | null = null
    for (const [id, remote] of this.remotes) {
      const p = remote.position
      const dx = p.x - st.x
      const dz = p.z - st.z
      if (Math.abs(p.y - st.y) > COMBAT_RULES.hitHeightTolerance) continue
      const dist = Math.hypot(dx, dz)
      if (dist > reach || dist < 1e-4) continue
      if ((fx * dx + fz * dz) / dist < cosLimit) continue
      if (!best || dist < best.dist) best = { id, dist }
    }
    if (!best) return
    this.remotes.get(best.id)?.impact(kind)
    net.send({ type: 'attack_hit', targetId: best.id, kind, side: this.attack.side, x: st.x, z: st.z })
  }


  /** 重新开一局：复位角色、障碍角度、答题墙与计时 */
  restart(): void {
    if (this.race.state !== 'Result') return
    this.quiz.reset()
    this.attack.reset()
    this.practiceTarget.reset()
    this.selfHits.reset()
    this.health.reset()
    this.kills = 0
    this.hurtFlashT = 0
    this.deathFlashT = 0
    this.killFlashT = 0
    this.interruptFlashT = 0
    // "本局死亡次数"要重开归零（hp 由 health.reset 回满，deaths 单独清）
    this.health.deaths = 0
    this.ownTag?.setHealth(HEALTH.max, HEALTH.max)
    for (const remote of this.remotes.values()) remote.setHealth(HEALTH.max, HEALTH.max)
    this.world?.resetQuizGates()
    // 方格桥重新随机一遍角色，并全部长回来
    this.world?.resetTiles()
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
    this.net?.send({ type: 'attack', kind, side: this.attack.side })
    return true
  }

  /** 命中帧：闪冲击环；单机记在规则靶子上，多人局再判一次打到谁 */
  private onAttackHit(kind: AttackKind): void {
    this.jelly?.impact(kind)
    this.practiceTarget.apply(kind)
    this.resolveNetHit(kind)
  }

  /**
   * 自己被别人打中（单机阶段只有调试钩子调这个）。
   * 先扣血：轻击 −34、重击 −70；再按旧规则累计倒地（轻击 3 次 / 重击 1 次）眩晕 1 s。
   * 血量归零则走死亡流程（回起点满血复活），此时答题必然中断。
   */
  hitPlayer(kind: AttackKind, killerId: string | null = null): { down: boolean; interrupted: boolean } {
    const out = this.selfHits.apply(kind)
    const dead = this.applyDamage(
      kind === 'heavy' ? HEALTH.heavyDamage : HEALTH.lightDamage,
      kind,
      killerId,
    )
    let interrupted = false
    if (dead) {
      interrupted = true
    } else if (out.knockdown) {
      this.player?.applyStun(COMBAT_RULES.knockdownSeconds)
      interrupted = this.interruptQuiz()
    }
    return { down: out.knockdown || dead, interrupted }
  }

  /**
   * 扣血入口：所有伤害统一从这里走。
   * 返回"这一下是否致死"；致死时立刻执行回起点复活。
   */
  private applyDamage(amount: number, cause: 'obstacle' | 'light' | 'heavy', killerId: string | null): boolean {
    if (this.race.state !== 'Racing' && this.race.state !== 'Paused') return false
    const dead = this.health.damage(amount, cause)
    this.damageLog.push({ amount, cause, hpAfter: this.health.hp, dead })
    if (this.damageLog.length > 20) this.damageLog.shift()
    this.hurtFlashT = 0.45
    // 头顶血条与 HUD 同步（血条只在数值变化时重画）
    this.ownTag?.setHealth(this.health.hp, HEALTH.max)
    if (dead) this.onDeath(killerId)
    return dead
  }

  /** 死亡：从起点复活并回满 100 血；正在答题则中断（题作废、墙不拆） */
  private onDeath(killerId: string | null): void {
    this.interruptQuiz()
    // 联机：把自己被打死 + 谁杀的报给服务器，服务器再广播给全场（击杀数在击杀者那边记）
    if (this.net) this.net.send({ type: 'died', killerId })
    this.deathFlashT = 1.6
    this.player?.teleport(this.spawnX, this.spawnY, this.spawnZ)
    this.followCam?.snap()
    // 站起来的 0.45 s 里不接受输入，避免刚落地就被同一根柱子再扫一次
    this.player?.applyStun(0.45)
    this.health.reset()
    this.ownTag?.setHealth(HEALTH.max, HEALTH.max)
    // 倒地计数不因死亡清零（是"本局被打倒几次"的统计），只在重开一局时复位
    this.attack.reset()
    this.debugAxes = null
  }

  /**
   * 掉进虚空（方格塌了）：掉到赛道下方由 PlayerController 兜住并已回起点。
   * 这里只结算"死亡一次 + 回满血 + 广播"，不扣血、不算被谁杀。
   */
  private onVoidFall(): void {
    this.health.voidFall()
    this.ownTag?.setHealth(this.health.hp, HEALTH.max)
    this.deathFlashT = 1.6
    this.interruptQuiz()
    this.attack.reset()
    this.player?.applyStun(0.45)
    this.followCam?.snap()
    this.debugAxes = null
    if (this.net) this.net.send({ type: 'died', killerId: null })
  }

  /** 别人死亡（服务器广播）：清掉他的插值缓冲直接瞬移回起点；若是我杀的，记一次击杀 */
  applyPeerDeath(playerId: string, killerId: string | null): void {
    const remote = this.remotes.get(playerId)
    remote?.snapToSpawn()
    remote?.setHealth(HEALTH.max, HEALTH.max)
    const mine = this.net !== null && killerId === this.net.selfId
    if (mine) {
      this.kills++
      this.killFlashT = 1.8
      this.sfx?.playKill()
    }
  }

  /** 供 HUD 以 10 Hz 拉取的生命值 / 击杀快照 */
  getStatus(): StatusSnapshot {
    return {
      hp: this.health.hp,
      maxHp: HEALTH.max,
      kills: this.kills,
      deaths: this.health.deaths,
      hurtFlash: this.hurtFlashT,
      deathFlash: this.deathFlashT,
      killFlash: this.killFlashT,
    }
  }

  /**
   * 被打倒时中断答题：题作废、墙不拆、退回赛道。
   * 玩家可以重新按 F 再答（会换一道新题）。
   */
  interruptQuiz(): boolean {
    if (this.quiz.phase === 'off') return false
    this.quiz.close()
    this.music?.duck(false)
    this.input?.setClickLock(true)
    if (this.race.state === 'Paused') this.race.set('Racing')
    this.input?.requestLock()
    this.interruptFlashT = 1.6
    return true
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
      interrupted: this.interruptFlashT > 0,
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
    this.sfx?.dispose()
    this.sfx = null

    this.ownTag?.dispose()
    this.ownTag = null

    if (this.jelly && this.manager) {
      this.manager.scene.remove(this.jelly.group)
      this.jelly.dispose()
    }
    this.jelly = null
    for (const remote of this.remotes.values()) {
      this.manager?.scene.remove(remote.jelly.group)
      remote.dispose()
    }
    this.remotes.clear()
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
    this.selfHits.tick(h)
    if (this.interruptFlashT > 0) this.interruptFlashT = Math.max(0, this.interruptFlashT - h)
    if (this.hurtFlashT > 0) this.hurtFlashT = Math.max(0, this.hurtFlashT - h)
    if (this.deathFlashT > 0) this.deathFlashT = Math.max(0, this.deathFlashT - h)
    if (this.killFlashT > 0) this.killFlashT = Math.max(0, this.killFlashT - h)
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

    // 方格塌了 / 漏下桥缝：PlayerController 已经把人送回起点，这里补一次死亡结算
    if (player.consumeVoidFall() && this.race.state === 'Racing') this.onVoidFall()

    // 障碍判定放在物理结算之后：读到的是本步真实位置，不会穿过摆臂再判定
    const st = player.read()

    // 圆角护栏顶：胶囊会稳在圆顶切点、甚至半挂在护栏内侧棱上（控制器不模拟侧翻），
    // 补一条规则——脚底离地超过 0.4 m 又贴着护栏带，就按"滑下圆顶"处理，朝赛道内滑落
    const railTopY = 0.4
    const railBandX = TRACK.width / 2 - 0.5
    if (st.y > railTopY && Math.abs(st.x) > railBandX && this.race.state !== 'Finished') {
      player.slipOffRail(st.x > 0 ? -1 : 1)
    }

    if (this.race.state === 'Racing' || this.race.state === 'Respawning') {
      const hit = this.world?.obstacles.hit(st.x, st.y, st.z)
      if (hit) {
        // 击退自带 0.35 s 冷却：冷却中返回 false，这一刻不再重复扣血（一次接触只扣一次）
        const applied = player.applyKnockback(hit)
        if (applied) {
          // 所有障碍（扫地杆 / 滚轴 / 地刺 / 摆锤）命中统一 −10 生命值
          this.applyDamage(HEALTH.obstacleDamage, 'obstacle', null)
        }
      }
    }

    // 方格桥：踩到消失格开始抖（0.3 s 后塌）、踩到回弹格立刻往起点方向弹回十几米。
    // 硬直期间不再判定，避免被弹飞的路上一路触发邻格。
    if (this.race.state === 'Racing' && !st.stunned && this.world) {
      const tile = this.world.probeTiles(st.x, st.y, st.z)
      if (tile === 'bounce') {
        player.applyKnockback({
          dirX: 0,
          dirZ: 1,
          speed: TILE.bounceSpeed,
          hop: TILE.bounceHop,
          stun: TILE.bounceStun,
        })
      }
    }

    // 终点：脚底越过 finishZ 即完赛，并急停，避免顺着速度冲下终点平台
    if (this.race.state === 'Racing' && st.z <= TRACK.finishZ) {
      this.finishMs = this.raceTimeMs
      this.race.set('Finished')
      this.resultDelay = 0
      player.halt()
      this.debugAxes = null
      if (this.bestMs === null || this.finishMs < this.bestMs) this.bestMs = this.finishMs
      // 多人局：官方时间由服务器算，这里只报"我到了"
      if (this.net && !this.netFinishSent) {
        this.netFinishSent = true
        this.net.send({ type: 'finish', t: this.finishMs })
      }
    }
    if (this.race.state === 'Finished') {
      this.resultDelay += h
      if (this.resultDelay >= RESULT_DELAY) this.race.set('Result')
    }

    // 位置上报：20 Hz，跑动/静止都发（远端靠它插值，停发会让人物卡住）
    if (this.net) {
      this.netAccum += h
      if (this.netAccum >= 0.05) {
        this.netAccum = 0
        this.net.send({ type: 'player_state', payload: this.buildStatePayload(st) })
      }
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

    if (this.remotes.size > 0) {
      const nowMs = performance.now()
      for (const remote of this.remotes.values()) remote.update(dtReal, nowMs)
    }

    if (this.manager && this.environment) {
      this.environment.followCamera(this.manager.camera)
    }
    this.manager?.render()
  }
}

