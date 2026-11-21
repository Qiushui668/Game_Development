import * as THREE from 'three'
import { COLORS, TRACK } from '@/game/core/GameConfig'
import { QUIZ_GATES, type QuizGateDef } from '@/game/quiz/QuizSystem'

export interface QuizWall {
  index: number
  z: number
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  texture: THREE.CanvasTexture
  /** 已经开门（碰撞已移除，正在淡出） */
  opened: boolean
  /** 淡出进度 0..1 */
  fade: number
}

/** 空气墙尺寸：铺满赛道并盖过两侧护栏，并在护栏外再留 0.6 m，跳上护栏也绕不过去 */
const WALL_HEIGHT = 4.6
const WALL_WIDTH = (TRACK.width / 2 + TRACK.railWidth + 0.6) * 2
/**
 * 碰撞体比画面更宽：护栏外没有地面，但可以斜跳出去再从墙后落回赛道。
 * 把碰撞横向延伸到 ±16 m，堵住这条"空中绕过"的路；这段墙看不见，但玩家也站不住。
 */
const WALL_COLLIDER_WIDTH = 32
const FADE_SECONDS = 0.35

function css(hex: number): string {
  return `#${new THREE.Color(hex).getHexString()}`
}

/** 一面墙的贴图：半透明玻璃底 + 虚线边框 + 大号序号 + 提示语 */
function makeWallTexture(gate: QuizGateDef): THREE.CanvasTexture {
  const w = 880
  const h = 200
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建答题墙画布')

  const pad = 10
  ctx.beginPath()
  ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, 20)
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, 'rgba(47, 230, 221, 0.30)')
  grad.addColorStop(0.5, 'rgba(120, 210, 255, 0.16)')
  grad.addColorStop(1, 'rgba(255, 127, 200, 0.30)')
  ctx.fillStyle = 'rgba(12, 40, 60, 0.20)'
  ctx.fill()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.setLineDash([18, 10])
  ctx.lineWidth = 8
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.stroke()
  ctx.setLineDash([])

  // 标题在最上方，序号底板居中，避免近身时被角色挡住
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '700 22px "Segoe UI", system-ui, sans-serif'
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(4, 18, 30, 0.85)'
  ctx.strokeText('QUIZ GATE', w / 2, 34)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText('QUIZ GATE', w / 2, 34)

  // 序号底板：不透明深色圆角块，白色数字在亮天空 / 粉栏架前都能读
  const plateW = 200
  const plateH = 112
  const plateX = w / 2 - plateW / 2
  const plateY = 52
  ctx.beginPath()
  ctx.roundRect(plateX, plateY, plateW, plateH, 16)
  ctx.fillStyle = 'rgba(6, 22, 36, 0.9)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(126, 255, 246, 0.75)'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.textBaseline = 'middle'
  ctx.font = '900 92px "Segoe UI", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.fillText(gate.label, w / 2, plateY + plateH / 2 + 5)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(gate.label, w / 2, plateY + plateH / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/**
 * 答题空气墙：4 面半透明玻璃墙铺满赛道，墙上是题目序号。
 * 视觉与碰撞分开：碰撞在 World 里建，这里只管画面与开门淡出。
 */
export class QuizWalls {
  readonly group = new THREE.Group()
  readonly walls: QuizWall[] = []

  constructor() {
    this.group.name = 'QuizWalls'
    for (let i = 0; i < QUIZ_GATES.length; i++) {
      const def = QUIZ_GATES[i]
      const texture = makeWallTexture(def)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const geo = new THREE.PlaneGeometry(WALL_WIDTH, WALL_HEIGHT)
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.set(0, WALL_HEIGHT / 2, def.z)
      mesh.name = `QuizWall${def.label}`
      const wall: QuizWall = { index: i, z: def.z, mesh, material, texture, opened: false, fade: 0 }
      this.walls.push(wall)
      this.group.add(mesh)
    }
  }

  /** 开门后 0.35 s 淡出消失；未开的墙保持不透明贴图（透明度写在贴图 alpha 里） */
  update(dt: number): void {
    for (const wall of this.walls) {
      if (!wall.opened || wall.fade >= 1) continue
      wall.fade = Math.min(1, wall.fade + dt / FADE_SECONDS)
      wall.material.opacity = 1 - wall.fade
      wall.mesh.visible = wall.fade < 1
    }
  }

  open(index: number): void {
    const wall = this.walls[index]
    if (!wall || wall.opened) return
    wall.opened = true
    wall.fade = 0
  }

  reset(): void {
    for (const wall of this.walls) {
      wall.opened = false
      wall.fade = 0
      wall.mesh.visible = true
      wall.material.opacity = 1
    }
  }

  dispose(): void {
    for (const wall of this.walls) {
      wall.material.dispose()
      wall.texture.dispose()
      wall.mesh.geometry.dispose()
    }
    this.walls.length = 0
    this.group.clear()
  }
}

export const QUIZ_WALL_HEIGHT = WALL_HEIGHT
export const QUIZ_WALL_WIDTH = WALL_WIDTH
export const QUIZ_WALL_COLLIDER_WIDTH = WALL_COLLIDER_WIDTH
export const QUIZ_WALL_COLOR = COLORS.checkerCyan
export const QUIZ_WALL_ACCENT = css(COLORS.rail)
