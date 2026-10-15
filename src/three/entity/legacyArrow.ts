import * as THREE from 'three'

/**
 * ArrowRenderer before 1.21.2 (the same from 1.8): the arrow is drawn quad by quad, after turning it by its yaw - 90
 * and pitch, then 45 degrees about x, scale 1/16 * 0.9 and 4 pixels back: a square at the fletching (two faces) and
 * four 16 x 4 quads, each turned 90 degrees further about x. The exports before 1.21.2 have it as custom geometry (its
 * texture, no quads); this is the renderer's geometry, in the frame the exports draw an entity facing north in (yaw
 * 180: turned 90 degrees). Quads as [x, y, z, u, v] corners, the texture's v down.
 */
export function legacyArrowQuads(): number[][][] {
  const frame = new THREE.Matrix4()
    .makeRotationY(THREE.MathUtils.degToRad(180 - 90))
    .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(45)))
    .multiply(new THREE.Matrix4().makeScale(0.056_25, 0.056_25, 0.056_25))
    .multiply(new THREE.Matrix4().makeTranslation(-4, 0, 0))
  const quad = (matrix: THREE.Matrix4, corners: number[][]) => corners.map(([x, y, z, u, v]) => {
    const vertex = new THREE.Vector3(x, y, z).applyMatrix4(matrix)
    return [vertex.x, vertex.y, vertex.z, u!, v!]
  })
  const quads = [
    quad(frame, [[-7, -2, -2, 0, 0.156_25], [-7, -2, 2, 0.156_25, 0.156_25], [-7, 2, 2, 0.156_25, 0.3125], [-7, 2, -2, 0, 0.3125]]),
    quad(frame, [[-7, 2, -2, 0, 0.156_25], [-7, 2, 2, 0.156_25, 0.156_25], [-7, -2, 2, 0.156_25, 0.3125], [-7, -2, -2, 0, 0.3125]])
  ]
  const turned = frame.clone()
  for (let i = 0; i < 4; i++) {
    turned.multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(90)))
    quads.push(quad(turned, [[-8, -2, 0, 0, 0], [8, -2, 0, 0.5, 0], [8, 2, 0, 0.5, 0.156_25], [-8, 2, 0, 0, 0.156_25]]))
  }
  return quads
}
