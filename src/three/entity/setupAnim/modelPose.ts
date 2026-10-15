import type { EntityModelPart } from 'mc-assets/dist/entityModels'

/**
 * A model's parts as the game's ModelPart fields (x, y, z, xRot, yRot, zRot, scales, visible, skipDraw), for the ports of
 * the models' setupAnim: every frame they start from the layer's initial pose (Model.resetPose) and write what the game's
 * code writes.
 */
export class PartPose {
  x = 0
  y = 0
  z = 0
  xRot = 0
  yRot = 0
  zRot = 0
  xScale = 1
  yScale = 1
  zScale = 1
  visible = true
  skipDraw = false
  /** set when setupAnim (or a keyframe animation) wrote the part this frame */
  touched = false

  constructor(
    readonly name: string,
    readonly path: string,
    readonly initial: readonly number[],
    readonly initialScale: readonly number[]
  ) {
    this.reset()
  }

  reset() {
    ;[this.x, this.y, this.z, this.xRot, this.yRot, this.zRot] = [0, 1, 2, 3, 4, 5].map(i => this.initial[i] ?? 0) as [number, number, number, number, number, number]
    ;[this.xScale, this.yScale, this.zScale] = [0, 1, 2].map(i => this.initialScale[i] ?? 1) as [number, number, number]
  }

  /** ModelPart.loadPose / PartPose: position and rotation at once. */
  setPos(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
  }

  setRotation(xRot: number, yRot: number, zRot: number) {
    this.xRot = xRot
    this.yRot = yRot
    this.zRot = zRot
  }

  /** ModelPart.copyFrom: another part's position and rotation (not scale or visibility). */
  copyFrom(other: PartPose) {
    this.xRot = other.xRot
    this.yRot = other.yRot
    this.zRot = other.zRot
    this.x = other.x
    this.y = other.y
    this.z = other.z
  }

  /** The pose as the export writes it: x, y, z, xRot, yRot, zRot. */
  get pose() {
    return [this.x, this.y, this.z, this.xRot, this.yRot, this.zRot]
  }

  get scale() {
    return [this.xScale, this.yScale, this.zScale]
  }

  /** Does the pose differ from the initial one (the export lists only those). */
  get moved() {
    const pose = this.pose
    const scale = this.scale
    return pose.some((value, i) => value !== (this.initial[i] ?? 0)) || scale.some((value, i) => value !== (this.initialScale[i] ?? 1))
  }
}

export class ModelPose {
  /** every part by path from the model's root ('' is the root) */
  readonly byPath = new Map<string, PartPose>()
  private readonly byName = new Map<string, PartPose[]>()

  constructor(root: EntityModelPart) {
    const add = (part: EntityModelPart, name: string, path: string) => {
      const pose = new PartPose(name, path, part.pose ?? [], part.scale ?? [])
      this.byPath.set(path, pose)
      if (!this.byName.has(name)) this.byName.set(name, [])
      this.byName.get(name)!.push(pose)
      for (const [childName, child] of Object.entries(part.children ?? {})) add(child, childName, `${path}/${childName}`)
    }
    add(root, 'root', '')
  }

  get root() {
    return this.byPath.get('')!
  }

  /** The part of that name (the model's field): a path from the root when names repeat ('body/tail'). */
  part(name: string): PartPose {
    const found = this.maybe(name)
    if (!found) throw new Error(`no part ${name}`)
    return found
  }

  /** The part, or undefined when the model has none of that name. */
  maybe(name: string): PartPose | undefined {
    if (name.includes('/')) return this.byPath.get(name.startsWith('/') ? name : `/${name}`)
    const parts = this.byName.get(name)
    if (parts && parts.length > 1) throw new Error(`part name ${name} is not unique: ${parts.map(p => p.path).join(', ')}`)
    return parts?.[0]
  }

  has(name: string) {
    return this.byName.has(name)
  }

  /** Every part under this one (the part itself first), ModelPart.getAllParts. */
  allParts(from: PartPose = this.root): PartPose[] {
    return [...this.byPath.values()].filter(part => part.path === from.path || part.path.startsWith(`${from.path}/`))
  }

  /** Model.resetPose: every part back to its initial pose; visibility stays. */
  resetPose() {
    for (const part of this.byPath.values()) {
      part.reset()
      part.touched = false
    }
  }
}
