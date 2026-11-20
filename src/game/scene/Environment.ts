import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS, RENDER } from '@/game/core/GameConfig'
import { getMaterials } from '@/game/scene/Materials'

function css(hex: number): string {
  return `#${new THREE.Color(hex).getHexString()}`
}

/** 竖直渐变贴图，用于天空穹顶 */
function makeSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建天空贴图画布')
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, css(COLORS.skyTop))
  grad.addColorStop(0.42, css(COLORS.sky))
  grad.addColorStop(1, css(COLORS.skyBottom))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 4, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  // 水平方向循环，避免球面接缝处的竖直线；竖直方向只取一次渐变
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

/**
 * 天空 / 远山 / 云 / 远景底座：全部程序生成且合批。
 * 天空穹顶 1 draw、远山 2 draw（明暗两档）、云 1 draw、底座 1 draw。
 */
export class Environment {
  private readonly group = new THREE.Group()
  private readonly sky: THREE.Mesh

  constructor(scene: THREE.Scene) {
    this.sky = this.buildSky()
    this.group.add(this.sky, this.buildGround(), this.buildClouds())
    const mountains = this.buildMountains()
    this.group.add(mountains.light, mountains.deep)
    scene.add(this.group)
  }

  /** 穹顶跟随相机，保证永远落在远裁剪面内且不出现"天空边缘" */
  followCamera(camera: THREE.Camera): void {
    this.sky.position.copy(camera.position)
    this.sky.updateMatrix()
  }

  /** 天空穹顶：内表面贴渐变，不吃雾，保证地平线处自然过渡 */
  private buildSky(): THREE.Mesh {
    const radius = RENDER.far - 40
    const geo = new THREE.SphereGeometry(radius, 32, 18)
    const tex = makeSkyTexture()
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'SkyDome'
    mesh.renderOrder = -10
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /** 低多边形远山：明暗两档各合并一次 */
  private buildMountains(): { light: THREE.Mesh; deep: THREE.Mesh } {
    const peaks: Array<[number, number, number, number]> = [
      [-70, -40, 34, 30],
      [-108, -115, 46, 42],
      [-150, -190, 40, 34],
      [-42, -228, 56, 40],
      [-190, -60, 30, 24],
      [72, -70, 30, 26],
      [118, -158, 50, 44],
      [58, -246, 44, 34],
      [170, -58, 30, 24],
      [205, -150, 38, 30],
      [0, -285, 62, 44],
      [-105, -300, 50, 36],
      [120, -300, 46, 34],
    ]
    const light: THREE.BufferGeometry[] = []
    const deep: THREE.BufferGeometry[] = []
    peaks.forEach(([x, z, radius, height], i) => {
      const cone = new THREE.ConeGeometry(radius, height, 5, 1)
      cone.translate(x, height / 2 - 2, z)
      ;(i % 2 === 0 ? light : deep).push(cone)
    })
    const build = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string): THREE.Mesh => {
      const merged = mergeGeometries(geos, false)
      geos.forEach((g) => g.dispose())
      const mesh = new THREE.Mesh(merged, mat)
      mesh.name = name
      mesh.matrixAutoUpdate = false
      return mesh
    }
    const mats = getMaterials()
    return {
      light: build(light, mats.mountainLight, 'MountainsLight'),
      deep: build(deep, mats.mountainDeep, 'MountainsDeep'),
    }
  }

  /** 远景底座，避免赛道"悬空在虚空里" */
  private buildGround(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, -1.6, -120)
    const mesh = new THREE.Mesh(geo, getMaterials().ground)
    mesh.name = 'DistantGround'
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /** 几朵压扁的球，合并成 1 个 draw call */
  private buildClouds(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const spots: Array<[number, number, number, number]> = [
      [-60, 46, -120, 1.0],
      [-14, 54, -175, 1.3],
      [48, 42, -100, 0.85],
      [96, 52, -200, 1.2],
      [-96, 58, -230, 1.1],
      [24, 62, -280, 1.4],
    ]
    for (const [x, y, z, s] of spots) {
      for (const [dx, dy, dz, r] of [
        [0, 0, 0, 7],
        [-6, -1, 1, 5],
        [7, -1.5, -1, 4.5],
        [2, 2.5, 0, 4],
      ] as Array<[number, number, number, number]>) {
        const sphere = new THREE.SphereGeometry(r * s, 8, 6)
        sphere.scale(1, 0.62, 0.8)
        sphere.translate(x + dx * s, y + dy * s, z + dz * s)
        geos.push(sphere)
      }
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, getMaterials().cloud)
    mesh.name = 'Clouds'
    mesh.matrixAutoUpdate = false
    return mesh
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group)
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const mat = o.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat instanceof THREE.MeshBasicMaterial && mat.map) {
          mat.map.dispose()
          mat.dispose()
        }
      }
    })
    this.group.clear()
  }
}

/** 供其他模块复用的天空色常量 */
export const SKY_COLOR = COLORS.sky
