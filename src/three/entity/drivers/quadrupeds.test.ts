import { describe, expect, it } from 'vitest'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers, type EntityAnimInput } from '../entityAnimState'
import { doubleSinCos, f, floatSinCos } from '../setupAnim/mth'
import { QUADRUPEDS_DRIVERS } from './quadrupeds'

registerEntityDrivers(QUADRUPEDS_DRIVERS)

const make = (name: string, meta: Record<string, unknown> = {}, extra: Partial<EntityAnimInput> = {}, version = '26.3') => {
  const input: EntityAnimInput = { name, version, meta, data: {}, bodyYaw: 0, headYaw: 0, pitch: 0, onGround: true, ...extra }
  const tracker = new EntityAnimTracker(name, version)
  tracker.setInput(input)
  return {
    input,
    tracker,
    ticks(n: number) {
      for (let i = 0; i < n; i++) tracker.tick()
    },
    state(partialTick = 0) {
      tracker.walk.partialTick = partialTick
      return entityAnimState(tracker, input)
    }
  }
}

describe('sheep', () => {
  it('eats grass from entity event 10 for 40 ticks', () => {
    const sheep = make('sheep', { wool: 16 | 14 }, { pitch: -0.5 })
    let state = sheep.state()
    expect(state.headEatPositionScale).toBe(0)
    expect(state.headEatAngleScale).toBe(f(f(f(0.5 * 180 / Math.PI) * f(Math.PI / 180))))
    expect(state.isSheared).toBe(true)
    expect(state.woolColor).toBe('RED')
    sheep.tracker.event(10)
    // eatAnimationTick 40: -((40 - 40) - a) / 4
    expect(sheep.state(0.5).headEatPositionScale).toBe(0.125)
    expect(sheep.state(0.5).headEatAngleScale).toBe(f(0.628_318_55))
    sheep.ticks(1)
    expect(sheep.state().headEatPositionScale).toBe(0.25)
    sheep.ticks(3)
    // 36: the head is down, the angle starts nodding: scale ((36 - 4) - a) / 32
    state = sheep.state()
    expect(state.headEatPositionScale).toBe(1)
    expect(state.headEatAngleScale).toBe(f(f(0.628_318_55) + f(f(0.219_911_49) * doubleSinCos.sin(f(1 * f(28.7))))))
    state = sheep.state(0.5)
    expect(state.headEatAngleScale).toBe(f(f(0.628_318_55) + f(f(0.219_911_49) * doubleSinCos.sin(f(f(31.5 / 32) * f(28.7))))))
    sheep.ticks(33)
    // 3: rising again
    expect(sheep.state(0.5).headEatPositionScale).toBe(0.625)
    expect(sheep.state().headEatAngleScale).toBe(f(0.628_318_55))
    sheep.ticks(3)
    expect(sheep.state().headEatPositionScale).toBe(0)
  })

  it('reads the float sin table before 1.21.11, and jeb_', () => {
    const sheep = make('sheep', {}, { customName: 'jeb_' }, '1.20.4')
    sheep.tracker.event(10)
    sheep.ticks(4)
    const state = sheep.state()
    expect(state.headEatAngleScale).toBe(f(f(0.628_318_55) + f(f(0.219_911_49) * floatSinCos.sin(f(28.7)))))
    expect(state.isJebSheep).toBe(true)
    expect(state.woolColor).toBe('WHITE')
  })
})

describe('polar bear', () => {
  it('stands up over 6 ticks while standing and back down', () => {
    const bear = make('polar_bear', { standing: true })
    expect(bear.state().standScale).toBe(0)
    bear.ticks(3)
    expect(bear.state(0.5).standScale).toBe(f(2.5 / 6))
    bear.ticks(10)
    expect(bear.state(0.5).standScale).toBe(1)
    bear.input.meta.standing = false
    bear.ticks(1)
    expect(bear.state(0.5).standScale).toBe(f(5.5 / 6))
    bear.ticks(6)
    expect(bear.state().standScale).toBe(0)
  })
})

