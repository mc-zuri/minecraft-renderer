/** Recent frame exceeded this → `longRenderTime`. */
export const LONG_RENDER_TIME_MS = 30

/** Scene pass without entities faster than this → candidate for entity bottleneck. */
export const FAST_SCENE_WITHOUT_ENTITIES_MS = 20

/** Entity pass slower than this (with low FPS) → `tooManyEntities`. */
export const SLOW_ENTITIES_RENDER_MS = 8

/** FPS at or below this is treated as low performance. */
export const LOW_FPS_THRESHOLD = 45

/** Loaded WebGL textures at or above this → `tooManyTextures` (labels, signs, iOS). */
export const HIGH_TEXTURE_COUNT = 100

/** Ring buffer length for sustained render-time analysis. */
export const RENDER_TIME_HISTORY_SIZE = 24

/** Fraction of recent frames over `LONG_RENDER_TIME_MS` → `constantLongRenderTime`. */
export const CONSTANT_LONG_RENDER_FRACTION = 0.65

/** Minimum frames in history before `constantLongRenderTime` can trigger. */
export const CONSTANT_LONG_RENDER_MIN_SAMPLES = 8
