/**
 * WorldGeometryHandler - Manages world block geometry for Three.js renderer.
 *
 * Responsibilities:
 * - Processing geometry data from mesher workers
 * - Creating and managing THREE.js section objects (chunks)
 * - Handling signs, banners, and player heads rendering
 * - Memory tracking for geometry buffers
 * - GPU upload and CPU array disposal for RAM optimization
 */

import * as THREE from 'three'
import { Vec3 } from 'vec3'
import type { MesherGeometryOutput, WorldRendererConfig } from '../types'

export interface WorldGeometryHandlerOptions {
  material: THREE.MeshLambertMaterial
  scene: THREE.Scene
  worldRendererConfig: WorldRendererConfig
  version: string
  worldSizeParams: { minY: number; worldHeight: number }
  blockEntities: Record<string, any>
}

export interface SectionObject extends THREE.Object3D {
  foutain?: boolean
  tilesCount?: number
  blocksCount?: number
}

/**
 * Estimates GPU buffer memory usage for a BufferGeometry.
 */
export function estimateGeometryMemoryUsage(geometry: THREE.BufferGeometry): number {
  let memoryBytes = 0

  const { attributes } = geometry
  for (const [name, attribute] of Object.entries(attributes)) {
    if (attribute?.array) {
      const bytesPerElement = attribute.array.BYTES_PER_ELEMENT
      memoryBytes += attribute.array.length * bytesPerElement
    }
  }

  if (geometry.index?.array) {
    const bytesPerElement = geometry.index.array.BYTES_PER_ELEMENT
    memoryBytes += geometry.index.array.length * bytesPerElement
  }

  return memoryBytes
}

/**
 * Disposes all child objects recursively.
 */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose()
      if (Array.isArray(child.material)) {
        for (const material of child.material) {
          material.dispose()
        }
      } else {
        child.material?.dispose()
      }
    }
  })
}

/**
 * WorldGeometryHandler - Manages all world geometry in the Three.js scene.
 */
export class WorldGeometryHandler {
  sectionObjects: Record<string, SectionObject> = {}
  private estimatedMemoryUsage = 0

  constructor(private options: WorldGeometryHandlerOptions) {}

  /**
   * Get total estimated memory usage in bytes.
   */
  get memoryUsage(): number {
    return this.estimatedMemoryUsage
  }

  /**
   * Get memory usage in human-readable format.
   */
  getMemoryUsageReadable(): { bytes: number; readable: string } {
    const bytes = this.estimatedMemoryUsage
    const mb = bytes / (1024 * 1024)
    return { bytes, readable: `${mb.toFixed(2)} MB` }
  }

  /**
   * Process geometry data from mesher worker and create section mesh.
   */
  handleGeometry(data: { geometry: MesherGeometryOutput; key: string }): SectionObject | null {
    const { geometry, key } = data
    const { material, scene, worldRendererConfig } = this.options

    // Remove existing section if present
    const existingObject = this.sectionObjects[key]
    if (existingObject) {
      this.removeSectionMemoryUsage(existingObject)
      scene.remove(existingObject)
      disposeObject(existingObject)
      delete this.sectionObjects[key]
    }

    // Don't create empty sections
    if (!geometry.positions.length) {
      return null
    }

    // Create buffer geometry
    const bufferGeometry = new THREE.BufferGeometry()
    const positionAttr = new THREE.BufferAttribute(geometry.positions, 3)
    const normalAttr = new THREE.BufferAttribute(geometry.normals, 3)
    const colorAttr = new THREE.BufferAttribute(geometry.colors, 3)
    const uvAttr = new THREE.BufferAttribute(geometry.uvs, 2)
    const indexAttr = new THREE.BufferAttribute(geometry.indices, 1)

    bufferGeometry.setAttribute('position', positionAttr)
    bufferGeometry.setAttribute('normal', normalAttr)
    bufferGeometry.setAttribute('color', colorAttr)
    bufferGeometry.setAttribute('uv', uvAttr)
    bufferGeometry.index = indexAttr

    // Track memory before disposing CPU arrays
    this.addSectionMemoryUsage(bufferGeometry)

    // Setup GPU upload callbacks to dispose CPU arrays
    this.setupGpuUploadCallbacks(bufferGeometry)

    // Create mesh
    const mesh = new THREE.Mesh(bufferGeometry, material)
    mesh.position.set(geometry.sx, geometry.sy, geometry.sz)
    mesh.name = 'mesh'

    // Create section group
    const sectionObject: SectionObject = new THREE.Group()
    sectionObject.add(mesh)

    // Add debug chunk border helper
    const staticChunkMesh = new THREE.Mesh(
      new THREE.BoxGeometry(16, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 })
    )
    staticChunkMesh.position.set(geometry.sx, geometry.sy, geometry.sz)
    const boxHelper = new THREE.BoxHelper(staticChunkMesh, 0xffff00)
    boxHelper.name = 'helper'
    boxHelper.visible = worldRendererConfig.showChunkBorders
    sectionObject.add(boxHelper)

