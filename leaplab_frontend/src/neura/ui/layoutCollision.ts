// Non-colliding layout rule for Neura canvas — brain / classes / predictor never overlap
// Each node is treated as an axis-aligned bounding box; we enforce minimum gap.

export type Pos = { x: number; y: number }
export type Rect = Pos & { w: number; h: number }

const GAP = 32 // minimum gap between nodes
const CLASS_W = 344
const CLASS_H = 320 // approx with 8 images expanded may be taller; we use conservative 360
const DATASET_W = 720
const DATASET_H = 360
const BRAIN_W = 400
const BRAIN_H = 420
const VISION_W = 420
const VISION_H = 520

function overlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w + GAP <= b.x || b.x + b.w + GAP <= a.x || a.y + a.h + GAP <= b.y || b.y + b.h + GAP <= a.y)
}

export function getClassRect(id: string, pos: Pos, expanded?: boolean): Rect {
  const h = expanded ? 420 : CLASS_H
  return { x: pos.x, y: pos.y, w: CLASS_W, h }
}
export function getDatasetRect(pos: Pos): Rect { return { x: pos.x, y: pos.y, w: DATASET_W, h: DATASET_H } }
export function getBrainRect(pos: Pos): Rect { return { x: pos.x, y: pos.y, w: BRAIN_W, h: BRAIN_H } }
export function getVisionRect(pos: Pos): Rect { return { x: pos.x, y: pos.y, w: VISION_W, h: VISION_H } }

/**
 * Ensures brain and vision are to the right of all classes/dataset and never overlap.
 * Called on project load, class add, and after drag end.
 * Returns adjusted brainPos / visionPos (classPositions unchanged — classes are primary).
 */
export function layoutNonColliding(
  classPositions: Record<string, Pos>,
  brainPos: Pos,
  visionPos: Pos,
  opts: { isSingleDataset?: boolean; datasetPos?: Pos; expandedClasses?: Record<string, boolean> } = {}
): { brainPos: Pos; visionPos: Pos } {
  const { isSingleDataset, datasetPos, expandedClasses } = opts

  // collect all left nodes (classes or dataset)
  const leftRects: Rect[] = []
  if (isSingleDataset && datasetPos) {
    leftRects.push(getDatasetRect(datasetPos))
  } else {
    for (const [id, pos] of Object.entries(classPositions)) {
      const exp = expandedClasses?.[id]
      leftRects.push(getClassRect(id, pos, !!exp))
    }
  }

  // if no left nodes, keep brain/vision as is but ensure they don't overlap each other
  let maxRight = 48 + CLASS_W // minimum
  let maxBottom = 80
  for (const r of leftRects) {
    maxRight = Math.max(maxRight, r.x + r.w)
    maxBottom = Math.max(maxBottom, r.y + r.h)
  }

  let newBrain = { ...brainPos }
  let newVision = { ...visionPos }

  // Place brain to the right of left nodes with gap, keep y near top but avoid vertical overlap if needed
  const desiredBrainX = maxRight + 80
  if (newBrain.x < desiredBrainX) newBrain.x = desiredBrainX
  // If brain vertically overlaps any left node at same x-range, push down
  // Simple: keep brain y at least max 80, but if left nodes are tall, keep brain y = 80 as well (horizontal separation is enough)
  // Horizontal separation already ensures no overlap if x gap enforced, so y can stay.

  // Ensure brain and vision don't overlap each other
  const brainRect = getBrainRect(newBrain)
  const visionRect = getVisionRect(newVision)
  if (overlap(brainRect, visionRect)) {
    // push vision to the right of brain
    newVision.x = brainRect.x + brainRect.w + 80
  }
  // Also ensure vision is to the right of left nodes
  const desiredVisionX = Math.max(newVision.x, maxRight + 80 + BRAIN_W + 80)
  // Actually vision should be to right of brain, which already is to right of left, so just ensure.
  if (newVision.x < desiredBrainX + BRAIN_W + 80) {
    // if brain was pushed, vision must be pushed again
    const br = getBrainRect(newBrain)
    newVision.x = br.x + br.w + 80
  }

  // Clamp to canvas bounds (3000x2000) — keep visible within reasonable area
  newBrain.x = Math.min(Math.max(newBrain.x, 48), 2600 - BRAIN_W)
  newBrain.y = Math.min(Math.max(newBrain.y, 24), 1600 - BRAIN_H)
  newVision.x = Math.min(Math.max(newVision.x, 48), 2600 - VISION_W)
  newVision.y = Math.min(Math.max(newVision.y, 24), 1600 - VISION_H)

  return { brainPos: newBrain, visionPos: newVision }
}

