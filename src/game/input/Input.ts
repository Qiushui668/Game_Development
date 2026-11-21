/**
 * 输入：键盘 + 鼠标视角（Pointer Lock）。
 * 每帧只被消费一次，状态由控制器在固定步里读取。
 */
export class Input {
  private readonly keys = new Set<string>()
  private jumpQueued = false
  private lookX = 0
  private lookY = 0
  private locked = false
  private readonly canvas: HTMLElement

  onLockChange?: (locked: boolean) => void

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('click', this.onClick)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('blur', this.onBlur)
  }

  get pointerLocked(): boolean {
    return this.locked
  }

  /** 本地坐标系输入：x 右为正，y 前为正，范围 -1..1 */
  readAxes(): { x: number; y: number; sprint: boolean } {
    const x = (this.has('d') || this.has('arrowright') ? 1 : 0) - (this.has('a') || this.has('arrowleft') ? 1 : 0)
    const y = (this.has('w') || this.has('arrowup') ? 1 : 0) - (this.has('s') || this.has('arrowdown') ? 1 : 0)
    return { x, y, sprint: this.has('shift') }
  }

  /** 取走并清空鼠标位移（弧度），单位是相机俯仰 / 偏航 */
  consumeLook(): { yaw: number; pitch: number } {
    const out = { yaw: this.lookX, pitch: this.lookY }
    this.lookX = 0
    this.lookY = 0
    return out
  }

  /** 跳跃是边沿触发：按下即入队，取出后清空 */
  consumeJump(): boolean {
    const queued = this.jumpQueued
    this.jumpQueued = false
    return queued
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.canvas.removeEventListener('click', this.onClick)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('blur', this.onBlur)
    if (this.locked) document.exitPointerLock()
    this.keys.clear()
  }

  private has(key: string): boolean {
    return this.keys.has(key)
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase()
    this.keys.add(key)
    if (key === ' ') {
      // 按住空格不重复入队，只有真正的按下沿才算一次跳跃
      if (!e.repeat) this.jumpQueued = true
      e.preventDefault()
    }
    if (key.startsWith('arrow')) e.preventDefault()
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase())
  }

  private readonly onBlur = (): void => {
    this.keys.clear()
  }

  private readonly onClick = (): void => {
    if (!this.locked) void this.canvas.requestPointerLock()
  }

  private readonly onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas
    this.onLockChange?.(this.locked)
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
    this.lookX -= e.movementX * 0.0026
    this.lookY += e.movementY * 0.0022
  }
}
