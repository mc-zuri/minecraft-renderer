/**
 * Shared WorldView types used by both main thread and mesher worker.
 */

import { Vec3 } from 'vec3'

/** Chunk position key format: "x,z" e.g. "16,16" */
export type ChunkPosKey = string

/** Chunk position object */
export type ChunkPos = { x: number; z: number }

/** World size parameters sent with chunk data */
export interface WorldSizeParams {
  minY: number
  worldHeight: number
}

/** Block update event data */
export interface BlockUpdateData {
  pos: Vec3
  stateId: number
}

/** Chunk load event data */
export interface LoadChunkData {
  x: number
  z: number
  chunk: string
  blockEntities: any
  worldConfig: WorldSizeParams
  isLightUpdate: boolean
}

/** Chunk unload event data */
export interface UnloadChunkData {
  x: number
  z: number
}

/** Biome update event data */
export interface BiomeUpdateData {
  biome: any
}

/**
 * WorldView events emitted to the renderer.
 */
export type WorldViewEvents = {
  chunkPosUpdate: (data: { pos: Vec3 }) => void
  blockUpdate: (data: BlockUpdateData) => void
  entity: (data: any) => void
  entityMoved: (data: any) => void
  playerEntity: (data: any) => void
  time: (data: number) => void
  renderDistance: (viewDistance: number) => void
  blockEntities: (data: Record<string, any> | { blockEntities: Record<string, any> }) => void
  markAsLoaded: (data: ChunkPos) => void
  unloadChunk: (data: UnloadChunkData) => void
  loadChunk: (data: LoadChunkData) => void
  updateLight: (data: { pos: Vec3 }) => void
  onWorldSwitch: () => void
  end: () => void
  biomeUpdate: (data: BiomeUpdateData) => void
  biomeReset: () => void
}
