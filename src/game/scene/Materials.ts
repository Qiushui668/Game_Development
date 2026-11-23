import * as THREE from 'three'
import { COLORS } from '@/game/core/GameConfig'

export interface MaterialSet {
  /** 棋盘地面（按赛道段落各一份，重复度不同） */
  floorStart: THREE.MeshLambertMaterial
  floorMain: THREE.MeshLambertMaterial
  floorFinish: THREE.MeshLambertMaterial
  /** 平台侧面 / 底面 */
  side: THREE.MeshLambertMaterial
  rail: THREE.MeshLambertMaterial
  railDark: THREE.MeshLambertMaterial
  hurdle: THREE.MeshLambertMaterial
  sweeper: THREE.MeshLambertMaterial
  pin: THREE.MeshLambertMaterial
  spike: THREE.MeshLambertMaterial
  spikeBase: THREE.MeshLambertMaterial
  pendulum: THREE.MeshLambertMaterial
  pendulumArm: THREE.MeshLambertMaterial
  /** 巨型拳击手套：拳套本体 / 暗部 / 袖口 / 墙上挂钩 */
  glove: THREE.MeshLambertMaterial
  gloveDark: THREE.MeshLambertMaterial
  gloveCuff: THREE.MeshLambertMaterial
  gloveMount: THREE.MeshLambertMaterial
  /** 方格桥（InstancedMesh 用实例色，这里只提供白底材质） */
  tile: THREE.MeshLambertMaterial
  crown: THREE.MeshLambertMaterial
  mountainLight: THREE.MeshLambertMaterial
  mountainDeep: THREE.MeshLambertMaterial
  ground: THREE.MeshLambertMaterial
  cloud: THREE.MeshLambertMaterial
}

let cached: MaterialSet | null = null

function css(hex: number): string {
  return `#${new THREE.Color(hex).getHexString()}`
}

/** 2×2 棋盘格贴图，一格 = 1.5 m（由几何 UV 缩放控制实际密度） */
function makeCheckerTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建棋盘贴图画布')
  ctx.fillStyle = css(COLORS.checkerCyan)
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = css(COLORS.checkerPink)
  ctx.fillRect(0, 0, size / 2, size / 2)
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  // 掠射角下 anisotropy=1 会直接跳最高 mip，近处地面被平均成一片粉；抬到 8 保住格子
  tex.anisotropy = 8
  return tex
}

/** 斜向条纹贴图，用于栏架 */
function makeStripeTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建条纹贴图画布')
  ctx.fillStyle = css(COLORS.hurdle)
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = css(COLORS.hurdleStripe)
  ctx.lineWidth = 14
  for (let i = -size; i < size * 2; i += 32) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + size, size)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/**
 * 全场景共享材质实例（§13.2-4）。Lambert 比 Standard 便宜一档，低多边形风格足够。
 * 棋盘 / 条纹用 CanvasTexture 程序生成，不引入外部图片资源。
 */
export function getMaterials(): MaterialSet {
  if (cached) return cached
  const checker = makeCheckerTexture()
  const stripe = makeStripeTexture()
  cached = {
    // 起步区原来染成 0xffd9ec，把青/粉两色都洗成一片浅粉、棋盘纹几乎看不出来；改为原色
    floorStart: new THREE.MeshLambertMaterial({ map: checker, color: 0xffffff }),
    floorMain: new THREE.MeshLambertMaterial({ map: checker, color: 0xffffff }),
    floorFinish: new THREE.MeshLambertMaterial({ map: checker, color: 0xd6cfff }),
    side: new THREE.MeshLambertMaterial({ color: COLORS.start }),
    rail: new THREE.MeshLambertMaterial({ color: COLORS.rail }),
    railDark: new THREE.MeshLambertMaterial({ color: COLORS.railDark }),
    hurdle: new THREE.MeshLambertMaterial({ map: stripe }),
    sweeper: new THREE.MeshLambertMaterial({ color: COLORS.sweeper }),
    pin: new THREE.MeshLambertMaterial({ color: COLORS.pin }),
    spike: new THREE.MeshLambertMaterial({ color: COLORS.spike }),
    spikeBase: new THREE.MeshLambertMaterial({ color: COLORS.spikeBase }),
    pendulum: new THREE.MeshLambertMaterial({ color: COLORS.pendulum }),
    pendulumArm: new THREE.MeshLambertMaterial({ color: COLORS.pendulumArm }),
    glove: new THREE.MeshLambertMaterial({ color: COLORS.glove }),
    gloveDark: new THREE.MeshLambertMaterial({ color: COLORS.gloveDark }),
    gloveCuff: new THREE.MeshLambertMaterial({ color: COLORS.gloveCuff }),
    gloveMount: new THREE.MeshLambertMaterial({ color: COLORS.gloveMount }),
    // 赛道方格用与主地面完全相同的棋盘贴图：尺寸、颜色都和普通路面一致，看不出哪块有陷阱
    tile: new THREE.MeshLambertMaterial({ map: checker, color: 0xffffff }),
    crown: new THREE.MeshLambertMaterial({ color: COLORS.crown }),
    mountainLight: new THREE.MeshLambertMaterial({ color: COLORS.mountainLight }),
    mountainDeep: new THREE.MeshLambertMaterial({ color: COLORS.mountainDeep }),
    ground: new THREE.MeshLambertMaterial({ color: COLORS.ground }),
    cloud: new THREE.MeshLambertMaterial({ color: COLORS.cloud }),
  }
  return cached
}

export function disposeMaterials(): void {
  if (!cached) return
  const textures: THREE.Texture[] = []
  for (const m of Object.values(cached)) {
    if (m.map) textures.push(m.map)
    m.dispose()
  }
  for (const t of textures) t.dispose()
  cached = null
}
