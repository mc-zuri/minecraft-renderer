/**
 * Three.js Graphics Backend
 *
 * This module provides the Three.js WebGL implementation for the Minecraft renderer.
 */

// Main backend
export { default as createGraphicsBackend, createGraphicsBackendBase } from './graphicsBackend'

// Core components
export { DocumentRenderer, addCanvasForWorker, isWebWorker } from './documentRenderer'
export type { ThreeRendererMainData } from './documentRenderer'

// World geometry
export { WorldGeometryHandler, estimateGeometryMemoryUsage, disposeObject } from './worldGeometryHandler'
export type { WorldGeometryHandlerOptions, SectionObject } from './worldGeometryHandler'

// Visual effects
export { StarField } from './starField'
export type { StarFieldOptions } from './starField'
