/**
 * 帧循环：渲染帧 + 固定物理步。
 * 规则（§13.3）：固定步 1/60，单帧最多补 maxSubSteps 步；掉帧时宁可慢放，不追帧。
 */
export class GameLoop {
  private raf: number | null = null
  private last = 0
  private acc = 0

  constructor(
    private readonly step: number,
    private readonly maxSubSteps: number,
    private readonly onFixedUpdate: (h: number) => void,
    private readonly onRender: (dtReal: number) => void,
  ) {}

  get running(): boolean {
    return this.raf !== null
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

  private readonly tick = (now: number): void => {
    // 切标签页回来时 dt 会非常大，用 0.25s 封顶避免一次性补帧爆炸
    const dt = Math.min((now - this.last) / 1000, 0.25)
    this.last = now
    this.acc += dt

    let steps = 0
    while (this.acc >= this.step && steps < this.maxSubSteps) {
      this.onFixedUpdate(this.step)
      this.acc -= this.step
      steps += 1
    }
    // 已经追不上就丢弃积压，避免"越卡越补、越补越卡"
    if (steps === this.maxSubSteps) this.acc = 0

    this.onRender(dt)

    this.raf = requestAnimationFrame(this.tick)
  }
}
