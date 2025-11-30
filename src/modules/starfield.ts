/**
 * StarField Module - Renders a twinkling star field effect for night sky.
 *
 * Uses Three.js Points with custom shader material for twinkling effect.
 */

import * as THREE from 'three'
import type {
  ModuleManifest,
  ModuleContext,
  RendererModule,
  ModuleSettingsSchema,
  InferSettings
} from './types'

// Get Three.js revision as integer
const threeVersion = parseInt(THREE.REVISION.replaceAll(/\D+/g, ''), 10)

// ============================================================================
// Settings Schema
// ============================================================================

const starfieldSettingsSchema = {
  radius: {
    default: 80,
    label: 'Radius',
    description: 'Inner radius of the star sphere',
    min: 20,
    max: 200,
  },
  depth: {
    default: 50,
    label: 'Depth',
    description: 'Thickness of the star sphere',
    min: 10,
    max: 100,
  },
  count: {
    default: 7000,
    label: 'Star Count',
    description: 'Number of stars to render',
    min: 1000,
    max: 20000,
    step: 1000,
  },
  factor: {
    default: 7,
    label: 'Size Factor',
    description: 'Star size multiplier',
    min: 1,
    max: 20,
  },
  saturation: {
    default: 10,
    label: 'Saturation',
    description: 'Color saturation of stars',
    min: 0,
    max: 100,
  },
  speed: {
    default: 0.2,
    label: 'Twinkle Speed',
    description: 'Speed of twinkling animation',
    min: 0,
    max: 1,
    step: 0.1,
  },
  autoTimeOfDay: {
    default: true,
    label: 'Auto Time-of-Day',
    description: 'Automatically show/hide stars based on in-game time',
  },
} as const satisfies ModuleSettingsSchema

export type StarfieldSettings = typeof starfieldSettingsSchema

// ============================================================================
// Custom Shader Material
// ============================================================================

class StarfieldMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: { time: { value: 0 }, fade: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float time;
        attribute float size;
        varying vec3 vColor;
        attribute vec3 color;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 0.5);
          gl_PointSize = 0.7 * size * (30.0 / -mvPosition.z) * (3.0 + sin(time + 100.0));
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D pointTexture;
        uniform float fade;
        varying vec3 vColor;
        void main() {
          float opacity = 1.0;
          gl_FragColor = vec4(vColor, 1.0);

          #include <tonemapping_fragment>
          #include <${threeVersion >= 154 ? 'colorspace_fragment' : 'encodings_fragment'}>
        }`,
    })
  }
}

// ============================================================================
// Module Manifest
// ============================================================================

export const starfieldManifest: ModuleManifest<StarfieldSettings> = {
  id: 'starfield',
  name: 'Star Field',
  description: 'Renders a twinkling star field effect for the night sky',
  version: '1.0.0',
  settings: starfieldSettingsSchema,
}

// ============================================================================
// Starfield Module Implementation
// ============================================================================

export class StarfieldModule implements RendererModule<StarfieldSettings> {
  readonly manifest = starfieldManifest

  // Current settings (mutable)
  private _settings: InferSettings<StarfieldSettings>

  // Module state
  private _enabled = true
  private context?: ModuleContext
  private points?: THREE.Points
  private readonly clock = new THREE.Clock()
  private renderCallback?: () => void

  constructor(initialSettings?: Partial<InferSettings<StarfieldSettings>>) {
    // Initialize settings with defaults
    this._settings = {
      radius: starfieldSettingsSchema.radius.default,
      depth: starfieldSettingsSchema.depth.default,
      count: starfieldSettingsSchema.count.default,
      factor: starfieldSettingsSchema.factor.default,
      saturation: starfieldSettingsSchema.saturation.default,
      speed: starfieldSettingsSchema.speed.default,
      autoTimeOfDay: starfieldSettingsSchema.autoTimeOfDay.default,
      ...initialSettings,
    }
  }

  get settings(): InferSettings<StarfieldSettings> {
    return this._settings
  }

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean) {
    if (this._enabled === value) return
    this._enabled = value

    if (value) {
      this.onEnable?.()
    } else {
      this.onDisable?.()
    }
  }

  init(context: ModuleContext): void {
    this.context = context

    // Create render callback
    this.renderCallback = () => {
      if (!this.points || !this.context) return
      this.points.position.copy(this.context.getCameraPosition())
        ; (this.points.material as StarfieldMaterial).uniforms.time.value =
          this.clock.getElapsedTime() * this._settings.speed
    }

    if (this._enabled) {
      this.createStars()
      context.onRender(this.renderCallback)
    }
  }

  setSetting<K extends keyof StarfieldSettings>(
    key: K,
    value: StarfieldSettings[K]['default']
  ): void {
    (this._settings as any)[key] = value

    // Recreate stars if geometry-affecting settings change
    if (['radius', 'depth', 'count', 'factor', 'saturation'].includes(key as string)) {
      this.recreateStars()
    }
  }

  onEnable(): void {
    if (!this.context) return
    this.createStars()
    if (this.renderCallback) {
      this.context.onRender(this.renderCallback)
    }
  }

  onDisable(): void {
    this.removeStars()
    if (this.context && this.renderCallback) {
      this.context.offRender(this.renderCallback)
    }
  }

  /**
   * Update visibility based on time of day (0-24000 Minecraft ticks).
   */
  updateTimeOfDay(time: number): void {
    if (!this._settings.autoTimeOfDay) return

    const nightTime = 13_500
    const morningStart = 23_000
    const displayStars = time > nightTime && time < morningStart

    if (displayStars && !this.points) {
      this.createStars()
    } else if (!displayStars && this.points) {
      this.removeStars()
    }
  }

  private createStars(): void {
    if (!this.context || this.points) return

    const { radius, depth, count, factor, saturation } = this._settings

    const geometry = new THREE.BufferGeometry()

    const genStar = (r: number): THREE.Vector3 =>
      new THREE.Vector3().setFromSpherical(
        new THREE.Spherical(
          r,
          Math.acos(1 - Math.random() * 2),
          Math.random() * 2 * Math.PI
        )
      )

    const positions: number[] = []
    const colors: number[] = []
    const sizes = Array.from({ length: count }, () => (0.5 + 0.5 * Math.random()) * factor)
    const color = new THREE.Color()
    let r = radius + depth
    const increment = depth / count

    for (let i = 0; i < count; i++) {
      r -= increment * Math.random()
      positions.push(...genStar(r).toArray())
      color.setHSL(i / count, saturation, 0.9)
      colors.push(color.r, color.g, color.b)
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1))

    const material = new StarfieldMaterial()
    material.blending = THREE.AdditiveBlending
    material.depthTest = false
    material.transparent = true

    this.points = new THREE.Points(geometry, material)
    this.points.renderOrder = -1
    this.context.scene.add(this.points)
  }

  private removeStars(): void {
    if (!this.context || !this.points) return

    this.points.geometry.dispose()
      ; (this.points.material as THREE.Material).dispose()
    this.context.scene.remove(this.points)
    this.points = undefined
  }

  private recreateStars(): void {
    if (!this._enabled) return
    this.removeStars()
    this.createStars()
  }

  dispose(): void {
    this.onDisable()
    this.context = undefined
  }
}

// ============================================================================
// Module Factory
// ============================================================================

/**
 * Create a new StarfieldModule instance.
 */
export const createStarfieldModule = (
  initialSettings?: Partial<InferSettings<StarfieldSettings>>
): StarfieldModule => {
  return new StarfieldModule(initialSettings)
}

// Re-export the old class for backwards compatibility
export { StarfieldModule as StarField }
