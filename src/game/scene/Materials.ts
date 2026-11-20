import * as THREE from 'three'
import { COLORS } from '@/game/core/GameConfig'

export interface MaterialSet {
  track: THREE.MeshLambertMaterial
  start: THREE.MeshLambertMaterial
  finish: THREE.MeshLambertMaterial
  rail: THREE.MeshLambertMaterial
  obstacle: THREE.MeshLambertMaterial
  mountain: THREE.MeshLambertMaterial
  ground: THREE.MeshLambertMaterial
}

let cached: MaterialSet | null = null

/**
 * 全场景共享材质实例（§13.2-4）。Lambert 比 Standard 便宜一档，低多边形风格足够。
 */
export function getMaterials(): MaterialSet {
  if (cached) return cached
  cached = {
    track: new THREE.MeshLambertMaterial({ color: COLORS.track }),
    start: new THREE.MeshLambertMaterial({ color: COLORS.start }),
    finish: new THREE.MeshLambertMaterial({ color: COLORS.finish }),
    rail: new THREE.MeshLambertMaterial({ color: COLORS.rail }),
    obstacle: new THREE.MeshLambertMaterial({ color: COLORS.obstacle }),
    mountain: new THREE.MeshLambertMaterial({ color: COLORS.mountain }),
    ground: new THREE.MeshLambertMaterial({ color: 0x9ad6ea }),
  }
  return cached
}

export function disposeMaterials(): void {
  if (!cached) return
  for (const m of Object.values(cached)) m.dispose()
  cached = null
}
