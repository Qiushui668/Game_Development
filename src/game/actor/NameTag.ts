import * as THREE from 'three'

/**
 * 头顶昵称名牌：Canvas 画成胶囊标签再贴到 Sprite 上。
 * Sprite 天然面向相机，父节点（角色 group）怎么旋转都不影响阅读。
 * 每个角色只建一次，昵称在会话里不变，所以不做动态重绘。
 */
const FONT = '700 44px "Segoe UI", "Microsoft YaHei", sans-serif'
/** 名牌在世界里的高度（米） */
const TAG_HEIGHT = 0.5

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

export class NameTag {
  readonly sprite: THREE.Sprite
  readonly text: string
  private readonly texture: THREE.CanvasTexture

  constructor(nickname: string, accent: number) {
    const text = nickname || '玩家'
    this.text = text
    const probe = document.createElement('canvas').getContext('2d')
    if (!probe) throw new Error('无法创建名牌画布')
    probe.font = FONT
    const textWidth = Math.ceil(probe.measureText(text).width)

    const padX = 26
    const width = textWidth + padX * 2
    const height = 68
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建名牌画布')

    // 半透明深底 + 角色配色的描边，压在糖果风背景上也读得清
    ctx.fillStyle = 'rgba(26, 20, 48, 0.78)'
    roundRect(ctx, 2, 2, width - 4, height - 4, 24)
    ctx.fill()
    ctx.lineWidth = 5
    ctx.strokeStyle = css(accent)
    ctx.stroke()

    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(10, 8, 20, 0.55)'
    ctx.strokeText(text, width / 2, height / 2 + 1)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, width / 2, height / 2 + 1)

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
    const aspect = width / height
    this.sprite.scale.set(TAG_HEIGHT * aspect, TAG_HEIGHT, 1)
    this.sprite.renderOrder = 3
  }

  /** 挂在角色头顶：果冻人本体高 1.8，名牌抬到 2.3 留出跳动余量 */
  attachTo(target: THREE.Object3D, y = 2.3): void {
    this.sprite.position.set(0, y, 0)
    target.add(this.sprite)
  }

  dispose(): void {
    this.sprite.parent?.remove(this.sprite)
    this.sprite.material.dispose()
    this.texture.dispose()
  }
}
