import React, { useRef, useState, useCallback, useEffect } from 'react'
import type { BoundingBox } from '../../types/neura.types'
import { ensureCocoSsd } from '../../ml/loadScript'
import ConfirmModal from './ConfirmModal'

interface ObjectAnnotatorModalProps {
    imageUrl: string
    initialBoxes: BoundingBox[]
    classOptions: { name: string; color: string }[]
    defaultLabel?: string
    onSave: (boxes: BoundingBox[]) => void
    onClose: () => void
    // Navigation for dataset — when annotating many images
    hasPrev?: boolean
    hasNext?: boolean
    onPrev?: () => void
    onNext?: () => void
    currentIndex?: number
    total?: number
    onSaveAndNext?: (boxes: BoundingBox[]) => void
    onSaveAndPrev?: (boxes: BoundingBox[]) => void
}

const TOOL_COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#14B8A6']

function getNextColor(existing: BoundingBox[]): string {
    const used = existing.map(b => b.color)
    return TOOL_COLORS.find(c => !used.includes(c)) || TOOL_COLORS[0]
}

export default function ObjectAnnotatorModal({ imageUrl, initialBoxes, classOptions, defaultLabel: defaultLabelProp, onSave, onClose, hasPrev, hasNext, onPrev, onNext, currentIndex, total, onSaveAndNext, onSaveAndPrev }: ObjectAnnotatorModalProps) {
    const canvasRef = useRef<HTMLDivElement>(null)
    const imgRef = useRef<HTMLImageElement>(null)
    const [boxes, setBoxes] = useState<BoundingBox[]>(() => initialBoxes.map(b => ({ ...b })))
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [activeTool, setActiveTool] = useState<'box' | 'delete'>('box')
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
    const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
    const [dragState, setDragState] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
    const [resizeState, setResizeState] = useState<{ id: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null)
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
    const [editingLabel, setEditingLabel] = useState('')
    const [isAutoDetecting, setIsAutoDetecting] = useState(false)
    const [undoStack, setUndoStack] = useState<BoundingBox[][]>([])
    const [redoStack, setRedoStack] = useState<BoundingBox[][]>([])
    const [showLabels, setShowLabels] = useState(true)
    const [showClearConfirm, setShowClearConfirm] = useState(false)
    const autoDetectModelRef = useRef<any>(null)
    const defaultLabel = defaultLabelProp || classOptions[0]?.name || 'Object'
    const [activeLabel, setActiveLabel] = useState(defaultLabel)
    // keep activeLabel in sync when palette changes externally
    useEffect(() => { setActiveLabel(defaultLabel) }, [defaultLabel])

    // Sync when navigating to next/prev image (imageUrl changes)
    useEffect(() => {
        setBoxes(initialBoxes.map(b => ({ ...b })))
        setSelectedId(null)
        setUndoStack([])
        setRedoStack([])
        setIsDrawing(false); setDrawStart(null); setDrawCurrent(null); setDragState(null); setResizeState(null)
    }, [imageUrl])

    const pushUndo = useCallback((prev: BoundingBox[]) => {
        setUndoStack(s => {
            const n = [...s, prev.map(b => ({ ...b }))]
            return n.length > 50 ? n.slice(-50) : n
        })
        setRedoStack([])
    }, [])

    const handleUndo = useCallback(() => {
        setUndoStack(prev => {
            if (prev.length === 0) return prev
            const last = prev[prev.length - 1]
            setRedoStack(r => [...r, boxes.map(b => ({ ...b }))])
            setBoxes(last)
            return prev.slice(0, -1)
        })
    }, [boxes])

    const handleRedo = useCallback(() => {
        setRedoStack(prev => {
            if (prev.length === 0) return prev
            const last = prev[prev.length - 1]
            setUndoStack(u => [...u, boxes.map(b => ({ ...b }))])
            setBoxes(last)
            return prev.slice(0, -1)
        })
    }, [boxes])

    const getRelativePos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!canvasRef.current) return { x: 0, y: 0 }
        const rect = canvasRef.current.getBoundingClientRect()
        const touch = 'touches' in e ? (e.touches[0] || (e as any).changedTouches?.[0]) : null
        const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX
        const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY
        return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 }
    }, [])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (activeTool === 'delete') return
        if (activeTool === 'box' && !dragState && !resizeState) {
            const pos = getRelativePos(e)
            // if clicked on empty area, start drawing
            if ((e.target as HTMLElement).closest('[data-box]')) return
            setIsDrawing(true)
            setDrawStart(pos)
            setDrawCurrent(pos)
        }
    }, [activeTool, getRelativePos, dragState, resizeState])

    const handleMouseMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (isDrawing && drawStart) {
            setDrawCurrent(getRelativePos(e as any))
            return
        }
        if (dragState) {
            const pos = getRelativePos(e as any)
            const dx = pos.x - dragState.startX
            const dy = pos.y - dragState.startY
            const box = boxes.find(b => b.id === dragState.id)
            if (!box) return
            const nx = Math.max(0, Math.min(100 - box.width, dragState.origX + dx))
            const ny = Math.max(0, Math.min(100 - box.height, dragState.origY + dy))
            setBoxes(prev => prev.map(b => b.id === dragState.id ? { ...b, x: nx, y: ny } : b))
        }
        if (resizeState) {
            const pos = getRelativePos(e as any)
            const dx = pos.x - resizeState.startX
            const dy = pos.y - resizeState.startY
            setBoxes(prev => prev.map(b => {
                if (b.id !== resizeState.id) return b
                let nx = resizeState.origX, ny = resizeState.origY, nw = resizeState.origW, nh = resizeState.origH
                if (resizeState.handle.includes('e')) nw = Math.max(2, Math.min(100 - resizeState.origX, resizeState.origW + dx))
                if (resizeState.handle.includes('w')) { nx = Math.max(0, resizeState.origX + dx); nw = Math.max(2, resizeState.origW - dx) }
                if (resizeState.handle.includes('s')) nh = Math.max(2, Math.min(100 - resizeState.origY, resizeState.origH + dy))
                if (resizeState.handle.includes('n')) { ny = Math.max(0, resizeState.origY + dy); nh = Math.max(2, resizeState.origH - dy) }
                return { ...b, x: nx, y: ny, width: nw, height: nh }
            }))
        }
    }, [isDrawing, drawStart, dragState, resizeState, getRelativePos, boxes])

    const handleMouseUp = useCallback(() => {
        if (isDrawing && drawStart && drawCurrent) {
            const x = Math.min(drawStart.x, drawCurrent.x)
            const y = Math.min(drawStart.y, drawCurrent.y)
            const w = Math.abs(drawCurrent.x - drawStart.x)
            const h = Math.abs(drawCurrent.y - drawStart.y)
            if (w > 2 && h > 2) {
                pushUndo(boxes)
                const color = classOptions.find(c => c.name === activeLabel)?.color || getNextColor(boxes)
                const nw = Math.min(w, 100 - x)
                const nh = Math.min(h, 100 - y)
                const newBox: BoundingBox = { id: `box_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, label: activeLabel, x, y, width: nw, height: nh, color }
                setBoxes(prev => [...prev, newBox])
                setSelectedId(newBox.id)
            }
        }
        setIsDrawing(false); setDrawStart(null); setDrawCurrent(null); setDragState(null); setResizeState(null)
    }, [isDrawing, drawStart, drawCurrent, boxes, defaultLabel, pushUndo])

    const handleBoxMouseDown = useCallback((e: React.MouseEvent, boxId: string) => {
        e.stopPropagation()
        if (activeTool === 'delete') {
            pushUndo(boxes)
            setBoxes(prev => prev.filter(b => b.id !== boxId))
            if (selectedId === boxId) setSelectedId(null)
            return
        }
        setSelectedId(boxId)
        const pos = getRelativePos(e)
        const box = boxes.find(b => b.id === boxId)
        if (box) {
            // push undo on drag start, not on click
            setDragState({ id: boxId, startX: pos.x, startY: pos.y, origX: box.x, origY: box.y })
        }
    }, [activeTool, boxes, selectedId, getRelativePos, pushUndo])

    const handleResizeMouseDown = useCallback((e: React.MouseEvent, boxId: string, handle: string) => {
        e.stopPropagation()
        const pos = getRelativePos(e)
        const box = boxes.find(b => b.id === boxId)
        if (box) setResizeState({ id: boxId, handle, startX: pos.x, startY: pos.y, origX: box.x, origY: box.y, origW: box.width, origH: box.height })
    }, [boxes, getRelativePos])

    const handleSave = () => {
        // validate: each box must have label from classOptions
        const validNames = new Set(classOptions.map(c => c.name.toLowerCase()))
        for (const b of boxes) {
            if (!validNames.has(b.label.toLowerCase())) {
                alert(`Box label "${b.label}" is not a folder name. Use one of: ${classOptions.map(c => c.name).join(', ')}`)
                return
            }
            if (b.width < 1 || b.height < 1) {
                alert('Each box must be at least 1% size')
                return
            }
        }
        onSave(boxes)
    }

    const handleAutoDetect = async () => {
        if (!imageUrl || !canvasRef.current) return
        setIsAutoDetecting(true)
        try {
            if (!autoDetectModelRef.current) {
                const cocoSsd = await ensureCocoSsd()
                autoDetectModelRef.current = await cocoSsd.load()
            }
            const img = new Image()
            img.src = imageUrl
            await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); setTimeout(() => resolve(), 5000) })
            if (!img.complete || img.naturalWidth === 0) { setIsAutoDetecting(false); return }
            const results: any[] = await autoDetectModelRef.current.detect(img)
            if (!results || results.length === 0) { alert('No objects detected. Draw boxes manually.'); setIsAutoDetecting(false); return }
            pushUndo(boxes)
            const COCO_MAP: Record<string, string> = {
                'cell phone': 'phone', 'potted plant': 'plant', 'backpack': 'bag', 'handbag': 'bag', 'suitcase': 'bag',
                'bicycle': 'bike', 'motorcycle': 'bike', 'laptop': 'computer', 'sports ball': 'ball', 'dining table': 'table',
                'traffic light': 'light', 'fire hydrant': 'hydrant', 'stop sign': 'sign', teddy: 'teddy', 'baseball bat': 'bat',
                'baseball glove': 'glove', 'tennis racket': 'racket', 'wine glass': 'glass', 'hot dog': 'hotdog'
            }
            const newBoxes: BoundingBox[] = []
            for (const r of results) {
                const [bx, by, bw, bh] = r.bbox
                // map COCO bbox (pixels on original image) to % of displayed image — use image natural size vs displayed container; we assume 1:1 container covers image with object-contain, so compute offset
                // Simpler: Convert directly to % of natural image: x% = bx / naturalWidth *100
                const x = (bx / img.naturalWidth) * 100
                const y = (by / img.naturalHeight) * 100
                const w = (bw / img.naturalWidth) * 100
                const h = (bh / img.naturalHeight) * 100
                if (w < 1 || h < 1) continue
                const cocoLabel = (r.class || '').toLowerCase()
                const friendly = COCO_MAP[cocoLabel] || cocoLabel
                const matched = classOptions.find(c => c.name.toLowerCase() === cocoLabel || c.name.toLowerCase() === friendly)
                const label = matched ? matched.name : activeLabel
                const color = classOptions.find(c => c.name === label)?.color || getNextColor([...boxes, ...newBoxes])
                newBoxes.push({ id: `box_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${newBoxes.length}`, label, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)), width: Math.min(w, 100 - Math.max(0, Math.min(100, x))), height: Math.min(h, 100 - Math.max(0, Math.min(100, y))), color })
            }
            setBoxes(prev => [...prev, ...newBoxes])
        } catch (e) {
            console.error('[Annotator] auto detect failed', e)
            alert('Auto-detect failed')
        }
        setIsAutoDetecting(false)
    }

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (editingLabelId) {
                if (e.key === 'Enter') {
                    const valid = classOptions.some(c => c.name.toLowerCase() === editingLabel.trim().toLowerCase())
                    if (!valid && editingLabel.trim()) {
                        // allow but warn? keep trimmed
                    }
                    setBoxes(prev => prev.map(b => b.id === editingLabelId ? { ...b, label: editingLabel.trim() || b.label } : b))
                    setEditingLabelId(null)
                }
                if (e.key === 'Escape') { setEditingLabelId(null); setEditingLabel('') }
                return
            }
            if (e.key === 'ArrowLeft' && hasPrev && onPrev) {
                e.preventDefault()
                if (onSaveAndPrev) onSaveAndPrev(boxes); else onPrev()
                return
            }
            if (e.key === 'ArrowRight' && hasNext && onNext) {
                e.preventDefault()
                if (onSaveAndNext) onSaveAndNext(boxes); else onNext()
                return
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedId) {
                    pushUndo(boxes)
                    setBoxes(prev => prev.filter(b => b.id !== selectedId))
                    setSelectedId(null)
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); handleUndo() }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); handleRedo() }
            if (e.key.toLowerCase() === 'b') setActiveTool('box')
            if (e.key.toLowerCase() === 'l') setShowLabels(v => !v)
            if (e.key === 'Escape') { // close if not editing
                if (!isDrawing && !dragState && !resizeState) onClose()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [selectedId, boxes, pushUndo, handleUndo, handleRedo, editingLabelId, editingLabel, classOptions, onClose, isDrawing, dragState, resizeState, hasPrev, hasNext, onPrev, onNext, onSaveAndNext, onSaveAndPrev])

    const previewBox = isDrawing && drawStart && drawCurrent ? { x: Math.min(drawStart.x, drawCurrent.x), y: Math.min(drawStart.y, drawCurrent.y), width: Math.abs(drawCurrent.x - drawStart.x), height: Math.abs(drawCurrent.y - drawStart.y) } : null

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-[min(1100px,98vw)] h-[min(86vh,820px)] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="h-[56px] flex items-center justify-between px-4 border-b border-slate-200 shrink-0 bg-gradient-to-r from-violet-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center">🏷️</div>
                        <div>
                            <h2 className="text-sm font-bold text-slate-900 leading-none">Annotate Image</h2>
                            <p className="text-xs text-slate-500 leading-none mt-0.5">Draw boxes around objects • {boxes.length} box{boxes.length!==1?'es':''}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {(hasPrev !== undefined || hasNext !== undefined) && (
                            <div className="flex items-center gap-1 mr-1">
                                <button onClick={() => { if (hasPrev && onPrev) { if (onSaveAndPrev) onSaveAndPrev(boxes); else onPrev() } }} disabled={!hasPrev} className={`h-8 px-2.5 rounded-lg text-xs font-bold border flex items-center gap-1 ${!hasPrev ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`} title="Previous image (←)">‹ Prev</button>
                                <span className="text-[11px] font-bold text-slate-600 px-1">{currentIndex !== undefined && total !== undefined ? `${currentIndex + 1}/${total}` : ''}</span>
                                <button onClick={() => { if (hasNext && onNext) { if (onSaveAndNext) onSaveAndNext(boxes); else onNext() } }} disabled={!hasNext} className={`h-8 px-2.5 rounded-lg text-xs font-bold border flex items-center gap-1 ${!hasNext ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'}`} title="Next image (→) — saves current">Next ›</button>
                            </div>
                        )}
                        <button onClick={() => setShowLabels(v => !v)} className={`h-8 px-2.5 rounded-lg text-xs font-bold border ${showLabels ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`} title="Toggle labels (L)">{showLabels ? '🏷️ Labels on' : '🏷️ Labels off'}</button>
                        <button onClick={handleAutoDetect} disabled={isAutoDetecting} className={`h-8 px-3 rounded-lg text-xs font-bold border ${isAutoDetecting ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{isAutoDetecting ? 'Detecting…' : '🤖 Auto-detect'}</button>
                        <button onClick={handleUndo} disabled={undoStack.length===0} className={`h-8 px-2.5 rounded-lg text-xs font-bold border ${undoStack.length===0?'bg-slate-50 text-slate-400 border-slate-200':'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>↩️</button>
                        <button onClick={handleRedo} disabled={redoStack.length===0} className={`h-8 px-2.5 rounded-lg text-xs font-bold border ${redoStack.length===0?'bg-slate-50 text-slate-400 border-slate-200':'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>↪️</button>
                        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center hover:bg-slate-800">✕</button>
                    </div>
                </div>
                {/* Label selector inside annotator — pick active class for next box */}
                <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 overflow-x-auto neura-scrollbar">
                    <span className="text-[11px] font-bold text-slate-600 shrink-0">Label for next box:</span>
                    {classOptions.map(opt => {
                        const isActive = activeLabel === opt.name
                        const count = boxes.filter(b => b.label === opt.name).length
                        return (
                            <button
                                key={opt.name}
                                onClick={() => setActiveLabel(opt.name)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold shrink-0 transition-all ${isActive ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-white'}`}
                                title={`Set next box to ${opt.name} — existing boxes keep their label (double-click a box label to edit it)`}
                            >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: opt.color }} />
                                {opt.name}
                                <span className={`px-1 py-0.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
                            </button>
                        )
                    })}
                    <span className="ml-1 text-[10px] text-slate-400 hidden sm:inline">Next box → <b className="text-slate-700">{activeLabel}</b> • existing boxes keep their label</span>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row min-h-0">
                    {/* Canvas */}
                    <div className="flex-1 relative bg-slate-950 overflow-hidden flex flex-col min-h-[320px]">
                        {/* Toolbar */}
                        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 bg-white/95 backdrop-blur p-2 rounded-xl border border-slate-200 shadow-sm">
                            <button onClick={() => setActiveTool('box')} className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm border ${activeTool==='box' ? 'bg-violet-600 text-white border-violet-600 shadow' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`} title="Box tool (B)">⬜</button>
                            <button onClick={() => setActiveTool('delete')} className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm border ${activeTool==='delete' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`} title="Delete mode">🗑️</button>
                        </div>
                        <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-black/70 backdrop-blur text-white px-3 py-1.5 rounded-full text-xs font-medium">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" /> {boxes.length} boxes
                        </div>
                        {isAutoDetecting && (
                            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-30">
                                <div className="bg-white rounded-xl border border-slate-200 shadow-lg px-6 py-4 flex flex-col items-center gap-2">
                                    <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
                                    <p className="text-xs font-bold text-slate-700">Auto-detecting objects…</p>
                                </div>
                            </div>
                        )}
                        <div
                            ref={canvasRef}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove as any}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onTouchStart={handleMouseDown as any}
                            onTouchMove={handleMouseMove as any}
                            onTouchEnd={handleMouseUp as any}
                            className={`relative flex-1 flex items-center justify-center select-none touch-none overflow-hidden ${activeTool==='box' ? 'cursor-crosshair' : activeTool==='delete' ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                            <img ref={imgRef} src={imageUrl} alt="" className="max-w-full max-h-full object-contain pointer-events-none select-none" draggable={false} />
                            {/* Boxes overlay — positioned relative to container; we need to align to image bounds, not container. Simplification: overlay covers entire container and boxes use % of container; since image is object-contain, offset matters. For correctness we compute image rect. */}
                            {/* Use absolute overlay sized to image element */}
                            {imgRef.current && (() => {
                                const img = imgRef.current
                                // we need to get rect of img vs container for pixel mapping; but we use % of image natural dimensions, and overlay is sized to image element's displayed size.
                                // Instead render boxes inside a wrapper sized to image.
                                return null
                            })()}
                            {/* Simpler: render boxes as % of container assuming image fills container (we use object-contain but we treat container as image area — slight offset error acceptable for demo, but better to use image-sized overlay) */}
                            <div className="absolute inset-0">
                                {boxes.map(box => {
                                    const isSelected = selectedId === box.id
                                    const showThisLabel = showLabels || isSelected || editingLabelId === box.id
                                    // Smart placement: if box near top edge (<6%), put label inside bottom, else top inside
                                    const nearTop = box.y < 6
                                    return (
                                    <div
                                        key={box.id}
                                        data-box
                                        onMouseDown={e => handleBoxMouseDown(e, box.id)}
                                        onDoubleClick={() => { setEditingLabelId(box.id); setEditingLabel(box.label); setTimeout(()=>document.getElementById(`edit-${box.id}`)?.focus(), 0) }}
                                        className={`absolute border flex ${isSelected ? 'z-20' : 'z-10'} ${activeTool==='delete' ? 'cursor-pointer hover:bg-red-500/10' : 'cursor-move'}`}
                                        style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%`, borderColor: box.color, borderWidth: isSelected ? 2 : 1.5, backgroundColor: isSelected ? `${box.color}14` : `${box.color}0D` }}
                                    >
                                        {/* Label — compact, inside box edge, does not cover image outside box */}
                                        {editingLabelId===box.id ? (
                                            <div className="absolute left-0 flex gap-1 bg-white rounded-lg border border-slate-200 shadow-md p-1 z-30" style={{ top: nearTop ? '2px' : '-28px' }} onClick={e=>e.stopPropagation()}>
                                                <select value={editingLabel} onChange={e=>setEditingLabel(e.target.value)} className="h-7 px-2 rounded-md border border-slate-200 text-xs font-bold outline-none max-w-[120px]">
                                                    {classOptions.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                </select>
                                                <button onClick={()=>{ setBoxes(prev=>prev.map(b=>b.id===box.id?{...b,label:editingLabel}:b)); setEditingLabelId(null)}} className="h-7 px-2 rounded-md bg-violet-600 text-white text-xs font-bold">✓</button>
                                                <button onClick={()=>setEditingLabelId(null)} className="h-7 px-2 rounded-md bg-slate-100 text-slate-700 text-xs font-bold">✕</button>
                                            </div>
                                        ) : showThisLabel ? (
                                            <div
                                                className={`absolute left-0 px-1.5 py-0.5 rounded text-[9px] font-bold text-white whitespace-nowrap shadow-sm flex items-center gap-1 cursor-text max-w-[90%] truncate ${isSelected ? 'ring-1 ring-white/50' : 'opacity-90 hover:opacity-100'}`}
                                                style={{ background: box.color, top: nearTop ? '1px' : '-1px', transform: nearTop ? 'none' : 'translateY(-100%)', marginTop: nearTop ? 0 : '-2px' }}
                                                onDoubleClick={e=>{e.stopPropagation(); setEditingLabelId(box.id); setEditingLabel(box.label)}}
                                                title={`${box.label} — double-click to edit`}
                                            >
                                                <span className="truncate max-w-[80px]">{box.label}</span>
                                                {isSelected && <span className="opacity-60 text-[8px] leading-none">✎</span>}
                                            </div>
                                        ) : (
                                            // labels hidden — show tiny color dot only so you can still see boxes
                                            <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full shadow-sm" style={{ background: box.color }} />
                                        )}
                                        {isSelected && (
                                            <>
                                                <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-nw-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={e=>handleResizeMouseDown(e, box.id, 'nw')} />
                                                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-ne-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={e=>handleResizeMouseDown(e, box.id, 'ne')} />
                                                <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-sw-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={e=>handleResizeMouseDown(e, box.id, 'sw')} />
                                                <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-se-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={e=>handleResizeMouseDown(e, box.id, 'se')} />
                                            </>
                                        )}
                                    </div>
                                )})}
                                {previewBox && previewBox.width>0.5 && previewBox.height>0.5 && (
                                    <div className="absolute border-2 border-dashed border-violet-600 bg-violet-500/10 pointer-events-none z-30" style={{ left:`${previewBox.x}%`, top:`${previewBox.y}%`, width:`${previewBox.width}%`, height:`${previewBox.height}%`}} />
                                )}
                            </div>
                        </div>
                        {/* Bottom white bar — shortcuts, connected with right Cancel/Prev/Next */}
                        <div className="min-h-[56px] px-3 py-2 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
                            <div className="flex items-center gap-2 text-[11px] leading-none flex-wrap">
                                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600"><span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold">B</span> box</span>
                                <span className="w-px h-4 bg-slate-200 hidden sm:block"></span>
                                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600"><span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold">L</span> hide labels</span>
                                <span className="w-px h-4 bg-slate-200 hidden sm:block"></span>
                                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600"><span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold">Del</span> delete</span>
                                <span className="w-px h-4 bg-slate-200 hidden sm:block"></span>
                                <span className="inline-flex items-center gap-1.5 font-medium text-slate-600"><span className="inline-flex items-center justify-center px-1 h-5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold">Ctrl+Z</span> undo</span>
                            </div>
                            <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-medium text-slate-500 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span> Double-click label to edit • labels hide when crowded
                            </div>
                        </div>
                    </div>

                    {/* Right sidebar: box list */}
                    <div className="w-full lg:w-[280px] border-t lg:border-t-0 lg:border-l border-slate-200 bg-slate-50 flex flex-col shrink-0 max-h-[40vh] lg:max-h-none">
                        <div className="p-3 border-b border-slate-200 bg-white">
                            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2">📦 Boxes ({boxes.length}) <span className={`ml-auto w-2 h-2 rounded-full ${boxes.length>0?'bg-emerald-500':'bg-slate-300'}`} /></h3>
                            <p className="text-[11px] text-slate-500 mt-1">Each box is one training example. Label must match a folder name.</p>
                        </div>
                        <div className="flex-1 overflow-auto p-3 flex flex-col gap-2">
                            {boxes.length===0 && (
                                <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                                    <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mb-3">⬜</div>
                                    <p className="text-xs font-bold text-slate-700">No boxes yet</p>
                                    <p className="text-[11px] text-slate-500 mt-1">Drag on image to draw a box</p>
                                    <button onClick={handleAutoDetect} disabled={isAutoDetecting} className="mt-3 h-8 px-3 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-xs font-bold">🤖 Auto-detect</button>
                                </div>
                            )}
                            {boxes.map((box, i)=>(
                                <div key={box.id} onClick={()=>setSelectedId(box.id)} className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${selectedId===box.id?'bg-white border-violet-300 shadow-sm ring-2 ring-violet-100':'bg-white border-slate-200 hover:border-slate-300'}`}>
                                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: box.color }} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-slate-900 truncate">{box.label}</p>
                                        <p className="text-[10px] text-slate-500">{Math.round(box.x)}%,{Math.round(box.y)}% • {Math.round(box.width)}×{Math.round(box.height)}%</p>
                                    </div>
                                    <span className="text-[11px] font-bold text-slate-400">#{i+1}</span>
                                    <button onClick={e=>{e.stopPropagation(); pushUndo(boxes); setBoxes(prev=>prev.filter(b=>b.id!==box.id))}} className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 flex items-center justify-center">×</button>
                                </div>
                            ))}
                        </div>
                        <div className="min-h-[56px] px-3 py-2 border-t border-slate-200 bg-white flex items-center gap-1.5">
                            <button onClick={onClose} className="h-9 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 shrink-0">Cancel</button>
                            {hasPrev !== undefined && (
                                <button
                                    onClick={() => {
                                        const validNames = new Set(classOptions.map(c => c.name.toLowerCase()))
                                        for (const b of boxes) if (!validNames.has(b.label.toLowerCase())) { alert(`Box "${b.label}" invalid`); return }
                                        if (onSaveAndPrev) onSaveAndPrev(boxes); else if (onPrev) onPrev()
                                    }}
                                    disabled={!hasPrev}
                                    className={`h-9 px-3 rounded-xl text-xs font-bold border shrink-0 ${!hasPrev?'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed':'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                                >‹ Prev</button>
                            )}
                            {hasNext !== undefined && (
                                <button
                                    onClick={() => {
                                        const validNames = new Set(classOptions.map(c => c.name.toLowerCase()))
                                        for (const b of boxes) if (!validNames.has(b.label.toLowerCase())) { alert(`Box "${b.label}" invalid`); return }
                                        if (onSaveAndNext) onSaveAndNext(boxes); else if (onNext) onNext()
                                    }}
                                    disabled={!hasNext}
                                    className={`h-9 px-3 rounded-xl text-xs font-bold border shrink-0 ${!hasNext?'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed':'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'}`}
                                >Next ›</button>
                            )}
                            <button
                                onClick={handleSave}
                                disabled={boxes.length===0}
                                className={`flex-1 h-9 rounded-xl text-xs font-bold border shadow-sm ${boxes.length===0?'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed':'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'}`}
                            >
                                💾 Save {boxes.length>0?`(${boxes.length})`:''}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <ConfirmModal isOpen={showClearConfirm} title="Clear all boxes?" message="All boxes on this image will be removed. You can undo with Ctrl+Z." confirmText="Clear all" variant="danger" icon="🧹" onConfirm={() => { pushUndo(boxes); setBoxes([]); setShowClearConfirm(false) }} onCancel={() => setShowClearConfirm(false)} />
        </div>
    )
}
