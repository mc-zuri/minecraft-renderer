//@ts-check
import { PlayerAnimation } from 'skinview3d'

const clamp01 = v => Math.max(0, Math.min(1, v))
const mix = (a, b, t) => a + (b - a) * t

function updateElytraRightWing(player) {
  const elytra = player?.elytra
  if (!elytra) return

  if (typeof elytra.updateRightWing === 'function') {
    elytra.updateRightWing()
    return
  }
  if (typeof elytra.updateRightWingRotation === 'function') {
    elytra.updateRightWingRotation()
    return
  }

  const left = elytra.leftWing
  const right = elytra.rightWing
  if (!left?.rotation || !right?.rotation) return
  if (typeof right.rotation.copy === 'function') {
    right.rotation.copy(left.rotation)
    right.rotation.z *= -1
  }
}

export class WalkingGeneralSwing extends PlayerAnimation {
  switchAnimationCallback

  isRunning = false
  isMoving = true

  /**
   * Body posture, orthogonal to the locomotion flags above.
   * @type {'standing' | 'sneaking' | 'swimming' | 'gliding'}
   */
  pose = 'standing'
  /** Extra body pitch (radians) past horizontal while gliding; derived from velocity. */
  glidePitch = 0

  /** Back-compat alias kept for playAnimation('crouch'/'crouchWalking') callers. */
  get isCrouched() {
    return this.pose === 'sneaking'
  }

  set isCrouched(v) {
    if (v) this.pose = 'sneaking'
    else if (this.pose === 'sneaking') this.pose = 'standing'
  }

  _dt = 0
  _phase = 0
  _moveBlend = 0
  _sneakBlend = 0
  _swimBlend = 0
  _glideBlend = 0
  _glidePitchSmooth = 0

  /** @type {number | null} */
  _swingTime = null
  _swingDuration = 0.25

  /** @type {{
    rootPos: any, rootRot: any,
    bodyPos: any, bodyRot: any,
    leftArmPos: any, leftArmRot: any,
    rightArmPos: any, rightArmRot: any,
    leftLegPos: any, leftLegRot: any,
    rightLegPos: any, rightLegRot: any,
    headPos: any, headRot: any,
    capePos: any, capeRot: any,
    elytraPos: any, elytraRot: any,
  } | null} */
  _defaults = null

  update(player, delta) {
    this._dt = delta
    super.update(player, delta)
  }

  swingArm() {
    // Only (re)start once we're past the halfway point of the current swing, like
    // vanilla EntityLiving.swingArm. Otherwise a burst of `animation` packets
    // (rapid clicks / digging) keeps resetting _swingTime and the arm never
    // completes an arc, looking like a stutter of fast partial swings.
    if (this._swingTime === null || this._swingTime >= this._swingDuration / 2) {
      this._swingTime = 0
    }
  }

  _captureDefaults(player) {
    this._defaults = {
      // PlayerObject root: swim/glide pivot the whole model (and running applies
      // a roll), so it must be restored every frame like the individual bones.
      rootPos: player.position.clone(),
      rootRot: player.rotation.clone(),

      bodyPos: player.skin.body.position.clone(),
      bodyRot: player.skin.body.rotation.clone(),

      leftArmPos: player.skin.leftArm.position.clone(),
      leftArmRot: player.skin.leftArm.rotation.clone(),
      rightArmPos: player.skin.rightArm.position.clone(),
      rightArmRot: player.skin.rightArm.rotation.clone(),

      leftLegPos: player.skin.leftLeg.position.clone(),
      leftLegRot: player.skin.leftLeg.rotation.clone(),
      rightLegPos: player.skin.rightLeg.position.clone(),
      rightLegRot: player.skin.rightLeg.rotation.clone(),

      headPos: player.skin.head.position.clone(),
      headRot: player.skin.head.rotation.clone(),

      capePos: player.cape.position.clone(),
      capeRot: player.cape.rotation.clone(),

      elytraPos: player.elytra.position.clone(),
      elytraRot: player.elytra.rotation.clone()
    }
  }

