/**
 * Vision3D - Helper Utilities
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 */

import * as THREE from 'three'
import { SHAPE_DEFINITIONS } from './constants'
import type { ShapeDefaults } from './constants'
import { debug } from './logger'
import { createGeometry } from './geometry'

let idCounter = 0

export function generateShapeId(): string {
  idCounter += 1
  return `shape_${Date.now()}_${idCounter}`
}

export interface CreatedShape {
  id: string
  type: string
  name: string
  position: number[]
  rotation: number[]
  scale: number[]
  color: string
  isHole: boolean
  visible: boolean
  locked: boolean
  width?: number
  height?: number
  depth?: number
  cornerRadius: number
  radiusTop?: number
  radiusBottom?: number
  cylinderHeight?: number
  radialSegments?: number
  taper: number
  radius?: number
  widthSegments?: number
  heightSegments?: number
  coneRadius?: number
  coneHeight?: number
  torusRadius?: number
  tubeRadius?: number
  torusRadialSegments?: number
  torusTubularSegments?: number
  roofWidth?: number
  roofDepth?: number
  roofHeight?: number
  roundRoofWidth?: number
  roundRoofDepth?: number
  roundRoofHeight?: number
  wedgeWidth?: number
  wedgeDepth?: number
  wedgeHeight?: number
  pyramidRadius?: number
  pyramidHeight?: number
  pyramidSides?: number
  halfSphereRadius?: number
  halfSphereSegments?: number
  paraboloidRadius?: number
  paraboloidHeight?: number
  paraboloidSegments?: number
  tubeOuterRadius?: number
  tubeInnerRadius?: number
  tubeHeight?: number
  tubeRadialSegments?: number
  starOuterRadius?: number
  starInnerRadius?: number
  starPoints?: number
  starHeight?: number
  polygonRadius?: number
  polygonSides?: number
  polygonHeight?: number
  innerRadius?: number
  outerRadius?: number
  text?: string
  fontSize?: number
  textDepth?: number
  metalness: number
  roughness: number
  opacity: number
  children?: string[]
  parentId?: string
  [key: string]: unknown
}

export function createShape(type: string, position: number[] = [0, 0, 0]): CreatedShape {
  debug('createShape:', type, 'at', position)
  const definition = SHAPE_DEFINITIONS.find((d) => d.type === type)
  if (!definition) {
    throw new Error(`Unknown shape type: ${type}`)
  }

  const id = generateShapeId()
  const defaults = definition.defaults as ShapeDefaults

  return {
    id,
    type,
    name: definition.name,
    position: (defaults.position as number[]) || position,
    rotation: (defaults.rotation as number[]) || [0, 0, 0],
    scale: (defaults.scale as number[]) || [1, 1, 1],
    color: defaults.color || '#4F46E5',
    isHole: false,
    visible: true,
    locked: false,
    width: defaults.width,
    height: defaults.height,
    depth: defaults.depth,
    cornerRadius: defaults.cornerRadius || 0,
    radiusTop: defaults.radiusTop,
    radiusBottom: defaults.radiusBottom,
    cylinderHeight: defaults.cylinderHeight,
    radialSegments: defaults.radialSegments,
    taper: defaults.taper || 0,
    radius: defaults.radius,
    widthSegments: defaults.widthSegments,
    heightSegments: defaults.heightSegments,
    coneRadius: defaults.coneRadius,
    coneHeight: defaults.coneHeight,
    torusRadius: defaults.torusRadius,
    tubeRadius: defaults.tubeRadius,
    torusRadialSegments: defaults.torusRadialSegments,
    torusTubularSegments: defaults.torusTubularSegments,
    roofWidth: defaults.roofWidth,
    roofDepth: defaults.roofDepth,
    roofHeight: defaults.roofHeight,
    roundRoofWidth: defaults.roundRoofWidth,
    roundRoofDepth: defaults.roundRoofDepth,
    roundRoofHeight: defaults.roundRoofHeight,
    wedgeWidth: defaults.wedgeWidth,
    wedgeDepth: defaults.wedgeDepth,
    wedgeHeight: defaults.wedgeHeight,
    pyramidRadius: defaults.pyramidRadius,
    pyramidHeight: defaults.pyramidHeight,
    pyramidSides: defaults.pyramidSides,
    halfSphereRadius: defaults.halfSphereRadius,
    halfSphereSegments: defaults.halfSphereSegments,
    paraboloidRadius: defaults.paraboloidRadius,
    paraboloidHeight: defaults.paraboloidHeight,
    paraboloidSegments: defaults.paraboloidSegments,
    tubeOuterRadius: defaults.tubeOuterRadius,
    tubeInnerRadius: defaults.tubeInnerRadius,
    tubeHeight: defaults.tubeHeight,
    tubeRadialSegments: defaults.tubeRadialSegments,
    starOuterRadius: defaults.starOuterRadius,
    starInnerRadius: defaults.starInnerRadius,
    starPoints: defaults.starPoints,
    starHeight: defaults.starHeight,
    polygonRadius: defaults.polygonRadius,
    polygonSides: defaults.polygonSides,
    polygonHeight: defaults.polygonHeight,
    innerRadius: defaults.innerRadius,
    outerRadius: defaults.outerRadius,
    text: defaults.text,
    fontSize: defaults.fontSize,
    textDepth: defaults.textDepth,
    metalness: 0.1,
    roughness: 0.7,
    opacity: 1,
  }
}

