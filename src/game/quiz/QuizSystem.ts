import { QUESTIONS, type QuizQuestion } from '@/game/data/questions'

/** 答题墙位置（沿赛道均布，避开了栏架 / 扫地杆 / 滚轴）。改这里墙和碰撞一起动 */
export interface QuizGateDef {
  z: number
  /** 墙上显示的序号 */
  label: string
}

export const QUIZ_GATES: QuizGateDef[] = [
  { z: -78, label: '1' },
  { z: -136, label: '2' },
  { z: -196, label: '3' },
  { z: -280, label: '4' },
]

/** 答错后的冻结秒数 */
export const QUIZ_FREEZE_SECONDS = 3
/** 答对后短暂展示 ✓ 的时间 */
const CORRECT_SHOW = 0.8

export type QuizPhase = 'off' | 'asking' | 'wrong' | 'correct'

/**
 * 答题玩法（纯 TS：不 import three、不碰 DOM）。
 * 只维护「哪面墙没解、当前是哪道题、答错了还剩几秒」，抽题与选项打乱都在这里，
 * 后续联机阶段服务端可直接复用。
 */
export class QuizSystem {
  /** 已解开的墙（0 起） */
  readonly solved: number[] = []
  phase: QuizPhase = 'off'
  /** 正在答题的墙（0 起） */
  activeGate: number | null = null
  /** 当前题（含原始选项序） */
  question: QuizQuestion | null = null
  /** 打乱后的展示选项 */
  options: string[] = []
  /** 正确项在 options 里的下标 */
  correctIndex = 0
  /** 本题答错次数 */
  wrongCount = 0
  /** 冻结剩余秒 */
  freezeLeft = 0
  /** 冻结总时长，UI 用来画进度圈 */
  readonly freezeTotal = QUIZ_FREEZE_SECONDS
  /** 最后一次选择（未作答为 null） */
  lastChoice: number | null = null
  private correctLeft = 0
  /** 本局已出过的题，避免同一局重复 */
  private readonly used = new Set<number>()

  get solvedCount(): number {
    return this.solved.length
  }

  isSolved(gate: number): boolean {
    return this.solved.includes(gate)
  }

  /** 玩家站在墙前、可以按 F 时返回墙序号，否则 null */
  gateInReach(feetZ: number, reach = 6): number | null {
    let best: number | null = null
    let bestGap = Infinity
    for (let i = 0; i < QUIZ_GATES.length; i++) {
      if (this.isSolved(i)) continue
      const gap = feetZ - QUIZ_GATES[i].z
      if (gap < 0.2 || gap > reach) continue
      if (gap < bestGap) {
        bestGap = gap
        best = i
      }
    }
    return best
  }

  /** 按 F 进入答题：抽一道题 */
  open(gate: number, rng: () => number = Math.random): void {
    this.activeGate = gate
    this.phase = 'asking'
    this.wrongCount = 0
    this.freezeLeft = 0
    this.lastChoice = null
    this.issue(rng)
  }

  /** 提交答案；返回是否答对 */
  submit(choice: number): boolean {
    if (this.phase !== 'asking' || !this.question) return false
    this.lastChoice = choice
    if (choice === this.correctIndex) {
      if (this.activeGate !== null && !this.isSolved(this.activeGate)) this.solved.push(this.activeGate)
      this.phase = 'correct'
      this.correctLeft = CORRECT_SHOW
      return true
    }
    this.wrongCount++
    this.phase = 'wrong'
    this.freezeLeft = QUIZ_FREEZE_SECONDS
    return false
  }

  /** 固定步推进：冻结读秒 → 换新题；答对展示 → 关闭 */
  tick(dt: number, rng: () => number = Math.random): void {
    if (this.phase === 'wrong') {
      this.freezeLeft -= dt
      if (this.freezeLeft <= 0) {
        this.freezeLeft = 0
        this.issue(rng)
      }
      return
    }
    if (this.phase === 'correct') {
      this.correctLeft -= dt
      if (this.correctLeft <= 0) this.close()
    }
  }

  close(): void {
    this.phase = 'off'
    this.activeGate = null
    this.question = null
    this.options = []
    this.lastChoice = null
    this.freezeLeft = 0
    this.correctLeft = 0
  }

  /** 重开一局 */
  reset(): void {
    this.solved.length = 0
    this.used.clear()
    this.phase = 'off'
    this.activeGate = null
    this.question = null
    this.options = []
    this.wrongCount = 0
    this.freezeLeft = 0
    this.correctLeft = 0
  }

  /** 从没用过的题里随机抽一道，并把选项顺序打乱（源题库答案偏 B，必须打乱） */
  private issue(rng: () => number = Math.random): void {
    let pool = QUESTIONS.filter((q) => !this.used.has(q.id))
    if (pool.length === 0) {
      this.used.clear()
      pool = QUESTIONS.slice()
    }
    const q = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
    this.used.add(q.id)
    this.question = q

    const idx = [0, 1, 2, 3]
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    this.options = idx.map((i) => q.options[i])
    this.correctIndex = idx.indexOf(q.answer)

    this.phase = 'asking'
    this.lastChoice = null
    this.freezeLeft = 0
  }
}