describe('panda', () => {
  const add = (from: number, step: number, n: number) => {
    let value = from
    for (let i = 0; i < n; i++) value = Math.min(1, f(value + f(step)))
    return value
  }

  it('sits, lies on its back and their amounts ease in and out', () => {
    const panda = make('panda', { flags: 8 | 16 })
    panda.ticks(2)
    let state = panda.state(0.5)
    expect(state.isSitting).toBe(true)
    expect(state.sitAmount).toBe(f(add(0, 0.15, 1) + f(0.5 * f(add(0, 0.15, 2) - add(0, 0.15, 1)))))
    expect(state.lieOnBackAmount).toBe(state.sitAmount)
    panda.ticks(10)
    expect(panda.state().sitAmount).toBe(1)
    panda.input.meta.flags = 0
    panda.ticks(1)
    // partial tick 0 is the previous tick's amount, 1 this tick's
    expect(panda.state().sitAmount).toBe(1)
    state = panda.state(1)
    expect(state.isSitting).toBe(false)
    expect(state.sitAmount).toBe(f(1 - f(0.19)))
    panda.ticks(6)
    expect(panda.state().sitAmount).toBe(0)
  })

  it('sets the pitch to 0 while sitting', () => {
    const panda = make('panda', { flags: 8 }, { pitch: 0.4 })
    expect(panda.state().xRot).toBe(0)
    panda.input.meta.flags = 0
    expect(panda.state().xRot).toBe(f((-0.4 * 180) / Math.PI))
  })

  it('counts the sneeze up client side and stops it past 20', () => {
    const panda = make('panda', { flags: 2, sneeze_counter: 0 })
    panda.ticks(1)
    expect(panda.state().sneezeTime).toBe(1)
    expect(panda.state().isSneezing).toBe(true)
    // the server's counter replaces the client's when it comes
    panda.input.meta.sneeze_counter = 5
    expect(panda.state().sneezeTime).toBe(5)
    panda.ticks(1)
    expect(panda.state().sneezeTime).toBe(6)
    panda.ticks(14)
    expect(panda.state().sneezeTime).toBe(20)
    expect(panda.state().isSneezing).toBe(true)
    panda.ticks(1)
    const state = panda.state()
    expect(state.isSneezing).toBe(false)
    expect(state.sneezeTime).toBe(0)
  })

  it('rolls for 32 ticks', () => {
    const panda = make('panda', { flags: 4 })
    panda.ticks(1)
    let state = panda.state(0.25)
    expect(state.rollTime).toBe(1.25)
    expect(state.rollAmount).toBe(f(0.25 * f(0.15)))
    panda.ticks(31)
    expect(panda.state().rollTime).toBe(32)
    expect(panda.state().rollAmount).toBe(1)
    panda.ticks(1)
    state = panda.state(1)
    // handleRoll: past 32 the roll stops, the counter resets the next tick
    expect(state.rollTime).toBe(34)
    expect(state.rollAmount).toBe(f(1 - f(0.19)))
    panda.ticks(1)
    expect(panda.state().rollTime).toBe(0)
  })

  it('a baby panda does not roll its head', () => {
    const panda = make('panda', { flags: 4, baby: true })
    panda.ticks(3)
    expect(panda.state().rollAmount).toBe(0)
    expect(panda.state().rollTime).toBe(3)
  })

  it('eats while sitting with an item, counts its unhappiness down', () => {
    const panda = make('panda', { flags: 8, eat_counter: 1, unhappy_counter: 2 }, { equipment: { mainhand: 'bamboo' } })
    expect(panda.state().isEating).toBe(true)
    expect(panda.state().isUnhappy).toBe(true)
    panda.ticks(1)
    expect(panda.state().isEating).toBe(true)
    expect(panda.state().isUnhappy).toBe(true)
    panda.ticks(1)
    expect(panda.state().isUnhappy).toBe(false)
    panda.input.equipment = {}
    panda.ticks(1)
    expect(panda.state().isEating).toBe(false)
  })

  it('a worried panda sits scared in a thunderstorm', () => {
    const panda = make('panda', { main_gene: 2, hidden_gene: 0 })
    ;(panda.input as any).isThundering = true
    panda.ticks(1)
    const state = panda.state(1)
    expect(state.variant).toBe('WORRIED')
    expect(state.isScared).toBe(true)
    expect(state.isSitting).toBe(true)
    expect(state.sitAmount).toBe(f(0.15))
    ;(panda.input as any).isThundering = false
    panda.ticks(1)
    expect(panda.state().isSitting).toBe(false)
    expect(panda.state().isScared).toBe(false)
  })

  it('recessive genes show only when both match', () => {
    expect(make('panda', { main_gene: 4, hidden_gene: 1 }).state().variant).toBe('NORMAL')
    expect(make('panda', { main_gene: 4, hidden_gene: 4 }).state().variant).toBe('BROWN')
    expect(make('panda', { main_gene: 6, hidden_gene: 1 }).state().variant).toBe('AGGRESSIVE')
  })
})

