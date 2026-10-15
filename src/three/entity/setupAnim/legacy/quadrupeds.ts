import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, f, lerp } from '../mth'

/**
 * QuadruPedEntityModel and the animals built on it (cows, pigs, sheep, polar bears, llamas, 1.13.2's turtle), the llama
 * spit and the horses (HorseBaseEntityModel, 1.13.2's class_4180 / class_4182), 1.8.9 - 1.13.2 with legacy Yarn names:
 * animateModel(entity, limbAngle, limbDistance, tickDelta) then setAngles(limbAngle, limbDistance, age, headYaw,
 * headPitch, scale, entity). Part names are the model's fields (head, torso, back_right_leg..., field_6415...).
 *
 * State: walkAnimationPos, walkAnimationSpeed, ageInTicks, yRot (headYaw), xRot (headPitch), partialTick, data.<index>
 * (DataTracker ids, per version below) and entity.<field> (legacy Yarn field names). Entity fields the renderer must
 * provide (absent: the value of a fresh entity, 0 / false):
 * - every model: entity.ticksAlive (polar bears, horses), entity.pitch / entity.prevPitch (the entity's own pitch: sheep,
 *   horses; not the head pitch);
 * - sheep: entity.eatGrassTimer;
 * - polar bears: entity.field_15033 (previous stand animation), entity.field_15034 (stand animation);
 * - horses: entity.bodyYaw / prevBodyYaw, entity.headYaw / prevHeadYaw, the animation progresses (1.8.9 - 1.10.2:
 *   entity.eatingGrassAnimationProgress, angryAnimationProgress, eatingAnimationProgress and their last*; 1.11+:
 *   entity.field_15502 / field_15503 (eating grass, last), field_15504 / field_15505 (angry), field_15506 / field_15507
 *   (eating)), the tail counter (entity.field_6897, 1.11+ entity.field_15509), the rider (1.8.9 entity.rider, 1.9+
 *   entity.hasPassengers: truthy when ridden), 1.13.2 entity.touchingWater;
 * - 1.13.2 turtles: entity.touchingWater, entity.onGround.
 */

/** A DataTracker value by its id, or the tracked default when the state has none. */
const data = (state: AnimState, index: number, fallback: unknown): any => {
  const value = state[`data.${index}`]
  return value === undefined || value === null ? fallback : value
}

/** An entity field, or its default when absent. */
const entity = <T>(state: AnimState, name: string, fallback: T): T => {
  const value = state[`entity.${name}`]
  return value === undefined || value === null ? fallback : (value as T)
}

/** 1.8.9's `180.0F / (float) Math.PI` (a folded float constant): degrees were divided by it */
const DEGREES_PER_RADIAN = f(180 / f(Math.PI))

/** AbstractHorseEntity's flags byte (saddled = 4): its DataTracker id per version */
const horseFlagsIndex = (model: AnimModel) => (model.c.atLeast('1.10') ? 13 : model.c.atLeast('1.9') ? 12 : 16)

/**
 * EntityModel: setupAnim = resetPose (every sample starts from the initial pose), animateModel(entity, limbAngle,
 * limbDistance, tickDelta), then setAngles(limbAngle, limbDistance, age, headYaw, headPitch, scale, entity).
 */
class EntityModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    // the render arguments a sample leaves out are 0
    const full = { walkAnimationPos: 0, walkAnimationSpeed: 0, ageInTicks: 0, yRot: 0, xRot: 0, partialTick: 0, ...state }
    this.animateModel(full)
    this.setAngles(full)
  }

  animateModel(_state: AnimState) {}

  setAngles(_state: AnimState) {}

  /** degrees to radians as the version wrote it: 1.8.9 `x / (180.0F / (float) Math.PI)`, 1.9+ `x * (float) (Math.PI / 180.0)` */
  toRadians(degrees: number) {
    return this.c.atLeast('1.9') ? f(degrees * DEG_TO_RAD) : f(degrees / DEGREES_PER_RADIAN)
  }
}

