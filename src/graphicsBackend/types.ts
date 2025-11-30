/**
 * Graphics Backend Types
 *
 * Core types for the graphics backend system.
 */

import { Vec3 } from 'vec3'

// ============================================================================
// Graphics Backend Configuration
// ============================================================================

/** Graphics backend configuration */
export interface GraphicsBackendConfig {
  fpsLimit?: number
  powerPreference?: 'high-performance' | 'low-power'
  statsVisible?: number
  sceneBackground: string
  timeoutRendering?: boolean
}

// ============================================================================
// World Renderer Configuration
// ============================================================================

/** World renderer configuration */
export interface WorldRendererConfig {
  paused: boolean

  // Debug settings
  showChunkBorders: boolean
  enableDebugOverlay: boolean
  debugModelVariant?: number[]

  // Performance settings
  mesherWorkers: number
  addChunksBatchWaitTime: number
  _experimentalSmoothChunkLoading: boolean
  _renderByChunks: boolean

  // Rendering engine settings
  dayCycle: boolean
  smoothLighting: boolean
  enableLighting: boolean
  starfield: boolean
  defaultSkybox: boolean
  renderEntities: boolean
  extraBlockRenderers: boolean
  foreground: boolean
  fov: number
  volume: number

  // Camera visual related settings
  showHand: boolean
  viewBobbing: boolean
  renderEars: boolean
  highlightBlockColor: string

  // Player models
  fetchPlayerSkins: boolean
  skinTexturesProxy?: string

  // VR settings
  vrSupport: boolean
  vrPageGameRendering: boolean

  // World settings
  clipWorldBelowY?: number
  isPlayground: boolean
  instantCameraUpdate: boolean
}

// ============================================================================
// State Types
// ============================================================================

/** Frame timing event for performance monitoring */
export interface FrameTimingEvent {
  type: 'frameStart' | 'frameEnd' | 'cameraUpdate' | 'frameDisplay'
  timestamp: number
  duration?: number
}

/** Non-reactive state for performance data */
export interface NonReactiveState {
  fps: number
  worstRenderTime: number
  avgRenderTime: number
  world: {
    chunksLoaded: Set<string>
    chunksTotalNumber: number
    allChunksLoaded?: boolean
  }
  renderer: {
    timeline: {
      live: FrameTimingEvent[]
      frozen: FrameTimingEvent[]
      lastSecond: FrameTimingEvent[]
    }
  }
}

/** Renderer reactive state */
export interface RendererReactiveState {
  world: {
    chunksLoaded: Set<string>
    heightmaps: Map<string, Uint8Array>
    allChunksLoaded: boolean
    mesherWork: boolean
    intersectMedia: any | null
  }
  renderer: string
  preventEscapeMenu: boolean
}

// ============================================================================
// Player State Types
// ============================================================================

/** Player state reactive proxy type */
export interface PlayerStateReactive {
  playerSkin?: string
  inWater: boolean
  waterBreathing: boolean
  backgroundColor: [number, number, number]
  ambientLight: number
  directionalLight: number
  eyeHeight: number
  gameMode?: string
  lookingAtBlock?: {
    x: number
    y: number
    z: number
    face?: number
    shapes: any
  }
  diggingBlock?: {
    x: number
    y: number
    z: number
    stage: number
    face?: number
    mergedShape: any
  }
  movementState: string
  onGround: boolean
  sneaking: boolean
  flying: boolean
  sprinting: boolean
  itemUsageTicks: number
  username: string
  onlineMode: boolean
  lightingDisabled: boolean
  shouldHideHand: boolean
  heldItemMain?: any
  heldItemOff?: any
  perspective: string
  onFire: boolean
  cameraSpectatingEntity?: number
  team?: any
}

// ============================================================================
// Graphics Backend Interfaces
// ============================================================================

/** Graphics initialization options */
export interface GraphicsInitOptions<S = any> {
  resourcesManager: ResourcesManagerLike
  config: GraphicsBackendConfig
  rendererSpecificSettings: S
  callbacks: {
    displayCriticalError: (error: Error) => void
    setRendererSpecificSettings: (key: string, value: any) => void
    fireCustomEvent: (eventName: string, ...args: any[]) => void
  }
}

/** Display world options for starting world rendering */
export interface DisplayWorldOptions {
  worldView: WorldViewLike
  playerState?: PlayerStateReactive
  playerStateReactive?: PlayerStateReactive
  rendererState?: RendererReactiveState
  nonReactiveState: NonReactiveState
  inWorldRenderingConfig: WorldRendererConfig
  version: string
  callbacks?: {
    worldReady?: () => void
  }
}

/** Graphics backend interface */
export interface GraphicsBackend {
  id: string
  displayName: string
  startPanorama(): Promise<void>
  startWorld(options: DisplayWorldOptions): Promise<void>
  disconnect(): void
  setRendering(rendering: boolean): void
  updateCamera(pos: Vec3 | null, yaw: number, pitch: number): void
  soundSystem?: any
  backendMethods?: any
  getDebugOverlay?(): { entitiesString?: string }
}

/** Graphics backend loader function type */
export type GraphicsBackendLoader = (initOptions: GraphicsInitOptions) => GraphicsBackend

// ============================================================================
// Resource Manager Interface
// ============================================================================

/** Resources manager interface for type compatibility */
export interface ResourcesManagerLike {
  currentConfig?: {
    version: string
  }
  currentResources?: any
  loadSourceData?(version: string): Promise<void>
  updateAssetsData?(request: any): Promise<void>
  on?(event: string, callback: (...args: any[]) => void): void
}

// ============================================================================
// World View Interface
// ============================================================================

/** World view interface for type compatibility */
export interface WorldViewLike {
  isPlayground?: boolean
  addWaitTime?: number
  loadedChunks: Record<string, boolean>
  init(pos: Vec3): Promise<void>
  setBlockStateId(pos: Vec3, stateId: number): void
  unloadAllChunks(): void
  emit(event: string, ...args: any[]): boolean
  on(event: string, callback: (...args: any[]) => void): void
}
