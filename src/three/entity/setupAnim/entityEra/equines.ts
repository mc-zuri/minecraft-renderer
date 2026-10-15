import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, PI, clamp, f, lerp, rotLerp } from '../mth'
import { applyKeyframes } from '../keyframes'

/**
 * Horses, donkeys and mules (HorseModel, ChestedHorseModel), camels, sniffers, striders and armadillos, 1.14.4 - 1.21.1:
 * posed from the entity (prepareMobModel then setupAnim). Entity-era state: walkAnimationPos (limbSwing),
 * walkAnimationSpeed (limbSwingAmount), ageInTicks, yRot (netHeadYaw), xRot (headPitch), partialTick, model.<field>,
 * data.<index> (read by name through state.dataNames), entity.<field>.
 *
 * Entity fields the renderer must provide (absent: the value a fresh entity has):
 * - horses: entity.yBodyRot(O), entity.yHeadRot(O), entity.xRot(O) (the entity's own pitch, not headPitch),
 *   entity.eatAnim(O), entity.standAnim(O), entity.mouthAnim(O), entity.tailCounter, entity.tickCount, entity.isInWater,
 *   entity.isVehicle (has passengers);
 * - camels: entity.dashCooldown, entity.tickCount, entity.isVehicle and the AnimationStates;
 * - 1.19.4 sniffers: entity.deltaMovement ([x, y, z], blocks per tick);
 * - armadillos: entity.inStateTicks;
 * - striders: entity.isVehicle.
 */

/** The entity's synched data by its name (state.dataNames: index -> name), or the define(...) default when absent. */
const data = (state: AnimState, name: string, fallback: unknown) => {
  const names = (state.dataNames ?? {}) as Record<string, string>
  for (const index of Object.keys(names)) {
    if (names[index] === name) {
      const value = state[`data.${index}`]
      return value === undefined || value === null ? fallback : value
    }
  }
  return fallback
}

/** An entity field, or its default when absent. */
const entity = <T>(state: AnimState, name: string, fallback: T): T => {
  const value = state[`entity.${name}`]
  return value === undefined || value === null ? fallback : (value as T)
}

type AnimationStateValue = { lastTime: number; accumulatedTime: number } | null | undefined

/**
 * HierarchicalModel.animate(AnimationState, definition, ageInTicks, speed) of 1.19 - 1.21.1: AnimationState.updateTime
 * (on a copy of the state's value) then the keyframes at the accumulated time.
 */
function animate(model: AnimModel, value: AnimationStateValue, name: string, ageInTicks: number, speed = 1, root?: PartPose) {
  if (value === null || value === undefined) return
  // updateTime: lastTime = Mth.lfloor(ageInTicks * 1000 / 20), accumulatedTime += (long) ((float) (l - lastTime) * speed)
  const l = Math.floor(f(f(ageInTicks * 1000) / 20))
  const accumulatedTime = value.accumulatedTime + Math.trunc(f(f(l - value.lastTime) * speed))
  applyKeyframes(model.model, model.c, name, accumulatedTime, 1, root)
}

/** HierarchicalModel.animateWalk(definition, limbSwing, limbSwingAmount, speedFactor, scaleFactor) of 1.19.4 - 1.21.1. */
function animateWalk(model: AnimModel, name: string, pos: number, speed: number, speedFactor: number, scaleFactor: number, root?: PartPose) {
  const millis = Math.trunc(f(f(pos * 50) * speedFactor))
  applyKeyframes(model.model, model.c, name, millis, Math.min(f(speed * scaleFactor), 1), root)
}

/** HierarchicalModel.applyStatic(definition) */
function applyStatic(model: AnimModel, name: string, root?: PartPose) {
  applyKeyframes(model.model, model.c, name, 0, 1, root)
}

/** Mth.rotlerp(from, to, delta) (deprecated, before 1.19.4) / HorseModel.rotlerp of 1.14.4: the loop wrapping. */
const rotlerpLoop = (from: number, to: number, delta: number) => {
  let diff = f(to - from)
  while (diff < -180) diff = f(diff + 360)
  while (diff >= 180) diff = f(diff - 360)
  return f(from + f(delta * diff))
}