export class QuadruPedEntityModel extends EntityModel {
  head = this.part('head')
  torso = this.part('torso')
  backRightLeg = this.part('back_right_leg')
  backLeftLeg = this.part('back_left_leg')
  frontRightLeg = this.part('front_right_leg')
  frontLeftLeg = this.part('front_left_leg')

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const handSwing = state.walkAnimationPos as number
    const handSwingAmount = state.walkAnimationSpeed as number
    this.head.xRot = this.toRadians(state.xRot)
    this.head.yRot = this.toRadians(state.yRot)
    this.torso.xRot = HALF_PI
    this.backRightLeg.xRot = f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount)
    this.backLeftLeg.xRot = f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount)
    this.frontRightLeg.xRot = f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount)
    this.frontLeftLeg.xRot = f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount)
  }
}

/** CowEntityModel (1.8.9 - 1.12.2) and 1.13.2's class_4184: QuadruPedEntityModel's animation */
export class CowEntityModel extends QuadruPedEntityModel {}

export class PigEntityModel extends QuadruPedEntityModel {}

/** LlamaEntityModel (1.11+): QuadruPedEntityModel's animation (the chests show in render) */
export class LlamaEntityModel extends QuadruPedEntityModel {}

/** SheepEntity.method_2864(tickDelta): the head's eating position */
const headEatPosition = (state: AnimState) => {
  const timer = entity(state, 'eatGrassTimer', 0)
  const tickDelta = state.partialTick as number
  if (timer <= 0) return 0
  if (timer >= 4 && timer <= 36) return 1
  return timer < 4 ? f(f(timer - tickDelta) / 4) : f(-f(f(timer - 40) - tickDelta) / 4)
}

/** SheepEntity.method_2865(tickDelta): the head's eating angle (the entity's own pitch when not eating) */
const headEatAngle = (model: EntityModel, state: AnimState) => {
  const timer = entity(state, 'eatGrassTimer', 0)
  if (timer > 4 && timer <= 36) {
    const g = f(f(f(timer - 4) - state.partialTick) / 32)
    return f(f(Math.PI / 5) + f(f(0.219_911_49) * model.c.sin(f(g * f(28.7)))))
  }
  return timer > 0 ? f(Math.PI / 5) : model.toRadians(entity(state, 'pitch', 0))
}

export class SheepEntityModel extends QuadruPedEntityModel {
  headPitch = 0

  override animateModel(state: AnimState) {
    super.animateModel(state)
    this.head.y = f(6 + f(headEatPosition(state) * 9))
    this.headPitch = headEatAngle(this, state)
  }

  override setAngles(state: AnimState) {
    super.setAngles(state)
    this.head.xRot = this.headPitch
  }
}

/** SheepWoolEntityModel: the same code as SheepEntityModel's (a separate class in the game) */
export class SheepWoolEntityModel extends SheepEntityModel {}

/** PolarBearEntityModel (1.10+) */
export class PolarBearEntityModel extends QuadruPedEntityModel {
  override setAngles(state: AnimState) {
    super.setAngles(state)
    // age - ticksAlive
    const l = f(state.ageInTicks - entity(state, 'ticksAlive', 0))
    // PolarBearEntity.method_13508(l)
    const previous = entity(state, 'field_15033', 0)
    const current = entity(state, 'field_15034', 0)
    let m = f(f(previous + f(f(current - previous) * l)) / 6)
    m = f(m * m)
    const n = f(1 - m)
    this.torso.xRot = f(HALF_PI - f(f(m * PI) * f(0.35)))
    this.torso.y = f(f(9 * n) + f(11 * m))
    this.frontRightLeg.y = f(f(14 * n) + f(-6 * m))
    this.frontRightLeg.z = f(f(-8 * n) + f(-4 * m))
    this.frontRightLeg.xRot = f(this.frontRightLeg.xRot - f(f(m * PI) * f(0.45)))
    this.frontLeftLeg.y = this.frontRightLeg.y
    this.frontLeftLeg.z = this.frontRightLeg.z
    this.frontLeftLeg.xRot = f(this.frontLeftLeg.xRot - f(f(m * PI) * f(0.45)))
    this.head.y = f(f(10 * n) + f(-12 * m))
    this.head.z = f(f(-16 * n) + f(-3 * m))
    this.head.xRot = f(this.head.xRot + f(f(m * PI) * f(0.15)))
  }
}

