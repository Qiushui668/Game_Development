import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS } from '@/game/core/GameConfig'
import { getMaterials } from '@/game/scene/Materials'

/** 远山与地面装饰：全部程序生成，合并为 2 个 draw call */
export class Environment {
  private readonly group = new THREE.Group()

  constructor(scene: THREE.Scene) {
    this.group.add(this.buildGround(), this.buildMountains())
    scene.add(this.group)
  }

  /** 低多边形远山：全部合并成一个几何体 */
  private buildMountains(): THREE.Mesh {
    const peaks: Array<[number, number, number, number]> = [
      [-70, -40, 34, 30],
      [-110, -120, 46, 42],
      [72, -70, 30, 26],
      [120, -160, 52, 46],
      [-40, -230, 58, 40],
      [60, -250, 44, 34],
      [-140, -200, 38, 32],
      [160, -60, 30, 24],
    ]
    const geos: THREE.BufferGeometry[] = []
    for (const [x, z, radius, height] of peaks) {
      const cone = new THREE.ConeGeometry(radius, height, 5, 1)
      cone.translate(x, height / 2 - 2, z)
      geos.push(cone)
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, getMaterials().mountain)
    mesh.name = 'BackgroundMountains'
    mesh.matrixAutoUpdate = false
    return mesh
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

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group)
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    this.group.clear()
  }
}

/** 供其他模块复用的天空色常量 */
export const SKY_COLOR = COLORS.sky
