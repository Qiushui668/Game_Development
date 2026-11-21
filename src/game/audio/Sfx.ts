/**
 * 音效：单次播放类音效（目前只有击杀）。
 * 用元素池而不是一个 <audio> 反复 currentTime=0：连杀时能叠着响，不会互相截断。
 * 浏览器自动播放策略下，如果 kill 音效先于用户手势触发，play() 会被拒——静默吞掉即可。
 */
const KILL_SRC = '/audio/kill.mp3'
const KILL_VOLUME = 0.7
/** 元素池大小：连杀最多同时 4 个 */
const POOL = 4

export class Sfx {
  private readonly pool: HTMLAudioElement[] = []
  private index = 0
  /** 击杀音效实际播放次数（调试/验收用） */
  private killPlays = 0
  /** 最近一次播放被浏览器拒绝的次数 */
  private blocked = 0

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const audio = new Audio(KILL_SRC)
      audio.volume = KILL_VOLUME
      audio.preload = 'auto'
      this.pool.push(audio)
    }
  }

  /** 每次杀敌播一次 1杀.mp3 */
  playKill(): void {
    const audio = this.pool[this.index]
    this.index = (this.index + 1) % this.pool.length
    this.killPlays++
    try {
      audio.currentTime = 0
    } catch {
      // 元数据还没加载完时设置 currentTime 会抛，忽略
    }
    void audio.play().catch(() => {
      this.blocked++
    })
  }

  snapshot(): { killPlays: number; blocked: number; src: string } {
    return { killPlays: this.killPlays, blocked: this.blocked, src: KILL_SRC }
  }

  dispose(): void {
    for (const audio of this.pool) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    this.pool.length = 0
  }
}