export type NudgeOpts = {
  isSingleDataset?: boolean
  datasetPos?: Pos
  expandedClasses?: Record<string, boolean>
  /**
   * Last committed (valid) position of the dragged node.
   * When provided, an invalid candidate snaps back to this position
   * (stick) instead of teleporting — this eliminates tab flicker when
   * the cursor hovers an unavailable slot.
   */
  fallback?: Pos
}

const CANVAS_W = 3000
const CANVAS_H = 2000

function getNodeSize(draggedId: string, expandedClasses?: Record<string, boolean>): { w: number; h: number } {
  if (draggedId === 'brain') return { w: BRAIN_W, h: BRAIN_H }
  if (draggedId === 'vision' || draggedId === 'listen') return { w: VISION_W, h: VISION_H }
  if (draggedId === 'dataset') return { w: DATASET_W, h: DATASET_H }
  return { w: CLASS_W, h: (expandedClasses?.[draggedId] ? 420 : CLASS_H) }
}

function clampToBounds(pos: Pos, w: number, h: number): Pos {
  return {
    x: Math.min(Math.max(pos.x, 0), Math.max(0, CANVAS_W - w)),
    y: Math.min(Math.max(pos.y, 0), Math.max(0, CANVAS_H - h)),
  }
}

function buildOthers(
  draggedId: string,
  classPositions: Record<string, Pos>,
  brainPos: Pos,
  visionPos: Pos,
  opts: NudgeOpts
): Rect[] {
  const { isSingleDataset, datasetPos, expandedClasses } = opts
  const others: Rect[] = []
  if (isSingleDataset) {
    if (draggedId !== 'dataset' && datasetPos) others.push(getDatasetRect(datasetPos))
  } else {
    for (const [id, pos] of Object.entries(classPositions)) {
      if (id === draggedId) continue
      others.push(getClassRect(id, pos, !!expandedClasses?.[id]))
    }
  }
  if (draggedId !== 'brain') others.push(getBrainRect(brainPos))
  // 'listen' is the audio-panel alias for the vision/predictor node
  if (draggedId !== 'vision' && draggedId !== 'listen') others.push(getVisionRect(visionPos))
  return others
}

function isRectFree(r: Rect, others: Rect[]): boolean {
  return !others.some(o => overlap(r, o))
}

/**
 * Returns true when the candidate position would collide with another node
 * or fall outside the canvas. Useful for invalid-slot UI feedback.
 */
export function isCollidingPosition(
  draggedId: string,
  candidate: Pos,
  classPositions: Record<string, Pos>,
  brainPos: Pos,
  visionPos: Pos,
  opts: NudgeOpts = {}
): boolean {
  const { w, h } = getNodeSize(draggedId, opts.expandedClasses)
  const clamped = clampToBounds(candidate, w, h)
  // Treat out-of-bounds as colliding so callers snap back instead of jumping
  if (clamped.x !== candidate.x || clamped.y !== candidate.y) return true
  const others = buildOthers(draggedId, classPositions, brainPos, visionPos, opts)
  return !isRectFree({ x: candidate.x, y: candidate.y, w, h }, others)
}