/** 1.13.2's turtle model (class_4200, TurtleModel later): data 14 has egg, 15 laying egg */
export class class_4200 extends QuadruPedEntityModel {
  eggBelly = this.part('field_20605')

  override setAngles(state: AnimState) {
    super.setAngles(state)
    const { cos } = this.c
    const handSwing = state.walkAnimationPos as number
    const handSwingAmount = state.walkAnimationSpeed as number
    this.backRightLeg.xRot = f(f(cos(f(f(handSwing * f(0.6662)) * f(0.6))) * 0.5) * handSwingAmount)
    this.backLeftLeg.xRot = f(f(cos(f(f(f(handSwing * f(0.6662)) * f(0.6)) + PI)) * 0.5) * handSwingAmount)
    this.frontRightLeg.zRot = f(f(cos(f(f(f(handSwing * f(0.6662)) * f(0.6)) + PI)) * 0.5) * handSwingAmount)
    this.frontLeftLeg.zRot = f(f(cos(f(f(handSwing * f(0.6662)) * f(0.6))) * 0.5) * handSwingAmount)
    this.frontRightLeg.xRot = 0
    this.frontLeftLeg.xRot = 0
    this.frontRightLeg.yRot = 0
    this.frontLeftLeg.yRot = 0
    this.backRightLeg.yRot = 0
    this.backLeftLeg.yRot = 0
    this.eggBelly.xRot = HALF_PI
    if (!entity(state, 'touchingWater', false) && entity(state, 'onGround', false)) {
      const layingEgg = !!data(state, 15, false)
      const l = layingEgg ? 4 : 1
      const m = layingEgg ? 2 : 1
      this.frontRightLeg.yRot = f(f(f(cos(f(f(f(l * handSwing) * 5) + PI)) * 8) * handSwingAmount) * m)
      this.frontRightLeg.zRot = 0
      this.frontLeftLeg.yRot = f(f(f(cos(f(f(l * handSwing) * 5)) * 8) * handSwingAmount) * m)
      this.frontLeftLeg.zRot = 0
      this.backRightLeg.yRot = f(f(cos(f(f(handSwing * 5) + PI)) * 3) * handSwingAmount)
      this.backRightLeg.xRot = 0
      this.backLeftLeg.yRot = f(f(cos(f(handSwing * 5)) * 3) * handSwingAmount)
      this.backLeftLeg.xRot = 0
    }
  }
}

/** HorseBaseEntityModel.method_5705 / class_4180.method_18900: angle interpolation wrapping with loops */
const rotWrap = (from: number, to: number, delta: number) => {
  let diff = f(to - from)
  while (diff < -180) diff = f(diff + 360)
  while (diff >= 180) diff = f(diff - 360)
  return f(from + f(delta * diff))
}

const PI_6 = f(Math.PI / 6)
const PI_12 = f(Math.PI / 12)
const PI_20 = f(Math.PI / 20)
const MINUS_PI_3 = f(-Math.PI / 3)
const MINUS_PI_4 = f(-Math.PI / 4)

/**
 * HorseBaseEntityModel (1.8.9 - 1.12.2: every horse type in one model, parts are the fields field_6396 - field_6434,
 * head, torso). 1.11 replaced some literals by exact constants (2.18166F, -1.3089F, -0.2618F, 3PI/2 -> -PI/2...).
 */
