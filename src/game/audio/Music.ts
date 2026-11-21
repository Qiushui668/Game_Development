/**
 * 背景音乐：单条 <audio> 循环播放。
 * 浏览器不允许无手势自动播放，所以只在首次点击画布（pointerdown）时启动；
 * 答题时降音量（duck），不打断播放。
 */
const SRC = '/audio/danzai.mp3'
const VOLUME = 0.5
const DUCKED = 0.18

export class Music {
  private readonly audio: HTMLAudioElement
  private started = false
  private ducked = false

  constructor() {
    const audio = new Audio(SRC)
    audio.loop = true
    audio.volume = VOLUME
    audio.preload = 'auto'
    // 部分浏览器在 play() 期间会暂停循环，这里兜底：到结尾手动回到 0
    audio.addEventListener('ended', () => {
      audio.currentTime = 0
      void audio.play().catch(() => {})
    })
    this.audio = audio
  }

  get playing(): boolean {
    return !this.audio.paused
  }

  /** 首次用户手势时调用；重复调用无副作用 */
  start(): void {
    if (this.started) return
    this.started = true
    void this.audio.play().catch(() => {
      // 被自动播放策略拦下就保持静音待下一次手势，不抛给上层
      this.started = false
    })
  }

  /** 答题期间压低音量，避免盖住倒计时反馈 */
  duck(on: boolean): void {
    this.ducked = on
    this.audio.volume = on ? DUCKED : VOLUME
  }

  snapshot(): {
    playing: boolean
    volume: number
    ducked: boolean
    loop: boolean
    currentTime: number
    duration: number
    src: string
  } {
    return {
      playing: this.playing,
      volume: this.audio.volume,
      ducked: this.ducked,
      loop: this.audio.loop,
      currentTime: this.audio.currentTime,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      src: this.audio.currentSrc || this.audio.src,
    }
  }

  dispose(): void {
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }
}
