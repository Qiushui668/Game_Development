import * as THREE from 'three'

/**
 * 头顶名牌：Canvas 画成「上方血条 + 下方昵称」两行，再贴到 Sprite 上。
 * Sprite 天然面向相机，父节点（角色 group）怎么旋转都不影响阅读。
 * 昵称在会话里不变，只在血量变化时重画一次（受伤时才触发，频率极低）。
 */
const NAME_FONT = '700 40px "Segoe UI", "Microsoft YaHei", sans-serif'
const HP_FONT = '700 24px "Segoe UI", "Microsoft YaHei", sans-serif'
/** 像素 → 世界米：1 px = 0.00735 m，昵称行 72 px ≈ 0.53 m 高 */
const METER_PER_PX = 0.00735
const PAD_X = 24
/** 画布高度：血条 38 px（含边距）+ 昵称 72 px + 上下留白 */
const CANVAS_H = 120
const BAR_H = 30
const BAR_TOP = 6
const NAME_TOP = 44
const NAME_H = 68
/** 挂点默认高度：让昵称行落在离地约 2.3 m（血条再往上 0.27 m） */
const ATTACH_Y = 2.45

function css(hex: number): string {
  return `#${new THREE.Color(hex).getHexString()}`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** 血量配色：>60% 青绿 / >30% 黄橙 / 其余红粉 */
function hpColor(ratio: number): string {
  if (ratio > 0.6) return '#3ee0a1'
  if (ratio > 0.3) return '#ffc247'
  return '#ff5f7a'
}

export class NameTag {
  readonly sprite: THREE.Sprite
  readonly text: string
  /** 名牌当前显示的血量（远端由网络包驱动，本地由伤害结算驱动） */
  hp: number
  maxHp: number
  private readonly texture: THREE.CanvasTexture
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly accent: string

  constructor(nickname: string, accent: number, maxHp = 100) {
    const text = nickname || '玩家'
    this.text = text
    this.accent = css(accent)
    this.hp = maxHp
    this.maxHp = maxHp

    const probe = document.createElement('canvas').getContext('2d')
    if (!probe) throw new Error('无法创建名牌画布')
    probe.font = NAME_FONT
    const textWidth = Math.ceil(probe.measureText(text).width)
    const width = Math.max(textWidth + PAD_X * 2, 190)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = CANVAS_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建名牌画布')
    this.canvas = canvas
    this.ctx = ctx

    this.draw()

    this.texture = new THREE.CanvasTexture(canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
    this.texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      // 保留深度测试：被墙挡住时名牌也一起被挡住，不会穿墙露在外面
      depthTest: true,
    })
    this.sprite = new THREE.Sprite(material)
    const aspect = width / CANVAS_H
    this.sprite.scale.set(CANVAS_H * METER_PER_PX * aspect, CANVAS_H * METER_PER_PX, 1)
    this.sprite.renderOrder = 3
  }

  /** 血量变化时调用；值没变就直接返回，避免每帧重画贴图 */
  setHealth(hp: number, maxHp = this.maxHp): boolean {
    const nextHp = Math.max(0, Math.min(maxHp, Math.round(hp)))
    if (nextHp === this.hp && maxHp === this.maxHp) return false
    this.hp = nextHp
    this.maxHp = maxHp
    this.draw()
    this.texture.needsUpdate = true
    return true
  }

  /** 挂在角色头顶（昵称行约 2.3 m，血条在它上面） */
  attachTo(target: THREE.Object3D, y = ATTACH_Y): void {
    this.sprite.position.set(0, y, 0)
    target.add(this.sprite)
  }

  snapshot(): { text: string; hp: number; maxHp: number; y: number; visible: boolean } {
    return {
      text: this.text,
      hp: this.hp,
      maxHp: this.maxHp,
      y: this.sprite.position.y,
      visible: this.sprite.visible,
    }
  }

  dispose(): void {
    this.sprite.parent?.remove(this.sprite)
    this.sprite.material.dispose()
    this.texture.dispose()
  }

  /** 整张重画：血条（含数字）+ 昵称胶囊 */
  private draw(): void {
    const ctx = this.ctx
    const w = this.canvas.width
    ctx.clearRect(0, 0, w, CANVAS_H)

    // ---------- 血条 ----------
    const bx = 10
    const by = BAR_TOP
    const bw = w - bx * 2
    const bh = BAR_H
    const ratio = this.maxHp > 0 ? Math.max(0, Math.min(1, this.hp / this.maxHp)) : 0

    ctx.save()
    roundRect(ctx, bx, by, bw, bh, bh / 2)
    ctx.clip()
    // 底槽：深灰紫，和果冻人身上的配色区分开
    ctx.fillStyle = 'rgba(24, 18, 44, 0.82)'
    ctx.fillRect(bx, by, bw, bh)
    // 已损失的部分先画一层暗红，剩血再按比例覆盖，低血量时一眼能看出缺口
    ctx.fillStyle = 'rgba(255, 95, 122, 0.4)'
    ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = hpColor(ratio)
    ctx.fillRect(bx, by, bw * ratio, bh)
    // 顶部一道高光，让条子有厚度
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.fillRect(bx, by, bw * ratio, bh * 0.34)
    ctx.restore()

    ctx.lineWidth = 3
    ctx.strokeStyle = this.accent
    roundRect(ctx, bx + 1.5, by + 1.5, bw - 3, bh - 3, (bh - 3) / 2)
    ctx.stroke()

    const label = `${this.hp}/${this.maxHp}`
    ctx.font = HP_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(12, 8, 24, 0.7)'
    ctx.strokeText(label, w / 2, by + bh / 2 + 1)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, w / 2, by + bh / 2 + 1)

    // ---------- 昵称胶囊 ----------
    ctx.fillStyle = 'rgba(26, 20, 48, 0.78)'
    roundRect(ctx, 2, NAME_TOP, w - 4, NAME_H, 24)
    ctx.fill()
    ctx.lineWidth = 5
    ctx.strokeStyle = this.accent
    ctx.stroke()

    ctx.font = NAME_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(10, 8, 20, 0.55)'
    ctx.strokeText(this.text, w / 2, NAME_TOP + NAME_H / 2 + 1)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(this.text, w / 2, NAME_TOP + NAME_H / 2 + 1)
  }
}
