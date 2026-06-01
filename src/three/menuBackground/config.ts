import type { MenuBackgroundMode } from './types'
import type { FuturisticCameraId, FuturisticSceneId, MinecraftBlockGroupId } from './futuristic'

/** Single source of truth for menu-background defaults (settings + runtime fallbacks). */
export const MENU_BACKGROUND_OPTION_DEFAULTS = {
  mode: 'futuristic' as MenuBackgroundMode,
  minecraftTextures: true as boolean,
  futuristicScene: 'light' as FuturisticSceneId,
  futuristicCamera: 'dive' as FuturisticCameraId,
  futuristicBlockGroup: 'stainedGlass' as MinecraftBlockGroupId,
  /** 0–200 (%). 100 = 1× motion. */
  futuristicCameraSpeedPercent: 80,
  futuristicBlockSpeedPercent: 40
} as const

export const menuBackgroundSpeedToMultiplier = (percent: number) => percent / 100

/** Default camera / block motion multipliers (1 = 100%). */
export const MENU_BACKGROUND_MOTION_DEFAULTS = {
  camera: menuBackgroundSpeedToMultiplier(MENU_BACKGROUND_OPTION_DEFAULTS.futuristicCameraSpeedPercent),
  block: menuBackgroundSpeedToMultiplier(MENU_BACKGROUND_OPTION_DEFAULTS.futuristicBlockSpeedPercent)
} as const