  _applyDefaults(player) {
    const d = this._defaults
    if (!d) return

    player.position.copy(d.rootPos)
    player.rotation.copy(d.rootRot)

    player.skin.body.position.copy(d.bodyPos)
    player.skin.body.rotation.copy(d.bodyRot)

    player.skin.leftArm.position.copy(d.leftArmPos)
    player.skin.leftArm.rotation.copy(d.leftArmRot)
    player.skin.rightArm.position.copy(d.rightArmPos)
    player.skin.rightArm.rotation.copy(d.rightArmRot)

    player.skin.leftLeg.position.copy(d.leftLegPos)
    player.skin.leftLeg.rotation.copy(d.leftLegRot)
    player.skin.rightLeg.position.copy(d.rightLegPos)
    player.skin.rightLeg.rotation.copy(d.rightLegRot)

    player.skin.head.position.copy(d.headPos)
    player.skin.head.rotation.copy(d.headRot)

    player.cape.position.copy(d.capePos)
    player.cape.rotation.copy(d.capeRot)

    player.elytra.position.copy(d.elytraPos)
    player.elytra.rotation.copy(d.elytraRot)
  }

  animate(player) {
    const dt = this._dt || 0

    if (!this._defaults) this._captureDefaults(player)
    this._applyDefaults(player)

    const targetMove = this.isMoving ? 1 : 0
    const kMove = Math.min(1, dt * 20)
    this._moveBlend += (targetMove - this._moveBlend) * kMove

    // ~100ms pose crossfades; all blends run simultaneously so e.g. swim->glide
    // transitions smoothly instead of snapping through standing.
    const kPose = Math.min(1, dt * 10)
    const snap01 = v => (v < 0.001 ? 0 : v > 0.999 ? 1 : v)
    this._sneakBlend = snap01(this._sneakBlend + ((this.pose === 'sneaking' ? 1 : 0) - this._sneakBlend) * kPose)
    this._swimBlend = snap01(this._swimBlend + ((this.pose === 'swimming' ? 1 : 0) - this._swimBlend) * kPose)
    this._glideBlend = snap01(this._glideBlend + ((this.pose === 'gliding' ? 1 : 0) - this._glideBlend) * kPose)
    // Clamp the extra glide pitch so steep dives don't fold the model into
    // the ground (total body pitch stays within ~30..135 degrees).
    const glideTarget = Math.max(-Math.PI / 3, Math.min(Math.PI / 4, this.glidePitch))
    this._glidePitchSmooth += (glideTarget - this._glidePitchSmooth) * kPose

    const speed = this.isRunning ? 10 : 8
    this._phase += dt * speed * this._moveBlend

    const t = this._phase + (this.isRunning ? Math.PI * 0.5 : 0)
    let reset = false

    applyCrouchPose(player, this._sneakBlend)

    const boundary = this.isRunning ? Math.cos(t) : Math.sin(t)
    if (Math.abs(boundary) < 0.02) {
      if (this.switchAnimationCallback) {
        reset = true
      }
    }

    if (this.isRunning) {
      player.skin.leftLeg.rotation.x = Math.cos(t + Math.PI) * 1.3
      player.skin.rightLeg.rotation.x = Math.cos(t) * 1.3
    } else {
      player.skin.leftLeg.rotation.x = Math.sin(t) * 0.5
      player.skin.rightLeg.rotation.x = Math.sin(t + Math.PI) * 0.5
    }

    if (this.isRunning) {
      player.skin.leftArm.rotation.x = Math.cos(t) * 1.5
      player.skin.rightArm.rotation.x = Math.cos(t + Math.PI) * 1.5

      const basicArmRotationZ = Math.PI * 0.1
      player.skin.leftArm.rotation.z = Math.cos(t) * 0.1 + basicArmRotationZ
      player.skin.rightArm.rotation.z = Math.cos(t + Math.PI) * 0.1 - basicArmRotationZ
    } else {
      player.skin.leftArm.rotation.x = Math.sin(t + Math.PI) * 0.5
      player.skin.rightArm.rotation.x = Math.sin(t) * 0.5

      const basicArmRotationZ = Math.PI * 0.02
      player.skin.leftArm.rotation.z = Math.cos(t) * 0.03 + basicArmRotationZ
      player.skin.rightArm.rotation.z = Math.cos(t + Math.PI) * 0.03 - basicArmRotationZ
    }

    if (this._swingTime !== null) {
      this._swingTime += dt
      const p = Math.min(this._swingTime / this._swingDuration, 1)
      HitAnimation.animate(p, player, this.isMoving)
      if (p >= 1) this._swingTime = null
    }

    if (this.isRunning) {
      player.rotation.z = Math.cos(t + Math.PI) * 0.01
    }

    if (this.isRunning) {
      const basicCapeRotationX = Math.PI * 0.3
      player.cape.rotation.x = Math.sin(t * 2) * 0.1 + basicCapeRotationX
    } else {
      const basicCapeRotationX = Math.PI * 0.06
      player.cape.rotation.x = Math.sin(t / 1.5) * 0.06 + basicCapeRotationX
    }

    // Horizontal poses go last: they lerp the limbs away from whatever the
    // walk/run swing above produced, so walking + swimming coexist.
    applySwimPose(player, this._swimBlend, this._phase, this._moveBlend)
    applyGlidePose(player, this._glideBlend, this._glidePitchSmooth)

    if (reset) {
      const cb = this.switchAnimationCallback
      this.switchAnimationCallback = null
      cb?.()
    }
  }
}