describe('goat', () => {
  it('lowers its head from event 58 and raises it from 59', () => {
    const goat = make('goat', { has_left_horn: false })
    let state = goat.state()
    expect(state.rammingXHeadRot).toBe(0)
    expect(state.hasLeftHorn).toBe(false)
    expect(state.hasRightHorn).toBe(true)
    goat.tracker.event(58)
    goat.ticks(5)
    expect(goat.state().rammingXHeadRot).toBe(f(f(f(5 / 20) * 30) * f(Math.PI / 180)))
    goat.ticks(30)
    expect(goat.state().rammingXHeadRot).toBe(f(30 * f(Math.PI / 180)))
    goat.tracker.event(59)
    goat.ticks(1)
    expect(goat.state().rammingXHeadRot).toBe(f(f(f(18 / 20) * 30) * f(Math.PI / 180)))
    goat.ticks(9)
    state = goat.state()
    expect(state.rammingXHeadRot).toBe(0)
  })

  it('a kid lowers its head further', () => {
    const goat = make('goat', { baby: true })
    goat.tracker.event(58)
    goat.ticks(20)
    expect(goat.state().rammingXHeadRot).toBe(f(f(52.5) * f(Math.PI / 180)))
  })
})

describe('hoglin, zoglin', () => {
  for (const name of ['hoglin', 'zoglin']) {
    it(`${name} headbutts for 10 ticks from event 4`, () => {
      const mob = make(name)
      expect(mob.state().attackAnimationRemainingTicks).toBe(0)
      mob.tracker.event(4)
      expect(mob.state().attackAnimationRemainingTicks).toBe(10)
      mob.ticks(1)
      expect(mob.state(0.9).attackAnimationRemainingTicks).toBe(9)
      mob.ticks(9)
      expect(mob.state().attackAnimationRemainingTicks).toBe(0)
      mob.ticks(1)
      expect(mob.state().attackAnimationRemainingTicks).toBe(0)
    })
  }

  it('a hoglin converts where piglins zombify', () => {
    const hoglin = make('hoglin', { immune_to_zombification: false })
    expect(hoglin.state().isConverting).toBe(false)
    ;(hoglin.input as any).piglinsZombify = true
    expect(hoglin.state().isConverting).toBe(true)
    hoglin.input.meta.mob_flags = 1
    expect(hoglin.state().isConverting).toBe(false)
  })
})

describe('turtle', () => {
  it('is on land on the ground out of water, lays and carries eggs', () => {
    const turtle = make('turtle', { has_egg: true, laying_egg: true })
    let state = turtle.state()
    expect(state.isOnLand).toBe(true)
    expect(state.hasEgg).toBe(true)
    expect(state.isLayingEgg).toBe(true)
    ;(turtle.input as any).isInWater = true
    expect(turtle.state().isOnLand).toBe(false)
    ;(turtle.input as any).isInWater = false
    turtle.input.onGround = false
    expect(turtle.state().isOnLand).toBe(false)
    turtle.input.meta.baby = true
    state = turtle.state()
    expect(state.hasEgg).toBe(false)
  })
})

