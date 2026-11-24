/**
 * 帧循环：渲染帧 + 固定物理步。
 * 规则（§13.3）：固定步 1/60，单帧最多补 maxSubSteps 步；掉帧时宁可慢放，不追帧。
 *
 * 容错：一帧里抛异常（物理 NaN、某个系统状态错乱）不能把 rAF 链扯断 ——
 * 断链在这款游戏里表现为"画面永久卡死、别人在动我看不见、也打不到人"。
 * 所以帧内异常一律捕获、记账，然后无论如何都把下一帧续上。
 */
export class GameLoop {
  private raf: number | null = null
  private last = 0
  private acc = 0
  /** 最近一次帧内异常的文案（诊断用，null 表示没出过事） */
  private lastError: string | null = null
  private errors = 0

  constructor(
    private readonly step: number,
    private readonly maxSubSteps: number,
    private readonly onFixedUpdate: (h: number) => void,
    private readonly onRender: (dtReal: number) => void,
  ) {}

  get running(): boolean {
    return this.raf !== null
  }

  /** 帧循环健康度（验收 / 线上排查用） */
  get health(): { running: boolean; errors: number; lastError: string | null } {
    return { running: this.raf !== null, errors: this.errors, lastError: this.lastError }
  }

  start(): void {
    if (this.raf !== null) return
    this.last = performance.now()
    this.acc = 0
    this.raf = requestAnimationFrame(this.tick)
  }

  stop(): void {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  /** 切回前台 / 长时间没出图之后：重设 dt 基准，并把停掉的循环重新拉起来 */
  resync(): void {
    this.last = performance.now()
    this.acc = 0
    if (this.raf === null) this.start()
  }

  private noteError(err: unknown): void {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    this.errors += 1
    this.lastError = msg
    // 只在前几次和每 60 次打一条，避免每帧刷屏拖慢控制台
    if (this.errors <= 3 || this.errors % 60 === 0) {
      console.error(`[GameLoop] 帧内异常（第 ${this.errors} 次，已跳过该帧）：`, err)
    }
  }

  private readonly tick = (now: number): void => {
    // 切标签页回来时 dt 会非常大，用 0.25s 封顶避免一次性补帧爆炸
    const dt = Math.min((now - this.last) / 1000, 0.25)
    this.last = now
    this.acc += dt

    try {
      let steps = 0
      while (this.acc >= this.step && steps < this.maxSubSteps) {
        this.onFixedUpdate(this.step)
        this.acc -= this.step
        steps += 1
      }
      // 已经追不上就丢弃积压，避免"越卡越补、越补越卡"
      if (steps === this.maxSubSteps) this.acc = 0

      this.onRender(dt)
    } catch (err) {
      // 抛异常的那一帧丢掉：清掉积压，别让下一帧接着爆同一处
      this.acc = 0
      this.noteError(err)
    }

    // 续帧放在 try 之外：异常帧之后循环照旧往下走
    this.raf = requestAnimationFrame(this.tick)
  }
}