const DEG_30 = f(Math.PI / 6)
const DEG_15 = f(Math.PI / 12)
const DEG_60 = f(Math.PI / 3)
const DEG_45 = f(Math.PI / 4)

/** HorseModel (horses, skeleton and zombie horses; the base of ChestedHorseModel) */
export class HorseModel extends AnimModel {
  // 1.17+: named parts; 1.15 - 1.16 legacy fields leg1..leg4 and babyLeg1..babyLeg4 (leg1 / baby_leg1 ...); 1.14.4:
  // leg1A..leg4A (leg1_a ...), no baby legs
  private readonly named = this.c.atLeast('1.17')
  body = this.part('body')
  headParts = this.part('head_parts')
  // leg1 / left hind, leg2 / right hind, leg3 / left front, leg4 / right front
  leftHindLeg = this.legPart('left_hind_leg', 1)
  rightHindLeg = this.legPart('right_hind_leg', 2)
  leftFrontLeg = this.legPart('left_front_leg', 3)
  rightFrontLeg = this.legPart('right_front_leg', 4)
  leftHindBabyLeg = this.babyLegPart('left_hind_baby_leg', 1)
  rightHindBabyLeg = this.babyLegPart('right_hind_baby_leg', 2)
  leftFrontBabyLeg = this.babyLegPart('left_front_baby_leg', 3)
  rightFrontBabyLeg = this.babyLegPart('right_front_baby_leg', 4)
  tail = this.part('body/tail')
  saddleParts: PartPose[] = this.named
    ? [this.part('body/saddle'), this.part('head_parts/left_saddle_mouth'), this.part('head_parts/right_saddle_mouth'), this.part('head_parts/head_saddle'), this.part('head_parts/mouth_saddle_wrap')]
    : this.legacySaddleParts()
  ridingParts: PartPose[] = this.named ? [this.part('head_parts/left_saddle_line'), this.part('head_parts/right_saddle_line')] : this.legacyRidingParts()

  private legPart(name: string, n: number) {
    if (this.named) return this.part(name)
    return this.part(this.c.atLeast('1.15') ? `leg${n}` : `leg${n}_a`)
  }

  private babyLegPart(name: string, n: number) {
    if (this.named) return this.part(name)
    return this.c.atLeast('1.15') ? this.part(`baby_leg${n}`) : undefined
  }

  /**
   * 1.15 - 1.16: the legacy layers' saddle pieces, named after the fields' arrays (saddleParts: the saddle on body, the
   * mouth pieces and head saddle on head_parts; ridingParts: the lines). 1.14.4 sets their visibility in render, not in
   * setupAnim: nothing here.
   */
  private legacySaddleParts(): PartPose[] {
    if (!this.c.atLeast('1.15')) return []
    return ['body/saddle_parts_0', 'head_parts/saddle_parts_1', 'head_parts/saddle_parts_2', 'head_parts/saddle_parts_3', 'head_parts/saddle_parts_4'].map(path => this.part(path))
  }

  private legacyRidingParts(): PartPose[] {
    if (!this.c.atLeast('1.15')) return []
    return ['head_parts/riding_parts_0', 'head_parts/riding_parts_1'].map(path => this.part(path))
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
    this.setupAnimBody(state)
  }

  /** HorseModel.setupAnim (1.14.4 has none: HorseModel.render sets the saddle's visibility) */
  protected setupAnimBody(state: AnimState) {
    if (!this.c.atLeast('1.15')) return
    const saddled = (Number(data(state, 'id_flags', 0)) & 4) !== 0
    const vehicle = !!entity(state, 'isVehicle', false)
    for (const part of this.saddleParts) part.visible = saddled
    for (const part of this.ridingParts) part.visible = vehicle && saddled
    this.body.y = 11
  }

