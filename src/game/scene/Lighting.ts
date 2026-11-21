import * as THREE from 'three'

/**
 * 灯光：1 个平行光 + 1 个半球光，全程不投阴影（§13.2-2/3）。
 */
export class Lighting {
  private readonly group = new THREE.Group()

  constructor(scene: THREE.Scene) {
    const sun = new THREE.DirectionalLight(0xffffff, 1.7)
    sun.position.set(28, 46, 18)
    sun.target.position.set(0, 0, -60)
    sun.castShadow = false

    // 半球光：天空取淡青、地面取糖果粉做反射色。原来的泥绿地面色会把角色下半身压成橄榄色
    const hemi = new THREE.HemisphereLight(0xdff3ff, 0xffb9dd, 1.25)

    this.group.add(sun, sun.target, hemi)
    scene.add(this.group)
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group)
    this.group.traverse((o) => {
      if (o instanceof THREE.Light) o.dispose()
    })
    this.group.clear()
  }
}
