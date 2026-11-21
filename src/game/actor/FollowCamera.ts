import * as THREE from 'three'
import { CAMERA } from '@/game/core/GameConfig'
import { clamp } from '@/game/utils/MathUtils'

const DEG = Math.PI / 180

/**
 * 第三人称跟随相机：鼠标绕角色偏航/俯仰，位置做指数阻尼。
 * yaw = 0 时相机在角色正后方（+Z），俯视一点点。
 */
export class FollowCamera {
  yaw = 0
  pitch = 9 * DEG

  private readonly smooth = new THREE.Vector3()
  private initialized = false

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  rotateLook(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw
    this.pitch = clamp(this.pitch + deltaPitch, CAMERA.pitchMin * DEG, CAMERA.pitchMax * DEG)
  }

  update(dt: number, targetX: number, targetY: number, targetZ: number): void {
    const cosPitch = Math.cos(this.pitch)
    const distance = CAMERA.distance

    const desiredX = targetX + Math.sin(this.yaw) * cosPitch * distance
    const desiredZ = targetZ + Math.cos(this.yaw) * cosPitch * distance
    // 高度基准 + 俯仰抬升，最低不低于 0.9 m，避免镜头钻进地面
    const desiredY = Math.max(0.9, targetY + CAMERA.height * 0.42 + Math.sin(this.pitch) * distance)

    if (!this.initialized) {
      this.smooth.set(desiredX, desiredY, desiredZ)
      this.initialized = true
    } else {
      const k = 1 - Math.exp(-10 * dt)
      this.smooth.x += (desiredX - this.smooth.x) * k
      this.smooth.y += (desiredY - this.smooth.y) * k
      this.smooth.z += (desiredZ - this.smooth.z) * k
    }

    this.camera.position.copy(this.smooth)
    this.camera.lookAt(targetX, targetY + CAMERA.targetHeight, targetZ)
  }

  /** 复活/瞬移时直接归位，避免镜头拉一条长线 */
  snap(): void {
    this.initialized = false
  }
}