    sectionObject.name = 'chunk'
    sectionObject.tilesCount = geometry.positions.length / 3 / 4
    sectionObject.blocksCount = geometry.blocksCount
    sectionObject.matrixAutoUpdate = false

    this.sectionObjects[key] = sectionObject
    scene.add(sectionObject)

    return sectionObject
  }

  /**
   * Remove a section from the scene.
   */
  removeSection(key: string): void {
    const object = this.sectionObjects[key]
    if (object) {
      this.removeSectionMemoryUsage(object)
      this.options.scene.remove(object)
      disposeObject(object)
      delete this.sectionObjects[key]
    }
  }

  /**
   * Remove all sections from the scene.
   */
  clear(): void {
    for (const key of Object.keys(this.sectionObjects)) {
      this.removeSection(key)
    }
    this.estimatedMemoryUsage = 0
  }

  /**
   * Update chunk border visibility for all sections.
   */
  updateChunkBorderVisibility(visible: boolean): void {
    for (const object of Object.values(this.sectionObjects)) {
      for (const child of object.children) {
        if (child.name === 'helper') {
          child.visible = visible
        }
      }
    }
  }

  /**
   * Get total tiles rendered across all sections.
   */
  getTilesRendered(): number {
    return Object.values(this.sectionObjects).reduce(
      (acc, obj) => acc + (obj.tilesCount || 0),
      0
    )
  }

  /**
   * Get total blocks rendered across all sections.
   */
  getBlocksRendered(): number {
    return Object.values(this.sectionObjects).reduce(
      (acc, obj) => acc + (obj.blocksCount || 0),
      0
    )
  }

  /**
   * Setup callbacks to dispose CPU arrays after GPU upload.
   */
  private setupGpuUploadCallbacks(geometry: THREE.BufferGeometry): void {
    const { attributes } = geometry
    for (const attributeName of Object.keys(attributes)) {
      const attribute = attributes[attributeName]
      if (attribute instanceof THREE.InterleavedBufferAttribute) continue

      const existingCallback = attribute.onUploadCallback
      attribute.onUploadCallback = () => {
        existingCallback?.()
        this.disposeCpuArray(attribute)
      }
      attribute.needsUpdate = true
    }

    if (geometry.index) {
      const existingCallback = geometry.index.onUploadCallback
      geometry.index.onUploadCallback = () => {
        existingCallback?.()
        this.disposeCpuArray(geometry.index!)
      }
      geometry.index.needsUpdate = true
    }
  }

  /**
   * Dispose CPU array data from buffer attribute.
   */
  private disposeCpuArray(attribute: THREE.BufferAttribute): void {
    if (attribute.array) {
      ;(attribute as any).array = null
    }
  }

  /**
   * Track memory usage when section is added.
   */
  private addSectionMemoryUsage(geometry: THREE.BufferGeometry): void {
    const memoryUsage = estimateGeometryMemoryUsage(geometry)
    this.estimatedMemoryUsage += memoryUsage
  }

  /**
   * Track memory usage when section is removed.
   */
  private removeSectionMemoryUsage(object: THREE.Object3D): void {
    const mesh = object.children.find(child => child.name === 'mesh') as THREE.Mesh
    if (mesh?.geometry) {
      const memoryUsage = estimateGeometryMemoryUsage(mesh.geometry)
      this.estimatedMemoryUsage -= memoryUsage
      this.estimatedMemoryUsage = Math.max(0, this.estimatedMemoryUsage)
    }
  }
}