  prepareMobModel(state: AnimState) {
    const { sin, cos } = this.c
    const pos = state.walkAnimationPos as number
    const g = state.walkAnimationSpeed as number
    const h = state.partialTick as number
    const new1194 = this.c.atLeast('1.19.4')
    const i = new1194 ? rotLerp(h, entity(state, 'yBodyRotO', 0), entity(state, 'yBodyRot', 0)) : rotlerpLoop(entity(state, 'yBodyRotO', 0), entity(state, 'yBodyRot', 0), h)
    const j = new1194 ? rotLerp(h, entity(state, 'yHeadRotO', 0), entity(state, 'yHeadRot', 0)) : rotlerpLoop(entity(state, 'yHeadRotO', 0), entity(state, 'yHeadRot', 0), h)
    const k = lerp(h, entity(state, 'xRotO', 0), entity(state, 'xRot', 0))
    let l = f(j - i)
    let m = f(k * DEG_TO_RAD)
    if (l > 20) l = 20
    if (l < -20) l = -20
    if (g > f(0.2)) {
      m = f(m + f(f(cos(f(pos * (new1194 ? f(0.8) : f(0.4)))) * f(0.15)) * g))
    }
    const n = lerp(h, entity(state, 'eatAnimO', 0), entity(state, 'eatAnim', 0))
    const o = lerp(h, entity(state, 'standAnimO', 0), entity(state, 'standAnim', 0))
    const p = f(1 - o)
    const q = lerp(h, entity(state, 'mouthAnimO', 0), entity(state, 'mouthAnim', 0))
    const tailMoving = entity(state, 'tailCounter', 0) !== 0
    const r = f(entity(state, 'tickCount', 0) + h)
    const headParts = this.headParts
    headParts.y = 4
    headParts.z = -12
    this.body.xRot = 0
    headParts.xRot = f(DEG_30 + m)
    headParts.yRot = f(l * DEG_TO_RAD)
    const s = entity(state, 'isInWater', false) ? f(0.2) : 1
    const t = cos(f(f(f(s * pos) * f(0.6662)) + PI))
    const u = f(f(t * f(0.8)) * g)
    const notStandingOrEating = f(1 - Math.max(o, n))
    const v = f(notStandingOrEating * f(f(DEG_30 + m) + f(f(q * sin(r)) * f(0.05))))
    headParts.xRot = f(f(f(o * f(DEG_15 + m)) + f(n * f(f(2.181_661_6) + f(sin(r) * f(0.05))))) + v)
    headParts.yRot = f(f(f(o * l) * DEG_TO_RAD) + f(notStandingOrEating * headParts.yRot))
    headParts.y = f(f(f(o * -4) + f(n * 11)) + f(notStandingOrEating * headParts.y))
    headParts.z = f(f(f(o * -4) + f(n * -12)) + f(notStandingOrEating * headParts.z))
    this.body.xRot = f(f(o * -DEG_45) + f(p * this.body.xRot))
    const w = f(DEG_15 * o)
    const x = cos(f(f(r * f(0.6)) + PI))
    this.leftFrontLeg.y = f(f(2 * o) + f(14 * p))
    this.leftFrontLeg.z = f(f(-6 * o) - f(10 * p))
    this.rightFrontLeg.y = this.leftFrontLeg.y
    this.rightFrontLeg.z = this.leftFrontLeg.z
    const y = f(f(f(-DEG_60 + x) * o) + f(u * p))
    const z = f(f(f(-DEG_60 - x) * o) - f(u * p))
    this.leftHindLeg.xRot = f(w - f(f(f(t * 0.5) * g) * p))
    this.rightHindLeg.xRot = f(w + f(f(f(t * 0.5) * g) * p))
    this.leftFrontLeg.xRot = y
    this.rightFrontLeg.xRot = z
    this.tail.xRot = f(DEG_30 + f(g * 0.75))
    this.tail.y = f(-5 + g)
    this.tail.z = f(2 + f(g * 2))
    if (tailMoving) {
      this.tail.yRot = cos(f(r * f(0.7)))
    } else {
      this.tail.yRot = 0
    }
    // 1.15+: the baby legs follow the legs, and only the ones for the entity's age show
    if (!this.c.atLeast('1.15')) return
    const babyLegs: Array<[PartPose | undefined, PartPose]> = [
      [this.rightHindBabyLeg, this.rightHindLeg],
      [this.leftHindBabyLeg, this.leftHindLeg],
      [this.rightFrontBabyLeg, this.rightFrontLeg],
      [this.leftFrontBabyLeg, this.leftFrontLeg]
    ]
    for (const [baby, leg] of babyLegs) {
      if (!baby) continue
      baby.y = leg.y
      baby.z = leg.z
      baby.xRot = leg.xRot
    }
    const baby = !!data(state, 'baby', false)
    this.rightHindLeg.visible = !baby
    this.leftHindLeg.visible = !baby
    this.rightFrontLeg.visible = !baby
    this.leftFrontLeg.visible = !baby
    for (const [babyLeg] of babyLegs) if (babyLeg) babyLeg.visible = baby
    this.body.y = baby ? f(10.8) : 0
  }
}

