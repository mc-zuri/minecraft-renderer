/**
 * Renderer Module System Types
 *
 * Modules are self-contained renderer extensions that can be enabled/disabled
 * and configured through a standardized interface.
 */

import * as THREE from 'three'

/**
 * Setting value types supported by modules.
 */
export type SettingValue = boolean | number | string | number[]

/**
 * Setting definition for a module.
 */
export interface ModuleSetting<T extends SettingValue = SettingValue> {
  /** Default value for the setting */
  default: T
  /** Human-readable label for UI */
  label?: string
  /** Description of the setting */
  description?: string
  /** Minimum value (for number settings) */
  min?: number
  /** Maximum value (for number settings) */
  max?: number
  /** Step value (for number settings) */
  step?: number
  /** Available options (for string settings) */
  options?: string[]
}

/**
 * Module settings schema.
 */
export type ModuleSettingsSchema = Record<string, ModuleSetting>

/**
 * Infer settings object type from schema.
 */
export type InferSettings<T extends ModuleSettingsSchema> = {
  [K in keyof T]: T[K]['default']
}

/**
 * Module manifest - describes a renderer module's identity and configuration.
 */
export interface ModuleManifest<TSettings extends ModuleSettingsSchema = ModuleSettingsSchema> {
  /** Unique identifier for the module */
  id: string
  /** Human-readable name */
  name: string
  /** Brief description */
  description?: string
  /** Module version */
  version?: string
  /** Settings schema for this module */
  settings: TSettings
}

/**
 * Module context provided to modules during initialization.
 */
export interface ModuleContext {
  /** The Three.js scene */
  scene: THREE.Scene
  /** Get the current camera position */
  getCameraPosition: () => THREE.Vector3
  /** Register a callback to be called each frame */
  onRender: (callback: () => void) => void
  /** Unregister a render callback */
  offRender: (callback: () => void) => void
}

/**
 * Base interface for renderer modules.
 */
export interface RendererModule<TSettings extends ModuleSettingsSchema = ModuleSettingsSchema> {
  /** Module manifest */
  readonly manifest: ModuleManifest<TSettings>

  /** Current settings values */
  readonly settings: InferSettings<TSettings>

  /** Whether the module is currently enabled */
  enabled: boolean

  /** Initialize the module with context */
  init(context: ModuleContext): void

  /** Update a setting value */
  setSetting<K extends keyof TSettings>(key: K, value: TSettings[K]['default']): void

  /** Called when module is enabled */
  onEnable?(): void

  /** Called when module is disabled */
  onDisable?(): void

  /** Cleanup and dispose resources */
  dispose(): void
}

/**
 * Module factory function type.
 */
export type ModuleFactory<TSettings extends ModuleSettingsSchema = ModuleSettingsSchema> =
  () => RendererModule<TSettings>
