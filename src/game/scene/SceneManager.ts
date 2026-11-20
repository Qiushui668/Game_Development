import * as THREE from 'three'
import { COLORS, RENDER } from '@/game/core/GameConfig'

/**
 * 渲染器 / 场景 / 相机 的唯一持有者。
 * 约束（§13.2）：不做抗锯齿、pixelRatio 固定 1、渲染分辨率封顶 1280×720、无实时阴影。
 */
export class SceneManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  private readonly resizeObserver: ResizeObserver

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(RENDER.pixelRatio)
    this.renderer.shadowMap.enabled = false
    // 不做 tone mapping，省一次全屏后处理
    this.renderer.toneMapping = THREE.NoToneMapping

    const canvas = this.renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(COLORS.sky)
    this.scene.fog = new THREE.Fog(COLORS.sky, RENDER.fogNear, RENDER.fogFar)

    this.camera = new THREE.PerspectiveCamera(RENDER.fov, 16 / 9, RENDER.near, RENDER.far)
    // M1 阶段用固定观察机位，俯视整条赛道；M2 换成 FollowCamera
    this.camera.position.set(0, 11, 24)
    this.camera.lookAt(0, 1.5, -60)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  private resize(): void {
    const cssW = this.container.clientWidth || window.innerWidth
    const cssH = this.container.clientHeight || window.innerHeight
    const w = Math.max(320, Math.min(cssW, RENDER.maxWidth))
    const h = Math.max(180, Math.min(cssH, RENDER.maxHeight))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.resizeObserver.disconnect()
    this.scene.clear()
    this.renderer.dispose()
    // 主动释放 WebGL 上下文，避免热更新时累积
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