/** ChestedHorseModel (donkeys and mules) */
export class ChestedHorseModel extends HorseModel {
  leftChest = this.c.atLeast('1.17') ? this.part('body/left_chest') : this.part('box_l')
  rightChest = this.c.atLeast('1.17') ? this.part('body/right_chest') : this.part('box_r')

  protected override setupAnimBody(state: AnimState) {
    super.setupAnimBody(state)
    // 1.14.4: ChestedHorseModel.render shows the chests
    if (!this.c.atLeast('1.15')) return
    if (data(state, 'id_chest', false)) {
      this.leftChest.visible = true
      this.rightChest.visible = true
    } else {
      this.leftChest.visible = false
      this.rightChest.visible = false
    }
  }
}

/** CamelModel (1.19.4 - 1.21.1) */
export class CamelModel extends AnimModel {
  head = this.part('body/head')
  saddleParts = [this.part('body/saddle'), this.part('body/head/bridle')]
  ridingParts = [this.part('body/head/reins')]

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const h = state.ageInTicks as number
    this.applyHeadRotation(state, state.yRot, state.xRot, h)
    this.toggleInvisibleParts(state)
    animateWalk(this, 'CamelAnimation.CAMEL_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 2, 2.5)
    animate(this, state['entity.sitAnimationState'], 'CamelAnimation.CAMEL_SIT', h, 1)
    animate(this, state['entity.sitPoseAnimationState'], 'CamelAnimation.CAMEL_SIT_POSE', h, 1)
    animate(this, state['entity.sitUpAnimationState'], 'CamelAnimation.CAMEL_STANDUP', h, 1)
    animate(this, state['entity.idleAnimationState'], 'CamelAnimation.CAMEL_IDLE', h, 1)
    animate(this, state['entity.dashAnimationState'], 'CamelAnimation.CAMEL_DASH', h, 1)
  }

  private applyHeadRotation(state: AnimState, yRot: number, xRot: number, ageInTicks: number) {
    yRot = clamp(yRot, -30, 30)
    xRot = clamp(xRot, -25, 45)
    const jumpCooldown = entity(state, 'dashCooldown', 0)
    if (jumpCooldown > 0) {
      const i = f(ageInTicks - entity(state, 'tickCount', 0))
      const j = f(f(45 * f(jumpCooldown - i)) / 55)
      xRot = clamp(f(xRot + j), -25, 70)
    }
    this.head.yRot = f(yRot * DEG_TO_RAD)
    this.head.xRot = f(xRot * DEG_TO_RAD)
  }

  private toggleInvisibleParts(state: AnimState) {
    const saddled = (Number(data(state, 'id_flags', 0)) & 4) !== 0
    const vehicle = !!entity(state, 'isVehicle', false)
    for (const part of this.saddleParts) part.visible = saddled
    for (const part of this.ridingParts) part.visible = vehicle && saddled
  }
}

