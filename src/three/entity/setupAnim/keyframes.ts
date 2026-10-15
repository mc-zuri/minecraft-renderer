import { sampleAnimation } from '../exportedAnimations'
import type { ModelPose, PartPose } from './modelPose'
import { f } from './mth'
import type { AnimContext } from './types'

/**
 * KeyframeAnimation as the models apply it inside setupAnim (26.3; KeyframeAnimations.animate before): the animation's
 * offsets added to the parts its bones name, found as ModelPart.createPartLookup finds them ("root" is the model's root,
 * then children before grandchildren).
 */

const lookups = new WeakMap<ModelPose, Map<string, Map<string, PartPose>>>()

/** ModelPart.createPartLookup of the part an animation was baked on (the model's root unless given). */
const partLookup = (model: ModelPose, root: PartPose = model.root) => {
  let byRoot = lookups.get(model)
  if (!byRoot) lookups.set(model, (byRoot = new Map()))
  let lookup = byRoot.get(root.path)
  if (!lookup) {
    lookup = new Map([['root', root]])
    const children = (part: PartPose) => [...model.byPath.values()].filter(other => other.path.startsWith(`${part.path}/`) && !other.path.slice(part.path.length + 1).includes('/'))
    const addAll = (part: PartPose) => {
      const direct = children(part)
      for (const child of direct) if (!lookup!.has(child.name)) lookup!.set(child.name, child)
      for (const child of direct) addAll(child)
    }
    addAll(root)
    byRoot.set(root.path, lookup)
  }
  return lookup
}

/** KeyframeAnimation.apply(millis, targetScale). */
export function applyKeyframes(model: ModelPose, context: AnimContext, name: string, millis: number, scale = 1, root?: PartPose) {
  const animation = context.animation(name)
  if (!animation) return
  const lookup = partLookup(model, root)
  for (const [bone, o] of sampleAnimation(animation, millis, scale)) {
    const part = lookup.get(bone)
    if (!part) continue
    part.x = f(part.x + o[0]!)
    part.y = f(part.y + o[1]!)
    part.z = f(part.z + o[2]!)
    part.xRot = f(part.xRot + o[3]!)
    part.yRot = f(part.yRot + o[4]!)
    part.zRot = f(part.zRot + o[5]!)
    part.xScale = f(part.xScale + o[6]!)
    part.yScale = f(part.yScale + o[7]!)
    part.zScale = f(part.zScale + o[8]!)
  }
}

/** KeyframeAnimation.apply(AnimationState, ageInTicks, speedFactor): nothing while the state is stopped (null). */
export function applyAnimationState(model: ModelPose, context: AnimContext, name: string, startTick: number | null | undefined, ageInTicks: number, speedFactor = 1, root?: PartPose) {
  if (startTick === null || startTick === undefined) return
  const millis = Math.trunc(f(f(ageInTicks - f(startTick)) * 50))
  applyKeyframes(model, context, name, speedFactor === 1 ? millis : Math.trunc(f(f(millis) * f(speedFactor))), 1, root)
}

/** KeyframeAnimation.applyWalk: the time from the walk position, the strength from the walk speed. */
export function applyWalkAnimation(model: ModelPose, context: AnimContext, name: string, position: number, speed: number, speedFactor: number, scaleFactor: number, root?: PartPose) {
  const millis = Math.trunc(f(f(position * 50) * f(speedFactor)))
  applyKeyframes(model, context, name, millis, Math.min(f(speed * f(scaleFactor)), 1), root)
}

/** KeyframeAnimation.applyStatic: the animation's first frame at full strength. */
export function applyStaticAnimation(model: ModelPose, context: AnimContext, name: string, root?: PartPose) {
  applyKeyframes(model, context, name, 0, 1, root)
}
