/**
 * ResourcesManager - Manages Minecraft assets, textures, and block data.
 *
 * Handles loading and managing:
 * - Block and item atlases
 * - Block states and models
 * - Custom textures from resource packs
 * - Item rendering
 */

import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'

// ============================================================================
// Types
// ============================================================================

export type ResourceManagerEvents = {
  assetsTexturesUpdated: () => void
  assetsInventoryStarted: () => void
  assetsInventoryReady: () => void
}

export interface ResourcesCurrentConfig {
  version: string
  texturesVersion?: string
  noInventoryGui?: boolean
  includeOnlyBlocks?: string[]
}

export interface UpdateAssetsRequest {
  _?: false
}

export interface ResourcesManagerTransferred extends TypedEmitter<ResourceManagerEvents> {
  currentResources: LoadedResourcesTransferrable
}

export interface ResourcesManagerCommon extends TypedEmitter<ResourceManagerEvents> {
  currentResources: LoadedResourcesTransferrable | undefined
}

// ============================================================================
// LoadedResourcesTransferrable
// ============================================================================

export class LoadedResourcesTransferrable {
  allReady = false

  // Atlas data
  itemsAtlasImage?: ImageBitmap
  blocksAtlasImage?: ImageBitmap
  blocksAtlasJson?: any

  // User data (specific to current resourcepack/version)
  customBlockStates?: Record<string, any>
  customModels?: Record<string, any>
  /** Array where the index represents the custom model data value */
  customItemModelNames: Record<string, string[]> = {}
  customTextures: {
    items?: { tileSize: number | undefined; textures: Record<string, HTMLImageElement> }
    blocks?: { tileSize: number | undefined; textures: Record<string, HTMLImageElement> }
    armor?: { tileSize: number | undefined; textures: Record<string, HTMLImageElement> }
  } = {}

  guiAtlas: { json: any; image: ImageBitmap } | null = null
  guiAtlasVersion = 0

  itemsRenderer?: any
  worldBlockProvider?: any
  blockstatesModels: any = null

  version?: string
  texturesVersion?: string

  // Item definitions
  sourceItemDefinitionsJson?: any
  itemsDefinitionsStore?: any

  constructor(data?: any) {
    if (data) {
      Object.assign(this, data)
    }
  }

  prepareForTransfer(): this {
    delete this.itemsRenderer
    delete this.worldBlockProvider
    this.customTextures = {}
    return this
  }
}

// ============================================================================
// ResourcesManager
// ============================================================================

const STABLE_MODELS_VERSION = '1.21.4'

export class ResourcesManager extends (EventEmitter as new () => TypedEmitter<ResourceManagerEvents>) {
  static restorerName = 'ResourcesManager'

  /**
   * Restore a ResourcesManager from transferred data in a worker.
   */
  static restoreTransferred(data: any, worker?: Worker): ResourcesManager {
    const resourcesManager = new ResourcesManager()

    const upResources = (data: any) => {
      resourcesManager.currentResources = new LoadedResourcesTransferrable(data)
    }
    upResources(data.currentResources)

    if (worker) {
      worker.addEventListener('message', ({ data }) => {
        if (data.class === ResourcesManager.restorerName) {
          if (data.type === 'newResources') {
            console.log('[worker] got new resources')
            upResources(data.currentResources)
          }
          if (data.type === 'event') {
            resourcesManager.emit(data.eventName, ...data.args)
          }
        }
      })
    }
    return resourcesManager
  }

  // Source data (imported, not changing)
  sourceBlockStatesModels: any = null
  sourceBlocksAtlases: any = null
  sourceItemsAtlases: any = null

  currentResources: LoadedResourcesTransferrable | undefined
  itemsAtlasParser?: any
  blocksAtlasParser?: any
  currentConfig: ResourcesCurrentConfig | undefined
  abortController = new AbortController()

  private _promiseAssetsReadyResolvers = Promise.withResolvers<void>()