export class HorseBaseEntityModel extends EntityModel {
  torso = this.part('torso')
  head = this.part('head')
  private readonly p = (n: number): PartPose => this.part(`field_${n}`)
  f6396 = this.p(6396)
  f6397 = this.p(6397)
  f6398 = this.p(6398)
  f6399 = this.p(6399)
  f6400 = this.p(6400)
  f6401 = this.p(6401)
  f6402 = this.p(6402)
  f6403 = this.p(6403)
  f6404 = this.p(6404)
  f6405 = this.p(6405)
  f6406 = this.p(6406)
  f6407 = this.p(6407)
  f6408 = this.p(6408)
  f6409 = this.p(6409)
  f6410 = this.p(6410)
  f6411 = this.p(6411)
  f6412 = this.p(6412)
  f6413 = this.p(6413)
  f6414 = this.p(6414)
  f6415 = this.p(6415)
  f6416 = this.p(6416)
  f6417 = this.p(6417)
  f6418 = this.p(6418)
  f6419 = this.p(6419)
  f6420 = this.p(6420)
  f6421 = this.p(6421)
  f6422 = this.p(6422)
  f6423 = this.p(6423)
  f6424 = this.p(6424)
  f6427 = this.p(6427)
  f6428 = this.p(6428)
  f6429 = this.p(6429)
  f6430 = this.p(6430)
  f6431 = this.p(6431)
  f6432 = this.p(6432)
  f6433 = this.p(6433)
  f6434 = this.p(6434)