export function cloneShape<T extends Record<string, unknown>>(shape: T): T {
  const newId = generateShapeId()
  debug('cloneShape:', shape.id, '->', newId)
  return {
    ...shape,
    id: newId,
    name: `${(shape as Record<string, unknown>).name}_copy`,
    position: [...((shape as Record<string, unknown>).position as number[])],
    rotation: [...((shape as Record<string, unknown>).rotation as number[])],
    scale: [...((shape as Record<string, unknown>).scale as number[])],
    children: undefined,
    parentId: undefined,
  } as T
}

export function getShapesCenter(
  shapes: Array<{ position: number[] }>
): [number, number, number] {
  if (shapes.length === 0) return [0, 0, 0]
  const sum = shapes.reduce(
    (acc, shape) => [
      acc[0] + shape.position[0],
      acc[1] + shape.position[1],
      acc[2] + shape.position[2],
    ],
    [0, 0, 0]
  )
  return [sum[0] / shapes.length, sum[1] / shapes.length, sum[2] / shapes.length]
}

export function snapToGrid(value: number, gridSize: number): number {
  if (!gridSize || gridSize === 0) return value
  const result = Math.round(value / gridSize) * gridSize
  if (Math.abs(result - value) > 0.001) {
    debug('snapToGrid:', value.toFixed(3), '->', result.toFixed(3), `(grid: ${gridSize})`)
  }
  // Guard against NaN/Infinity from bad gridSize
  if (!Number.isFinite(result)) return value
  return result
}

export function snapPositionToGrid(position: number[], gridSize: number): number[] {
  if (!gridSize || gridSize === 0) return [...position]
  const snapped = [
    snapToGrid(position[0], gridSize),
    snapToGrid(position[1], gridSize),
    snapToGrid(position[2], gridSize),
  ]
  // If any became non-finite, return original
  if (snapped.some((v) => !Number.isFinite(v))) return [...position]
  return snapped
}

export function validateShape(shape: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (!shape.type) errors.push('Shape type is required')
  if (!shape.id) errors.push('Shape ID is required')
  if (shape.position) {
    if (!Array.isArray(shape.position) || (shape.position as unknown[]).length !== 3) {
      errors.push('Position must be a 3-element array')
    }
  }
  if (shape.scale) {
    if (!Array.isArray(shape.scale) || (shape.scale as unknown[]).length !== 3) {
      errors.push('Scale must be a 3-element array')
    }
    if ((shape.scale as number[]).some((s) => s <= 0)) {
      errors.push('Scale values must be positive')
    }
  }
  return errors
}