const HitAnimation = {
  animate(progress, player, isMovingOrRunning) {
    if (!player?.skin?.rightArm?.rotation) return

    const swing = Math.sin(progress * Math.PI)
    player.skin.rightArm.rotation.x = -0.4537860552 * 2 - 2 * swing * 0.3

    if (!isMovingOrRunning) {
      const basicArmRotationZ = 0.01 * Math.PI + 0.06
      player.skin.rightArm.rotation.z = -swing * 0.403 + basicArmRotationZ
      player.skin.body.rotation.y = -swing * 0.06
      player.skin.leftArm.rotation.x = -swing * 0.077
      player.skin.leftArm.rotation.z = -swing * 0.015 + 0.13 - 0.05
      player.skin.leftArm.position.z = swing * 0.3
      player.skin.leftArm.position.x = 5 - swing * 0.05
    }
  }
}

function applyCrouchPose(player, crouchBlend) {
  const skin = player?.skin
  const cape = player?.cape
  const elytra = player?.elytra
  if (!skin || !cape) return

  const pr = clamp01(crouchBlend)
  const s = Math.abs(Math.sin((pr * Math.PI) / 2))
  if (s <= 0.000001) return

  skin.body.rotation.x += 0.4537860552 * s
  skin.body.position.z += (1.3256181 - 3.4500310377) * s
  skin.body.position.y += -2.103677462 * s

  cape.position.y += -1.851236166577372 * s
  cape.rotation.x += 0.294220265771 * s
  cape.position.z += (3.786619432 - 3.4500310377) * s

  if (elytra?.position) elytra.position.copy(cape.position)
  if (elytra?.rotation) elytra.rotation.copy(cape.rotation)
  if (elytra?.rotation) elytra.rotation.x -= (10.8 * Math.PI) / 180

  if (elytra?.leftWing?.rotation) elytra.leftWing.rotation.z = mix(0.72, 0.26179944 + 0.4582006, s)
  updateElytraRightWing(player)

  skin.head.position.y += -3.618325234674 * s

  const armZ = 0.1 * s
  const armPosZ = (3.618325234674 - 3.4500310377) * s
  const armPosY = -2.53943318 * s

  skin.leftArm.position.z += armPosZ
  skin.rightArm.position.z += armPosZ

  skin.leftArm.rotation.x += 0.410367746202 * s
  skin.rightArm.rotation.x += 0.410367746202 * s

  skin.leftArm.rotation.z += armZ
  skin.rightArm.rotation.z += -armZ

  skin.leftArm.position.y += armPosY
  skin.rightArm.position.y += armPosY

  skin.rightLeg.position.z += -3.4500310377 * s
  skin.leftLeg.position.z += -3.4500310377 * s
}

// Model root sits at the model center, 16 units (1 block) above the feet at
// blend 0. Swim/glide pivot around it and sink it so the horizontal body's
// underside tracks the entity's 0.6-block-high AABB.
const POSE_ROOT_DEFAULT_Y = 16
const POSE_ROOT_HORIZONTAL_Y = 5

/**
 * Swim/crawl: body horizontal, alternate front-crawl arm stroke, flutter kick.
 * Transition targets (root pitch, -PI/4 head, +PI/4 cape, root drop) follow
 * skinview3d's SwimAnimation; the stroke reuses the walk phase so it stops
 * with the entity.
 */
