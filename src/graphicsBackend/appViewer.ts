/**
 * AppViewer - Base application viewer for Minecraft renderer.
 *
 * This is the main entry point for integrating the renderer into an application.
 * It manages:
 * - Graphics backend loading and lifecycle
 * - World view management
 * - Player state
 * - Renderer state
 */

import { Vec3 } from 'vec3'
import { proxy } from 'valtio'
import type {
  GraphicsBackend,
  GraphicsBackendConfig,
  GraphicsBackendLoader,
  GraphicsInitOptions,
  DisplayWorldOptions,
  WorldRendererConfig,
  RendererReactiveState,
  NonReactiveState,
  PlayerStateReactive,
  ResourcesManagerLike,
  WorldViewLike
} from './types'
import { WorldView, WorldProvider } from '../worldView'
import { getInitialPlayerState } from './playerState'
import { defaultWorldRendererConfig, defaultGraphicsBackendConfig, getDefaultRendererState } from './config'

export interface AppViewerOptions {
  config?: Partial<GraphicsBackendConfig>
  rendererConfig?: Partial<WorldRendererConfig>
}

/**
 * AppViewer - Main application viewer class.
 *
 * This is designed to be extended for specific use cases (game client, playground, etc.)
 */
export class AppViewer {
  waitBackendLoadPromises: Promise<void>[] = []

  // Resources manager - must be provided by implementation
  resourcesManager?: ResourcesManagerLike

  // World view
  worldView?: WorldView

  // Configuration
  readonly config: GraphicsBackendConfig
  readonly inWorldRenderingConfig: WorldRendererConfig

  // Backend
  backend?: GraphicsBackend
  backendLoader?: GraphicsBackendLoader
  private currentState?: {
    method: string
    args: any[]
  }

  // Display state
  currentDisplay: 'menu' | 'world' | null = null

  // Player state
  playerState = {
    reactive: getInitialPlayerState()
  }

  // Renderer state
  rendererState: RendererReactiveState
  nonReactiveState: NonReactiveState

  // World ready promise
  worldReady!: Promise<void>
  private resolveWorldReady!: () => void

  constructor(options: AppViewerOptions = {}) {
    this.config = {
      ...defaultGraphicsBackendConfig,
      ...options.config
    }

    this.inWorldRenderingConfig = proxy({
      ...defaultWorldRendererConfig,
      ...options.rendererConfig
    })

    const defaultState = getDefaultRendererState()
    this.rendererState = defaultState.reactive
    this.nonReactiveState = defaultState.nonReactive

    this.initWorldReadyPromise()
  }

  private initWorldReadyPromise(): void {
    const { promise, resolve } = Promise.withResolvers<void>()
    this.worldReady = promise
    this.resolveWorldReady = resolve
  }

  /**
   * Load a graphics backend.
   */
  async loadBackend(loader: GraphicsBackendLoader): Promise<void> {
    if (this.backend) {
      this.disconnectBackend()
    }

    await Promise.all(this.waitBackendLoadPromises)
    this.waitBackendLoadPromises = []

    this.backendLoader = loader

    const loaderOptions: GraphicsInitOptions = {
      resourcesManager: this.resourcesManager!,
      config: this.config,
      callbacks: {
        displayCriticalError: (error) => {
          console.error('[AppViewer] Critical error:', error)
        },
        setRendererSpecificSettings: (key, value) => {
          // Override in implementation
        },
        fireCustomEvent: (eventName, ...args) => {
          // Override in implementation
        }
      },
      rendererSpecificSettings: {}
    }

    this.backend = loader(loaderOptions)

    // Execute queued action if exists
    if (this.currentState) {
      if (this.currentState.method === 'startPanorama') {
        this.startPanorama()
      } else {
        const { method, args } = this.currentState
          ; (this.backend as any)[method](...args)
      }
    }
  }

  /**
   * Start the world with a given world provider and render distance.
   */
  async startWorld(
    world: WorldProvider,
    renderDistance: number,
    playerStateReactive: PlayerStateReactive = this.playerState.reactive,
    startPosition?: Vec3
  ): Promise<boolean> {
    if (this.currentDisplay === 'world') {
      throw new Error('World already started')
    }

    this.currentDisplay = 'world'
    const finalStartPosition = startPosition ?? new Vec3(0, 64, 0)

    this.worldView = new WorldView(world, renderDistance, finalStartPosition)
    this.worldView.isPlayground = this.inWorldRenderingConfig.isPlayground

    const displayWorldOptions: DisplayWorldOptions = {
      version: this.resourcesManager?.currentConfig?.version ?? '1.20.4',
      worldView: this.worldView as unknown as WorldViewLike,
      inWorldRenderingConfig: this.inWorldRenderingConfig,
      playerStateReactive,
      rendererState: this.rendererState,
      nonReactiveState: this.nonReactiveState
    }

    let promise: Promise<void> | undefined
    if (this.backend) {
      const result = this.backend.startWorld(displayWorldOptions)
      if (result && typeof result.then === 'function') {
        promise = result
      }
    }

    this.currentState = { method: 'startWorld', args: [displayWorldOptions] }

    await promise
    this.resolveWorldReady()
    return !!promise
  }

  /**
   * Start panorama display (menu background).
   */
  startPanorama(): void {
    if (this.currentDisplay === 'menu') return

    if (this.backend) {
      this.currentDisplay = 'menu'
      this.backend.startPanorama()
    }

    this.currentState = { method: 'startPanorama', args: [] }
  }

  /**
   * Reset the backend.
   */
  resetBackend(cleanState = false): void {
    this.disconnectBackend(cleanState)
    if (this.backendLoader) {
      void this.loadBackend(this.backendLoader)
    }
  }

  /**
   * Disconnect the backend.
   */
  disconnectBackend(cleanState = false): void {
    if (cleanState) {
      this.currentState = undefined
      this.currentDisplay = null
      this.worldView = undefined
    }

    if (this.backend) {
      this.backend.disconnect()
      this.backend = undefined
    }

    this.currentDisplay = null
    this.initWorldReadyPromise()
    this.rendererState = proxy(getDefaultRendererState().reactive)
    this.nonReactiveState = getDefaultRendererState().nonReactive
  }

  /**
   * Update camera position and rotation.
   */
  updateCamera(pos: Vec3 | null, yaw: number, pitch: number): void {
    this.backend?.updateCamera(pos, yaw, pitch)
  }

  /**
   * Set rendering active/paused.
   */
  setRendering(rendering: boolean): void {
    this.backend?.setRendering(rendering)
  }

  /**
   * Destroy the viewer and cleanup resources.
   */
  destroy(): void {
    this.disconnectBackend(true)
  }
}