describe('llama', () => {
  it('carries a chest when grown, its variant and carpet', () => {
    const llama = make('llama', { chest: true, variant: 2 }, { equipment: { body: 'red_carpet' } })
    let state = llama.state()
    expect(state.hasChest).toBe(true)
    expect(state.variant).toBe('BROWN')
    expect(state.bodyItem).toBe('red_carpet')
    expect(state.isTraderLlama).toBe(false)
    llama.input.meta.baby = true
    expect(llama.state().hasChest).toBe(false)
    const trader = make('trader_llama', { variant: 9, swag: 3 }, {}, '1.19.4')
    state = trader.state()
    expect(state.isTraderLlama).toBe(true)
    expect(state.variant).toBe('GRAY')
    expect(state.bodyItem).toBe('light_blue_carpet')
  })
})

describe('ravager', () => {
  it('attacks for 10 ticks from event 4', () => {
    const ravager = make('ravager')
    ravager.tracker.event(4)
    expect(ravager.state(0.25).attackTicksRemaining).toBe(9.75)
    ravager.ticks(1)
    expect(ravager.state(0.5).attackTicksRemaining).toBe(8.5)
    ravager.ticks(9)
    expect(ravager.state(0.5).attackTicksRemaining).toBe(0)
    expect(ravager.state().roarAnimation).toBe(0)
  })

  it('is stunned for 40 ticks from event 39, then roars for 20', () => {
    const ravager = make('ravager')
    ravager.tracker.event(39)
    expect(ravager.state(0.5).stunnedTicksRemaining).toBe(39.5)
    ravager.ticks(39)
    expect(ravager.state().stunnedTicksRemaining).toBe(1)
    expect(ravager.state().roarAnimation).toBe(0)
    ravager.ticks(1)
    // the stun ended this tick: roarTick 20, roarAnimation ((20 - 20) + a) / 20
    let state = ravager.state(0.5)
    expect(state.stunnedTicksRemaining).toBe(0)
    expect(state.roarAnimation).toBe(f(0.5 / 20))
    ravager.ticks(1)
    state = ravager.state(0.5)
    expect(state.roarAnimation).toBe(f(1.5 / 20))
    ravager.ticks(19)
    expect(ravager.state(0.5).roarAnimation).toBe(0)
  })

  it('a dead ravager stops counting', () => {
    const ravager = make('ravager', { health: 0 })
    ravager.tracker.event(4)
    ravager.ticks(3)
    expect(ravager.state().attackTicksRemaining).toBe(10)
  })
})

describe('llama spit', () => {
  it('turns along its rotation', () => {
    const spit = make('llama_spit', {}, { bodyYaw: Math.PI / 2, pitch: 0.1 })
    const state = spit.state()
    expect(state.yRot).toBe(90)
    expect(state.xRot).toBe(f((-0.1 * 180) / Math.PI))
  })
})

describe('mooshroom, pig', () => {
  it('mooshroom variant by id or name', () => {
    expect(make('mooshroom', { type: 1 }).state().variant).toBe('BROWN')
    expect(make('mooshroom', { type: 0 }).state().variant).toBe('RED')
    expect(make('mooshroom', { type: 'brown' }, {}, '1.20.4').state().variant).toBe('BROWN')
  })

  it('pig saddle from the slot or the old synched data', () => {
    expect(make('pig', {}, { equipment: { saddle: 'saddle' } }).state().saddle).toBe('saddle')
    expect(make('pig', { saddle: true }, {}, '1.20.4').state().saddle).toBe('saddle')
    expect(make('pig').state().saddle).toBeUndefined()
  })
})
