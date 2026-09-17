/**
 * Vision3D - Zustand Store
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 */

import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import { createShape, cloneShape, snapPositionToGrid, generateShapeId } from '../utils/helpers'
import type { RulerSlice } from './rulerSlice'
import { createRulerSlice } from './rulerSlice'
import type { EditModeSlice } from './editModeSlice'
import { createEditModeSlice } from './editModeSlice'
import type { CameraSlice } from './cameraSlice'
import { createCameraSlice } from './cameraSlice'
import type { MarqueeSlice } from './marqueeSlice'
import { createMarqueeSlice } from './marqueeSlice'
import { serializeGeometry, deserializeGeometry } from '../utils/geometry'
import { autoSave, saveProject, loadProject } from '../utils/indexedDB'
import { performCSG, performMultiCSG, isCSGValid } from '../engine/CSGEngine'
import * as THREE from 'three'
import { log, debug, warn, error } from '../utils/logger'

const MAX_HISTORY = 50

const GRID_PRESETS = [0, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]

interface Shape {
  id: string
  type: string
  name: string
  position: number[]
  rotation: number[]
  scale: number[]
  color?: string
  metalness?: number
  roughness?: number
  opacity?: number
  isHole?: boolean
  visible: boolean
  locked?: boolean
  parentId?: string
  children?: string[]
  _csgGeometry?: THREE.BufferGeometry | Record<string, unknown>
  _customGeometry?: THREE.BufferGeometry | Record<string, unknown>
  [key: string]: unknown
}

interface Project {
  id: string
  name: string
  [key: string]: unknown
}

interface LastDuplicateTransform {
  ids: string[]
  deltaX: number
  deltaY: number
  deltaZ: number
  rotDeltaX: number
  rotDeltaY: number
  rotDeltaZ: number
}

interface TransformDelta {
  deltaX: number
  deltaY: number
  deltaZ: number
  rotDeltaX: number
  rotDeltaY: number
  rotDeltaZ: number
}

interface Workplane {
  [key: string]: unknown
}

interface ShapeDataImport {
  type?: string
  name?: string
  position?: number[]
  color?: string
  geometry?: THREE.BufferGeometry
  _customGeometry?: THREE.BufferGeometry | Record<string, unknown>
  _csgGeometry?: THREE.BufferGeometry | Record<string, unknown>
  [key: string]: unknown
}

interface MainStoreState {
  shapes: Shape[]
  selectedIds: string[]
  activeTool: string
  gridSnap: number
  rotationSnap: number
  showGrid: boolean
  showAxes: boolean
  showShapePanel: boolean
  showInspector: boolean
  history: Shape[][]
  historyIndex: number
  project: Project | null
  isProjectDirty: boolean
  lastDuplicateTransform: LastDuplicateTransform | null
  tempWorkplane: Workplane | null
  clipboard: Shape[] | null
}

interface MainStoreActions {
  addShape: (type: string, position?: number[]) => string
  removeShape: (id: string) => void
  removeShapes: (ids: string[]) => void
  selectShape: (id: string | null, multi?: boolean) => void
  selectShapes: (ids: string[]) => void
  deselectAll: () => void
  updateShape: (id: string, updates: Record<string, unknown>) => void
  updateShapes: (ids: string[], updates: Record<string, unknown>) => void
  duplicateShapes: (ids: string[]) => string[]
  setTool: (tool: string) => void
  setGridSnap: (size: number) => void
  cycleGridSnap: () => void
  setShowGrid: (show: boolean) => void
  setShowAxes: (show: boolean) => void
  setShowShapePanel: (show: boolean) => void
  setShowInspector: (show: boolean) => void
  moveShapesByArrow: (ids: string[], axis: string, direction: number, fast: boolean) => void
  hideShapes: (ids: string[]) => void
  showAllHidden: () => void
  toggleLock: (ids: string[]) => void
  groupShapes: (ids: string[]) => void
  ungroupShape: (id: string) => void
  alignShapes: (ids: string[], axis: string, mode: string) => void
  mirrorShapes: (ids: string[], axis: string) => void
  dropToWorkplane: (ids: string[]) => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  setProject: (project: Project) => void
  loadProjectFromDB: (projectId: string) => Promise<void>
  autoSaveProject: () => void
  setShapes: (shapes: Shape[]) => void
  clearScene: () => void
  csgOperation: (operation: string) => void
  smartDuplicate: (ids: string[]) => string[]
  recordTransformDelta: (ids: string[], delta: TransformDelta) => void
  setTempWorkplane: (wp: Workplane | null) => void
  clearTempWorkplane: () => void
  distributeShapes: (ids: string[], axis: string) => void
  setRotationSnap: (deg: number) => void
  importShape: (shapeData: ShapeDataImport) => string
  copyShapes: (ids: string[]) => void
  pasteShapes: () => string[]
}

