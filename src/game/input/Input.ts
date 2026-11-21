/**
 * 输入：键盘 + 鼠标视角（Pointer Lock）+ 鼠标左右键出招。
 * 每帧只被消费一次，状态由控制器在固定步里读取。
 */
import type { AttackKind } from '@/game/combat/AttackSystem'

export class Input {
  private readonly keys = new Set<string>()
  private jumpQueued = false
  private interactQueued = false
  private attackQueued: AttackKind | null = null
  private lookX = 0
  private lookY = 0
  private locked = false
  /** 答题面板打开时关掉"点画布自动锁鼠标"，否则误点画布会重新锁死光标 */
  private clickLock = true
  private readonly canvas: HTMLElement

  onLockChange?: (locked: boolean) => void

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('click', this.onClick)
    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('contextmenu', this.onContextMenu)
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

  /** F 键（交互 / 开始答题）同样是边沿触发 */
  consumeInteract(): boolean {
    const queued = this.interactQueued
    this.interactQueued = false
    return queued
  }

  /** 鼠标左/右键：轻击 / 重击，边沿触发，取出即清空 */
  consumeAttack(): AttackKind | null {
    const queued = this.attackQueued
    this.attackQueued = null
    return queued
  }

  /** 答题时释放鼠标，让指针能点选项 */
  exitLock(): void {
    if (this.locked) document.exitPointerLock()
    this.lookX = 0
    this.lookY = 0
  }

  /** 答完题恢复第一人称视角（必须在用户手势（点击）里调用） */
  requestLock(): void {
    if (!this.locked) void this.canvas.requestPointerLock()
  }

  /** 答题期间关掉"点击画布自动锁鼠标"，保证光标始终能点选项 */
  setClickLock(enabled: boolean): void {
    this.clickLock = enabled
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.canvas.removeEventListener('click', this.onClick)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('blur', this.onBlur)
    if (this.locked) document.exitPointerLock()
    this.keys.clear()
    this.attackQueued = null
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
    if (key === 'f' && !e.repeat) this.interactQueued = true
    if (key.startsWith('arrow')) e.preventDefault()
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase())
  }

  private readonly onBlur = (): void => {
    this.keys.clear()
  }

  private readonly onClick = (): void => {
    if (!this.clickLock || this.locked) return
    void this.canvas.requestPointerLock()
  }

  /**
   * 锁住指针后才算"在游戏里"，此时左键=轻击、右键=重击。
   * 未锁定时左键仍走 onClick 的进入游戏逻辑，避免开局第一下就挥拳。
   */
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return
    if (e.button === 0) this.attackQueued = 'light'
    else if (e.button === 2) this.attackQueued = 'heavy'
    else return
    e.preventDefault()
  }

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
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
