import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import { useCamera } from '../../hooks/useCamera'
import { HandPoseClassifier } from '../../ml/classifiers/HandPoseClassifier'
import { classifyDrawErase, StateMachineBuffer } from '../../ml/utils/ruleBasedClassifiers'

interface DrawingCanvasPanelProps {
    mode: UseNeuraProjectReturn
}

const PREDICT_THROTTLE_MS = 16
const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 480
const MAX_UNDO = 30
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
const BRUSH_SIZES = { small: 3, medium: 8, large: 15 }
const ERASER_BRUSH = 25
const POINTER_COLOR = '#22c55e'

const CLASSES = ['Draw', 'Erase', 'Move', 'Color Select'] as const

const TOOL_CONFIG: Record<string, { emoji: string; description: string; gesture: string }> = {
    'Draw': { emoji: '✏️', description: 'Draw on canvas', gesture: '☝️ Index finger pointing' },
    'Erase': { emoji: '🧹', description: 'Erase strokes', gesture: '✊ Closed fist' },
    'Move': { emoji: '✋', description: 'Pan canvas', gesture: '✌️ Peace sign' },
    'Color Select': { emoji: '🎨', description: 'Cycle colors', gesture: '🖐️ Open hand' },
}

// Infinite canvas card sizes — parity with other Neura modules (ObjectDetector / ImageClassifier)
const CARD_SIZES: Record<string, { w: number; h: number }> = {
    'draw-camera': { w: 460, h: 340 },
    'draw-canvas': { w: 640, h: 520 },
    'draw-controls': { w: 360, h: 84 },
    'draw-tools': { w: 360, h: 620 },
}
const GAP = 32
const CANVAS_W = 3000
const CANVAS_H = 2000
const HEADER_H = 72

function overlapRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    return !(a.x + a.w + GAP <= b.x || b.x + b.w + GAP <= a.x || a.y + a.h + GAP <= b.y || b.y + b.h + GAP <= a.y)
}
function clampToBounds(pos: { x: number; y: number }, w: number, h: number) {
    return {
        x: Math.min(Math.max(pos.x, 0), Math.max(0, CANVAS_W - w)),
        y: Math.min(Math.max(pos.y, HEADER_H), Math.max(HEADER_H, CANVAS_H - h)),
    }
}