  override animateModel(state: AnimState) {
    super.animateModel(state)
    const { sin, cos } = this.c
    const new111 = this.c.atLeast('1.11')
    const limbAngle = state.walkAnimationPos as number
    const limbDistance = state.walkAnimationSpeed as number
    const tickDelta = state.partialTick as number
    const i = rotWrap(entity(state, 'prevBodyYaw', 0), entity(state, 'bodyYaw', 0), tickDelta)
    const j = rotWrap(entity(state, 'prevHeadYaw', 0), entity(state, 'headYaw', 0), tickDelta)
    const k = lerp(tickDelta, entity(state, 'prevPitch', 0), entity(state, 'pitch', 0))
    let l = f(j - i)
    let m = this.toRadians(k)
    if (l > 20) l = 20
    if (l < -20) l = -20
    if (limbDistance > f(0.2)) {
      m = f(m + f(f(cos(f(limbAngle * f(0.4))) * f(0.15)) * limbDistance))
    }
    // the eating grass, angry and eating animation progresses, interpolated
    const progress = (current: string, last: string) => lerp(tickDelta, entity(state, last, 0), entity(state, current, 0))
    const n = new111 ? progress('field_15502', 'field_15503') : progress('eatingGrassAnimationProgress', 'lastEatingGrassAnimationProgress')
    const o = new111 ? progress('field_15504', 'field_15505') : progress('angryAnimationProgress', 'lastAngryAnimationProgress')
    const p = f(1 - o)
    const q = new111 ? progress('field_15506', 'field_15507') : progress('eatingAnimationProgress', 'lastEatingAnimationProgress')
    const bl = entity(state, new111 ? 'field_15509' : 'field_6897', 0) !== 0
    const bl2 = (Number(data(state, horseFlagsIndex(this), 0)) & 4) !== 0
    const bl3 = !!entity(state, this.c.atLeast('1.9') ? 'hasPassengers' : 'rider', false)
    const r = f(entity(state, 'ticksAlive', 0) + tickDelta)
    const s = cos(f(f(limbAngle * f(0.6662)) + PI))
    const t = f(f(s * f(0.8)) * limbDistance)
    const head = this.f6415
    head.y = 4
    head.z = -10
    this.head.y = 3
    this.f6427.z = 14
    this.f6403.y = 3
    this.f6403.z = 10
    this.torso.xRot = 0
    head.xRot = f(PI_6 + m)
    head.yRot = this.toRadians(l)
    const notAngryOrEating = f(1 - Math.max(o, n))
    head.xRot = f(f(f(o * f(PI_12 + m)) + f(n * (new111 ? f(2.181_661_6) : f(2.181_66)))) + f(notAngryOrEating * head.xRot))
    head.yRot = f(this.toRadians(f(o * l)) + f(notAngryOrEating * head.yRot))
    head.y = f(f(f(o * -6) + f(n * 11)) + f(notAngryOrEating * head.y))
    head.z = f(f(f(o * -1) + f(n * -10)) + f(notAngryOrEating * head.z))
    this.head.y = f(f(o * 9) + f(p * this.head.y))
    this.f6427.z = f(f(o * 18) + f(p * this.f6427.z))
    this.f6403.y = f(f(o * 5.5) + f(p * this.f6403.y))
    this.f6403.z = f(f(o * 15) + f(p * this.f6403.z))
    // 1.8.9 - 1.10.2: o * -45.0F converted to radians; 1.11+: o * (float) (-Math.PI / 4)
    this.torso.xRot = f((new111 ? f(o * MINUS_PI_4) : this.toRadians(f(o * -45))) + f(p * this.torso.xRot))
    const followers = [this.f6418, this.f6419, this.f6420, this.f6421, this.f6422]
    for (const part of followers) part.y = head.y
    this.f6416.y = f(0.02)
    this.f6417.y = 0
    this.f6424.y = head.y
    for (const part of followers) part.z = head.z
    this.f6416.z = f(f(0.02) - q)
    this.f6417.z = q
    this.f6424.z = head.z
    for (const part of followers) part.xRot = head.xRot
    this.f6416.xRot = -f(f(0.094_247_78) * q)
    this.f6417.xRot = f(PI_20 * q)
    this.f6424.xRot = head.xRot
    for (const part of followers) part.yRot = head.yRot
    this.f6416.yRot = 0
    this.f6417.yRot = 0
    this.f6424.yRot = head.yRot
    this.f6402.xRot = f(t / 5)
    this.f6403.xRot = f(-t / 5)
    const x = f(PI_12 * o)
    const y = cos(f(f(r * f(0.6)) + PI))
    // 3PI/2 before 1.11, -PI/2 since (the same cosine, another float)
    const cosOffset = new111 ? -HALF_PI : f((Math.PI * 3) / 2)
    this.f6396.y = f(f(-2 * o) + f(9 * p))
    this.f6396.z = f(f(-2 * o) + f(-8 * p))
    this.f6399.y = this.f6396.y
    this.f6399.z = this.f6396.z
    const back = f(f(f(p * -s) * 0.5) * limbDistance)
    const front = f(f(f(p * s) * 0.5) * limbDistance)
    this.f6430.y = f(this.f6429.y + f(sin(f(f(HALF_PI + x) + back)) * 7))
    this.f6430.z = f(this.f6429.z + f(cos(f(f(cosOffset + x) + back)) * 7))
    this.f6433.y = f(this.f6432.y + f(sin(f(f(HALF_PI + x) + front)) * 7))
    this.f6433.z = f(this.f6432.z + f(cos(f(f(cosOffset + x) + front)) * 7))
    const z = f(f(f(MINUS_PI_3 + y) * o) + f(t * p))
    const aa = f(f(f(MINUS_PI_3 - y) * o) + f(-t * p))
    this.f6397.y = f(this.f6396.y + f(sin(f(HALF_PI + z)) * 7))
    this.f6397.z = f(this.f6396.z + f(cos(f(cosOffset + z)) * 7))
    this.f6400.y = f(this.f6399.y + f(sin(f(HALF_PI + aa)) * 7))
    this.f6400.z = f(this.f6399.z + f(cos(f(cosOffset + aa)) * 7))
    const swing = f(f(s * 0.5) * limbDistance)
    const minusSwing = f(f(-s * 0.5) * limbDistance)
    this.f6429.xRot = f(x + f(minusSwing * p))
    this.f6430.xRot = f(f(f(-0.087_266_46) * o) + f(f(minusSwing - Math.max(0, swing)) * p))
    this.f6431.xRot = this.f6430.xRot
    this.f6432.xRot = f(x + f(swing * p))
    this.f6433.xRot = f(f(f(-0.087_266_46) * o) + f(f(swing - Math.max(0, minusSwing)) * p))
    this.f6434.xRot = this.f6433.xRot
    this.f6396.xRot = z
    this.f6397.xRot = f(f(f(this.f6396.xRot + f(PI * Math.max(0, f(f(0.2) + f(y * f(0.2)))))) * o) + f(f(t + Math.max(0, swing)) * p))
    this.f6398.xRot = this.f6397.xRot
    this.f6399.xRot = aa
    this.f6400.xRot = f(f(f(this.f6399.xRot + f(PI * Math.max(0, f(f(0.2) - f(y * f(0.2)))))) * o) + f(f(-t + Math.max(0, minusSwing)) * p))
    this.f6401.xRot = this.f6400.xRot
    this.f6431.y = this.f6430.y
    this.f6431.z = this.f6430.z
    this.f6434.y = this.f6433.y
    this.f6434.z = this.f6433.z
    this.f6398.y = this.f6397.y
    this.f6398.z = this.f6397.z
    this.f6401.y = this.f6400.y
    this.f6401.z = this.f6400.z
    if (bl2) {
      this.f6404.y = f(f(o * 0.5) + f(p * 2))
      this.f6404.z = f(f(o * 11) + f(p * 2))
      for (const part of [this.f6405, this.f6406, this.f6407, this.f6409, this.f6408, this.f6410]) part.y = this.f6404.y
      this.f6402.y = this.f6403.y
      for (const part of [this.f6405, this.f6406, this.f6407, this.f6409, this.f6408, this.f6410]) part.z = this.f6404.z
      this.f6402.z = this.f6403.z
      this.f6404.xRot = this.torso.xRot
      this.f6405.xRot = this.torso.xRot
      this.f6406.xRot = this.torso.xRot
      for (const part of [this.f6413, this.f6414, this.f6423, this.f6411, this.f6412]) part.y = head.y
      for (const part of [this.f6413, this.f6414, this.f6423, this.f6411, this.f6412]) part.z = head.z
      this.f6413.xRot = m
      this.f6414.xRot = m
      this.f6423.xRot = head.xRot
      this.f6411.xRot = head.xRot
      this.f6412.xRot = head.xRot
      for (const part of [this.f6423, this.f6411, this.f6413, this.f6412, this.f6414]) part.yRot = head.yRot
      const reins = [this.f6407, this.f6408, this.f6409, this.f6410]
      if (bl3) {
        for (const part of reins) part.xRot = MINUS_PI_3
        for (const part of reins) part.zRot = 0
      } else {
        for (const part of reins) part.xRot = f(t / 3)
        this.f6407.zRot = f(t / 5)
        this.f6408.zRot = f(t / 5)
        this.f6409.zRot = f(-t / 5)
        this.f6410.zRot = f(-t / 5)
      }
    }
    let u = f((new111 ? f((-Math.PI * 5) / 12) : f(-1.3089)) + f(limbDistance * 1.5))
    if (u > 0) u = 0
    if (bl) {
      this.head.yRot = cos(f(r * f(0.7)))
      u = 0
    } else {
      this.head.yRot = 0
    }
    this.f6427.yRot = this.head.yRot
    this.f6428.yRot = this.head.yRot
    this.f6427.y = this.head.y
    this.f6428.y = this.head.y
    this.f6427.z = this.head.z
    this.f6428.z = this.head.z
    this.head.xRot = u
    this.f6427.xRot = u
    this.f6428.xRot = f((new111 ? f(-Math.PI / 12) : f(-0.2618)) + u)
  }
}

