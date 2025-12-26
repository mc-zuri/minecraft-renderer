//@ts-check
import { PlayerAnimation } from 'skinview3d'

export class WalkingGeneralSwing extends PlayerAnimation {
  switchAnimationCallback

  isRunning = false
  isMoving = true
  isCrouched = false

  _dt = 0
  _phase = 0
  _moveBlend = 0

  /** @type {number | null} */
  _swingTime = null
  _swingDuration = 0.25

  /** @type {{
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
    this._swingTime = 0
  }

  _captureDefaults(player) {
    this._defaults = {
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
      elytraRot: player.elytra.rotation.clone(),
    }
  }

  _applyDefaults(player) {
    const d = this._defaults
    if (!d) return

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

    const speed = this.isRunning ? 10 : 8
    this._phase += dt * speed * this._moveBlend

    const t = this._phase + (this.isRunning ? Math.PI * 0.5 : 0)
    let reset = false

    croughAnimation(player, this.isCrouched)

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

    // swing overlay (doesn't depend on progress)
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

    if (reset) {
      const cb = this.switchAnimationCallback
      this.switchAnimationCallback = null
      cb?.()
    }
  }
}

const HitAnimation = {
  animate(progress, player, isMovingOrRunning) {
    const t = progress * 18
    player.skin.rightArm.rotation.x = -0.453_786_055_2 * 2 + 2 * Math.sin(t + Math.PI) * 0.3

    if (!isMovingOrRunning) {
      const basicArmRotationZ = 0.01 * Math.PI + 0.06
      player.skin.rightArm.rotation.z = -Math.cos(t) * 0.403 + basicArmRotationZ
      player.skin.body.rotation.y = -Math.cos(t) * 0.06
      player.skin.leftArm.rotation.x = Math.sin(t + Math.PI) * 0.077
      player.skin.leftArm.rotation.z = -Math.cos(t) * 0.015 + 0.13 - 0.05
      player.skin.leftArm.position.z = Math.cos(t) * 0.3
      player.skin.leftArm.position.x = 5 - Math.cos(t) * 0.05
    }
  },
}

const croughAnimation = (player, isCrouched) => {
  let pr = isCrouched ? 1 : 0

  player.skin.body.rotation.x = 0.453_786_055_2 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.skin.body.position.z =
    1.325_618_1 * Math.abs(Math.sin((pr * Math.PI) / 2)) - 3.450_031_037_7 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.skin.body.position.y = -6 - 2.103_677_462 * Math.abs(Math.sin((pr * Math.PI) / 2))

  player.cape.position.y = 8 - 1.851_236_166_577_372 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.cape.rotation.x = (10.8 * Math.PI) / 180 + 0.294_220_265_771 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.cape.position.z =
    -2 + 3.786_619_432 * Math.abs(Math.sin((pr * Math.PI) / 2)) - 3.450_031_037_7 * Math.abs(Math.sin((pr * Math.PI) / 2))

  player.elytra.position.x = player.cape.position.x
  player.elytra.position.y = player.cape.position.y
  player.elytra.position.z = player.cape.position.z
  player.elytra.rotation.x = player.cape.rotation.x - (10.8 * Math.PI) / 180

  const pr1 = 1
  if (Math.abs(Math.sin((pr * Math.PI) / 2)) === 1) {
    player.elytra.leftWing.rotation.z =
      0.261_799_44 + 0.458_200_6 * Math.abs(Math.sin((Math.min(pr1, 1) * Math.PI) / 2))
    player.elytra.updateRightWing()
  } else if (isCrouched !== undefined) {
    player.elytra.leftWing.rotation.z =
      0.72 - 0.458_200_6 * Math.abs(Math.sin((Math.min(pr1, 1) * Math.PI) / 2))
    player.elytra.updateRightWing()
  }

  player.skin.head.position.y = -3.618_325_234_674 * Math.abs(Math.sin((pr * Math.PI) / 2))

  player.skin.leftArm.position.z =
    3.618_325_234_674 * Math.abs(Math.sin((pr * Math.PI) / 2)) - 3.450_031_037_7 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.skin.rightArm.position.z = player.skin.leftArm.position.z

  player.skin.leftArm.rotation.x = 0.410_367_746_202 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.skin.rightArm.rotation.x = player.skin.leftArm.rotation.x

  player.skin.leftArm.rotation.z = 0.1
  player.skin.rightArm.rotation.z = -player.skin.leftArm.rotation.z

  player.skin.leftArm.position.y = -2 - 2.539_433_18 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.skin.rightArm.position.y = player.skin.leftArm.position.y

  player.skin.rightLeg.position.z = -3.450_031_037_7 * Math.abs(Math.sin((pr * Math.PI) / 2))
  player.skin.leftLeg.position.z = player.skin.rightLeg.position.z
}