/** SnifferModel (1.19.4 - 1.21.1): the animations are baked on the "root" child (HierarchicalModel.root()) */
export class SnifferModel extends AnimModel {
  root = this.part('/root')
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const h = state.ageInTicks as number
    const root = this.root
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (!this.c.atLeast('1.20')) {
      // 1.19.4: the walk animations are animation states, their speed from the entity's horizontal movement
      const delta = entity<number[]>(state, 'deltaMovement', [0, 0, 0])
      const k = Math.min(f(f(delta[0]! * delta[0]! + delta[2]! * delta[2]!) * 9000), 1)
      const l = f(k * 2)
      animate(this, state['entity.walkingAnimationState'], 'SnifferAnimation.SNIFFER_WALK', h, k, root)
      animate(this, state['entity.panicAnimationState'], 'SnifferAnimation.SNIFFER_WALK', h, l, root)
      animate(this, state['entity.diggingAnimationState'], 'SnifferAnimation.SNIFFER_DIG', h, 1, root)
      animate(this, state['entity.searchingAnimationState'], 'SnifferAnimation.SNIFFER_SNIFF_SEARCH', h, k, root)
      animate(this, state['entity.sniffingAnimationState'], 'SnifferAnimation.SNIFFER_LONGSNIFF', h, 1, root)
      animate(this, state['entity.risingAnimationState'], 'SnifferAnimation.SNIFFER_STAND_UP', h, 1, root)
      animate(this, state['entity.feelingHappyAnimationState'], 'SnifferAnimation.SNIFFER_HAPPY', h, 1, root)
      animate(this, state['entity.scentingAnimationState'], 'SnifferAnimation.SNIFFER_SNIFFSNIFF', h, 1, root)
      return
    }
    if (data(state, 'state', 'IDLING') === 'SEARCHING') {
      animateWalk(this, 'SnifferAnimation.SNIFFER_SNIFF_SEARCH', state.walkAnimationPos, state.walkAnimationSpeed, 9, 100, root)
    } else {
      animateWalk(this, 'SnifferAnimation.SNIFFER_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 9, 100, root)
    }
    animate(this, state['entity.diggingAnimationState'], 'SnifferAnimation.SNIFFER_DIG', h, 1, root)
    animate(this, state['entity.sniffingAnimationState'], 'SnifferAnimation.SNIFFER_LONGSNIFF', h, 1, root)
    animate(this, state['entity.risingAnimationState'], 'SnifferAnimation.SNIFFER_STAND_UP', h, 1, root)
    animate(this, state['entity.feelingHappyAnimationState'], 'SnifferAnimation.SNIFFER_HAPPY', h, 1, root)
    animate(this, state['entity.scentingAnimationState'], 'SnifferAnimation.SNIFFER_SNIFFSNIFF', h, 1, root)
    if (state['model.young']) {
      applyStatic(this, 'SnifferAnimation.BABY_TRANSFORM', root)
    }
  }
}

/** Armadillo.ArmadilloState.shouldHideInShell(inStateTicks) */
const armadilloHidesInShell = (armadilloState: string, inStateTicks: number) => {
  switch (armadilloState) {
    case 'ROLLING':
      return inStateTicks > 5
    case 'SCARED':
      return true
    case 'UNROLLING':
      return inStateTicks < 26
    default:
      return false
  }
}

/** ArmadilloModel (1.20.5 - 1.21.1) */
export class ArmadilloModel extends AnimModel {
  body = this.part('body')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  head = this.part('body/head')
  tail = this.part('body/tail')
  cube = this.part('cube')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const h = state.ageInTicks as number
    if (armadilloHidesInShell(String(data(state, 'armadillo_state', 'IDLE')), entity(state, 'inStateTicks', 0))) {
      this.body.skipDraw = true
      this.leftHindLeg.visible = false
      this.rightHindLeg.visible = false
      this.tail.visible = false
      this.cube.visible = true
    } else {
      this.body.skipDraw = false
      this.leftHindLeg.visible = true
      this.rightHindLeg.visible = true
      this.tail.visible = true
      this.cube.visible = false
      this.head.xRot = f(clamp(state.xRot, -22.5, 25) * DEG_TO_RAD)
      this.head.yRot = f(clamp(state.yRot, -32.5, 32.5) * DEG_TO_RAD)
    }
    animateWalk(this, 'ArmadilloAnimation.ARMADILLO_WALK', state.walkAnimationPos, state.walkAnimationSpeed, f(16.5), 2.5)
    animate(this, state['entity.rollOutAnimationState'], 'ArmadilloAnimation.ARMADILLO_ROLL_OUT', h, 1)
    animate(this, state['entity.rollUpAnimationState'], 'ArmadilloAnimation.ARMADILLO_ROLL_UP', h, 1)
    animate(this, state['entity.peekAnimationState'], 'ArmadilloAnimation.ARMADILLO_PEEK', h, 1)
  }
}