/**
 * Drag resolver with snap-back semantics (flicker-free).
 *
 * - Valid candidate → returned (clamped to canvas).
 * - Invalid candidate + `fallback` (previous valid pos) → tries single-axis
 *   slide (keeps dominant movement axis) so nodes can glide along edges;
 *   otherwise returns `fallback` itself (same reference) so callers can bail
 *   out of `setState` and the tab visually sticks instead of flickering.
 * - Invalid candidate without `fallback` (legacy) → resolves to the nearest
 *   free edge by minimal displacement (deterministic, no oscillation between
 *   far-away teleport targets like the old right/down-first strategy).
 */
export function nudgeToNonColliding(
  draggedId: string,
  candidate: Pos,
  classPositions: Record<string, Pos>,
  brainPos: Pos,
  visionPos: Pos,
  opts: NudgeOpts = {}
): Pos {
  const { fallback, expandedClasses } = opts
  const { w, h } = getNodeSize(draggedId, expandedClasses)
  const others = buildOthers(draggedId, classPositions, brainPos, visionPos, opts)

  const clamped = clampToBounds(candidate, w, h)
  const clampedRect: Rect = { x: clamped.x, y: clamped.y, w, h }
  const sameAs = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y

  // Fast path — candidate is free
  if (isRectFree(clampedRect, others)) {
    // Preserve reference when nothing changed so React can bail out
    if (sameAs(clamped, candidate)) return candidate
    if (fallback && sameAs(clamped, fallback)) return fallback
    return clamped
  }

  // Snap-back path — stick to last valid position (with single-axis slide)
  if (fallback) {
    const fbClamped = clampToBounds(fallback, w, h)
    const dx = Math.abs(clamped.x - fbClamped.x)
    const dy = Math.abs(clamped.y - fbClamped.y)
    const xOnly: Pos = { x: clamped.x, y: fbClamped.y }
    const yOnly: Pos = { x: fbClamped.x, y: clamped.y }
    // Try dominant axis first so diagonal drags slide naturally along edges
    const first = dx >= dy ? xOnly : yOnly
    const second = dx >= dy ? yOnly : xOnly
    if (isRectFree({ ...first, w, h }, others)) {
      if (sameAs(first, fallback)) return fallback
      return first
    }
    if (isRectFree({ ...second, w, h }, others)) {
      if (sameAs(second, fallback)) return fallback
      return second
    }
    // No axis is free — snap back. Return the exact fallback reference when
    // it is already in bounds so `setState(sameRef)` bails out (zero flicker).
    if (sameAs(fbClamped, fallback)) return fallback
    // Fallback itself was out of bounds — clamp it once (single stable move)
    if (isRectFree({ ...fbClamped, w, h }, others)) return fbClamped
    return fallback
  }

  // Legacy path (no fallback) — nearest-edge resolution by minimal distance.
  // Deterministic: pick the smallest displacement that frees the rect.
  type Try = { pos: Pos; dist: number }
  const tries: Try[] = []
  for (const o of others) {
    const r: Rect = { x: clamped.x, y: clamped.y, w, h }
    if (!overlap(r, o)) continue
    const right: Pos = { x: o.x + o.w + GAP, y: clamped.y }
    const left: Pos = { x: o.x - w - GAP, y: clamped.y }
    const down: Pos = { x: clamped.x, y: o.y + o.h + GAP }
    const up: Pos = { x: clamped.x, y: o.y - h - GAP }
    for (const p of [right, left, down, up]) {
      if (p.x < 0 || p.y < 0 || p.x + w > CANVAS_W || p.y + h > CANVAS_H) continue
      if (!isRectFree({ ...p, w, h }, others)) continue
      tries.push({ pos: p, dist: Math.hypot(p.x - clamped.x, p.y - clamped.y) })
    }
  }
  if (tries.length > 0) {
    tries.sort((a, b) => a.dist - b.dist)
    return tries[0].pos
  }
  // Nowhere free nearby — stay clamped (no far teleport, no flicker)
  if (sameAs(clamped, candidate)) return candidate
  return clamped
}