function applySwimPose(player, blend, phase, moveBlend) {
  const b = clamp01(blend)
  if (b <= 0.001) return
  const skin = player?.skin
  if (!skin) return

  player.rotation.x += (Math.PI / 2) * b
  player.position.y += (POSE_ROOT_HORIZONTAL_Y - POSE_ROOT_DEFAULT_Y) * b

  skin.head.rotation.x = mix(skin.head.rotation.x, -Math.PI / 4, b)
  player.cape.rotation.x = mix(player.cape.rotation.x, Math.PI / 4, b)

  // Front-crawl stroke: arms sweep past the head alternately while moving,
  // trail along the body when idle in water.
  const stroke = phase * 0.75
  const strokeAmp = 0.9 * moveBlend
  const idleArmX = Math.PI * 0.9
  skin.leftArm.rotation.x = mix(skin.leftArm.rotation.x, idleArmX + Math.sin(stroke) * strokeAmp, b)
  skin.rightArm.rotation.x = mix(skin.rightArm.rotation.x, idleArmX + Math.sin(stroke + Math.PI) * strokeAmp, b)
  skin.leftArm.rotation.z = mix(skin.leftArm.rotation.z, 0.12, b)
  skin.rightArm.rotation.z = mix(skin.rightArm.rotation.z, -0.12, b)

  // Flutter kick (17.2deg amplitude, from skinview3d), replacing the walk swing.
  const kick = 0.3 * (0.35 + 0.65 * moveBlend)
  skin.leftLeg.rotation.x = mix(skin.leftLeg.rotation.x, Math.cos(phase * 2 + Math.PI) * kick, b)
  skin.rightLeg.rotation.x = mix(skin.rightLeg.rotation.x, Math.cos(phase * 2) * kick, b)
  skin.leftLeg.rotation.z = mix(skin.leftLeg.rotation.z, -0.02, b)
  skin.rightLeg.rotation.z = mix(skin.rightLeg.rotation.z, 0.02, b)
}

/**
 * Elytra glide: body pitched along the velocity vector, arms tucked back,
 * legs together, wings spread. Targets follow skinview3d's FlyingAnimation
 * (head PI/4 - bodyPitch, arm z +-PI/4, wing x 0.349 / z PI/2).
 */
function applyGlidePose(player, blend, glidePitch) {
  const b = clamp01(blend)
  if (b <= 0.001) return
  const skin = player?.skin
  if (!skin) return

  const bodyPitch = Math.PI / 2 + glidePitch
  player.rotation.x += bodyPitch * b
  // Lift the pivot with the pitch so the leading end (head when diving, legs
  // when climbing) stays above the feet/ground instead of clipping into it.
  const pitchLift = Math.sin(Math.min(Math.abs(glidePitch), Math.PI / 2)) * 12
  player.position.y += (POSE_ROOT_HORIZONTAL_Y + pitchLift - POSE_ROOT_DEFAULT_Y) * b

  skin.head.rotation.x = mix(skin.head.rotation.x, Math.PI / 4 - bodyPitch, b)

  skin.leftArm.rotation.x = mix(skin.leftArm.rotation.x, 0.15, b)
  skin.rightArm.rotation.x = mix(skin.rightArm.rotation.x, 0.15, b)
  skin.leftArm.rotation.z = mix(skin.leftArm.rotation.z, Math.PI * 0.25, b)
  skin.rightArm.rotation.z = mix(skin.rightArm.rotation.z, -Math.PI * 0.25, b)

  skin.leftLeg.rotation.x = mix(skin.leftLeg.rotation.x, 0, b)
  skin.rightLeg.rotation.x = mix(skin.rightLeg.rotation.x, 0, b)
  skin.leftLeg.rotation.z = mix(skin.leftLeg.rotation.z, -0.02, b)
  skin.rightLeg.rotation.z = mix(skin.rightLeg.rotation.z, 0.02, b)

  const elytra = player?.elytra
  if (elytra?.leftWing?.rotation) {
    elytra.leftWing.rotation.x = mix(elytra.leftWing.rotation.x, 0.34906584, b)
    elytra.leftWing.rotation.z = mix(elytra.leftWing.rotation.z, Math.PI / 2, b)
    updateElytraRightWing(player)
  }
  player.cape.rotation.x = mix(player.cape.rotation.x, Math.PI * 0.1, b)
}