/** StriderModel (1.16.5 - 1.21.1; 1.16.5's legacy fields bristle0 - bristle5) */
export class StriderModel extends AnimModel {
  private readonly named = this.c.atLeast('1.17')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  body = this.part('body')
  rightBottomBristle = this.part(this.named ? 'right_bottom_bristle' : 'bristle0')
  rightMiddleBristle = this.part(this.named ? 'right_middle_bristle' : 'bristle1')
  rightTopBristle = this.part(this.named ? 'right_top_bristle' : 'bristle2')
  leftTopBristle = this.part(this.named ? 'left_top_bristle' : 'bristle3')
  leftMiddleBristle = this.part(this.named ? 'left_middle_bristle' : 'bristle4')
  leftBottomBristle = this.part(this.named ? 'left_bottom_bristle' : 'bristle5')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const pos = state.walkAnimationPos as number
    const g = Math.min(0.25, state.walkAnimationSpeed as number)
    const h = state.ageInTicks as number
    // 1.16.5: getPassengers().size() <= 0, since: !isVehicle()
    if (!entity(state, 'isVehicle', false)) {
      this.body.xRot = f(state.xRot * DEG_TO_RAD)
      this.body.yRot = f(state.yRot * DEG_TO_RAD)
    } else {
      this.body.xRot = 0
      this.body.yRot = 0
    }
    const pos15 = f(pos * 1.5)
    const half = f(pos15 * 0.5)
    this.body.zRot = f(f(f(f(0.1) * sin(pos15)) * 4) * g)
    this.body.y = 2
    this.body.y = f(this.body.y - f(f(f(2 * cos(pos15)) * 2) * g))
    this.leftLeg.xRot = f(f(sin(half) * 2) * g)
    this.rightLeg.xRot = f(f(sin(f(half + PI)) * 2) * g)
    this.leftLeg.zRot = f(f(f(0.174_532_92) * cos(half)) * g)
    this.rightLeg.zRot = f(f(f(0.174_532_92) * cos(f(half + PI))) * g)
    this.leftLeg.y = f(8 + f(f(f(2 * sin(f(half + PI))) * 2) * g))
    this.rightLeg.y = f(8 + f(f(f(2 * sin(half)) * 2) * g))
    this.rightBottomBristle.zRot = f(-1.221_730_5)
    this.rightMiddleBristle.zRot = f(-1.134_464)
    this.rightTopBristle.zRot = f(-0.872_664_63)
    this.leftTopBristle.zRot = f(0.872_664_63)
    this.leftMiddleBristle.zRot = f(1.134_464)
    this.leftBottomBristle.zRot = f(1.221_730_5)
    const l = f(cos(f(pos15 + PI)) * g)
    const add = (part: PartPose, value: number) => {
      part.zRot = f(part.zRot + value)
    }
    add(this.rightBottomBristle, f(l * f(1.3)))
    add(this.rightMiddleBristle, f(l * f(1.2)))
    add(this.rightTopBristle, f(l * f(0.6)))
    add(this.leftTopBristle, f(l * f(0.6)))
    add(this.leftMiddleBristle, f(l * f(1.2)))
    add(this.leftBottomBristle, f(l * f(1.3)))
    add(this.rightBottomBristle, f(f(0.05) * sin(f(f(h * 1) * f(-0.4)))))
    add(this.rightMiddleBristle, f(f(0.1) * sin(f(f(h * 1) * f(0.2)))))
    add(this.rightTopBristle, f(f(0.1) * sin(f(f(h * 1) * f(0.4)))))
    add(this.leftTopBristle, f(f(0.1) * sin(f(f(h * 1) * f(0.4)))))
    add(this.leftMiddleBristle, f(f(0.1) * sin(f(f(h * 1) * f(0.2)))))
    add(this.leftBottomBristle, f(f(0.05) * sin(f(f(h * 1) * f(-0.4)))))
  }
}

export const ENTITY_ERA_EQUINES_MODELS: Record<string, AnimModelClass> = {
  HorseModel,
  ChestedHorseModel,
  CamelModel,
  SnifferModel,
  ArmadilloModel,
  StriderModel
}
