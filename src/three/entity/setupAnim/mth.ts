/**
 * The game's float math, as the models' animation code computes it: every operation rounded to a float (Math.fround,
 * `f` here) where Java rounds it, and Mth.sin / Mth.cos read from the game's 65536 entry table, so a pose comes out as
 * the game's to the last bit of the table lookup.
 */

export const f = Math.fround

export const PI = f(Math.PI) // 3.1415927F
export const HALF_PI = f(Math.PI / 2) // 1.5707964F
export const TWO_PI = f(Math.PI * 2) // 6.2831855F
export const DEG_TO_RAD = f(Math.PI / 180) // 0.017453292F
export const RAD_TO_DEG = f(180 / Math.PI) // 57.295776F

let doubleTable: Float32Array | undefined
let floatTable: Float32Array | undefined

/** 1.21.11 on: SIN[i] = (float) Math.sin(i / 10430.378350470453), read at (long) (x * 10430.378350470453) & 65535. */
const tableOfDoubles = () => {
  if (!doubleTable) {
    doubleTable = new Float32Array(65_536)
    for (let i = 0; i < 65_536; i++) doubleTable[i] = Math.sin(i / 10_430.378_350_470_453)
  }
  return doubleTable
}

/** Before 1.21.11: SIN[i] = (float) Math.sin(i * PI * 2 / 65536), read at (int) (x * 10430.378F) & 65535 (float math). */
const tableOfFloats = () => {
  if (!floatTable) {
    floatTable = new Float32Array(65_536)
    for (let i = 0; i < 65_536; i++) floatTable[i] = Math.sin((i * Math.PI * 2) / 65_536)
  }
  return floatTable
}

const SCALE_F = f(10_430.378)

/** Java's (int) cast of a float: toward zero, saturating. */
const toInt = (value: number) => {
  if (Number.isNaN(value)) return 0
  if (value >= 2_147_483_647) return 2_147_483_647
  if (value <= -2_147_483_648) return -2_147_483_648
  return Math.trunc(value)
}

export type SinCos = { sin: (x: number) => number; cos: (x: number) => number }

/** Mth.sin(double) of 1.21.11 on (the argument is the float the model computed, widened). */
export const doubleSinCos: SinCos = {
  sin: x => {
    const index = Math.trunc(x * 10_430.378_350_470_453)
    return tableOfDoubles()[((index % 65_536) + 65_536) % 65_536]!
  },
  cos: x => {
    const index = Math.trunc(x * 10_430.378_350_470_453 + 16_384)
    return tableOfDoubles()[((index % 65_536) + 65_536) % 65_536]!
  }
}

/** Mth.sin(float) before 1.21.11 (and MathHelper.sin of 1.8). */
export const floatSinCos: SinCos = {
  sin: x => tableOfFloats()[toInt(f(f(x) * SCALE_F)) & 65_535]!,
  cos: x => tableOfFloats()[toInt(f(f(f(x) * SCALE_F) + 16_384)) & 65_535]!
}

export const sqrt = (x: number) => f(Math.sqrt(x))
export const abs = Math.abs
export const clamp = (value: number, min: number, max: number) => (value < min ? min : Math.min(value, max))
export const lerp = (delta: number, from: number, to: number) => f(from + f(delta * f(to - from)))
export const clampedLerp = (delta: number, from: number, to: number) => (delta < 0 ? from : delta > 1 ? to : lerp(delta, from, to))
export const inverseLerp = (value: number, min: number, max: number) => f(f(value - min) / f(max - min))
export const square = (x: number) => f(x * x)
export const cube = (x: number) => f(f(x * x) * x)

/** Java's float remainder: the sign of the dividend. */
export const rem = (a: number, b: number) => f(a % b)

export const wrapDegrees = (angle: number) => {
  let wrapped = rem(angle, 360)
  if (wrapped >= 180) wrapped = f(wrapped - 360)
  if (wrapped < -180) wrapped = f(wrapped + 360)
  return wrapped
}

export const rotLerp = (delta: number, from: number, to: number) => f(from + f(delta * wrapDegrees(f(to - from))))

export const rotLerpRad = (delta: number, from: number, to: number) => {
  let diff = f(to - from)
  while (diff < -PI) diff = f(diff + TWO_PI)
  while (diff >= PI) diff = f(diff - TWO_PI)
  return f(from + f(delta * diff))
}

export const triangleWave = (index: number, period: number) => f(f(Math.abs(f(rem(index, period) - f(period * 0.5))) - f(period * 0.25)) / f(period * 0.25))

/** net.minecraft.util.Ease, as the models use it. */
export const makeEase = ({ cos }: SinCos) => ({
  inOutSine: (x: number) => f(f(-f(cos(f(PI * x)) - 1)) / 2),
  outBack: (x: number) => f(f(1 + f(f(2.701_58) * cube(f(x - 1)))) + f(f(1.701_58) * square(f(x - 1)))),
  outQuart: (x: number) => f(1 - square(square(f(1 - x)))),
  outCubic: (x: number) => f(1 - cube(f(1 - x))),
  inOutExpo: (x: number) => (x < 0.5 ? (x === 0 ? 0 : f(2 ** (20 * x - 10) / 2)) : x === 1 ? 1 : f((2 - 2 ** (-20 * x + 10)) / 2)),
  inQuad: (x: number) => f(x * x),
  outCirc: (x: number) => f(Math.sqrt(f(1 - square(f(x - 1))))),
  inOutElastic: (x: number) => {
    if (x === 0) return 0
    if (x === 1) return 1
    const sin = Math.sin((20 * x - 11.125) * 1.396_263_480_186_462_4)
    return x < 0.5 ? f(-(2 ** (20 * x - 10) * sin) / 2) : f((2 ** (-20 * x + 10) * sin) / 2 + 1)
  },
  inCirc: (x: number) => f(f(-Math.sqrt(f(1 - f(x * x)))) + 1),
  inOutBack: (x: number) => {
    if (x < 0.5) return f(f(f(f(4 * x) * x) * f(f(f(7.189_819) * x) - f(2.594_909_4))) / 2)
    const dt = f(f(2 * x) - 2)
    return f(f(f(f(dt * dt) * f(f(f(3.594_909_4) * dt) + f(2.594_909_4))) + 2) / 2)
  }
})
