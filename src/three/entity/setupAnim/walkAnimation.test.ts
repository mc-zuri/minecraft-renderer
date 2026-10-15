import { describe, expect, test } from 'vitest'
import { TickedWalk } from './walkAnimation'

describe('the ticked walk', () => {
  test('a position sent is reached over 3 ticks, a third, a half, then the rest of the way', () => {
    const walk = new TickedWalk()
    walk.setPosition({ x: 0, y: 64, z: 0 }, 0)
    walk.advance(0.05, {}, 50)
    walk.setPosition({ x: 0.3, y: 64, z: 0 }, 60)
    const speeds: number[] = []
    for (let i = 0; i < 4; i++) {
      walk.advance(0.05, {}, 100 + i * 50)
      speeds.push(walk.walk.speed)
    }
    // 0.1 a tick for three ticks (target speed 0.4), then still
    const f = Math.fround
    let speed = 0
    const expected = [0.4, 0.4, 0.4, 0].map(target => (speed = f(speed + f(f(f(target) - speed) * f(0.4)))))
    for (const [i, value] of speeds.entries()) expect(value).toBeCloseTo(expected[i]!, 6)
  })

  test('a slow frame covers its ticks with the positions sent before each, as frames of a tick each do', () => {
    const run = (frameTicks: number) => {
      const walk = new TickedWalk()
      walk.setPosition({ x: 0, y: 64, z: 0 }, 0)
      let x = 0
      let now = 0
      for (let tick = 1; tick <= 40; tick++) {
        // a position every tick, 10 ms into it
        x += tick <= 20 ? 0.12 : 0
        walk.setPosition({ x, y: 64, z: 0 }, tick * 50 + 10)
        if (tick % frameTicks === 0) {
          now = (tick + 1) * 50
          walk.advance((frameTicks * 50) / 1000, {}, now)
        }
      }
      return walk.walk
    }
    const smooth = run(1)
    const slow = run(5)
    expect(slow.speed).toBeCloseTo(smooth.speed, 6)
    expect(slow.position).toBeCloseTo(smooth.position, 5)
    expect(smooth.position).toBeGreaterThan(5)
  })
})