/**
 * 1.13.2's horse model (class_4180, HorseModel later; parts field_20511 body, field_20512 head parts, field_20513 -
 * field_20516 legs, field_20517 tail). The saddle pieces' visibility is set in render, not here.
 */
export class class_4180 extends EntityModel {
  body = this.part('field_20511')
  headParts = this.part('field_20512')
  leftHindLeg = this.part('field_20513')
  rightHindLeg = this.part('field_20514')
  leftFrontLeg = this.part('field_20515')
  rightFrontLeg = this.part('field_20516')
  tail = this.part('field_20517')

  override animateModel(state: AnimState) {
    super.animateModel(state)
    const { sin, cos } = this.c
    const limbAngle = state.walkAnimationPos as number
    const limbDistance = state.walkAnimationSpeed as number
    const tickDelta = state.partialTick as number
    const i = rotWrap(entity(state, 'prevBodyYaw', 0), entity(state, 'bodyYaw', 0), tickDelta)
    const j = rotWrap(entity(state, 'prevHeadYaw', 0), entity(state, 'headYaw', 0), tickDelta)
    const k = lerp(tickDelta, entity(state, 'prevPitch', 0), entity(state, 'pitch', 0))
    let l = f(j - i)
    let m = f(k * DEG_TO_RAD)
    if (l > 20) l = 20
    if (l < -20) l = -20
    if (limbDistance > f(0.2)) {
      m = f(m + f(f(cos(f(limbAngle * f(0.4))) * f(0.15)) * limbDistance))
    }
    const n = lerp(tickDelta, entity(state, 'field_15503', 0), entity(state, 'field_15502', 0))
    const o = lerp(tickDelta, entity(state, 'field_15505', 0), entity(state, 'field_15504', 0))
    const p = f(1 - o)
    const q = lerp(tickDelta, entity(state, 'field_15507', 0), entity(state, 'field_15506', 0))
    const bl = entity(state, 'field_15509', 0) !== 0
    const r = f(entity(state, 'ticksAlive', 0) + tickDelta)
    const headParts = this.headParts
    headParts.y = 4
    headParts.z = -12
    this.body.xRot = 0
    headParts.xRot = f(PI_6 + m)
    headParts.yRot = f(l * DEG_TO_RAD)
    const s = entity(state, 'touchingWater', false) ? f(0.2) : 1
    const t = cos(f(f(f(s * limbAngle) * f(0.6662)) + PI))
    const u = f(f(t * f(0.8)) * limbDistance)
    const notAngryOrEating = f(1 - Math.max(o, n))
    const v = f(notAngryOrEating * f(f(PI_6 + m) + f(f(q * sin(r)) * f(0.05))))
    headParts.xRot = f(f(f(o * f(PI_12 + m)) + f(n * f(f(2.181_661_6) + f(sin(r) * f(0.05))))) + v)
    headParts.yRot = f(f(f(o * l) * DEG_TO_RAD) + f(notAngryOrEating * headParts.yRot))
    headParts.y = f(f(f(o * -4) + f(n * 11)) + f(notAngryOrEating * headParts.y))
    headParts.z = f(f(f(o * -4) + f(n * -12)) + f(notAngryOrEating * headParts.z))
    this.body.xRot = f(f(o * MINUS_PI_4) + f(p * this.body.xRot))
    const w = f(PI_12 * o)
    const x = cos(f(f(r * f(0.6)) + PI))
    this.leftFrontLeg.y = f(f(2 * o) + f(14 * p))
    this.leftFrontLeg.z = f(f(-6 * o) - f(10 * p))
    this.rightFrontLeg.y = this.leftFrontLeg.y
    this.rightFrontLeg.z = this.leftFrontLeg.z
    const y = f(f(f(MINUS_PI_3 + x) * o) + f(u * p))
    const z = f(f(f(MINUS_PI_3 - x) * o) - f(u * p))
    this.leftHindLeg.xRot = f(w - f(f(f(t * 0.5) * limbDistance) * p))
    this.rightHindLeg.xRot = f(w + f(f(f(t * 0.5) * limbDistance) * p))
    this.leftFrontLeg.xRot = y
    this.rightFrontLeg.xRot = z
    this.tail.xRot = f(PI_6 + f(limbDistance * 0.75))
    this.tail.y = f(-5 + limbDistance)
    this.tail.z = f(2 + f(limbDistance * 2))
    if (bl) {
      this.tail.yRot = cos(f(r * f(0.7)))
    } else {
      this.tail.yRot = 0
    }
  }
}

/** 1.13.2's donkey / mule model (class_4182, ChestedHorseModel later): class_4180's animation, the chests show in render */
export class class_4182 extends class_4180 {}

export const LEGACY_QUADRUPEDS_MODELS: Record<string, AnimModelClass> = {
  QuadruPedEntityModel,
  CowEntityModel,
  class_4184: CowEntityModel,
  PigEntityModel,
  SheepEntityModel,
  SheepWoolEntityModel,
  PolarBearEntityModel,
  LlamaEntityModel,
  LlamaSpitModel: AnimModel,
  class_4200,
  HorseBaseEntityModel,
  class_4180,
  class_4182
}