  get promiseAssetsReady(): Promise<void> {
    return this._promiseAssetsReadyResolvers.promise
  }

  /**
   * Prepare this ResourcesManager for transfer to a worker thread.
   */
  prepareForTransfer(worker?: Worker): { __restorer: string; currentResources: LoadedResourcesTransferrable | undefined } {
    if (worker) {
      const oldEmit = this.emit.bind(this) as any
      this.emit = ((eventName: keyof ResourceManagerEvents, ...args: any[]) => {
        oldEmit(eventName, ...args)
        worker.postMessage({
          class: ResourcesManager.restorerName,
          type: 'event',
          eventName,
          args,
        })
        if (eventName === 'assetsTexturesUpdated' || eventName === 'assetsInventoryReady') {
          worker.postMessage({
            class: ResourcesManager.restorerName,
            type: 'newResources',
            currentResources: this.currentResources?.prepareForTransfer(),
          })
        }
      }) as any
    }
    return {
      __restorer: ResourcesManager.restorerName,
      currentResources: this.currentResources?.prepareForTransfer(),
    }
  }

  /**
   * Load source data for a specific version.
   */
  async loadSourceData(version: string): Promise<void> {
    // Override this in app-specific implementation to load mc-assets data
  }

  resetResources(): void {
    this.currentResources = new LoadedResourcesTransferrable()
  }

  /**
   * Update assets data for the current config.
   */
  async updateAssetsData(request: UpdateAssetsRequest, unstableSkipEvent = false): Promise<void> {
    if (!this.currentConfig) throw new Error('No config loaded')

    this._promiseAssetsReadyResolvers = Promise.withResolvers()
    const abortController = new AbortController()

    await this.loadSourceData(this.currentConfig.version)
    if (abortController.signal.aborted) return

    const resources = this.currentResources ?? new LoadedResourcesTransferrable()
    resources.version = this.currentConfig.version
    resources.texturesVersion = this.currentConfig.texturesVersion ?? resources.version

    resources.blockstatesModels = {
      blockstates: {},
      models: {}
    }

    resources.blockstatesModels.blockstates.latest = {
      ...this.sourceBlockStatesModels?.blockstates?.latest,
      ...resources.customBlockStates
    }

    resources.blockstatesModels.models.latest = {
      ...this.sourceBlockStatesModels?.models?.latest,
      ...resources.customModels
    }

    if (abortController.signal.aborted) return

    // Override recreateBlockAtlas and recreateItemsAtlas in app-specific implementation
    await Promise.all([
      this.recreateBlockAtlas(resources),
      this.recreateItemsAtlas(resources)
    ])

    if (abortController.signal.aborted) return

    this.currentResources = resources
    resources.allReady = true

    if (!unstableSkipEvent) {
      this.emit('assetsTexturesUpdated')
    }

    if (this.currentConfig.noInventoryGui) {
      this._promiseAssetsReadyResolvers.resolve()
    } else {
      this.emit('assetsInventoryStarted')
      void this.generateGuiTextures().then(() => {
        if (abortController.signal.aborted) return
        if (!unstableSkipEvent) {
          this.emit('assetsInventoryReady')
        }
        this._promiseAssetsReadyResolvers.resolve()
      })
    }
  }

  /**
   * Override in app-specific implementation to recreate block atlas.
   */
  async recreateBlockAtlas(resources: LoadedResourcesTransferrable): Promise<void> {
    // Override this in app-specific implementation
  }

  /**
   * Override in app-specific implementation to recreate items atlas.
   */
  async recreateItemsAtlas(resources: LoadedResourcesTransferrable): Promise<void> {
    // Override this in app-specific implementation
  }

  /**
   * Override in app-specific implementation to generate GUI textures.
   */
  async generateGuiTextures(): Promise<void> {
    // Override this in app-specific implementation
  }

  destroy(): void {
    this.abortController.abort()
    this.currentResources = undefined
    this.abortController = new AbortController()
  }
}
