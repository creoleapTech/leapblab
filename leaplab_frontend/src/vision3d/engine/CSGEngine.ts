/**
 * Vision3D - CSG Boolean Engine
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 *
 * Implements Union, Subtract, and Intersect operations
 * using three-bvh-csg for real constructive solid geometry.
 */

import * as THREE from 'three'
import { Evaluator, Brush, ADDITION, INTERSECTION, HOLLOW_SUBTRACTION } from 'three-bvh-csg'
import { createGeometry } from '../utils/geometry'
import { generateShapeId } from '../utils/helpers'
import { log, debug, error } from '../utils/logger'

interface ShapeData {
  id: string
  type: string
  name: string
  position: [number, number, number] | number[]
  rotation?: [number, number, number] | number[]
  scale?: [number, number, number] | number[]
  color?: string
  metalness?: number
  roughness?: number
  opacity?: number
  visible: boolean
  locked?: boolean
  isHole?: boolean
  parentId?: string
  _csgGeometry?: THREE.BufferGeometry | Record<string, unknown>
  _customGeometry?: THREE.BufferGeometry | Record<string, unknown>
  [key: string]: unknown
}

type CSGOperationType = 'union' | 'subtract' | 'intersect'

const evaluator = new Evaluator()

function buildGeometry(shape: ShapeData): THREE.BufferGeometry {
  const geo = createGeometry(shape)
  geo.computeBoundingBox()
  return geo
}

function createBrush(shape: ShapeData): Brush {
  const geometry = buildGeometry(shape)
  const matrix = new THREE.Matrix4()

  const pos = shape.position as number[]
  const scl = (shape.scale as number[] | undefined) || [1, 1, 1]
  const rot = (shape.rotation as number[] | undefined) || [0, 0, 0]
  matrix.compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0)
    ),
    new THREE.Vector3(scl[0], scl[1], scl[2])
  )

  geometry.applyMatrix4(matrix)

  const brush = new Brush(geometry)
  brush.updateMatrixWorld()
  return brush
}

export function performCSG(
  shapeA: ShapeData,
  shapeB: ShapeData,
  operation: CSGOperationType
): ShapeData | null {
  debug(`CSG: ${operation} on ${shapeA.type} + ${shapeB.type}`)

  try {
    const brushA = createBrush(shapeA)
    const brushB = createBrush(shapeB)

    let csgOp: unknown
    switch (operation) {
      case 'union':
        csgOp = ADDITION
        break
      case 'subtract':
        csgOp = HOLLOW_SUBTRACTION
        break
      case 'intersect':
        csgOp = INTERSECTION
        break
      default:
        error('CSG: unknown operation:', operation)
        return null
    }

    const result = evaluator.evaluate(brushA, brushB, csgOp as never)

    if (!result || !result.geometry) {
      error('CSG: operation produced no result')
      return null
    }

    const finalGeometry = result.geometry.toNonIndexed()
    // Validate: three-bvh-csg can silently return empty geometry for disjoint torus/box or non-manifold cases – treat as failure so caller keeps original structure instead of "deleting" it
    const posCount = (finalGeometry.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0
    if (posCount === 0) {
      error('CSG: result has 0 vertices – likely disjoint or non-manifold (e.g., torus), treating as failure')
      return null
    }
    finalGeometry.computeVertexNormals()
    finalGeometry.computeBoundingBox()
    finalGeometry.computeBoundingSphere()

    const bbox = finalGeometry.boundingBox!
    if (!bbox) {
      error('CSG: no bounding box on result')
      return null
    }
    const center = new THREE.Vector3()
    bbox.getCenter(center)

    finalGeometry.translate(-center.x, -center.y, -center.z)

    const newShape: ShapeData = {
      id: generateShapeId(),
      type: 'csg_result',
      name: `CSG ${operation}`,
      position: [center.x, center.y, center.z] as [number, number, number],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: shapeA.color || '#6366f1',
      metalness: shapeA.metalness ?? 0.1,
      roughness: shapeA.roughness ?? 0.7,
      opacity: 1,
      visible: true,
      locked: false,
      isHole: false,
      parentId: shapeA.parentId || shapeB.parentId || undefined,
      _csgGeometry: finalGeometry,
    }

    log(
      `CSG: ${operation} completed, result has ${finalGeometry.attributes.position?.count || 0} vertices`
    )
    return newShape
  } catch (err) {
    error('CSG operation failed:', err)
    return null
  }
}

export function performMultiCSG(
  shapes: ShapeData[],
  operation: CSGOperationType
): ShapeData | null {
  if (shapes.length < 2) return null

  let result: ShapeData | null = shapes[0]
  for (let i = 1; i < shapes.length; i++) {
    result = performCSG(result, shapes[i], operation)
    if (!result) return null
  }
  return result
}

export function isCSGValid(shapes: ShapeData[]): boolean {
  if (shapes.length < 2) return false
  return shapes.every((s) => s.visible && !s.locked)
}
