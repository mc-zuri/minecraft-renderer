import type { EntityAnimInput, EntityAnimTracker, EntityDriver } from '../entityAnimState'
import { clampedLerp, f, lerp } from '../setupAnim/mth'

const versionAtLeast = (version: string, other: string) => {
  const n = (v: string) => v.split('.').reduce((total, part, i) => total + Number(part) * [1_000_000, 1000, 1][i]!, 0)
  return n(version) >= n(other)
}

/**
 * Boats and rafts (AbstractBoat, Boat before 1.21.2): the render state BoatRenderer extracts. Paddles turn by PI/8 a tick
 * while their paddle state holds (the paddle_left / paddle_right synched data and a controlling passenger, or what the
 * client's own boat is paddled with: the boatPaddleLeft / boatPaddleRight render hints), the hurt wobble counts down the
 * hurt and damage data every tick as the client does, and a bubble column rocks the boat (bubble_time, 1.13+).
 */

const PADDLE_STEP = f(Math.PI / 8) // 0.3926991F

type BoatMemory = {
  paddlePositions: [number, number]
  hurtTime: number
  damage: number
  seenHurt?: unknown
  seenDamage?: unknown
  bubbleMultiplier: number
  bubbleAngle: number
  bubbleAngleO: number
}

const memoryOf = (tracker: EntityAnimTracker): BoatMemory => {
  tracker.memory.boat ??= { paddlePositions: [0, 0], hurtTime: 0, damage: 0, bubbleMultiplier: 0, bubbleAngle: 0, bubbleAngleO: 0 } satisfies BoatMemory
  return tracker.memory.boat as BoatMemory
}

/** getPaddleState: the synched paddle state while someone controls the boat; the client's own boat from its input. */
export const boatPaddleState = (input: EntityAnimInput, side: 0 | 1) => {
  const hints = input.renderHints
  if (hints && (hints.boatPaddleLeft !== undefined || hints.boatPaddleRight !== undefined)) return !!(side === 0 ? hints.boatPaddleLeft : hints.boatPaddleRight)
  const value = side === 0 ? input.meta.paddle_left : input.meta.paddle_right
  const passengers = hints?.passengerIds ?? hints?.boatPassengerIds
  return value === true && (!passengers || passengers.length > 0)
}

const numberOf = (value: unknown) => (typeof value === 'number' ? value : 0)

export const boatDriver: EntityDriver = {
  tick(tracker, input) {
    const memory = memoryOf(tracker)
    // synched hurt and damage: the server's value when it changes, counted down every tick like the client's copy
    if (input.meta.hurt !== memory.seenHurt) memory.hurtTime = numberOf((memory.seenHurt = input.meta.hurt))
    else if (memory.hurtTime > 0) memory.hurtTime--
    if (input.meta.damage !== memory.seenDamage) memory.damage = numberOf((memory.seenDamage = input.meta.damage))
    else if (memory.damage > 0) memory.damage = f(memory.damage - 1)
    // tickBubbleColumn (client)
    memory.bubbleMultiplier = Math.min(1, Math.max(0, f(memory.bubbleMultiplier + (numberOf(input.meta.bubble_time) > 0 ? f(0.05) : f(-0.1)))))
    memory.bubbleAngleO = memory.bubbleAngle
    // 1.21.5 on: the boat's own tick count; before, the level's game time (the client's tick count stands in when the
    // client gives no world age: only the rocking's phase differs)
    memory.bubbleAngle = versionAtLeast(input.version, '1.21.5')
      ? f(f(10 * f(Math.sin(0.5 * tracker.tickCount))) * memory.bubbleMultiplier)
      : f(f(10 * f(Math.sin(f(0.5 * f(input.gameTime ?? tracker.tickCount))))) * memory.bubbleMultiplier)
    for (const side of [0, 1] as const) {
      if (boatPaddleState(input, side)) memory.paddlePositions[side] = f(memory.paddlePositions[side] + PADDLE_STEP)
      else memory.paddlePositions[side] = 0
    }
  },
  state(state, tracker, input) {
    const memory = memoryOf(tracker)
    const pt = tracker.partialTick
    const rowing = (side: 0 | 1) => (boatPaddleState(input, side) ? clampedLerp(pt, f(memory.paddlePositions[side] - PADDLE_STEP), memory.paddlePositions[side]) : 0)
    state.yRot = f(180 - (input.bodyYaw * 180) / Math.PI)
    state.hurtTime = f(memory.hurtTime - pt)
    state.hurtDir = numberOf(input.meta.hurtdir) || 1
    state.damageTime = Math.max(f(memory.damage - pt), 0)
    state.bubbleAngle = lerp(pt, memory.bubbleAngleO, memory.bubbleAngle)
    // a remote boat's water status is not sent; only the bubble column rocking reads it, and a boat rocks at the surface
    state.isUnderWater = false
    state.rowingTimeLeft = rowing(0)
    state.rowingTimeRight = rowing(1)
  }
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']

/** Every boat and raft: the boats of 1.9 to 1.21.1 (boat, chest_boat), then one per wood (bamboo rafts). */
export const BOAT_NAMES = ['boat', 'chest_boat', ...WOODS.flatMap(wood => [`${wood}_boat`, `${wood}_chest_boat`]), 'bamboo_raft', 'bamboo_chest_raft']

export const BOATS_DRIVERS: Record<string, EntityDriver> = Object.fromEntries(BOAT_NAMES.map(name => [name, boatDriver]))