export default function DrawingCanvasPanel({ mode }: DrawingCanvasPanelProps) {
    const hiddenCanvasRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
    const previewCanvasRef = useRef<HTMLCanvasElement>(null)
    const drawingCanvasRef = useRef<HTMLCanvasElement>(null)
    const classifierRef = useRef(new HandPoseClassifier())
    const animFrameRef = useRef<number>(0)
    const isPredictingRef = useRef(false)
    const lastPredictTimeRef = useRef(0)
    const stateMachineRef = useRef(new StateMachineBuffer(3))

    const [prediction, setPrediction] = useState<{ label: string; confidences: Record<string, number> } | null>(null)
    const [modelLoading, setModelLoading] = useState(false)
    const [handDetected, setHandDetected] = useState(false)
    const [inferenceTime, setInferenceTime] = useState(0)
    const [savedMessage, setSavedMessage] = useState<string | null>(null)
    const [modelError, setModelError] = useState<string | null>(null)
    const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [confidenceThreshold, setConfidenceThreshold] = useState(0.5)
    const [activeTool, setActiveTool] = useState<string | null>(null)
    const [currentColorIndex, setCurrentColorIndex] = useState(0)
    const [brushSize, setBrushSize] = useState<keyof typeof BRUSH_SIZES>('medium')
    const [fingerPos, setFingerPos] = useState<{ x: number; y: number } | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const lastDragPosRef = useRef<{ x: number; y: number } | null>(null)
    const colorCycleTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const lastColorCycleTimeRef = useRef(0)
    const undoStackRef = useRef<ImageData[]>([])
    const isPanningRef = useRef(false)
    const handDetectedRef = useRef(false)
    const panStartRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
    const [smoothingAlpha, setSmoothingAlpha] = useState(0.35)
    const smoothingAlphaRef = useRef(smoothingAlpha)
    smoothingAlphaRef.current = smoothingAlpha
    const smoothedIndexTipRef = useRef<{ x: number; y: number } | null>(null)
    const activeToolRef = useRef<string | null>(null)
    const currentColorIndexRef = useRef(currentColorIndex)
    const brushSizeRef = useRef(brushSize)
    const handDetectionEverWorkedRef = useRef(false)
    const modelErrorShownRef = useRef(false)

    // Infinite canvas state — parity with other Neura infinite screens
    const viewportRef = useRef<HTMLDivElement>(null)
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 32, y: 24 })
    const [isPanning, setIsPanning] = useState(false)
    const viewportPanStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
    const pinchRef = useRef<{ startDist: number; startZoom: number; startPan: { x: number; y: number }; center: { x: number; y: number } } | null>(null)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const dragStartRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
    // Default layout: vertical flow for requested "class, drawing camera, canvas, control" — can be dragged anywhere
    // Camera top-left, Canvas large center, Tools right, Controls below camera
    const [cameraPos, setCameraPos] = useState({ x: 48, y: 80 })
    const [canvasPos, setCanvasPos] = useState({ x: 540, y: 80 })
    const [toolsPos, setToolsPos] = useState({ x: 1220, y: 80 })
    const [controlsPos, setControlsPos] = useState({ x: 48, y: 440 })

    const showSaved = useCallback((msg: string) => {
        setSavedMessage(msg)
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        savedTimeoutRef.current = setTimeout(() => setSavedMessage(null), 2000)
    }, [])

    const saveUndoState = useCallback(() => {
        const canvas = drawingCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        undoStackRef.current.push(imageData)
        if (undoStackRef.current.length > MAX_UNDO) {
            undoStackRef.current.shift()
        }
    }, [])

    const handleUndo = useCallback(() => {
        const canvas = drawingCanvasRef.current
        if (!canvas || undoStackRef.current.length === 0) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const prev = undoStackRef.current.pop()!
        ctx.putImageData(prev, 0, 0)
    }, [])

    const handleClearCanvas = useCallback(() => {
        const canvas = drawingCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        saveUndoState()
        ctx.clearRect(0, 0, canvas.width, canvas.height)
    }, [saveUndoState])

    const drawAtPosition = useCallback((x: number, y: number, isErase: boolean) => {
        const canvas = drawingCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        if (isErase) {
            ctx.globalCompositeOperation = 'destination-out'
            ctx.beginPath()
            ctx.arc(x, y, ERASER_BRUSH / 2, 0, Math.PI * 2)
            ctx.fill()
            ctx.globalCompositeOperation = 'source-over'
            return
        }

        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = COLORS[currentColorIndex]
        ctx.lineWidth = BRUSH_SIZES[brushSize]
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        const prev = lastDragPosRef.current
        if (prev) {
            ctx.beginPath()
            ctx.moveTo(prev.x, prev.y)
            ctx.lineTo(x, y)
            ctx.stroke()
        } else {
            ctx.beginPath()
            ctx.arc(x, y, BRUSH_SIZES[brushSize] / 2, 0, Math.PI * 2)
            ctx.fillStyle = COLORS[currentColorIndex]
            ctx.fill()
        }
    }, [currentColorIndex, brushSize])

    const handleToolAction = useCallback((tool: string, _keypoints: { x: number; y: number; score: number }[]) => {
        const canvas = drawingCanvasRef.current
        let pos: { x: number; y: number } | null = null
        if (canvas && smoothedIndexTipRef.current) {
            pos = {
                x: (1 - smoothedIndexTipRef.current.x / CANVAS_WIDTH) * canvas.width,
                y: (smoothedIndexTipRef.current.y / CANVAS_HEIGHT) * canvas.height,
            }
        }
        setFingerPos(pos)
        if (!pos) {
            if (isDragging) console.debug('[DrawingCanvas] Drag stop — finger lost')
            setIsDragging(false)
            lastDragPosRef.current = null
            return
        }

        switch (tool) {
            case 'Draw': {
                if (!isDragging) {
                    saveUndoState()
                    setIsDragging(true)
                    console.debug('[DrawingCanvas] Draw start at', Math.round(pos.x), Math.round(pos.y))
                }
                drawAtPosition(pos.x, pos.y, false)
                lastDragPosRef.current = pos
                break
            }
            case 'Erase': {
                if (!isDragging) {
                    saveUndoState()
                    setIsDragging(true)
                    console.debug('[DrawingCanvas] Erase start at', Math.round(pos.x), Math.round(pos.y))
                }
                drawAtPosition(pos.x, pos.y, true)
                lastDragPosRef.current = pos
                break
            }
            case 'Move': {
                if (isDragging) {
                    setIsDragging(false)
                    lastDragPosRef.current = null
                }
                if (!isPanningRef.current) {
                    isPanningRef.current = true
                    panStartRef.current = { x: pos.x, y: pos.y, cx: 0, cy: 0 }
                }
                break
            }
            case 'Color Select': {
                const now = Date.now()
                if (now - lastColorCycleTimeRef.current > 600) {
                    lastColorCycleTimeRef.current = now
                    setCurrentColorIndex(prev => {
                        const next = (prev + 1) % COLORS.length
                        console.log('[DrawingCanvas] Color changed to', COLORS[next])
                        showSaved(`🎨 Color: ${COLORS[next]}`)
                        return next
                    })
                }
                lastDragPosRef.current = pos
                break
            }
        }
    }, [isDragging, drawAtPosition, saveUndoState, showSaved])

    const camera = useCamera({ videoConstraints: { width: 640, height: 480, facingMode: 'user' } })

    const handleStopCamera = useCallback(() => {
        camera.stopCamera()
        setHandDetected(false)
        handDetectedRef.current = false
        setPrediction(null)
        setFingerPos(null)
        setIsDragging(false)
        lastDragPosRef.current = null
        isPanningRef.current = false
        if (overlayCanvasRef.current) {
            const octx = overlayCanvasRef.current.getContext('2d')
            if (octx) octx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
        }
        if (previewCanvasRef.current) {
            const pctx = previewCanvasRef.current.getContext('2d')
            if (pctx) pctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
        }
    }, [camera])

    useEffect(() => { currentColorIndexRef.current = currentColorIndex }, [currentColorIndex])
    useEffect(() => { brushSizeRef.current = brushSize }, [brushSize])

    useEffect(() => {
        return () => {
            cancelAnimationFrame(animFrameRef.current)
            classifierRef.current.dispose()
        }
    }, [])

    // Camera default OFF — like other Neura modules (Virtual Piano, Image Classifier, Object Detector)
    // User must explicitly tap "Turn On Camera" / "Start" to activate — no auto-start on mount

    // Hide left Classes sidebar for infinite canvas parity — this canvas is rule-based, not training
    useEffect(() => { mode.setHideSidebar(true); return () => mode.setHideSidebar(false) }, [])

    // Infinite canvas helpers
    const getCanvasPoint = (clientX: number, clientY: number) => {
        const rect = viewportRef.current?.getBoundingClientRect(); if (!rect) return { x: 0, y: 0 }
        return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom }
    }
    const getAllRects = () => ({
        'draw-camera': { x: cameraPos.x, y: cameraPos.y, ...CARD_SIZES['draw-camera'] },
        'draw-canvas': { x: canvasPos.x, y: canvasPos.y, ...CARD_SIZES['draw-canvas'] },
        'draw-controls': { x: controlsPos.x, y: controlsPos.y, ...CARD_SIZES['draw-controls'] },
        'draw-tools': { x: toolsPos.x, y: toolsPos.y, ...CARD_SIZES['draw-tools'] },
    })
    const nudgeToFree = (draggedId: string, candidate: { x: number; y: number }, fallback: { x: number; y: number }) => {
        const { w, h } = CARD_SIZES[draggedId]
        const clamped = clampToBounds(candidate, w, h)
        const all = getAllRects() as Record<string, { x: number; y: number; w: number; h: number }>
        const others = Object.entries(all).filter(([k]) => k !== draggedId).map(([, v]) => v as any)
        others.push({ x: 0, y: 0, w: CANVAS_W, h: HEADER_H })
        const isFree = (r: any) => !others.some(o => overlapRect(r, o))
        const rect = { x: clamped.x, y: clamped.y, w, h }
        if (isFree(rect)) return clamped
        // try single-axis slide, else snap back (flicker-free)
        const fbClamped = clampToBounds(fallback, w, h)
        const dx = Math.abs(clamped.x - fbClamped.x)
        const dy = Math.abs(clamped.y - fbClamped.y)
        const first = dx >= dy ? { x: clamped.x, y: fbClamped.y } : { x: fbClamped.x, y: clamped.y }
        const second = dx >= dy ? { x: fbClamped.x, y: clamped.y } : { x: clamped.x, y: fbClamped.y }
        if (isFree({ ...first, w, h })) return first
        if (isFree({ ...second, w, h })) return second
        return fallback
    }
    const startNodeDrag = (e: React.PointerEvent | React.MouseEvent, id: string, orig: { x: number; y: number }) => {
        e.stopPropagation()
        if ('preventDefault' in e) (e as any).preventDefault?.()
        const p = getCanvasPoint((e as any).clientX, (e as any).clientY)
        dragStartRef.current = { id, startX: p.x, startY: p.y, origX: orig.x, origY: orig.y }
        setDraggingId(id)
        if ('pointerId' in e && typeof (e as any).pointerId === 'number') {
            try { (e.target as HTMLElement).setPointerCapture?.((e as any).pointerId) } catch {}
        }
    }
    const handleViewportMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('[data-node]')) return
        setIsPanning(true); viewportPanStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    }
    const handleViewportMouseMove = (e: React.MouseEvent) => {
        if (isPanning && viewportPanStartRef.current) {
            const dx = e.clientX - viewportPanStartRef.current.x, dy = e.clientY - viewportPanStartRef.current.y
            setPan({ x: viewportPanStartRef.current.panX + dx, y: viewportPanStartRef.current.panY + dy })
        }
        if (draggingId && dragStartRef.current) {
            const cur = getCanvasPoint(e.clientX, e.clientY)
            const s = dragStartRef.current
            const nx = s.origX + (cur.x - s.startX), ny = s.origY + (cur.y - s.startY)
            if (s.id === 'draw-camera') { const cand = nudgeToFree('draw-camera', {x:nx,y:ny}, cameraPos); if (cand !== cameraPos) setCameraPos(cand) }
            else if (s.id === 'draw-canvas') { const cand = nudgeToFree('draw-canvas', {x:nx,y:ny}, canvasPos); if (cand !== canvasPos) setCanvasPos(cand) }
            else if (s.id === 'draw-tools') { const cand = nudgeToFree('draw-tools', {x:nx,y:ny}, toolsPos); if (cand !== toolsPos) setToolsPos(cand) }
            else if (s.id === 'draw-controls') { const cand = nudgeToFree('draw-controls', {x:nx,y:ny}, controlsPos); if (cand !== controlsPos) setControlsPos(cand) }
        }
    }
    const handleViewportMouseUp = () => { setIsPanning(false); viewportPanStartRef.current = null; if (draggingId) setDraggingId(null) }
    // Wheel handled via native passive:false below; React handler only zooms
    const handleWheel = (e: React.WheelEvent) => {
        e.stopPropagation()
        const isPinch = e.ctrlKey || (e as any).ctrlKey
        const delta = -e.deltaY * (isPinch ? 0.008 : 0.0012)
        const newZoom = Math.min(1.4, Math.max(0.6, zoom + delta))
        const rect = viewportRef.current?.getBoundingClientRect()
        if (rect) {
            const mx = e.clientX - rect.left, my = e.clientY - rect.top
            const wx = (mx - pan.x) / zoom, wy = (my - pan.y) / zoom
            const nx = mx - wx * newZoom, ny = my - wy * newZoom
            setPan({ x: nx, y: ny })
        }
        setZoom(newZoom)
    }
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX
            const dy = e.touches[0].clientY - e.touches[1].clientY
            const dist = Math.hypot(dx, dy)
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
            pinchRef.current = { startDist: dist, startZoom: zoom, startPan: { ...pan }, center: { x: cx, y: cy } }
        }
    }
    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && pinchRef.current) {
            const dx = e.touches[0].clientX - e.touches[1].clientX
            const dy = e.touches[0].clientY - e.touches[1].clientY
            const dist = Math.hypot(dx, dy)
            const scale = dist / pinchRef.current.startDist
            const newZoom = Math.min(1.4, Math.max(0.6, pinchRef.current.startZoom * scale))
            const rect = viewportRef.current?.getBoundingClientRect()
            if (rect) {
                const mx = pinchRef.current.center.x - rect.left
                const my = pinchRef.current.center.y - rect.top
                const wx = (mx - pinchRef.current.startPan.x) / pinchRef.current.startZoom
                const wy = (my - pinchRef.current.startPan.y) / pinchRef.current.startZoom
                const nx = mx - wx * newZoom
                const ny = my - wy * newZoom
                setPan({ x: nx, y: ny })
            }
            setZoom(newZoom)
        }
    }
    const handleTouchEnd = () => { if (pinchRef.current) pinchRef.current = null }
    const zoomIn = () => setZoom(z => Math.min(1.4, +(z + 0.1).toFixed(2)))
    const zoomOut = () => setZoom(z => Math.max(0.6, +(z - 0.1).toFixed(2)))
    const resetView = () => { setZoom(1); setPan({ x: 32, y: 24 }) }

    useEffect(() => {
        const onMove = (e: MouseEvent | PointerEvent) => {
            const cx = (e as any).clientX, cy = (e as any).clientY
            if (isPanning && viewportPanStartRef.current) {
                const dx = cx - viewportPanStartRef.current.x, dy = cy - viewportPanStartRef.current.y
                setPan({ x: viewportPanStartRef.current.panX + dx, y: viewportPanStartRef.current.panY + dy })
            }
            if (draggingId && dragStartRef.current) {
                const rect = viewportRef.current?.getBoundingClientRect(); if (!rect) return
                const curX = (cx - rect.left - pan.x) / zoom, curY = (cy - rect.top - pan.y) / zoom
                const s = dragStartRef.current
                const nx = s.origX + (curX - s.startX), ny = s.origY + (curY - s.startY)
                if (s.id === 'draw-camera') { const cand = nudgeToFree('draw-camera', {x:nx,y:ny}, cameraPos); if (cand !== cameraPos) setCameraPos(cand) }
                else if (s.id === 'draw-canvas') { const cand = nudgeToFree('draw-canvas', {x:nx,y:ny}, canvasPos); if (cand !== canvasPos) setCanvasPos(cand) }
                else if (s.id === 'draw-tools') { const cand = nudgeToFree('draw-tools', {x:nx,y:ny}, toolsPos); if (cand !== toolsPos) setToolsPos(cand) }
                else if (s.id === 'draw-controls') { const cand = nudgeToFree('draw-controls', {x:nx,y:ny}, controlsPos); if (cand !== controlsPos) setControlsPos(cand) }
            }
        }
        const onUp = () => { setIsPanning(false); viewportPanStartRef.current = null; setDraggingId(null) }
        window.addEventListener('mousemove', onMove as any); window.addEventListener('mouseup', onUp)
        window.addEventListener('pointermove', onMove as any); window.addEventListener('pointerup', onUp as any)
        return () => { window.removeEventListener('mousemove', onMove as any); window.removeEventListener('mouseup', onUp as any); window.removeEventListener('pointermove', onMove as any); window.removeEventListener('pointerup', onUp as any) }
    }, [isPanning, draggingId, zoom, pan, cameraPos, canvasPos, toolsPos, controlsPos])

    useEffect(() => {
        const el = viewportRef.current; if (!el) return
        const onWheelNative = (e: WheelEvent) => { if (e.cancelable) e.preventDefault() }
        const onTouchMoveNative = (e: TouchEvent) => { if (e.touches.length===2 && e.cancelable) e.preventDefault() }
        el.addEventListener('wheel', onWheelNative, { passive: false })
        el.addEventListener('touchmove', onTouchMoveNative, { passive: false })
        return () => { el.removeEventListener('wheel', onWheelNative); el.removeEventListener('touchmove', onTouchMoveNative) }
    }, [])

    // Run detection loop whenever camera is on
    useEffect(() => {
        if (modelLoading) return
        if (!camera.cameraOn) return
        const runPrediction = async () => {
            if (isPredictingRef.current) return
            if (camera.streamStateRef.current && camera.videoRef.current && hiddenCanvasRef.current) {
                isPredictingRef.current = true
                let keypoints: any[] = []
                let elapsed = 0
                try {
                    const start = performance.now()
                    const ctx = hiddenCanvasRef.current.getContext('2d')
                    if (ctx) {
                        hiddenCanvasRef.current.width = CANVAS_WIDTH
                        hiddenCanvasRef.current.height = CANVAS_HEIGHT
                        ctx.drawImage(camera.videoRef.current, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
                        try {
                            const rawKeypoints = await classifierRef.current.detectHand(hiddenCanvasRef.current)
                            keypoints = rawKeypoints.map(kp => ({ ...kp, score: typeof kp.score === 'number' ? kp.score : 1 }))
                            if (keypoints.length > 0) {
                                handDetectionEverWorkedRef.current = true
                                if (modelErrorShownRef.current) {
                                    modelErrorShownRef.current = false
                                    setModelError(null)
                                }
                            }
                        } catch (detectErr) {
                            console.warn('[DrawingCanvas] detectHand error:', detectErr)
                            if (!handDetectionEverWorkedRef.current && !modelErrorShownRef.current) {
                                modelErrorShownRef.current = true
                                setModelError('MediaPipe GPU hand model failed to load. Check your internet connection and retry.')
                            }
                        }
                        elapsed = Math.round(performance.now() - start)
                    }

                    if (keypoints.length > 0) {
                        const wasDetected = handDetectedRef.current
                        if (!wasDetected) console.log('[DrawingCanvas] Hand detected —', keypoints.length, 'keypoints')
                        handDetectedRef.current = true
                        setHandDetected(true)
                        setInferenceTime(elapsed)

                        const indexTip = keypoints[8]
                        const indexTipOk = !!indexTip && (typeof indexTip.score !== 'number' || indexTip.score > 0.3)
                        if (indexTipOk) {
                            const sa = smoothingAlphaRef.current
                            if (smoothedIndexTipRef.current) {
                                smoothedIndexTipRef.current = {
                                    x: sa * indexTip.x + (1 - sa) * smoothedIndexTipRef.current.x,
                                    y: sa * indexTip.y + (1 - sa) * smoothedIndexTipRef.current.y,
                                }
                            } else {
                                smoothedIndexTipRef.current = { x: indexTip.x, y: indexTip.y }
                            }
                        } else {
                            if (indexTip) {
                                smoothedIndexTipRef.current = { x: indexTip.x, y: indexTip.y }
                            } else {
                                smoothedIndexTipRef.current = null
                            }
                        }

                        let toolName = 'Draw'
                        try {
                            const features = classifierRef.current.extractFeatures(keypoints)
                            const result = classifyDrawErase(features)
                            const smoothedTool = stateMachineRef.current.update(result.label)
                            const labelToTool: Record<string, string> = {
                                'draw': 'Draw', 'erase': 'Erase', 'move': 'Move', 'color-select': 'Color Select',
                            }
                            toolName = labelToTool[smoothedTool] || 'Draw'
                        } catch (classifyErr) {
                            console.warn('[DrawingCanvas] Classification error:', classifyErr)
                        }
                        const prevTool = activeToolRef.current
                        if (prevTool !== toolName) console.log('[DrawingCanvas] Tool switch:', prevTool || '(none)', '→', toolName)
                        activeToolRef.current = toolName
                        setPrediction({ label: toolName, confidences: { [toolName]: 1 } })
                        setActiveTool(toolName)

                        if (overlayCanvasRef.current && smoothedIndexTipRef.current) {
                            try {
                                overlayCanvasRef.current.width = CANVAS_WIDTH
                                overlayCanvasRef.current.height = CANVAS_HEIGHT
                                classifierRef.current.drawHand(overlayCanvasRef.current, keypoints, POINTER_COLOR, { readableLabels: true })
                                const octx = overlayCanvasRef.current.getContext('2d')
                                if (octx) {
                                    const raw = smoothedIndexTipRef.current
                                    const px = overlayCanvasRef.current.width - raw.x
                                    const py = raw.y
                                    const isErase = toolName === 'Erase'
                                    const color = isErase ? '#ef4444' : POINTER_COLOR
                                    const brushPx = BRUSH_SIZES[brushSizeRef.current]
                                    const ringRadius = isErase ? 24 : Math.max(10, brushPx * 1.8)
                                    octx.beginPath()
                                    octx.arc(px, py, ringRadius, 0, Math.PI * 2)
                                    octx.strokeStyle = color
                                    octx.lineWidth = isErase ? 4 : 3
                                    octx.shadowColor = color
                                    octx.shadowBlur = 20
                                    octx.stroke()
                                    if (isErase) {
                                        octx.beginPath()
                                        octx.arc(px, py, ringRadius - 2, 0, Math.PI * 2)
                                        octx.fillStyle = 'rgba(239,68,68,0.15)'
                                        octx.shadowBlur = 0
                                        octx.fill()
                                    }
                                    octx.beginPath()
                                    octx.arc(px, py, 3, 0, Math.PI * 2)
                                    octx.fillStyle = '#ffffff'
                                    octx.shadowColor = '#ffffff'
                                    octx.shadowBlur = 12
                                    octx.fill()
                                    octx.shadowBlur = 0
                                    const ch = Math.max(8, ringRadius * 0.6)
                                    octx.strokeStyle = 'rgba(255,255,255,0.7)'
                                    octx.lineWidth = 1
                                    octx.beginPath()
                                    octx.moveTo(px - ch, py)
                                    octx.lineTo(px - ringRadius * 0.5, py)
                                    octx.moveTo(px + ringRadius * 0.5, py)
                                    octx.lineTo(px + ch, py)
                                    octx.moveTo(px, py - ch)
                                    octx.lineTo(px, py - ringRadius * 0.5)
                                    octx.moveTo(px, py + ringRadius * 0.5)
                                    octx.lineTo(px, py + ch)
                                    octx.stroke()
                                    const toolEmoji = isErase ? '🧹' : (toolName === 'Color Select' ? '🎨' : (toolName === 'Move' ? '✋' : '✏️'))
                                    octx.font = 'bold 12px system-ui, sans-serif'
                                    octx.textAlign = 'center'
                                    const labelText = `${toolEmoji} ${toolName}`
                                    const tw = octx.measureText(labelText).width
                                    octx.fillStyle = 'rgba(0,0,0,0.65)'
                                    octx.beginPath()
                                    // @ts-ignore roundRect
                                    octx.roundRect(px - tw / 2 - 8, py - ringRadius - 27, tw + 16, 22, 6)
                                    octx.fill()
                                    octx.fillStyle = '#ffffff'
                                    octx.fillText(labelText, px, py - ringRadius - 13)
                                }
                            } catch (drawErr) {
                                console.warn('[DrawingCanvas] Overlay draw error:', drawErr)
                            }
                        }

                        handleToolAction(toolName, keypoints)
                    } else {
                        if (handDetectedRef.current) console.log('[DrawingCanvas] Hand lost')
                        handDetectedRef.current = false
                        setHandDetected(false)
                        smoothedIndexTipRef.current = null
                        setPrediction(null)
                        setActiveTool(null)
                        activeToolRef.current = null
                        setFingerPos(null)
                        setIsDragging(false)
                        lastDragPosRef.current = null
                        isPanningRef.current = false
                        stateMachineRef.current.clear()
                        if (overlayCanvasRef.current) {
                            const octx = overlayCanvasRef.current.getContext('2d')
                            if (octx) octx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
                        }
                    }
                } catch (e) {
                    console.warn('[DrawingCanvas] Prediction error:', e)
                }
                isPredictingRef.current = false
            }
        }
        const drawPreview = () => {
            if (!previewCanvasRef.current || !drawingCanvasRef.current || !camera.cameraOnRef.current) return
            previewCanvasRef.current.width = CANVAS_WIDTH
            previewCanvasRef.current.height = CANVAS_HEIGHT
            const pctx = previewCanvasRef.current.getContext('2d')
            if (!pctx) return
            pctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
            pctx.save()
            pctx.scale(-1, 1)
            pctx.translate(-CANVAS_WIDTH, 0)
            pctx.globalAlpha = 0.5
            pctx.drawImage(drawingCanvasRef.current, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
            pctx.globalAlpha = 1.0
            pctx.restore()
        }
        lastPredictTimeRef.current = performance.now()
        const tick = () => {
            drawPreview()
            const now = performance.now()
            if (now - lastPredictTimeRef.current >= PREDICT_THROTTLE_MS) {
                lastPredictTimeRef.current = now
                runPrediction()
            }
            animFrameRef.current = requestAnimationFrame(tick)
        }
        animFrameRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(animFrameRef.current)
    }, [camera.stream, camera.cameraOn, modelLoading, confidenceThreshold, handleToolAction])

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#F8FAFC] relative">
            {savedMessage && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg animate-fade-in">
                    {savedMessage}
                </div>
            )}

            {/* Header — parity with other Neura infinite modules */}
            <div className="shrink-0 h-[48px] flex items-center justify-between px-4 bg-white border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white">🎨</div>
                    <div className="min-w-0">
                        <h1 className="text-[13px] font-semibold text-slate-900 leading-none tracking-tight">Virtual Drawing Canvas</h1>
                        <p className="text-[11px] text-slate-500 leading-none mt-0.5 hidden sm:block">Canvas • Pan, zoom, and arrange cards</p>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-slate-200">
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">✏️ {activeTool || 'Idle'}</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-600">{inferenceTime} ms</span>
                        <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold border ${handDetected ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>{handDetected ? 'Hand found' : 'No hand'}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={camera.toggleCamera} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold border ${camera.cameraOn ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                        <span className={`w-2 h-2 rounded-full ${camera.cameraOn ? 'bg-emerald-400' : 'bg-slate-300'}`} />{camera.cameraOn ? 'Camera on' : 'Camera off'}
                    </button>
                    <button onClick={handleUndo} className="hidden sm:inline-flex h-8 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">↩️ Undo</button>
                    <button onClick={handleClearCanvas} className="hidden sm:inline-flex h-8 px-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 hover:bg-red-100">🗑️ Clear</button>
                </div>
            </div>

            {/* Infinite canvas viewport */}
            <div
                ref={viewportRef}
                onMouseDown={handleViewportMouseDown as any}
                onMouseMove={handleViewportMouseMove as any}
                onMouseUp={handleViewportMouseUp as any}
                onPointerDown={handleViewportMouseDown as any}
                onPointerMove={handleViewportMouseMove as any}
                onPointerUp={handleViewportMouseUp as any}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart as any}
                onTouchMove={handleTouchMove as any}
                onTouchEnd={handleTouchEnd as any}
                style={{ touchAction: 'none' }}
                className={`flex-1 relative overflow-hidden ${isPanning ? 'cursor-grabbing' : 'cursor-grab'} bg-[#F8FAFC]`}
            >
                <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #DDD6FE 1.2px, transparent 1.2px)`, backgroundSize: '20px 20px', backgroundPosition: `${pan.x}px ${pan.y}px` }} />
                <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: `linear-gradient(#7C3AED 1px, transparent 1px), linear-gradient(90deg, #7C3AED 1px, transparent 1px)`, backgroundSize: '80px 80px', backgroundPosition: `${pan.x}px ${pan.y}px` }} />

                <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: 3000, height: 2000 }}>
                    <svg className="absolute inset-0 pointer-events-none" width={3000} height={2000} style={{ overflow: 'visible' }}>
                        <defs><linearGradient id="wire" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#CBD5E1" /><stop offset="100%" stopColor="#94A3B8" /></linearGradient></defs>
                        {(() => {
                            const x1 = cameraPos.x + CARD_SIZES['draw-camera'].w, y1 = cameraPos.y + 160
                            const x2 = canvasPos.x, y2 = canvasPos.y + 260
                            const mx = (x1 + x2) / 2
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" />
                        })()}
                        {(() => {
                            const x1 = canvasPos.x + CARD_SIZES['draw-canvas'].w, y1 = canvasPos.y + 260
                            const x2 = toolsPos.x, y2 = toolsPos.y + 300
                            const mx = (x1 + x2) / 2
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" />
                        })()}
                    </svg>

                    {/* Classes — vertical pills (rule-based tools, not trainable) */}
                    <div data-node style={{ left: 48, top: 520, width: 460 }} className="absolute select-none z-10">
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex flex-wrap gap-1.5">
                            {CLASSES.map(cls => {
                                const cfg = TOOL_CONFIG[cls]
                                const isActive = activeTool === cls
                                return (
                                    <div key={cls} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-bold ${isActive ? 'bg-emerald-500 text-white border-emerald-500 shadow' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                                        <span>{cfg.emoji}</span>{cls}<span className="text-[10px] opacity-60 hidden sm:inline">• {cfg.gesture}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Camera Card */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'draw-camera', cameraPos)} style={{ left: cameraPos.x, top: cameraPos.y, width: CARD_SIZES['draw-camera'].w, touchAction: 'none' as any }} className={`absolute select-none ${draggingId==='draw-camera'?'z-40':'z-10'} cursor-grab active:cursor-grabbing`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                            <div className="h-11 px-3 flex items-center justify-between border-b border-slate-100 bg-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white text-sm">📷</div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Drawing Camera</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{camera.cameraOn ? (handDetected ? 'Hand tracking' : 'Looking for hand') : 'Idle — turn on to draw'}</p>
                                    </div>
                                </div>
                                <span className={`w-2 h-2 rounded-full ${camera.cameraOn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            </div>
                            <div className="relative bg-[#0a0128] h-[260px] overflow-hidden" onPointerDown={e=>e.stopPropagation()}>
                                <video ref={camera.videoRef} autoPlay playsInline muted className={`w-full h-full object-contain -scale-x-100 ${camera.cameraOn ? 'block' : 'hidden'}`} />
                                <canvas ref={hiddenCanvasRef} className="hidden" />
                                <canvas ref={previewCanvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none -scale-x-100" />
                                <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                                {camera.cameraOn && <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/40 backdrop-blur-md rounded-md"><div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /><span className="text-white text-[9px] font-bold">LIVE</span></div>}
                                {activeTool && <div className="absolute top-2 right-2 px-2.5 py-1 rounded-xl backdrop-blur-md text-white text-xs font-bold bg-emerald-500/85 flex items-center gap-1"><span>{TOOL_CONFIG[activeTool]?.emoji}</span>{activeTool}</div>}
                                {modelError && <div className="absolute inset-x-2 bottom-2 px-3 py-2 bg-red-600/80 backdrop-blur-md rounded-xl text-white text-[10px] font-bold leading-relaxed z-10">⚠️ {modelError}<button type="button" onClick={() => { setModelError(null); modelErrorShownRef.current = false }} className="ml-2 text-white/70 hover:text-white">✕</button></div>}
                                {!camera.cameraOn && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                                        <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-2xl mb-3">🎨</div>
                                        <h3 className="text-white text-sm font-bold mb-1">Camera is off</h3>
                                        <p className="text-white/60 text-xs mb-3">Start camera to draw with hand gestures</p>
                                        <button type="button" onClick={camera.startCamera} className="h-9 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow">Turn On Camera</button>
                                    </div>
                                )}
                            </div>
                            <div className="p-2.5 flex items-center justify-between bg-white border-t border-slate-100">
                                <button type="button" onClick={camera.toggleCamera} className={`h-8 px-3 rounded-xl text-xs font-bold border ${camera.cameraOn ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{camera.cameraOn ? 'Stop' : 'Start'} Camera</button>
                                <span className="text-[11px] font-semibold text-slate-500">{handDetected ? 'Hand found' : 'No hand'} • {inferenceTime}ms</span>
                            </div>
                        </div>
                    </div>

                    {/* Canvas Card — whiteboard */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'draw-canvas', canvasPos)} style={{ left: canvasPos.x, top: canvasPos.y, width: CARD_SIZES['draw-canvas'].w, touchAction: 'none' as any }} className={`absolute select-none ${draggingId==='draw-canvas'?'z-40':'z-10'} cursor-grab active:cursor-grabbing`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                            <div className="h-11 px-3 flex items-center justify-between border-b border-slate-100 bg-white">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center text-sm">⬜</div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Whiteboard</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{activeTool ? TOOL_CONFIG[activeTool]?.description : 'Show a gesture to begin'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded-full border-2 border-slate-200" style={{ background: COLORS[currentColorIndex] }} />
                                    <span className="text-xs font-bold text-slate-600 hidden sm:inline">{brushSize}</span>
                                </div>
                            </div>
                            <div className="relative bg-white h-[420px] p-2" onPointerDown={e=>e.stopPropagation()}>
                                <canvas ref={drawingCanvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="w-full h-full border border-slate-200 rounded-xl bg-white block" />
                                {fingerPos && handDetected && (
                                    <div className="absolute pointer-events-none rounded-full border-2" style={{ left: `${(fingerPos.x / CANVAS_WIDTH) * 100}%`, top: `${(fingerPos.y / CANVAS_HEIGHT) * 100}%`, width: activeTool === 'Erase' ? '24px' : '10px', height: activeTool === 'Erase' ? '24px' : '10px', transform: 'translate(-50%, -50%)', borderColor: activeTool === 'Erase' ? '#ef4444' : '#22c55e', background: activeTool === 'Erase' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.25)' }} />
                                )}
                            </div>
                            <div className="p-2.5 flex items-center justify-center gap-2 bg-slate-50 border-t border-slate-200">
                                <button type="button" onClick={handleUndo} className="h-8 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">↩️ Undo</button>
                                <button type="button" onClick={handleClearCanvas} className="h-8 px-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 hover:bg-red-100">🗑️ Clear</button>
                                <span className="ml-auto text-[11px] text-slate-500 hidden sm:inline">Drag canvas card to reposition • Scroll to zoom</span>
                            </div>
                        </div>
                    </div>

                    {/* Controls Card — compact below camera (vertical flow) */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'draw-controls', controlsPos)} style={{ left: controlsPos.x, top: controlsPos.y, width: CARD_SIZES['draw-controls'].w, touchAction: 'none' as any }} className={`absolute select-none ${draggingId==='draw-controls'?'z-40':'z-10'} cursor-grab active:cursor-grabbing`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2.5 flex items-center justify-around">
                            <button type="button" onClick={camera.toggleCamera} className="flex-1 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold mx-1">{camera.cameraOn ? '📷 Stop' : '📷 Start'}</button>
                            <button type="button" onClick={handleUndo} className="flex-1 h-9 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 mx-1">↩️ Undo</button>
                            <button type="button" onClick={handleClearCanvas} className="flex-1 h-9 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 mx-1">🗑️ Clear</button>
                        </div>
                    </div>

                    {/* Tools Card — Color, Brush, Smoothing, Gesture Map */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'draw-tools', toolsPos)} style={{ left: toolsPos.x, top: toolsPos.y, width: CARD_SIZES['draw-tools'].w, touchAction: 'none' as any }} className={`absolute select-none ${draggingId==='draw-tools'?'z-40':'z-10'} cursor-grab active:cursor-grabbing`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                            <div className="h-11 px-3 flex items-center gap-2 border-b border-slate-100 bg-white">
                                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center text-sm">🎛️</div>
                                <div>
                                    <p className="text-[13px] font-semibold text-slate-900 leading-none">Tools</p>
                                    <p className="text-[11px] text-slate-500 leading-none mt-0.5">{activeTool ? `${TOOL_CONFIG[activeTool]?.emoji} ${activeTool}` : '-- idle'}</p>
                                </div>
                                <span className="ml-auto w-2 h-2 rounded-full bg-slate-300" />
                            </div>
                            <div className="p-3 flex flex-col gap-3 max-h-[520px] overflow-auto neura-scrollbar" onPointerDown={e=>e.stopPropagation()}>
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Current Tool</p>
                                    {activeTool ? <div className="flex flex-col items-center gap-1"><span className="text-4xl">{TOOL_CONFIG[activeTool]?.emoji}</span><span className="text-lg font-black text-emerald-500">{activeTool}</span><span className="text-[10px] text-slate-500">{TOOL_CONFIG[activeTool]?.description}</span></div> : <div className="text-3xl font-black text-slate-300">--</div>}
                                </div>
                                <div>
                                    <p className="text-[11px] font-bold text-slate-700 mb-2">Color Palette</p>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {COLORS.map((c,i)=><button key={c} type="button" onClick={()=>setCurrentColorIndex(i)} className="w-8 h-8 rounded-lg border-2 transition-all" style={{background:c, borderColor: i===currentColorIndex?'#111827':'transparent', transform: i===currentColorIndex?'scale(1.15)':'scale(1)'}} />)}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[11px] font-bold text-slate-700 mb-2">Brush Size</p>
                                    <div className="flex gap-1.5">
                                        {Object.entries(BRUSH_SIZES).map(([name,size])=><button key={name} type="button" onClick={()=>setBrushSize(name as any)} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${brushSize===name?'bg-emerald-50 text-emerald-600 border-emerald-200':'bg-white text-slate-600 border-slate-200'}`}>{name}<div className="mx-auto mt-1 rounded-full bg-current" style={{width:Math.min(size*1.5,16)+'px',height:Math.min(size*1.5,16)+'px'}}/></button>)}
                                    </div>
                                </div>
                                <div className="bg-white rounded-xl p-2 border border-slate-200">
                                    <p className="text-[11px] font-bold text-slate-700 mb-1">Smoothing {Math.round(smoothingAlpha*100)}%</p>
                                    <input type="range" min={5} max={80} value={Math.round(smoothingAlpha*100)} onChange={e=>setSmoothingAlpha(Number(e.target.value)/100)} className="w-full accent-emerald-500" />
                                    <div className="flex justify-between text-[10px] text-slate-400"><span>Smooth</span><span>Responsive</span></div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-emerald-50 rounded-xl p-2.5 border border-emerald-100"><p className="text-[10px] font-bold text-slate-500">Speed</p><p className="text-lg font-extrabold text-slate-900">{inferenceTime}ms</p></div>
                                    <div className="bg-emerald-50 rounded-xl p-2.5 border border-emerald-100"><p className="text-[10px] font-bold text-slate-500">Hand</p><p className={`text-lg font-extrabold ${handDetected?'text-emerald-600':'text-slate-400'}`}>{handDetected?'Found':'None'}</p></div>
                                </div>
                                <div>
                                    <p className="text-[11px] font-bold text-slate-700 mb-2">Gesture Map</p>
                                    <div className="flex flex-col gap-1">
                                        {CLASSES.map(cls=>{const cfg=TOOL_CONFIG[cls]; return <div key={cls} className="flex items-center gap-2 text-[11px]"><span className="text-sm">{cfg.emoji}</span><span className="font-bold text-slate-700 flex-1">{cfg.description}</span><span className="text-slate-400 text-[10px]">{cfg.gesture}</span></div>})}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom canvas controls — parity */}
                <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-white rounded-full shadow-sm border border-slate-200 px-2 py-1.5">
                    <span className="text-[11px] font-medium text-slate-600 px-2">Canvas</span>
                    <button onClick={zoomOut} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">−</button>
                    <span className="text-sm font-bold w-11 text-center text-slate-900">{Math.round(zoom*100)}%</span>
                    <button onClick={zoomIn} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">+</button>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <button onClick={resetView} className="h-7 px-3 rounded-full bg-slate-900 text-white text-sm font-bold">Reset</button>
                </div>
            </div>
        </div>
    )
}
