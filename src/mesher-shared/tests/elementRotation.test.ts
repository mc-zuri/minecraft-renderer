import { describe, expect, test } from 'vitest'
import { buildElementRotation, buildRotationMatrix, matmul3, vecadd3 } from '../modelsGeometryCommon'

const rotate = (rotation, point: number[]) => {
  const { localMatrix, localShift } = buildElementRotation(rotation)
  return vecadd3(matmul3(localMatrix, point), localShift)
}

const expectClose = (actual: number[], expected: number[]) => {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6))
}

describe('x/y/z element rotation (26.x)', () => {
  const origin = [8, 4, 8]
  const point = [3, 11, 14]

  test('with one angle, matches the axis/angle rotation', () => {
    for (const axis of ['x', 'y', 'z']) {
      expectClose(rotate({ origin, [axis]: 35 }, point), rotate({ origin, axis, angle: 35 }, point))
    }
  })

  test('applies x, then y, then z, about the origin (rotationZYX(z, y, x))', () => {
    const angles = { x: -40, y: 3, z: -2.5 }
    let expected = point.map((value, i) => value - origin[i]!)
    for (const axis of ['x', 'y', 'z']) expected = matmul3(buildRotationMatrix(axis, angles[axis]), expected)
    expected = expected.map((value, i) => value + origin[i]!)
    expectClose(rotate({ origin, ...angles }, point), expected)
  })

  test('leaves the origin in place', () => {
    expectClose(rotate({ origin, x: 30, y: 60, z: 90 }, origin), origin)
  })
})
