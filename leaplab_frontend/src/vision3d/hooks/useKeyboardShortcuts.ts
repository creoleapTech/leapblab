import { useEffect } from 'react'
import { use3DStore } from '../store/use3DStore'
import { log, debug } from '../utils/logger'

interface KeyboardShortcutOptions {
  onOpenProject?: () => void
}

export function useKeyboardShortcuts({ onOpenProject }: KeyboardShortcutOptions = {}): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }

      const key = e.key.toLowerCase()
      const state = use3DStore.getState()
      const ids = state.selectedIds

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: Delete ' + ids.length + ' shapes')
          state.removeShapes(ids)
        }
      }

      if (e.ctrlKey && key === 'g' && !e.shiftKey) {
        e.preventDefault()
        if (ids.length >= 2) {
          log('Keyboard: Ctrl+G (group) ' + ids.length + ' shapes')
          state.groupShapes(ids)
        }
      }

      if (e.ctrlKey && key === 'g' && e.shiftKey) {
        e.preventDefault()
        if (ids.length === 1) {
          log('Keyboard: Ctrl+Shift+G (ungroup) ' + ids[0])
          state.ungroupShape(ids[0])
        }
      }

      if (e.ctrlKey && key === 'd') {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: Ctrl+D (smart duplicate) ' + ids.length + ' shapes')
          state.smartDuplicate(ids)
        }
      }

      if (e.ctrlKey && key === 'c' && !e.shiftKey) {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: Ctrl+C (copy) ' + ids.length + ' shapes')
          state.copyShapes(ids)
        } else {
          log('Keyboard: Ctrl+C (copy) – nothing selected')
        }
      }

      if (e.ctrlKey && (key === 'v' || key === 'p') && !e.shiftKey) {
        e.preventDefault()
        if (key === 'p') {
          // Prevent browser print dialog for Ctrl+P paste alias
          log('Keyboard: Ctrl+P (paste alias)')
        } else {
          log('Keyboard: Ctrl+V (paste)')
        }
        state.pasteShapes()
      }

      if (e.ctrlKey && key === 'o') {
        e.preventDefault()
        log('Keyboard: Ctrl+O (open project)')
        if (onOpenProject) onOpenProject()
      }

      if (e.ctrlKey && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        log('Keyboard: Ctrl+Z (undo)')
        state.undo()
      }

      if (e.ctrlKey && key === 'z' && e.shiftKey) {
        e.preventDefault()
        log('Keyboard: Ctrl+Shift+Z (redo)')
        state.redo()
      }
      if (e.ctrlKey && key === 'y') {
        e.preventDefault()
        log('Keyboard: Ctrl+Y (redo)')
        state.redo()
      }

      if (e.ctrlKey && key === 'a') {
        e.preventDefault()
        log('Keyboard: Ctrl+A (select all)')
        const allIds = state.shapes.map((s) => s.id)
        state.selectShapes(allIds)
      }

      if (e.altKey && key === 'a') {
        e.preventDefault()
        log('Keyboard: Alt+A (deselect all)')
        if (state.editMode !== 'object') {
          state.clearComponentSelection()
        } else {
          state.deselectAll()
        }
      }

      if (e.ctrlKey && key === 'i' && !e.shiftKey) {
        e.preventDefault()
        log('Keyboard: Ctrl+I (invert selection)')
        if (state.editMode !== 'object') {
          const geo = state.geometryCache[state.editShapeId!]
          if (geo) {
            const pos = geo.attributes.position!
            const index = geo.index
            if (state.editMode === 'vertex') {
              const selected = new Set(state.selectedVertices.filter(v => v.shapeId === state.editShapeId).map(v => v.index))
              const verts: Array<{ shapeId: string; index: number }> = []
              for (let i = 0; i < pos.count; i++) {
                if (!selected.has(i)) verts.push({ shapeId: state.editShapeId!, index: i })
              }
              use3DStore.setState({ selectedVertices: verts })
            } else if (state.editMode === 'edge') {
              const edgeKey = (a: number, b: number) => Math.min(a, b) + '-' + Math.max(a, b)
              const selected = new Set(state.selectedEdges.filter(e => e.shapeId === state.editShapeId).map(e => edgeKey(e.a, e.b)))
              const edgeSet = new Set<string>()
              const edges: Array<{ shapeId: string; a: number; b: number }> = []
              const addEdge = (a: number, b: number) => {
                const k = edgeKey(a, b)
                if (!edgeSet.has(k)) {
                  edgeSet.add(k)
                  if (!selected.has(k)) edges.push({ shapeId: state.editShapeId!, a: Math.min(a, b), b: Math.max(a, b) })
                }
              }
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  addEdge(index.getX(i), index.getX(i + 1))
                  addEdge(index.getX(i + 1), index.getX(i + 2))
                  addEdge(index.getX(i + 2), index.getX(i))
                }
              } else {
                for (let i = 0; i < pos.count; i += 3) { addEdge(i, i + 1); addEdge(i + 1, i + 2); addEdge(i + 2, i) }
              }
              use3DStore.setState({ selectedEdges: edges })
            } else if (state.editMode === 'face') {
              const selected = new Set(state.selectedFaces.filter(f => f.shapeId === state.editShapeId).map(f => f.index))
              const faceCount = index ? index.count / 3 : pos.count / 3
              const faces: Array<{ shapeId: string; index: number }> = []
              for (let i = 0; i < faceCount; i++) {
                if (!selected.has(i)) faces.push({ shapeId: state.editShapeId!, index: i })
              }
              use3DStore.setState({ selectedFaces: faces })
            }
          }
        } else {
          const selectedSet = new Set(state.selectedIds)
          const allIds = state.shapes.map(s => s.id)
          const inverted = allIds.filter(id => !selectedSet.has(id))
          state.selectShapes(inverted)
        }
      }

      if (e.key === 'Escape') {
        const st = use3DStore.getState()
        if (st.editMode !== 'object') {
          log('Keyboard: Escape (exit edit mode)')
          st.setEditMode('object')
        } else {
          log('Keyboard: Escape (deselect)')
          st.deselectAll()
        }
      }

      if (key === 'v') { debug('Keyboard: V (select tool)'); state.setTool('select') }
      if (key === 'm' && !e.ctrlKey && state.editMode === 'object') { debug('Keyboard: M (move tool)'); state.setTool('move') }
      if (key === 'r' && !e.ctrlKey) { debug('Keyboard: R (rotate tool)'); state.setTool('rotate') }
      if (key === 's' && !e.ctrlKey && !e.shiftKey) { debug('Keyboard: S (scale tool)'); state.setTool('scale') }

      if (key === 'tab') {
        e.preventDefault()
        if (state.editMode !== 'object') {
          debug('Keyboard: Tab (exit edit mode)')
          state.setEditMode('object')
        } else if (ids.length === 1) {
          debug('Keyboard: Tab (enter vertex edit)')
          state.setEditMode('vertex')
        }
      }
      if (key === '1' && !e.ctrlKey && !e.altKey && ids.length === 1) {
        debug('Keyboard: 1 (vertex edit)')
        state.setEditMode(state.editMode === 'vertex' ? 'object' : 'vertex')
      }
      if (key === '2' && !e.ctrlKey && !e.altKey && ids.length === 1) {
        debug('Keyboard: 2 (edge edit)')
        state.setEditMode(state.editMode === 'edge' ? 'object' : 'edge')
      }
      if (key === '3' && !e.ctrlKey && !e.altKey && ids.length === 1) {
        debug('Keyboard: 3 (face edit)')
        state.setEditMode(state.editMode === 'face' ? 'object' : 'face')
      }

      if (state.editMode !== 'object') {
        const mode = state.editMode

        if (key === 'e' && !e.ctrlKey) {
          e.preventDefault()
          debug('Keyboard: E (exclude ' + mode + ')')
          state.setEditTool('exclude')
        }

        if (key === 'i' && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault()
          debug('Keyboard: I (include ' + mode + ')')
          state.setEditTool('include')
        }

        if (e.ctrlKey && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) {
          e.preventDefault()
          debug('Keyboard: Ctrl++ (expand selection)')
          const geo = state.geometryCache[state.editShapeId!]
          if (geo) {
            const index = geo.index
            if (mode === 'vertex') {
              const selected = new Set(state.selectedVertices.filter(v => v.shapeId === state.editShapeId).map(v => v.index))
              const edges = new Set<string>()
              const addEdge = (a: number, b: number) => { edges.add(Math.min(a, b) + '-' + Math.max(a, b)) }
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)
                  if (selected.has(a) || selected.has(b)) addEdge(a, b)
                  if (selected.has(b) || selected.has(c)) addEdge(b, c)
                  if (selected.has(c) || selected.has(a)) addEdge(c, a)
                }
              }
              const newVerts = new Set(selected)
              edges.forEach(k => { const [a, b] = k.split('-').map(Number); newVerts.add(a); newVerts.add(b) })
              use3DStore.setState({ selectedVertices: [...newVerts].map(i => ({ shapeId: state.editShapeId!, index: i })) })
            } else if (mode === 'edge') {
              const edgeKey = (a: number, b: number) => Math.min(a, b) + '-' + Math.max(a, b)
              const selected = new Set(state.selectedEdges.filter(e => e.shapeId === state.editShapeId).map(e => edgeKey(e.a, e.b)))
              const neighborEdges = new Set<string>()
              const allEdges = new Set<string>()
              const addAllEdges = (a: number, b: number) => { allEdges.add(edgeKey(a, b)) }
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)
                  addAllEdges(a, b); addAllEdges(b, c); addAllEdges(c, a)
                  if (selected.has(edgeKey(a, b))) { neighborEdges.add(edgeKey(b, c)); neighborEdges.add(edgeKey(c, a)) }
                  if (selected.has(edgeKey(b, c))) { neighborEdges.add(edgeKey(a, b)); neighborEdges.add(edgeKey(c, a)) }
                  if (selected.has(edgeKey(c, a))) { neighborEdges.add(edgeKey(a, b)); neighborEdges.add(edgeKey(b, c)) }
                }
              }
              const newEdges = new Set(selected)
              neighborEdges.forEach(k => { if (!newEdges.has(k)) newEdges.add(k) })
              use3DStore.setState({ selectedEdges: [...newEdges].map(k => { const [a, b] = k.split('-').map(Number); return { shapeId: state.editShapeId!, a, b } }) })
            } else if (mode === 'face') {
              const selected = new Set(state.selectedFaces.filter(f => f.shapeId === state.editShapeId).map(f => f.index))
              const neighborFaces = new Set<number>()
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  const fi = Math.floor(i / 3)
                  const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)
                  if (selected.has(fi)) {
                    for (let j = 0; j < index.count; j += 3) {
                      if (Math.floor(j / 3) === fi) continue
                      const na = index.getX(j); const nb = index.getX(j + 1); const nc = index.getX(j + 2)
                      if ((a === na || a === nb || a === nc || b === na || b === nb || b === nc || c === na || c === nb || c === nc)) {
                        neighborFaces.add(Math.floor(j / 3))
                      }
                    }
                  }
                }
              }
              const newFaces = new Set(selected)
              neighborFaces.forEach(f => newFaces.add(f))
              use3DStore.setState({ selectedFaces: [...newFaces].map(i => ({ shapeId: state.editShapeId!, index: i })) })
            }
          }
        }

        if (e.ctrlKey && (e.key === '-' || e.code === 'NumpadSubtract')) {
          e.preventDefault()
          debug('Keyboard: Ctrl+- (contract selection)')
          const geo = state.geometryCache[state.editShapeId!]
          if (geo) {
            const index = geo.index
            if (mode === 'vertex') {
              const selected = new Set(state.selectedVertices.filter(v => v.shapeId === state.editShapeId).map(v => v.index))
              const boundary = new Set<number>()
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)
                  if (selected.has(a) && selected.has(b) && selected.has(c)) {
                    boundary.add(a); boundary.add(b); boundary.add(c)
                  }
                }
              }
              use3DStore.setState({ selectedVertices: [...boundary].map(i => ({ shapeId: state.editShapeId!, index: i })) })
            } else if (mode === 'edge') {
              const edgeKey = (a: number, b: number) => Math.min(a, b) + '-' + Math.max(a, b)
              const selected = new Set(state.selectedEdges.filter(e => e.shapeId === state.editShapeId).map(e => edgeKey(e.a, e.b)))
              const interior = new Set<string>()
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)
                  if (selected.has(edgeKey(a, b)) && selected.has(edgeKey(b, c)) && selected.has(edgeKey(c, a))) {
                    interior.add(edgeKey(a, b)); interior.add(edgeKey(b, c)); interior.add(edgeKey(c, a))
                  }
                }
              }
              use3DStore.setState({ selectedEdges: [...interior].map(k => { const [a, b] = k.split('-').map(Number); return { shapeId: state.editShapeId!, a, b } }) })
            } else if (mode === 'face') {
              const selected = new Set(state.selectedFaces.filter(f => f.shapeId === state.editShapeId).map(f => f.index))
              const interior = new Set<number>()
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  const fi = Math.floor(i / 3)
                  if (!selected.has(fi)) continue
                  const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)
                  let fullyShared = true
                  for (let j = 0; j < index.count; j += 3) {
                    if (Math.floor(j / 3) === fi) continue
                    const na = index.getX(j); const nb = index.getX(j + 1); const nc = index.getX(j + 2)
                    const shared = [a, b, c].filter(v => v === na || v === nb || v === nc).length
                    if (shared >= 2 && !selected.has(Math.floor(j / 3))) { fullyShared = false; break }
                  }
                  if (fullyShared) interior.add(fi)
                }
              }
              use3DStore.setState({ selectedFaces: [...interior].map(i => ({ shapeId: state.editShapeId!, index: i })) })
            }
          }
        }

        if (key === 'a' && !e.ctrlKey) {
          e.preventDefault()
          debug('Keyboard: A (select all ' + state.editMode + 's)')
          const geo = state.geometryCache[state.editShapeId!]
          if (geo) {
            const pos = geo.attributes.position!
            const index = geo.index
            if (state.editMode === 'vertex') {
              const verts: Array<{ shapeId: string; index: number }> = []
              for (let i = 0; i < pos.count; i++) {
                verts.push({ shapeId: state.editShapeId!, index: i })
              }
              use3DStore.setState({ selectedVertices: verts })
            } else if (state.editMode === 'edge') {
              const edgeSet = new Set<string>()
              const edges: Array<{ shapeId: string; a: number; b: number }> = []
              const addEdge = (a: number, b: number) => {
                const k = Math.min(a, b) + '-' + Math.max(a, b)
                if (!edgeSet.has(k)) { edgeSet.add(k); edges.push({ shapeId: state.editShapeId!, a: Math.min(a, b), b: Math.max(a, b) }) }
              }
              if (index) {
                for (let i = 0; i < index.count; i += 3) {
                  addEdge(index.getX(i), index.getX(i + 1))
                  addEdge(index.getX(i + 1), index.getX(i + 2))
                  addEdge(index.getX(i + 2), index.getX(i))
                }
              } else {
                for (let i = 0; i < pos.count; i += 3) { addEdge(i, i + 1); addEdge(i + 1, i + 2); addEdge(i + 2, i) }
              }
              use3DStore.setState({ selectedEdges: edges })
            } else if (state.editMode === 'face') {
              const faces: Array<{ shapeId: string; index: number }> = []
              const faceCount = index ? index.count / 3 : pos.count / 3
              for (let i = 0; i < faceCount; i++) {
                faces.push({ shapeId: state.editShapeId!, index: i })
              }
              use3DStore.setState({ selectedFaces: faces })
            }
          }
        }
      }

      if (key === 'd' && !e.ctrlKey) {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: D (drop to workplane) ' + ids.length + ' shapes')
          state.dropToWorkplane(ids)
        }
      }

      if (key === 'g' && !e.ctrlKey) {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: G (mirror X) ' + ids.length + ' shapes')
          state.mirrorShapes(ids, 'x')
        }
      }

      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && ids.length > 0) {
        e.preventDefault()
        const fast = e.shiftKey
        if (key === 'arrowright') {
          state.moveShapesByArrow(ids, 'x', 1, fast)
        } else if (key === 'arrowleft') {
          state.moveShapesByArrow(ids, 'x', -1, fast)
        } else if (key === 'arrowup') {
          state.moveShapesByArrow(ids, 'z', -1, fast)
        } else if (key === 'arrowdown') {
          state.moveShapesByArrow(ids, 'z', 1, fast)
        }
      }
      if (e.ctrlKey && (key === 'arrowup' || key === 'arrowdown') && ids.length > 0) {
        e.preventDefault()
        const fast = e.shiftKey
        state.moveShapesByArrow(ids, 'y', key === 'arrowup' ? 1 : -1, fast)
      }

      if (key === 'f' && !e.ctrlKey) {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: F (fit selection to view)')
          state.setFitSelection(ids)
        } else {
          log('Keyboard: F (fit all - nothing selected)')
          state.setFitAll()
        }
      }

      if (key === 'h' && !e.ctrlKey) {
        if (ids.length > 0) {
          log('Keyboard: H (make hole) ' + ids.length + ' shapes')
          state.updateShapes(ids, { isHole: true })
        }
      }

      if (e.shiftKey && key === 's') {
        if (ids.length > 0) {
          log('Keyboard: Shift+S (make solid) ' + ids.length + ' shapes')
          state.updateShapes(ids, { isHole: false })
        }
      }

      if (key === 't' && !e.ctrlKey) {
        if (ids.length > 0) {
          log('Keyboard: T (toggle transparency)')
          const selectedShapes = state.shapes.filter((s) => ids.includes(s.id))
          const anyOpaque = selectedShapes.some((s) => (s.opacity ?? 1) === 1)
          state.updateShapes(ids, { opacity: anyOpaque ? 0.5 : 1.0 })
        }
      }

      if (e.ctrlKey && key === 'h' && !e.shiftKey) {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: Ctrl+H (hide) ' + ids.length + ' shapes')
          state.hideShapes(ids)
        }
      }

      if (e.ctrlKey && key === 'h' && e.shiftKey) {
        e.preventDefault()
        log('Keyboard: Ctrl+Shift+H (show all hidden)')
        state.showAllHidden()
      }

      if (e.ctrlKey && key === 'l') {
        e.preventDefault()
        if (ids.length > 0) {
          log('Keyboard: Ctrl+L (toggle lock) ' + ids.length + ' shapes')
          state.toggleLock(ids)
        }
      }

      if (key === 'n' && !e.ctrlKey) {
        e.preventDefault()
        log('Keyboard: N (cycle grid snap)')
        state.cycleGridSnap()
      }

      if (key === ';' && !e.ctrlKey) {
        e.preventDefault()
        log('Keyboard: ; (toggle grid)')
        state.setShowGrid(!state.showGrid)
      }

      if (key === 'w' && !e.ctrlKey) {
        e.preventDefault()
        log('Keyboard: W (workplane tool)')
        if (state.tempWorkplane) {
          state.clearTempWorkplane()
        }
      }

      if (key === 'p' && !e.ctrlKey) {
        e.preventDefault()
        log('Keyboard: P (toggle camera)')
        state.toggleCameraMode()
      }

      if (key === 'f' && e.ctrlKey) {
        e.preventDefault()
        log('Keyboard: Ctrl+F (fit all)')
        state.setFitAll()
      }

      if (e.ctrlKey && key === '1') {
        e.preventDefault()
        if (ids.length >= 2) {
          log('Keyboard: Ctrl+1 (CSG Union)')
          state.csgOperation('union')
        }
      }
      if (e.ctrlKey && key === '2') {
        e.preventDefault()
        if (ids.length >= 2) {
          log('Keyboard: Ctrl+2 (CSG Subtract)')
          state.csgOperation('subtract')
        }
      }
      if (e.ctrlKey && key === '3') {
        e.preventDefault()
        if (ids.length >= 2) {
          log('Keyboard: Ctrl+3 (CSG Intersect)')
          state.csgOperation('intersect')
        }
      }

      if (key === 'l' && !e.ctrlKey) {
        if (ids.length >= 2) {
          e.preventDefault()
          log('Keyboard: L (align center)')
          state.alignShapes(ids, 'x', 'center')
          state.alignShapes(ids, 'y', 'center')
          state.alignShapes(ids, 'z', 'center')
        }
      }

      if (e.key === 'Escape') {
        if (state.tempWorkplane) {
          state.clearTempWorkplane()
        }
        if (state.rulerActive) {
          state.clearRuler()
        }
      }

      if (key === 'x' && !e.ctrlKey) {
        e.preventDefault()
        log('Keyboard: X (ruler tool)')
        state.toggleRuler()
      }

      if (e.ctrlKey && e.shiftKey && key === 'd' && ids.length >= 3) {
        e.preventDefault()
        log('Keyboard: Ctrl+Shift+D (distribute X)')
        state.distributeShapes(ids, 'x')
      }
      if (e.ctrlKey && e.shiftKey && key === 'e' && ids.length >= 3) {
        e.preventDefault()
        log('Keyboard: Ctrl+Shift+E (distribute Y)')
        state.distributeShapes(ids, 'y')
      }
      if (e.ctrlKey && e.shiftKey && key === 'f' && ids.length >= 3) {
        e.preventDefault()
        log('Keyboard: Ctrl+Shift+F (distribute Z)')
        state.distributeShapes(ids, 'z')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenProject])
}