type StoreState = MainStoreState & RulerSlice & EditModeSlice & CameraSlice & MarqueeSlice

type StoreActions = MainStoreActions

type FullStore = StoreState & StoreActions

type StoreCreator = StateCreator<FullStore, [], [], FullStore>

export const use3DStore = create<FullStore>()((set, get, store) => ({
  ...createRulerSlice(set as never, get as never, store as never),
  ...createEditModeSlice(set as never, get as never, store as never),
  ...createCameraSlice(set as never, get as never, store as never),
  ...createMarqueeSlice(set as never, get as never, store as never),

  shapes: [],
  selectedIds: [],
  activeTool: 'select',
  gridSnap: 0.5,
  rotationSnap: 1,
  showGrid: true,
  showAxes: true,
  showShapePanel: true,
  showInspector: false,
  history: [[] as unknown as Shape[]],
  historyIndex: 0,
  project: null,
  isProjectDirty: false,
  lastDuplicateTransform: null,
  tempWorkplane: null,
  clipboard: null,

  addShape: (type, position = [0, 1, 0]) => {
    const state = get()
    const snappedPosition = snapPositionToGrid(position, state.gridSnap)
    const newShape = createShape(type, snappedPosition)
    log('addShape:', type, '-> id:', newShape.id, 'pos:', snappedPosition)

    set((state) => ({
      shapes: [...state.shapes, newShape as Shape],
      selectedIds: [newShape.id],
      isProjectDirty: true,
    }))

    get().pushHistory()
    setTimeout(() => get().autoSaveProject(), 100)

    return newShape.id
  },

  removeShape: (id) => {
    const shape = get().shapes.find((s) => s.id === id)
    log('removeShape:', id, shape ? `(${shape.name})` : '(not found)')
    const state = get()
    const isEditing = state.editShapeId === id
    const hasCache = !!state.geometryCache[id]
    set((state) => {
      const filtered = state.shapes.filter((s) => s.id !== id)
      const cleaned = filtered.map((s) => {
        if (s.type === 'group' && Array.isArray(s.children)) {
          const newChildren = (s.children as string[]).filter((cid) => cid !== id)
          if (newChildren.length !== (s.children as string[]).length) return { ...s, children: newChildren }
        }
        if (s.parentId === id) return { ...s, parentId: undefined }
        return s
      })
      const nextCache = { ...state.geometryCache }
      if (hasCache) delete nextCache[id]
      return {
        shapes: cleaned,
        selectedIds: state.selectedIds.filter((sid) => sid !== id),
        isProjectDirty: true,
        ...(isEditing ? { editMode: 'object', editShapeId: null, selectedVertices: [], selectedEdges: [], selectedFaces: [], editTool: null, geometryCache: nextCache } : hasCache ? { geometryCache: nextCache } : {}),
      }
    })
    setTimeout(() => get().autoSaveProject(), 100)
  },

  removeShapes: (ids) => {
    log('removeShapes:', ids.length, 'shapes')
    const state = get()
    const idSet = new Set(ids)
    const isEditingDeleted = state.editShapeId ? idSet.has(state.editShapeId) : false
    set((state) => {
      const filtered = state.shapes.filter((s) => !idSet.has(s.id))
      const cleaned = filtered.map((s) => {
        if (s.type === 'group' && Array.isArray(s.children)) {
          const newChildren = (s.children as string[]).filter((cid) => !idSet.has(cid))
          if (newChildren.length !== (s.children as string[]).length) return { ...s, children: newChildren }
        }
        if (s.parentId && idSet.has(s.parentId)) return { ...s, parentId: undefined }
        return s
      })
      const nextCache = { ...state.geometryCache }
      let cacheChanged = false
      for (const id of ids) if (nextCache[id]) { delete nextCache[id]; cacheChanged = true }
      return {
        shapes: cleaned,
        selectedIds: [],
        showInspector: false,
        isProjectDirty: true,
        ...(cacheChanged ? { geometryCache: nextCache } : {}),
        ...(isEditingDeleted ? { editMode: 'object', editShapeId: null, selectedVertices: [], selectedEdges: [], selectedFaces: [], editTool: null, geometryCache: nextCache } : {}),
      }
    })
    setTimeout(() => get().autoSaveProject(), 100)
  },

  selectShape: (id, multi = false) => {
    debug('selectShape:', id, multi ? '(multi)' : '(single)')
    set((state) => {
      if (id === null) {
        return { selectedIds: [], showInspector: false }
      }

      if (multi) {
        const isSelected = state.selectedIds.includes(id)
        const newIds = isSelected
          ? state.selectedIds.filter((sid) => sid !== id)
          : [...state.selectedIds, id]
        return {
          selectedIds: newIds,
          showInspector: newIds.length > 0,
        }
      }

      return { selectedIds: [id], showInspector: true }
    })
  },

  selectShapes: (ids) => {
    debug('selectShapes:', ids.length, 'shapes')
    set({ selectedIds: ids, showInspector: ids.length > 0 })
  },

  deselectAll: () => {
    debug('deselectAll')
    set({ selectedIds: [], showInspector: false })
  },

  updateShape: (id, updates) => {
    const keys = Object.keys(updates).join(', ')
    debug('updateShape:', id, '->', keys)
    set((state) => ({
      shapes: state.shapes.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      isProjectDirty: true,
    }))
  },

  updateShapes: (ids, updates) => {
    const keys = Object.keys(updates).join(', ')
    log('updateShapes:', ids.length, 'shapes ->', keys)
    set((state) => ({
      shapes: state.shapes.map((s) =>
        ids.includes(s.id) ? { ...s, ...updates } : s
      ),
      isProjectDirty: true,
    }))
  },

  duplicateShapes: (ids) => {
    log('duplicateShapes:', ids.length, 'shapes')
    const state = get()
    const shapesToDuplicate = state.shapes.filter((s) => ids.includes(s.id))
    const newShapes = shapesToDuplicate.map((s) => {
      const clone = cloneShape(s)
      clone.position = [
        clone.position[0] + 2,
        clone.position[1],
        clone.position[2],
      ]
      return clone
    })

    const newIds = newShapes.map((s) => s.id)

    set((state) => ({
      shapes: [...state.shapes, ...newShapes as Shape[]],
      selectedIds: newIds,
      isProjectDirty: true,
    }))

    return newIds
  },

  setTool: (tool) => {
    log('setTool:', tool)
    set({ activeTool: tool })
  },
  setGridSnap: (size) => {
    log('setGridSnap:', size)
    set({ gridSnap: size })
  },
  cycleGridSnap: () => {
    const current = get().gridSnap
    const idx = GRID_PRESETS.indexOf(current)
    const next = GRID_PRESETS[(idx + 1) % GRID_PRESETS.length]
    log('cycleGridSnap:', current, '->', next)
    set({ gridSnap: next })
  },
  setShowGrid: (show) => {
    log('setShowGrid:', show)
    set({ showGrid: show })
  },
  setShowAxes: (show) => {
    log('setShowAxes:', show)
    set({ showAxes: show })
  },
  setShowShapePanel: (show) => set({ showShapePanel: show }),
  setShowInspector: (show) => set({ showInspector: show }),

  moveShapesByArrow: (ids, axis, direction, fast) => {
    const state = get()
    const gridSnap = state.gridSnap || 1.0
    const step = fast ? gridSnap * 10 : gridSnap
    const delta = direction * step
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2

    log('moveShapesByArrow:', ids.length, 'shapes, axis:', axis, 'delta:', delta)
    set((state) => ({
      shapes: state.shapes.map((s) => {
        if (ids.includes(s.id)) {
          const newPos = [...s.position]
          newPos[axisIndex] += delta
          return { ...s, position: newPos }
        }
        return s
      }),
      isProjectDirty: true,
    }))
  },

  hideShapes: (ids) => {
    log('hideShapes:', ids.length, 'shapes')
    set((state) => ({
      shapes: state.shapes.map((s) =>
        ids.includes(s.id) ? { ...s, visible: false } : s
      ),
      isProjectDirty: true,
    }))
  },

  showAllHidden: () => {
    log('showAllHidden')
    set((state) => ({
      shapes: state.shapes.map((s) =>
        s.visible === false ? { ...s, visible: true } : s
      ),
      isProjectDirty: true,
    }))
  },

  toggleLock: (ids) => {
    log('toggleLock:', ids.length, 'shapes')
    set((state) => ({
      shapes: state.shapes.map((s) =>
        ids.includes(s.id) ? { ...s, locked: !s.locked } : s
      ),
      isProjectDirty: true,
    }))
  },

  groupShapes: (ids) => {
    log('groupShapes:', ids.length, 'shapes')
    const state = get()
    const shapesToGroup = state.shapes.filter((s) => ids.includes(s.id))

    if (shapesToGroup.length < 2) return

    const groupShape = createShape('group', [0, 0, 0])
    groupShape.name = 'Group'
    groupShape.children = ids

    const centerX =
      shapesToGroup.reduce((sum, s) => sum + s.position[0], 0) /
      shapesToGroup.length
    const centerY =
      shapesToGroup.reduce((sum, s) => sum + s.position[1], 0) /
      shapesToGroup.length
    const centerZ =
      shapesToGroup.reduce((sum, s) => sum + s.position[2], 0) /
      shapesToGroup.length

    groupShape.position = [centerX, centerY, centerZ]

    const updatedShapes = state.shapes.map((s) => {
      if (ids.includes(s.id)) {
        return { ...s, parentId: groupShape.id }
      }
      return s
    })

    set(() => ({
      shapes: [...updatedShapes, groupShape as Shape],
      selectedIds: [groupShape.id],
      isProjectDirty: true,
    }))
  },

  ungroupShape: (id) => {
    log('ungroupShape:', id)
    const state = get()
    const shape = state.shapes.find((s) => s.id === id)

    if (!shape || shape.type !== 'group' || !shape.children) return

    set((state) => ({
      shapes: state.shapes
        .filter((s) => s.id !== id)
        .map((s) => {
          if (s.parentId === id) {
            return { ...s, parentId: undefined }
          }
          return s
        }),
      selectedIds: shape.children!,
      isProjectDirty: true,
    }))
  },

  alignShapes: (ids, axis, mode) => {
    log('alignShapes:', ids.length, 'shapes, axis:', axis, 'mode:', mode)
    const state = get()
    const shapesToAlign = state.shapes.filter((s) => ids.includes(s.id))

    if (shapesToAlign.length < 2) return

    let targetValue: number
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2

    if (mode === 'min') {
      targetValue = Math.min(
        ...shapesToAlign.map((s) => s.position[axisIndex])
      )
    } else if (mode === 'max') {
      targetValue = Math.max(
        ...shapesToAlign.map((s) => s.position[axisIndex])
      )
    } else {
      targetValue =
        shapesToAlign.reduce((sum, s) => sum + s.position[axisIndex], 0) /
        shapesToAlign.length
    }

    set((state) => ({
      shapes: state.shapes.map((s) => {
        if (ids.includes(s.id)) {
          const newPosition = [...s.position]
          newPosition[axisIndex] = targetValue
          return { ...s, position: newPosition }
        }
        return s
      }),
      isProjectDirty: true,
    }))
  },

  mirrorShapes: (ids, axis) => {
    log('mirrorShapes:', ids.length, 'shapes, axis:', axis)
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2

    set((state) => ({
      shapes: state.shapes.map((s) => {
        if (ids.includes(s.id)) {
          const newPosition = [...s.position]
          newPosition[axisIndex] = -newPosition[axisIndex]
          const newRotation = [...s.rotation]
          newRotation[axisIndex] = -newRotation[axisIndex]
          return { ...s, position: newPosition, rotation: newRotation }
        }
        return s
      }),
      isProjectDirty: true,
    }))
  },

  dropToWorkplane: (ids) => {
    log('dropToWorkplane:', ids.length, 'shapes')
    set((state) => ({
      shapes: state.shapes.map((s) => {
        if (ids.includes(s.id)) {
          return { ...s, position: [s.position[0], 0, s.position[2]] }
        }
        return s
      }),
      isProjectDirty: true,
    }))
  },

  pushHistory: () => {
    debug('pushHistory')
    try {
      const state = get()
      const newHistory = state.history.slice(0, state.historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(state.shapes, (key, val) => {
        if (key === '_csgGeometry' && val && (val as Record<string, unknown>).attributes) return serializeGeometry(val as THREE.BufferGeometry)
        if (key === '_customGeometry' && val && (val as Record<string, unknown>).attributes) return serializeGeometry(val as THREE.BufferGeometry)
        return val
      })))

      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift()
      }

      set({
        history: newHistory,
        historyIndex: newHistory.length - 1,
      })
    } catch (err) {
      error('pushHistory failed (likely large sphere geometry), skipping history:', err)
    }
  },

  undo: () => {
    const state = get()
    if (state.historyIndex > 0) {
      log('undo: index', state.historyIndex, '->', state.historyIndex - 1)
      const newIndex = state.historyIndex - 1
      const restoredShapes: Shape[] = JSON.parse(JSON.stringify(state.history[newIndex]))
      for (const sh of restoredShapes) {
        if (sh._customGeometry && (sh._customGeometry as Record<string, unknown>).attributes) {
          sh._customGeometry = deserializeGeometry(sh._customGeometry as never)! as never
        }
        if (sh._csgGeometry && (sh._csgGeometry as Record<string, unknown>).attributes) {
          sh._csgGeometry = deserializeGeometry(sh._csgGeometry as never)! as never
        }
      }
      const restoredIds = new Set(restoredShapes.map((s) => s.id))
      const shouldResetEdit = state.editShapeId ? !restoredIds.has(state.editShapeId) : false
      set({
        shapes: restoredShapes,
        historyIndex: newIndex,
        selectedIds: [],
        ...(shouldResetEdit ? { editMode: 'object', editShapeId: null, selectedVertices: [], selectedEdges: [], selectedFaces: [], editTool: null, geometryCache: {} } : {}),
      })
    }
  },

  redo: () => {
    const state = get()
    if (state.historyIndex < state.history.length - 1) {
      log('redo: index', state.historyIndex, '->', state.historyIndex + 1)
      const newIndex = state.historyIndex + 1
      const restoredShapes: Shape[] = JSON.parse(JSON.stringify(state.history[newIndex]))
      for (const sh of restoredShapes) {
        if (sh._customGeometry && (sh._customGeometry as Record<string, unknown>).attributes) {
          sh._customGeometry = deserializeGeometry(sh._customGeometry as never)! as never
        }
        if (sh._csgGeometry && (sh._csgGeometry as Record<string, unknown>).attributes) {
          sh._csgGeometry = deserializeGeometry(sh._csgGeometry as never)! as never
        }
      }
      const restoredIds = new Set(restoredShapes.map((s) => s.id))
      const shouldResetEdit = state.editShapeId ? !restoredIds.has(state.editShapeId) : false
      set({
        shapes: restoredShapes,
        historyIndex: newIndex,
        selectedIds: [],
        ...(shouldResetEdit ? { editMode: 'object', editShapeId: null, selectedVertices: [], selectedEdges: [], selectedFaces: [], editTool: null, geometryCache: {} } : {}),
      })
    }
  },

  setProject: (project) => {
    log('setProject:', project.id, project.name)
    set({ project })
    saveProject(project)
  },

  loadProjectFromDB: async (projectId) => {
    log('loadProjectFromDB:', projectId)
    try {
      const project = await loadProject(projectId)
      if (project) {
        set({ project: project as Project })
        log('loadProjectFromDB: loaded', (project as Project).name)
      } else {
        warn('loadProjectFromDB: project not found:', projectId)
      }
    } catch (err) {
      error('Failed to load project:', err)
    }
  },

  autoSaveProject: () => {
    const state = get()
    if (state.project) {
      debug('autoSaveProject: saving', state.shapes.length, 'shapes')
      autoSave(state.project, state.shapes)
    }
  },

  setShapes: (shapes) => {
    log('setShapes:', shapes.length, 'shapes')
    const deserialized = shapes.map((sh) => {
      if (sh._customGeometry && !(sh._customGeometry as THREE.BufferGeometry).isBufferGeometry) {
        sh._customGeometry = (deserializeGeometry(sh._customGeometry as never) as never) ?? undefined
      }
      if (sh._csgGeometry && !(sh._csgGeometry as THREE.BufferGeometry).isBufferGeometry) {
        sh._csgGeometry = (deserializeGeometry(sh._csgGeometry as never) as never) ?? undefined
      }
      return sh
    })
    const state = get()
    const newIds = new Set(deserialized.map((s) => s.id))
    const shouldResetEdit = state.editShapeId ? !newIds.has(state.editShapeId) : false
    set({
      shapes: deserialized,
      isProjectDirty: true,
      ...(shouldResetEdit ? { editMode: 'object', editShapeId: null, selectedVertices: [], selectedEdges: [], selectedFaces: [], editTool: null, geometryCache: {} } : {}),
    })
  },

  clearScene: () => {
    log('clearScene')
    set({
      shapes: [],
      selectedIds: [],
      isProjectDirty: true,
      editMode: 'object',
      editShapeId: null,
      selectedVertices: [],
      selectedEdges: [],
      selectedFaces: [],
      editTool: null,
      geometryCache: {},
      showInspector: false,
    })
    setTimeout(() => get().autoSaveProject(), 100)
  },

  csgOperation: (operation) => {
    const state = get()
    let ids = state.selectedIds
    if (ids.length < 2) {
      const allShapes = state.shapes
      if (allShapes.length >= 2) {
        ids = allShapes.slice(-2).map((s) => s.id)
        log(`CSG: auto-selecting last 2 shapes: ${ids.join(', ')}`)
        set({ selectedIds: ids })
      } else {
        warn('CSG: need at least 2 shapes in scene')
        return
      }
    }

    const shapes = state.shapes.filter((s) => ids.includes(s.id))
    if (!isCSGValid(shapes)) {
      warn('CSG: invalid selection (hidden or locked shapes)')
      return
    }

    log('CSG:', operation, 'on', ids.length, 'shapes')
    // Fix: use performMultiCSG so selecting >2 shapes (e.g., car body + 4 torus wheels) merges all at once instead of deleting the extras
    const op = operation as 'union' | 'subtract' | 'intersect'
    const result = ids.length === 2
      ? performCSG(shapes[0], shapes[1], op)
      : performMultiCSG(shapes, op)
    if (!result) {
      error('CSG: operation failed – keeping original shapes')
      return
    }
    // Safety: three-bvh-csg can return a geometry with 0 vertices for non-manifold/disjoint cases (e.g., torus) – treat as failure so structure is not "deleted"
    const vertCount = (result._csgGeometry as THREE.BufferGeometry)?.attributes?.position?.count ?? 0
    if (vertCount === 0) {
      error('CSG: result geometry is empty (0 vertices) – operation produced no visible mesh, keeping originals')
      return
    }

    set((state) => ({
      shapes: [
        ...state.shapes.filter((s) => !ids.includes(s.id)),
        result as Shape,
      ],
      selectedIds: [result.id],
      isProjectDirty: true,
    }))

    get().pushHistory()
    setTimeout(() => get().autoSaveProject(), 100)
  },

  smartDuplicate: (ids) => {
    const state = get()
    const shapesToDuplicate = state.shapes.filter((s) => ids.includes(s.id))

    if (state.lastDuplicateTransform && state.lastDuplicateTransform.ids.length === ids.length) {
      const t = state.lastDuplicateTransform
      const newShapes = shapesToDuplicate.map((s) => {
        const clone = cloneShape(s)
        clone.position = [
          s.position[0] + t.deltaX,
          s.position[1] + t.deltaY,
          s.position[2] + t.deltaZ,
        ]
        clone.rotation = [
          s.rotation[0] + t.rotDeltaX,
          s.rotation[1] + t.rotDeltaY,
          s.rotation[2] + t.rotDeltaZ,
        ]
        return clone
      })

      const newIds = newShapes.map((s) => s.id)
      set((state) => ({
        shapes: [...state.shapes, ...newShapes as Shape[]],
        selectedIds: newIds,
        isProjectDirty: true,
      }))
      log('Smart duplicate: repeated transform')
      return newIds
    }

    const newShapes = shapesToDuplicate.map((s) => {
      const clone = cloneShape(s)
      clone.position = [s.position[0] + 2, s.position[1], s.position[2]]
      return clone
    })

    const newIds = newShapes.map((s) => s.id)
    set((state) => ({
      shapes: [...state.shapes, ...newShapes as Shape[]],
      selectedIds: newIds,
      lastDuplicateTransform: {
        ids,
        deltaX: 2,
        deltaY: 0,
        deltaZ: 0,
        rotDeltaX: 0,
        rotDeltaY: 0,
        rotDeltaZ: 0,
      },
      isProjectDirty: true,
    }))

    log('Smart duplicate: first copy, offset +2 X')
    return newIds
  },

  recordTransformDelta: (ids, delta) => {
    set({ lastDuplicateTransform: { ids, ...delta } })
  },

  setTempWorkplane: (wp) => {
    log('setTempWorkplane:', wp)
    set({ tempWorkplane: wp })
  },
  clearTempWorkplane: () => {
    log('clearTempWorkplane')
    set({ tempWorkplane: null })
  },

  distributeShapes: (ids, axis) => {
    const state = get()
    const shapesToDistribute = state.shapes.filter((s) => ids.includes(s.id))
    if (shapesToDistribute.length < 3) return

    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const sorted = [...shapesToDistribute].sort((a, b) => a.position[axisIndex] - b.position[axisIndex])
    const min = sorted[0].position[axisIndex]
    const max = sorted[sorted.length - 1].position[axisIndex]
    const spacing = (max - min) / (sorted.length - 1)

    log('distributeShapes:', ids.length, 'shapes on', axis, 'spacing:', spacing.toFixed(2))

    set((state) => ({
      shapes: state.shapes.map((s) => {
        const idx = sorted.findIndex((ss) => ss.id === s.id)
        if (idx >= 0) {
          const newPos = [...s.position]
          newPos[axisIndex] = min + idx * spacing
          return { ...s, position: newPos }
        }
        return s
      }),
      isProjectDirty: true,
    }))
  },

  setRotationSnap: (deg) => {
    log('setRotationSnap:', deg)
    set({ rotationSnap: deg })
  },

  importShape: (shapeData) => {
    const isImported = shapeData.type === 'stl' || shapeData.type === 'obj'

    let newShape: Shape
    if (isImported) {
      newShape = {
        id: generateShapeId(),
        type: shapeData.type || 'box',
        name: shapeData.name || 'Imported',
        position: shapeData.position || [0, 1, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: shapeData.color || '#4F46E5',
        metalness: 0.1,
        roughness: 0.7,
        opacity: 1,
        isHole: false,
        visible: true,
        locked: false,
        _customGeometry: shapeData._customGeometry || shapeData.geometry,
      }
    } else {
      newShape = createShape(shapeData.type || 'box', shapeData.position || [0, 1, 0]) as Shape
      if (shapeData.name) newShape.name = shapeData.name
      if (shapeData.color) newShape.color = shapeData.color
      Object.assign(newShape, shapeData)
    }

    if (newShape._customGeometry && !(newShape._customGeometry as THREE.BufferGeometry).isBufferGeometry) {
      newShape._customGeometry = (deserializeGeometry(newShape._customGeometry as never) as never) ?? undefined
    }
    if (newShape._csgGeometry && !(newShape._csgGeometry as THREE.BufferGeometry).isBufferGeometry) {
      newShape._csgGeometry = (deserializeGeometry(newShape._csgGeometry as never) as never) ?? undefined
    }

    log('importShape:', newShape.type, newShape.name)
    set((state) => ({
      shapes: [...state.shapes, newShape],
      selectedIds: [newShape.id],
      isProjectDirty: true,
    }))
    setTimeout(() => get().autoSaveProject(), 100)
    return newShape.id
  },

  copyShapes: (ids) => {
    const state = get()
    const toCopy = state.shapes.filter((s) => ids.includes(s.id))
    if (toCopy.length === 0) {
      warn('copyShapes: nothing to copy')
      return
    }
    // Deep clone via JSON to capture serialized geometry safely
    try {
      const cloned: Shape[] = JSON.parse(JSON.stringify(toCopy))
      set({ clipboard: cloned })
      log('copyShapes: copied', cloned.length, 'shapes')
    } catch (err) {
      error('copyShapes failed', err)
    }
  },

  pasteShapes: () => {
    const state = get()
    const clip = state.clipboard
    if (!clip || (clip as Shape[]).length === 0) {
      warn('pasteShapes: clipboard empty')
      return []
    }
    const newShapes: Shape[] = (clip as Shape[]).map((s) => {
      const clone = cloneShape(s as unknown as Record<string, unknown>) as unknown as Shape
      const origPos = (s as Shape).position as number[]
      clone.position = [origPos[0] + 1.5, origPos[1], origPos[2] + 1.5]
      // Ensure deserialized geometry if clipboard held serialized form
      if (clone._customGeometry && !(clone._customGeometry as THREE.BufferGeometry).isBufferGeometry) {
        clone._customGeometry = (deserializeGeometry(clone._customGeometry as never) as never) ?? undefined
      }
      if (clone._csgGeometry && !(clone._csgGeometry as THREE.BufferGeometry).isBufferGeometry) {
        clone._csgGeometry = (deserializeGeometry(clone._csgGeometry as never) as never) ?? undefined
      }
      return clone
    })
    const newIds = newShapes.map((s) => s.id)
    set((s) => ({
      shapes: [...s.shapes, ...newShapes],
      selectedIds: newIds,
      isProjectDirty: true,
    }))
    get().pushHistory()
    setTimeout(() => get().autoSaveProject(), 100)
    log('pasteShapes: pasted', newShapes.length, 'shapes')
    return newIds
  },
}))
