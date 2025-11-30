/**
 * Three.js Graphics Backend - Main entry point for Three.js WebGL rendering.
 *
 * This module provides the GraphicsBackend implementation using Three.js.
 * It creates and manages:
 * - WebGL renderer (via DocumentRenderer)
 * - World renderer (via WorldRendererThree - to be implemented)
 * - Scene management
 * - Camera updates
 */

import * as THREE from 'three'
import { Vec3 } from 'vec3'
import type {
  GraphicsBackend,
  GraphicsBackendLoader,
  GraphicsInitOptions,
  DisplayWorldOptions,
  SoundSystem
} from '../types'
import { DocumentRenderer, ThreeRendererMainData, isWebWorker } from './documentRenderer'

// Enable Three.js in global scope for debugging
;(globalThis as any).THREE = THREE
// Disable Three.js color management for compatibility
THREE.ColorManagement.enabled = false

/**
 * Creates the base graphics backend with core functionality.
 */
export const createGraphicsBackendBase = () => {
  let initOptions: GraphicsInitOptions
  let documentRenderer: DocumentRenderer | null = null

  const init = (initOptionsArg: GraphicsInitOptions, mainData?: ThreeRendererMainData) => {
    initOptions = initOptionsArg
    documentRenderer = new DocumentRenderer(initOptions, mainData?.canvas)
    ;(globalThis as any).renderer = documentRenderer.renderer
    ;(globalThis as any).documentRenderer = documentRenderer
  }

  const startPanorama = async () => {
    if (!documentRenderer) throw new Error('Document renderer not initialized')
    // Panorama rendering would go here
    console.log('[GraphicsBackend] Panorama rendering not yet implemented in library')
  }

  const startWorld = async (displayOptionsArg: DisplayWorldOptions) => {
    if (!documentRenderer) throw new Error('Document renderer not initialized')

    // World renderer would be created here
    // For now, we just set up the basic scene
    console.log('[GraphicsBackend] Starting world with version:', displayOptionsArg.version)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(initOptions.config.sceneBackground)

    // Add basic lighting
    const ambientLight = new THREE.AmbientLight(0xcccccc)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5)
    directionalLight.position.set(1, 1, 0.5).normalize()
    scene.add(directionalLight)

    // Create camera
    const size = documentRenderer.renderer.getSize(new THREE.Vector2())
    const camera = new THREE.PerspectiveCamera(75, size.x / size.y, 0.1, 1000)
    scene.add(camera)

    // Store references
    ;(globalThis as any).scene = scene
    ;(globalThis as any).camera = camera

    // Set up render callback
    documentRenderer.render = (sizeChanged: boolean) => {
      if (sizeChanged) {
        const newSize = documentRenderer!.renderer.getSize(new THREE.Vector2())
        camera.aspect = newSize.width / newSize.height
        camera.updateProjectionMatrix()
      }
      documentRenderer!.renderer.render(scene, camera)
    }

    documentRenderer.inWorldRenderingConfig = displayOptionsArg.inWorldRenderingConfig
  }

  const disconnect = () => {
    if (documentRenderer) {
      documentRenderer.dispose()
      documentRenderer = null
    }
  }

  const backend: GraphicsBackend = {
    id: 'threejs',
    displayName: `three.js ${THREE.REVISION}`,
    startPanorama,
    startWorld,
    disconnect,
    setRendering(rendering) {
      documentRenderer?.setPaused(!rendering)
    },
    getDebugOverlay: () => ({}),
    updateCamera(pos: Vec3 | null, yaw: number, pitch: number) {
      const camera = (globalThis as any).camera as THREE.PerspectiveCamera
      if (!camera) return

      if (pos) {
        camera.position.set(pos.x, pos.y, pos.z)
      }

      // Apply rotation (yaw and pitch)
      camera.rotation.order = 'YXZ'
      camera.rotation.y = yaw
      camera.rotation.x = pitch
    },
    get soundSystem(): SoundSystem | undefined {
      return undefined // Sound system not yet implemented
    },
    get backendMethods() {
      return {}
    }
  }

  return {
    main: {
      init,
      backend
    }
  }
}

/**
 * Creates a Three.js graphics backend loader.
 */
const createGraphicsBackend: GraphicsBackendLoader = (initOptions: GraphicsInitOptions): GraphicsBackend => {
  const { main } = createGraphicsBackendBase()
  main.init(initOptions)
  return main.backend
}

createGraphicsBackend.id = 'threejs'

export default createGraphicsBackend
export { createGraphicsBackend }
