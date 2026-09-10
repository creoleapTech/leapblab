import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import type { BoundingBox } from '../../types/neura.types'
import { ensureCocoSsd } from '../../ml/loadScript'
import { openImageViewer, openSingleImage } from '../components/neuraImageViewer'

interface AnnotatePanelProps {
    mode: UseNeuraProjectReturn
}

const TOOL_COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#8B5CF6']

function getNextToolColor(existingBoxes: BoundingBox[]): string {
    const usedColors = existingBoxes.map(b => b.color)
    return TOOL_COLORS.find(c => !usedColors.includes(c)) || TOOL_COLORS[0]
}

export default function AnnotatePanel({ mode }: AnnotatePanelProps) {
    const canvasRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const labelInputRef = useRef<HTMLInputElement>(null)
    const autoDetectModelRef = useRef<any>(null)
    const autoDetectGenerationRef = useRef(0)
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
    const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
    const [dragBox, setDragBox] = useState<{ boxId: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
    const [resizeBox, setResizeBox] = useState<{ boxId: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null)
    const [undoStack, setUndoStack] = useState<BoundingBox[][]>([])
    const [redoStack, setRedoStack] = useState<BoundingBox[][]>([])
    const [elapsed, setElapsed] = useState(0)
    const [sessionStart] = useState(() => Date.now())
    const [annotationImage, setAnnotationImage] = useState<string | null>(null)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
    const [savedMessage, setSavedMessage] = useState<string | null>(null)
    const [editingBoxId, setEditingBoxId] = useState<string | null>(null)
    const [editingLabel, setEditingLabel] = useState('')
    const [isAutoDetecting, setIsAutoDetecting] = useState(false)
    const [showBoxList, setShowBoxList] = useState(true)
    const [showLabels, setShowLabels] = useState(true)
    const [isDragging, setIsDragging] = useState(false)
    const [currentImageIndex, setCurrentImageIndex] = useState(0)

    const currentStepIndex = ['collect', 'annotate', 'train', 'test'].indexOf(mode.mode)
    const totalBoxes = mode.currentAnnotation?.boxes.length || 0
    const progress = Math.min((totalBoxes / 10) * 100, 100)
    const selectedClass = mode.getSelectedClass()
    // Fix: when viewing an already annotated image, defaultLabel (and thus new boxes) must match the existing annotation, not just the folder
    const existingAnnotationLabel = React.useMemo(() => {
        const boxes = mode.currentAnnotation?.boxes || []
        if (boxes.length === 0) return null
        const counts: Record<string, number> = {}
        boxes.forEach(b => { const l = b.label?.trim(); if (l) counts[l] = (counts[l] || 0) + 1 })
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
        return sorted[0]?.[0] || null
    }, [mode.currentAnnotation?.boxes])
    const defaultLabel = existingAnnotationLabel || selectedClass?.name || 'Object'
    const classSamples = selectedClass?.samples || []
    const totalImages = classSamples.length

    const annotatedCount = React.useMemo(() => {
        let count = 0
        for (const sample of classSamples) {
            try {
                const parsed = JSON.parse(sample.data)
                if (parsed.boxes && parsed.boxes.length > 0) count++
            } catch { /* raw image, not annotated */ }
        }
        return count
    }, [classSamples])
    const allAnnotated = totalImages > 0 && annotatedCount === totalImages

    useEffect(() => {
        if (mode.selectedClassId && classSamples.length > 0) {
            const safeIndex = Math.min(currentImageIndex, classSamples.length - 1)
            if (safeIndex !== currentImageIndex && currentImageIndex >= 0) {
                setCurrentImageIndex(safeIndex)
                return
            }
            const sample = classSamples[safeIndex]
            if (!sample) return
            try {
                const parsed = JSON.parse(sample.data)
                if (parsed.imageUrl) {
                    setAnnotationImage(parsed.imageUrl)
                    const img = new Image()
                    img.src = parsed.imageUrl
                    img.onload = () => {
                        setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
                    }
                    mode.setCurrentAnnotation({ id: sample.id, imageUrl: parsed.imageUrl, boxes: parsed.boxes || [], imageName: parsed.imageName || 'annotated', timestamp: sample.timestamp })
                }
            } catch {
                if (sample.data && sample.data.startsWith('data:image')) {
                    setAnnotationImage(sample.data)
                    const img = new Image()
                    img.src = sample.data
                    img.onload = () => {
                        setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
                    }
                    mode.setCurrentAnnotation({ id: sample.id, imageUrl: sample.data, boxes: [], imageName: sample.data.split('/').pop() || 'image', timestamp: sample.timestamp })
                }
            }
        }
    }, [mode.selectedClassId, currentImageIndex, classSamples.length])

    // Clear undo/redo stacks when switching images — stacks are per-image
    useEffect(() => {
        setUndoStack([])
        setRedoStack([])
    }, [mode.currentAnnotation?.id, currentImageIndex])

    // New file / LeapLab open – clear previous dataset images and train state
    useEffect(() => {
        if (!mode.project?.id) return
        setUndoStack([])
        setRedoStack([])
        setIsDrawing(false)
        setDrawStart(null)
        setDrawCurrent(null)
        setDragBox(null)
        setResizeBox(null)
        setEditingBoxId(null)
        setEditingLabel('')
        setIsAutoDetecting(false)
        setShowBoxList(true)
        setShowLabels(true)
        setIsDragging(false)
        setCurrentImageIndex(0)
        setAnnotationImage(null)
        setImageSize(null)
        setSavedMessage(null)
        // currentAnnotation will be re-set by the classSamples effect for the new project
    }, [mode.project?.id])

    const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !file.type.startsWith('image/')) return
        if (!mode.selectedClassId) {
            setSavedMessage('Create a class first, then upload')
            setTimeout(() => setSavedMessage(null), 2000)
            return
        }
        const dataUrl = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file) })
        const img = new Image(); img.src = dataUrl
        await new Promise<void>((resolve) => {
            img.onload = () => resolve()
            img.onerror = () => resolve()
            setTimeout(() => resolve(), 5000)
        })
        if (!img.complete || img.naturalWidth === 0) return
        // Resize for storage
        const maxDim = 640
        const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(img.naturalWidth * scale)
        canvas.height = Math.floor(img.naturalHeight * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        const resizedUrl = canvas.toDataURL('image/jpeg', 0.7)
        const annotatedData = JSON.stringify({ imageUrl: resizedUrl, boxes: [], imageName: file.name })
        const ok = mode.addSample(mode.selectedClassId, { type: 'image', data: annotatedData })
        if (ok) {
            // Switch to new image index
            const newCount = (mode.getSelectedClass()?.samples.length || 0) + 1
            setCurrentImageIndex(Math.max(0, newCount - 1))
            setAnnotationImage(resizedUrl)
            setImageSize({ width: canvas.width, height: canvas.height })
            setSavedMessage(`Added to ${mode.getSelectedClass()?.name} — draw a box!`)
            setTimeout(() => setSavedMessage(null), 2000)
        }
        if (fileInputRef.current) fileInputRef.current.value = ''
    }, [mode, currentImageIndex])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (!file || !file.type.startsWith('image/')) return
        if (!mode.selectedClassId) {
            setSavedMessage('Create a class first')
            setTimeout(() => setSavedMessage(null), 2000)
            return
        }
        const dataUrl = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file) })
        const img = new Image(); img.src = dataUrl
        await new Promise<void>((resolve) => {
            img.onload = () => resolve()
            img.onerror = () => resolve()
            setTimeout(() => resolve(), 5000)
        })
        if (!img.complete || img.naturalWidth === 0) return
        const maxDim = 640
        const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(img.naturalWidth * scale)
        canvas.height = Math.floor(img.naturalHeight * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        const resizedUrl = canvas.toDataURL('image/jpeg', 0.7)
        const annotatedData = JSON.stringify({ imageUrl: resizedUrl, boxes: [], imageName: file.name })
        const ok = mode.addSample(mode.selectedClassId, { type: 'image', data: annotatedData })
        if (ok) {
            const newCount = (mode.getSelectedClass()?.samples.length || 0) + 1
            setCurrentImageIndex(Math.max(0, newCount - 1))
            setAnnotationImage(resizedUrl)
            setImageSize({ width: canvas.width, height: canvas.height })
        }
    }, [mode])

    // Paste image from clipboard (Ctrl+V) — no download needed
    useEffect(() => {
        const handlePaste = async (e: ClipboardEvent) => {
            const active = document.activeElement as HTMLElement | null
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
            const items = e.clipboardData?.items
            if (!items) return
            const imageFiles: File[] = []
            for (let i = 0; i < items.length; i++) {
                const it = items[i]
                if (it.kind === 'file' && it.type.startsWith('image/')) {
                    const f = it.getAsFile()
                    if (f) imageFiles.push(f)
                }
            }
            if (imageFiles.length === 0 && e.clipboardData?.files?.length) {
                for (let i = 0; i < e.clipboardData.files.length; i++) {
                    const f = e.clipboardData.files[i]
                    if (f.type.startsWith('image/')) imageFiles.push(f)
                }
            }
            if (imageFiles.length === 0) return
            if (!mode.selectedClassId) { setSavedMessage('Create/select a class first, then paste (Ctrl+V)'); setTimeout(() => setSavedMessage(null), 2000); return }
            e.preventDefault()
            const file = imageFiles[0]
            const dataUrl = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(file) })
            const img = new Image(); img.src = dataUrl
            await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); setTimeout(() => resolve(), 5000) })
            if (!img.complete || img.naturalWidth === 0) return
            const maxDim = 640
            const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1)
            const canvas = document.createElement('canvas')
            canvas.width = Math.floor(img.naturalWidth * scale)
            canvas.height = Math.floor(img.naturalHeight * scale)
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
            const resizedUrl = canvas.toDataURL('image/jpeg', 0.7)
            const annotatedData = JSON.stringify({ imageUrl: resizedUrl, boxes: [], imageName: file.name || `pasted_${Date.now()}.jpg` })
            const ok = mode.addSample(mode.selectedClassId, { type: 'image', data: annotatedData })
            if (ok) {
                const newCount = (mode.getSelectedClass()?.samples.length || 0) + 1
                setCurrentImageIndex(Math.max(0, newCount - 1))
                setAnnotationImage(resizedUrl)
                setImageSize({ width: canvas.width, height: canvas.height })
                setSavedMessage(`📋 Pasted to ${mode.getSelectedClass()?.name} — draw a box!`)
                setTimeout(() => setSavedMessage(null), 2000)
            }
        }
        window.addEventListener('paste', handlePaste as any)
        return () => window.removeEventListener('paste', handlePaste as any)
    }, [mode])

    useEffect(() => {
        const interval = setInterval(() => { setElapsed(Math.floor((Date.now() - sessionStart) / 1000)) }, 1000)
        return () => clearInterval(interval)
    }, [sessionStart])

    const formatTime = (seconds: number) => { const m = Math.floor(seconds / 60); const s = seconds % 60; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` }

    const saveUndoState = useCallback(() => {
        if (mode.currentAnnotation) {
            setUndoStack(prev => {
                const next = [...prev, [...mode.currentAnnotation!.boxes]]
                return next.length > 50 ? next.slice(-50) : next
            })
            setRedoStack([])
        }
    }, [mode.currentAnnotation])

    const handleUndo = useCallback(() => {
        if (undoStack.length === 0 || !mode.currentAnnotation) return
        const prevBoxes = undoStack[undoStack.length - 1]
        const currBoxesCopy: BoundingBox[] = mode.currentAnnotation.boxes.map(b => ({ ...b }))
        const prevBoxesCopy: BoundingBox[] = prevBoxes.map(b => ({ ...b }))
        setRedoStack(prev => [...prev, currBoxesCopy])
        setUndoStack(prev => prev.slice(0, -1))
        mode.setCurrentAnnotation({ ...mode.currentAnnotation, boxes: prevBoxesCopy })
    }, [undoStack, mode])

    const handleRedo = useCallback(() => {
        if (redoStack.length === 0 || !mode.currentAnnotation) return
        const nextBoxes = redoStack[redoStack.length - 1]
        const currBoxesCopy: BoundingBox[] = mode.currentAnnotation.boxes.map(b => ({ ...b }))
        const nextBoxesCopy: BoundingBox[] = nextBoxes.map(b => ({ ...b }))
        setUndoStack(prev => [...prev, currBoxesCopy])
        setRedoStack(prev => prev.slice(0, -1))
        mode.setCurrentAnnotation({ ...mode.currentAnnotation, boxes: nextBoxesCopy })
    }, [redoStack, mode])

    const handleClear = useCallback(() => {
        if (!mode.currentAnnotation || mode.currentAnnotation.boxes.length === 0) return
        saveUndoState()
        mode.setCurrentAnnotation({ ...mode.currentAnnotation, boxes: [] })
        mode.setSelectedBoxId(null)
    }, [mode, saveUndoState])

    const getRelativePos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!canvasRef.current) return { x: 0, y: 0 }
        const rect = canvasRef.current.getBoundingClientRect()
        const touch = 'touches' in e ? (e.touches[0] || (e as React.TouchEvent).changedTouches[0]) : null
        const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX
        const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY
        return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 }
    }, [])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (mode.activeTool === 'delete') return
        if (mode.activeTool === 'box') { const pos = getRelativePos(e); saveUndoState(); setIsDrawing(true); setDrawStart(pos); setDrawCurrent(pos) }
    }, [mode.activeTool, getRelativePos, saveUndoState])

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (mode.activeTool === 'delete') return
        if (mode.activeTool === 'box') {
            const pos = getRelativePos(e); saveUndoState(); setIsDrawing(true); setDrawStart(pos); setDrawCurrent(pos)
        }
    }, [mode.activeTool, getRelativePos, saveUndoState])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (isDrawing && drawStart) { const pos = getRelativePos(e); setDrawCurrent(pos) }
        if (dragBox) {
            const pos = getRelativePos(e); const dx = pos.x - dragBox.startX; const dy = pos.y - dragBox.startY
            mode.updateBox(dragBox.boxId, { x: Math.max(0, Math.min(100 - (mode.currentAnnotation?.boxes.find(b => b.id === dragBox.boxId)?.width || 0), dragBox.origX + dx)), y: Math.max(0, Math.min(100 - (mode.currentAnnotation?.boxes.find(b => b.id === dragBox.boxId)?.height || 0), dragBox.origY + dy)) })
        }
        if (resizeBox) {
            const pos = getRelativePos(e); const dx = pos.x - resizeBox.startX; const dy = pos.y - resizeBox.startY
            const box = mode.currentAnnotation?.boxes.find(b => b.id === resizeBox.boxId)
            if (!box) return
            let newX = resizeBox.origX; let newY = resizeBox.origY; let newW = resizeBox.origW; let newH = resizeBox.origH
            if (resizeBox.handle.includes('e')) newW = Math.max(2, Math.min(100 - resizeBox.origX, resizeBox.origW + dx))
            if (resizeBox.handle.includes('w')) { newX = Math.max(0, resizeBox.origX + dx); newW = Math.max(2, resizeBox.origW - dx) }
            if (resizeBox.handle.includes('s')) newH = Math.max(2, Math.min(100 - resizeBox.origY, resizeBox.origH + dy))
            if (resizeBox.handle.includes('n')) { newY = Math.max(0, resizeBox.origY + dy); newH = Math.max(2, resizeBox.origH - dy) }
            mode.updateBox(resizeBox.boxId, { x: newX, y: newY, width: newW, height: newH })
        }
    }, [isDrawing, drawStart, dragBox, resizeBox, getRelativePos, mode])

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (isDrawing && drawStart) { const pos = getRelativePos(e); setDrawCurrent(pos) }
        if (dragBox) {
            const pos = getRelativePos(e); const dx = pos.x - dragBox.startX; const dy = pos.y - dragBox.startY
            mode.updateBox(dragBox.boxId, { x: Math.max(0, Math.min(100 - (mode.currentAnnotation?.boxes.find(b => b.id === dragBox.boxId)?.width || 0), dragBox.origX + dx)), y: Math.max(0, Math.min(100 - (mode.currentAnnotation?.boxes.find(b => b.id === dragBox.boxId)?.height || 0), dragBox.origY + dy)) })
        }
        if (resizeBox) {
            const pos = getRelativePos(e); const dx = pos.x - resizeBox.startX; const dy = pos.y - resizeBox.startY
            const box = mode.currentAnnotation?.boxes.find(b => b.id === resizeBox.boxId)
            if (!box) return
            let newX = resizeBox.origX; let newY = resizeBox.origY; let newW = resizeBox.origW; let newH = resizeBox.origH
            if (resizeBox.handle.includes('e')) newW = Math.max(2, Math.min(100 - resizeBox.origX, resizeBox.origW + dx))
            if (resizeBox.handle.includes('w')) { newX = Math.max(0, resizeBox.origX + dx); newW = Math.max(2, resizeBox.origW - dx) }
            if (resizeBox.handle.includes('s')) newH = Math.max(2, Math.min(100 - resizeBox.origY, resizeBox.origH + dy))
            if (resizeBox.handle.includes('n')) { newY = Math.max(0, resizeBox.origY + dy); newH = Math.max(2, resizeBox.origH - dy) }
            mode.updateBox(resizeBox.boxId, { x: newX, y: newY, width: newW, height: newH })
        }
    }, [isDrawing, drawStart, dragBox, resizeBox, getRelativePos, mode])

    const handleMouseUp = useCallback(() => {
        if (isDrawing && drawStart && drawCurrent) {
            const x = Math.min(drawStart.x, drawCurrent.x); const y = Math.min(drawStart.y, drawCurrent.y)
            const width = Math.abs(drawCurrent.x - drawStart.x); const height = Math.abs(drawCurrent.y - drawStart.y)
            if (width > 1 && height > 1) {
                const color = getNextToolColor(mode.currentAnnotation?.boxes || [])
                const newBox = { label: defaultLabel, x, y, width: Math.min(width, 100 - x), height: Math.min(height, 100 - y), color }
                mode.addBox(newBox)
            }
        }
        setIsDrawing(false); setDrawStart(null); setDrawCurrent(null); setDragBox(null); setResizeBox(null)
    }, [isDrawing, drawStart, drawCurrent, mode, defaultLabel])

    const handleBoxMouseDown = useCallback((e: React.MouseEvent, boxId: string) => {
        e.stopPropagation()
        if (mode.activeTool === 'delete') { saveUndoState(); mode.removeBox(boxId); return }
        mode.setSelectedBoxId(boxId)
        const pos = getRelativePos(e); const box = mode.currentAnnotation?.boxes.find(b => b.id === boxId)
        if (box) { saveUndoState(); setDragBox({ boxId, startX: pos.x, startY: pos.y, origX: box.x, origY: box.y }) }
    }, [mode, getRelativePos, saveUndoState])

    const handleResizeMouseDown = useCallback((e: React.MouseEvent, boxId: string, handle: string) => {
        e.stopPropagation()
        const pos = getRelativePos(e); const box = mode.currentAnnotation?.boxes.find(b => b.id === boxId)
        if (box) { saveUndoState(); setResizeBox({ boxId, handle, startX: pos.x, startY: pos.y, origX: box.x, origY: box.y, origW: box.width, origH: box.height }) }
    }, [mode, getRelativePos, saveUndoState])

    const handleStartEditLabel = useCallback((boxId: string, currentLabel: string) => {
        setEditingBoxId(boxId)
        setEditingLabel(currentLabel)
        setTimeout(() => labelInputRef.current?.focus(), 0)
    }, [])

    const handleSaveLabel = useCallback(() => {
        if (editingBoxId && editingLabel.trim()) {
            mode.updateBox(editingBoxId, { label: editingLabel.trim() })
        }
        setEditingBoxId(null)
        setEditingLabel('')
    }, [editingBoxId, editingLabel, mode])

    const handleAutoDetect = useCallback(async () => {
        if (!annotationImage || !canvasRef.current) return
        setIsAutoDetecting(true)
        const generation = ++autoDetectGenerationRef.current
        try {
            if (!autoDetectModelRef.current) {
                const cocoSsd = await ensureCocoSsd()
                autoDetectModelRef.current = await cocoSsd.load()
            }
            if (generation !== autoDetectGenerationRef.current) return
            const img = new Image()
            img.src = annotationImage
            await new Promise<void>((resolve) => {
                img.onload = () => resolve()
                img.onerror = () => resolve()
                setTimeout(() => resolve(), 5000)
            })
            if (!img.complete || img.naturalWidth === 0) { setIsAutoDetecting(false); return }
            if (generation !== autoDetectGenerationRef.current) return
            const results = await autoDetectModelRef.current.detect(img)
            if (generation !== autoDetectGenerationRef.current) return
            const canvasRect = canvasRef.current.getBoundingClientRect()
            const imgElement = canvasRef.current.querySelector('img')
            if (!imgElement) { setIsAutoDetecting(false); return }
            const imgRect = imgElement.getBoundingClientRect()
            const offsetX = (imgRect.left - canvasRect.left) / canvasRect.width * 100
            const offsetY = (imgRect.top - canvasRect.top) / canvasRect.height * 100
            const scaleX = (imgRect.width / canvasRect.width) * 100
            const scaleY = (imgRect.height / canvasRect.height) * 100
            saveUndoState()
            const userClasses = mode.project?.classes || []
            const COCO_LABEL_MAP: Record<string, string> = {
                'cell phone': 'phone', 'potted plant': 'plant', 'backpack': 'bag',
                'handbag': 'bag', 'suitcase': 'bag', 'bicycle': 'bike', 'motorcycle': 'bike',
                'laptop': 'computer', 'sports ball': 'ball', 'dining table': 'table',
                'traffic light': 'light', 'fire hydrant': 'hydrant', 'stop sign': 'sign',
                'teddy bear': 'teddy', 'baseball bat': 'bat', 'baseball glove': 'glove',
                'tennis racket': 'racket', 'wine glass': 'glass', 'hot dog': 'hotdog',
                'tv': 'tv', 'remote': 'remote', 'mouse': 'mouse', 'keyboard': 'keyboard',
                'bed': 'bed', 'couch': 'couch', 'toilet': 'toilet', 'sink': 'sink',
                'refrigerator': 'fridge', 'microwave': 'microwave', 'oven': 'oven',
                'vase': 'vase', 'scissors': 'scissors',
            }
            let matchedCount = 0
            results.forEach((r: any) => {
                const [bx, by, bw, bh] = r.bbox
                const x = offsetX + (bx / img.naturalWidth) * scaleX
                const y = offsetY + (by / img.naturalHeight) * scaleY
                const width = (bw / img.naturalWidth) * scaleX
                const height = (bh / img.naturalHeight) * scaleY
                if (width > 1 && height > 1) {
                    const cocoLabel = (r.class || '').toLowerCase()
                    const friendlyLabel = COCO_LABEL_MAP[cocoLabel] || cocoLabel
                    const matchedClass = userClasses.find(c => c.name.toLowerCase() === cocoLabel || c.name.toLowerCase() === friendlyLabel)
                    const label = matchedClass ? matchedClass.name : defaultLabel
                    if (matchedClass) matchedCount++
                    const color = getNextToolColor(mode.currentAnnotation?.boxes || [])
                    mode.addBox({ label, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)), width: Math.min(width, 100 - Math.max(0, Math.min(100, x))), height: Math.min(height, 100 - Math.max(0, Math.min(100, y))), color })
                }
            })
            const matchedMsg = matchedCount > 0 ? ` (${matchedCount} matched to your classes)` : ''
            setSavedMessage(`🎯 Auto-detected ${results.length} objects!${matchedMsg}`)
            setTimeout(() => setSavedMessage(null), 3000)
        } catch (err) {
            console.error('[AnnotatePanel] Auto-detect failed:', err)
            setSavedMessage('⚠️ Auto-detect failed. Try drawing boxes manually.')
            setTimeout(() => setSavedMessage(null), 2000)
        }
        setIsAutoDetecting(false)
    }, [annotationImage, mode, saveUndoState])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (editingBoxId) {
                if (e.key === 'Enter') handleSaveLabel()
                if (e.key === 'Escape') { setEditingBoxId(null); setEditingLabel('') }
                return
            }
            const isMod = e.ctrlKey || e.metaKey
            if (isMod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return }
            if (isMod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); return }
            if (e.key === 'Delete' || e.key === 'Backspace') { if (mode.selectedBoxId) { saveUndoState(); mode.removeBox(mode.selectedBoxId) } }
            if (e.key === 'b' || e.key === 'B') mode.setActiveTool('box')
            if (e.key.toLowerCase() === 'l') setShowLabels(v => !v)
            if (e.key === 'Escape') mode.setSelectedBoxId(null)
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [mode, saveUndoState, handleUndo, handleRedo, editingBoxId, handleSaveLabel])

    const handleSave = useCallback(() => {
        if (!annotationImage || !mode.selectedClassId || !mode.currentAnnotation?.id) return
        const boxes = mode.currentAnnotation?.boxes || []
        if (boxes.length === 0) {
            setSavedMessage('⚠️ Draw at least one box before saving — empty images cannot be used for training')
            setTimeout(() => setSavedMessage(null), 2500)
            return
        }
        // validate each box label matches a class
        const validNames = new Set((mode.project?.classes || []).map(c => c.name.toLowerCase()))
        for (const b of boxes) {
            if (!validNames.has(b.label.toLowerCase())) {
                setSavedMessage(`⚠️ Box "${b.label}" must match a folder name`)
                setTimeout(() => setSavedMessage(null), 2500)
                return
            }
        }
        const annotationData = JSON.stringify({
            imageUrl: annotationImage,
            boxes,
            imageName: mode.currentAnnotation?.imageName || 'annotated'
        })
        mode.updateSample(mode.selectedClassId, mode.currentAnnotation.id, { type: 'image', data: annotationData })
        const className = mode.getSelectedClass()?.name || 'class'
        setSavedMessage(`✅ Saved ${boxes.length} box${boxes.length!==1?'es':''} to ${className}!`)
        setTimeout(() => setSavedMessage(null), 2000)
    }, [annotationImage, mode])

    const previewBox = isDrawing && drawStart && drawCurrent ? { x: Math.min(drawStart.x, drawCurrent.x), y: Math.min(drawStart.y, drawCurrent.y), width: Math.abs(drawCurrent.x - drawStart.x), height: Math.abs(drawCurrent.y - drawStart.y) } : null

    return (
        <div className="flex-1 flex flex-col overflow-y-auto neura-scrollbar">
            {savedMessage && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-2.5 bg-[#006c44] text-white rounded-xl text-sm font-bold shadow-[0_4px_16px_rgba(0,0,0,0.15)] animate-fade-in">
                    {savedMessage}
                </div>
            )}

            {/* Header */}
            <div className="pt-4 px-5 pb-3 shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#f5f3ff] to-[#ede9fe] flex items-center justify-center text-xl">🏷️</div>
                    <div>
                        <h2 className="text-lg font-extrabold text-[#131b2e] leading-snug">Label Your Objects!</h2>
                        <p className="text-xs text-gray-500">Draw boxes around things AI should find 🔍</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`py-1.5 px-3.5 rounded-lg text-sm font-bold ${progress >= 100 ? 'bg-emerald-100 text-[#006c44]' : 'bg-[#f5f3ff] text-[#630ed4]'}`}>
                        {Math.round(progress)}%
                    </div>
                </div>
            </div>

            {/* Progress bar */}
            <div className="px-5 shrink-0 mb-2.5">
                <div className="relative h-2 bg-gray-200 rounded-full overflow-visible">
                    <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-[#006c44] to-emerald-500 rounded-full transition-[width] duration-500" style={{ width: `${progress}%` }} />
                    {['Collect', 'Label', 'Train', 'Test'].map((_, idx) => (
                        <div key={idx} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white z-10 ${idx === currentStepIndex ? 'w-4 h-4 bg-[#630ed4] shadow-[0_0_8px_rgba(99,14,212,0.4)]' : idx < currentStepIndex ? 'w-3 h-3 bg-[#006c44]' : 'w-3 h-3 bg-[#ccc3d8]'}`} style={{ left: `${(idx / 3) * 100}%` }} />
                    ))}
                </div>
                <div className="flex justify-between mt-2">
                    {[
                        { emoji: '📸', label: 'Collect', done: currentStepIndex > 0 },
                        { emoji: '🏷️', label: 'Label', done: currentStepIndex > 1 },
                        { emoji: '🏋️', label: 'Train', done: currentStepIndex > 2 },
                        { emoji: '🧪', label: 'Test', done: currentStepIndex > 3 }
                    ].map((step, idx) => (
                        <span key={step.label} className={`text-[11px] flex items-center gap-1 ${idx === currentStepIndex ? 'text-[#630ed4] font-bold' : step.done ? 'text-[#006c44] font-medium' : 'text-gray-400 font-medium'}`}>
                            {step.done ? '✅' : step.emoji} {step.label}
                        </span>
                    ))}
                </div>
            </div>

            {/* Thumbnail strip */}
            {totalImages > 0 && (
                <div className="px-5 shrink-0 mb-2">
                    <div className="flex items-center gap-2 overflow-x-auto py-1.5 neura-scrollbar">
                        {classSamples.map((sample, idx) => {
                            let hasBoxes = false
                            let thumbnail = ''
                            try {
                                const parsed = JSON.parse(sample.data)
                                hasBoxes = parsed.boxes && parsed.boxes.length > 0
                                thumbnail = parsed.imageUrl || ''
                            } catch {
                                if (sample.data && sample.data.startsWith('data:image')) {
                                    thumbnail = sample.data
                                }
                            }
                            return (
                                <div
                                    key={sample.id}
                                    className={`relative shrink-0 w-14 h-14 rounded-lg border-2 overflow-hidden cursor-pointer transition-all group/strip ${idx === currentImageIndex ? 'border-[#630ed4] shadow-md scale-105' : 'border-gray-200 hover:border-gray-300'}`}
                                >
                                    <button
                                        onClick={() => setCurrentImageIndex(idx)}
                                        onDoubleClick={() => { if (thumbnail) openSingleImage(thumbnail, `Image ${idx + 1}`) }}
                                        title="Click to select • Double-click to view (80% screen)"
                                        className="absolute inset-0 p-0 border-none bg-transparent cursor-pointer"
                                    >
                                        {thumbnail ? (
                                            <img src={thumbnail} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false} />
                                        ) : (
                                            <div className="w-full h-full bg-gray-100 flex items-center justify-center text-xs">🖼️</div>
                                        )}
                                    </button>
                                    {hasBoxes && (
                                        <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-[#006c44] rounded-full flex items-center justify-center pointer-events-none">
                                            <span className="text-white text-[7px] font-bold">✓</span>
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[7px] text-center py-0.5 pointer-events-none">{idx + 1}</div>
                                    {thumbnail && (
                                        <button
                                            onClick={e => { e.stopPropagation(); openImageViewer(classSamples.map((x, xi) => { try { const p = JSON.parse(x.data); return { src: p.imageUrl || (x.data.startsWith('data:image') ? x.data : ''), label: `Image ${xi + 1}` } } catch { return { src: x.data.startsWith('data:image') ? x.data : '', label: `Image ${xi + 1}` } } }).filter(x => !!x.src), idx) }}
                                            title="View (80% screen)"
                                            className="absolute bottom-3 right-0.5 w-4 h-4 rounded bg-black/60 text-white hidden group-hover/strip:flex items-center justify-center text-[8px] hover:bg-black/80 border-none cursor-pointer"
                                        >
                                            ⛶
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                        <p className="text-[10px] text-gray-500">
                            {annotatedCount} of {totalImages} images annotated
                            {allAnnotated && ' — all done!'}
                        </p>
                        {allAnnotated && (
                            <button onClick={() => mode.setMode('train')} className="text-[10px] font-bold text-[#006c44] bg-emerald-50 py-1 px-2.5 rounded-lg border border-emerald-200 cursor-pointer hover:bg-emerald-100">
                                🏋️ Go to Train →
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Main content - horizontal split */}
            <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0 px-5 pb-3 overflow-auto">
                {/* Left - Canvas */}
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="relative flex-1 bg-white border border-gray-200 rounded-2xl overflow-hidden min-h-0">
                        {/* Toolbar */}
                        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 bg-white/95 p-2 rounded-xl border border-gray-200 shadow-sm">
                            <button onClick={() => mode.setActiveTool('box')} className={`p-2 rounded-lg text-sm border-none cursor-pointer ${mode.activeTool === 'box' ? 'bg-[#630ed4] text-white' : 'bg-transparent text-[#4a4455]'}`} title="Box tool (B)">⬜</button>
                            <button onClick={handleAutoDetect} disabled={isAutoDetecting || !annotationImage} className={`p-2 rounded-lg text-sm border-none cursor-pointer ${isAutoDetecting ? 'bg-amber-500 text-white' : 'bg-transparent text-[#4a4455]'} ${!annotationImage ? 'opacity-40' : 'opacity-100'}`} title="Auto-detect">🤖</button>
                            <div className="w-full h-px bg-gray-200 my-1" />
                            <button onClick={() => mode.setActiveTool('delete')} className={`p-2 rounded-lg text-sm border-none cursor-pointer ${mode.activeTool === 'delete' ? 'bg-red-700 text-white' : 'bg-transparent text-[#4a4455]'}`} title="Delete tool — click a box to delete">🗑️</button>
                            <div className="w-full h-px bg-gray-200 my-1" />
                            <button onClick={handleUndo} disabled={undoStack.length === 0} className={`p-2 rounded-lg text-sm border-none ${undoStack.length === 0 ? 'cursor-not-allowed opacity-30 text-[#4a4455] bg-transparent' : 'cursor-pointer bg-transparent text-[#4a4455] hover:bg-gray-100'}`} title="Undo (Ctrl+Z)" aria-label="Undo">↩️</button>
                            <button onClick={handleRedo} disabled={redoStack.length === 0} className={`p-2 rounded-lg text-sm border-none ${redoStack.length === 0 ? 'cursor-not-allowed opacity-30 text-[#4a4455] bg-transparent' : 'cursor-pointer bg-transparent text-[#4a4455] hover:bg-gray-100'}`} title="Redo (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Redo">↪️</button>
                            <div className="w-full h-px bg-gray-200 my-1" />
                            <button onClick={() => setShowLabels(v => !v)} className={`p-2 rounded-lg text-[11px] font-bold border-none cursor-pointer ${showLabels ? 'bg-violet-600 text-white' : 'bg-transparent text-[#4a4455]'}`} title="Toggle labels (L)">🏷️</button>
                            <div className="w-full h-px bg-gray-200 my-1" />
                            <button onClick={() => { if (annotationImage) openSingleImage(annotationImage, `Image ${currentImageIndex + 1}`) }} disabled={!annotationImage} className={`p-2 rounded-lg text-sm border-none ${!annotationImage ? 'cursor-not-allowed opacity-30 text-[#4a4455] bg-transparent' : 'cursor-pointer bg-transparent text-[#4a4455] hover:bg-gray-100'}`} title="View fullscreen (80% screen)">⛶</button>
                        </div>

                        {/* Box count / Timer */}
                        <div className="absolute top-3 right-3 z-20 bg-white/95 py-1.5 px-3.5 rounded-xl border border-gray-200 flex gap-3.5 text-xs font-semibold text-gray-700 shadow-sm">
                            <span>📦 {totalBoxes}</span>
                            <span>⏱️ {formatTime(elapsed)}</span>
                        </div>

                        {/* Auto-detect loading */}
                        {isAutoDetecting && (
                            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-30">
                                <div className="text-center">
                                    <div className="w-8 h-8 border-2 border-[#630ed4] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                    <p className="text-[11px] font-bold text-[#4a4455]">🤖 Detecting objects...</p>
                                </div>
                            </div>
                        )}

                        {/* Canvas area */}
                        <div ref={canvasRef} className={`relative w-full h-full overflow-hidden flex items-center justify-center cursor-crosshair select-none touch-none transition-colors duration-200 ${isDragging ? 'bg-[#f0ebff]' : 'bg-gray-100'}`} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleMouseUp} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                            {annotationImage ? (
                                <img src={annotationImage} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                            ) : (
                                <div className="text-center">
                                    <div className={`contents ${isDragging ? 'pointer-events-none' : 'pointer-events-auto'}`}>
                                        {isDragging ? (
                                            <>
                                                <span className="text-5xl block mb-3">📥</span>
                                                <p className="text-base font-bold text-[#630ed4] mb-1.5">Drop your image here!</p>
                                                <p className="text-xs text-violet-500">Release to upload</p>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-5xl block mb-3">🖼️</span>
                                                <p className="text-base font-bold text-[#4a4455] mb-1.5">Upload a picture to start labeling!</p>
                                                <p className="text-xs text-gray-400 mb-2">or paste (Ctrl+V) • no download needed!</p>
                                                <p className="text-xs text-gray-400 mb-4">Drag & drop or <span className="font-bold text-violet-600">Ctrl+V</span> to paste copied image</p>
                                                <button onClick={() => fileInputRef.current?.click()} className="py-3 px-6 bg-gradient-to-br from-[#630ed4] to-[#7c3aed] text-white rounded-xl text-sm font-bold border-none cursor-pointer">📂 Upload Picture</button>
                                                <p className="text-[11px] text-violet-500 mt-3 font-medium">💡 Copy any image (right-click → Copy image) then Ctrl+V here</p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Bounding boxes — compact labels that don't hide image */}
                            {mode.currentAnnotation?.boxes.map((box) => {
                                const isSelected = mode.selectedBoxId === box.id
                                const showThisLabel = showLabels || isSelected || editingBoxId === box.id
                                const nearTop = box.y < 6
                                return (
                                <div key={box.id} className="absolute cursor-move" style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%`, borderColor: box.color, backgroundColor: isSelected ? `${box.color}14` : `${box.color}0D`, borderWidth: isSelected ? 2 : 1.5, zIndex: isSelected ? 10 : 1, borderStyle: 'solid' }} onMouseDown={(e) => handleBoxMouseDown(e, box.id)} onDoubleClick={() => handleStartEditLabel(box.id, box.label)}>
                                    {editingBoxId === box.id ? (
                                        <input ref={labelInputRef} value={editingLabel} onChange={(e) => setEditingLabel(e.target.value)} onBlur={handleSaveLabel} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLabel(); if (e.key === 'Escape') { setEditingBoxId(null); setEditingLabel('') } }} className="absolute left-0 py-1 px-2 text-[11px] font-bold text-white border border-white rounded-md min-w-[60px] outline-none z-30 shadow-md" style={{ background: box.color, top: nearTop ? '2px' : '-28px' }} onClick={(e) => e.stopPropagation()} />
                                    ) : showThisLabel ? (
                                        <div
                                            className={`absolute left-0 px-1.5 py-0.5 rounded text-[9px] font-bold text-white whitespace-nowrap shadow-sm flex items-center gap-1 cursor-text max-w-[90%] truncate ${isSelected ? 'ring-1 ring-white/50' : 'opacity-85'}`}
                                            style={{ background: box.color, top: nearTop ? '1px' : '-1px', transform: nearTop ? 'none' : 'translateY(-100%)', marginTop: nearTop ? 0 : '-2px' }}
                                            onDoubleClick={(e) => { e.stopPropagation(); handleStartEditLabel(box.id, box.label) }}
                                            title={`${box.label} — double-click to edit`}
                                        >
                                            <span className="truncate max-w-[80px]">{box.label}</span>
                                            {isSelected && <span className="opacity-60 text-[8px]">✎</span>}
                                        </div>
                                    ) : (
                                        <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full shadow-sm" style={{ background: box.color }} />
                                    )}
                                    {isSelected && (
                                        <>
                                            <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-nw-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={(e) => handleResizeMouseDown(e, box.id, 'nw')} />
                                            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-ne-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={(e) => handleResizeMouseDown(e, box.id, 'ne')} />
                                            <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-sw-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={(e) => handleResizeMouseDown(e, box.id, 'sw')} />
                                            <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-white border rounded-sm cursor-se-resize shadow-sm" style={{ borderColor: box.color, borderWidth: 1.5 }} onMouseDown={(e) => handleResizeMouseDown(e, box.id, 'se')} />
                                        </>
                                    )}
                                </div>
                            )})}

                            {previewBox && previewBox.width > 0.5 && previewBox.height > 0.5 && (
                                <div className="absolute border-2 border-dashed border-[#630ed4] bg-[#630ed4]/10 pointer-events-none z-10" style={{ left: `${previewBox.x}%`, top: `${previewBox.y}%`, width: `${previewBox.width}%`, height: `${previewBox.height}%` }} />
                            )}
                        </div>

                        {/* Bottom toolbar */}
                        <div className="absolute bottom-0 left-0 right-0 py-2.5 px-4 bg-white/95 border-t border-gray-200 flex justify-between items-center z-20">
                            <div className="flex gap-4 items-center">
                                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-[#4a4455] font-bold text-xs bg-transparent border-none cursor-pointer">📂 Upload</button>
                                {totalImages > 1 && (
                                    <div className="flex items-center gap-1.5">
                                        <button onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))} disabled={currentImageIndex === 0} className={`py-1 px-2 rounded text-sm font-bold bg-gray-100 border-none ${currentImageIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-200'}`}>◀</button>
                                        <span className="text-[11px] font-bold text-gray-500 min-w-[40px] text-center">{currentImageIndex + 1}/{totalImages}</span>
                                        <button onClick={() => setCurrentImageIndex(Math.min(totalImages - 1, currentImageIndex + 1))} disabled={currentImageIndex >= totalImages - 1} className={`py-1 px-2 rounded text-sm font-bold bg-gray-100 border-none ${currentImageIndex >= totalImages - 1 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-200'}`}>▶</button>
                                    </div>
                                )}
                                <button onClick={handleUndo} disabled={undoStack.length === 0} className={`flex items-center gap-1.5 font-bold text-xs bg-transparent border-none py-1.5 px-2.5 rounded-lg transition-colors ${undoStack.length === 0 ? 'cursor-not-allowed opacity-30 text-[#4a4455]' : 'cursor-pointer text-[#4a4455] hover:text-[#630ed4] hover:bg-[#f5f3ff]'}`} title="Undo (Ctrl+Z)" aria-label="Undo">↩️ Undo</button>
                                <button onClick={handleRedo} disabled={redoStack.length === 0} className={`flex items-center gap-1.5 font-bold text-xs bg-transparent border-none py-1.5 px-2.5 rounded-lg transition-colors ${redoStack.length === 0 ? 'cursor-not-allowed opacity-30 text-[#4a4455]' : 'cursor-pointer text-[#4a4455] hover:text-[#630ed4] hover:bg-[#f5f3ff]'}`} title="Redo (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Redo">↪️ Redo</button>
                                <button onClick={handleClear} disabled={totalBoxes === 0} className={`flex items-center gap-1.5 font-bold text-xs bg-transparent border-none py-1.5 px-2.5 rounded-lg transition-colors ${totalBoxes === 0 ? 'cursor-not-allowed opacity-30 text-[#4a4455]' : 'cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50'}`} title="Clear all boxes" aria-label="Clear">🗑️ Clear</button>
                            </div>
                            <div className="flex items-center gap-3.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-[#4a4455]">🔍</span>
                                    <input type="range" min="50" max="200" value={mode.zoom} onChange={(e) => mode.setZoom(Number(e.target.value))} className="w-20 h-1 rounded-full appearance-none cursor-pointer accent-[#630ed4]" />
                                    <span className="text-sm font-bold text-[#4a4455]">{mode.zoom}%</span>
                                </div>
                                <button onClick={handleSave} disabled={!annotationImage || !mode.selectedClassId} className={`py-2 px-4.5 bg-gradient-to-br from-[#630ed4] to-[#7c3aed] text-white rounded-xl text-sm font-bold border-none ${!annotationImage || !mode.selectedClassId ? 'cursor-not-allowed opacity-40' : 'cursor-pointer opacity-100'}`}>💾 Save</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right sidebar */}
                <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden overflow-y-auto px-1 neura-scrollbar">
                    {/* Boxes list */}
                    <div className="bg-white/85 border border-gray-200 rounded-xl p-4 shrink-0">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-[#131b2e]">📦 Boxes ({totalBoxes})</h3>
                            <button onClick={() => setShowBoxList(!showBoxList)} className="text-xs text-[#630ed4] font-bold bg-transparent border-none cursor-pointer">{showBoxList ? 'Hide' : 'Show'}</button>
                        </div>
                        {showBoxList && (
                            <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto neura-scrollbar">
                                {mode.currentAnnotation?.boxes.length === 0 && (
                                    <p className="text-xs text-gray-400 text-center py-4">No boxes yet. Draw one!</p>
                                )}
                                {mode.currentAnnotation?.boxes.map((box, i) => (
                                    <div key={box.id} onClick={() => mode.setSelectedBoxId(box.id)} className={`flex items-center gap-2.5 py-2 px-3 rounded-lg cursor-pointer border ${mode.selectedBoxId === box.id ? 'bg-[#f5f3ff] border-[#630ed4]' : 'bg-transparent border-transparent'}`}>
                                        <div className="w-2.5 h-2.5 rounded shrink-0" style={{ background: box.color }} />
                                        <span className="text-xs font-semibold text-[#131b2e] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{box.label}</span>
                                        <span className="text-[11px] text-gray-400">{i + 1}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Edit label */}
                    {mode.selectedBoxId && mode.currentAnnotation?.boxes.find(b => b.id === mode.selectedBoxId) && (
                        <div className="bg-white/85 border border-gray-200 rounded-xl p-4 shrink-0">
                            <h3 className="text-sm font-bold text-[#131b2e] mb-2.5">✏️ Edit Label</h3>
                            <input value={editingBoxId === mode.selectedBoxId ? editingLabel : (mode.currentAnnotation?.boxes.find(b => b.id === mode.selectedBoxId)?.label || '')} onChange={(e) => { if (editingBoxId === mode.selectedBoxId) setEditingLabel(e.target.value); else { setEditingBoxId(mode.selectedBoxId); setEditingLabel(e.target.value) } }} onFocus={() => { if (editingBoxId !== mode.selectedBoxId) { const box = mode.currentAnnotation?.boxes.find(b => b.id === mode.selectedBoxId); if (box) { setEditingBoxId(mode.selectedBoxId); setEditingLabel(box.label) } } }} onBlur={handleSaveLabel} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLabel(); if (e.key === 'Escape') { setEditingBoxId(null); setEditingLabel('') } }} className="w-full py-2.5 px-3 text-xs border border-gray-200 rounded-lg outline-none" placeholder="Enter label..." />
                            <div className="flex gap-2 mt-2.5">
                                {selectedClass && <button onClick={() => { if (editingBoxId === mode.selectedBoxId) setEditingLabel(selectedClass.name); else { setEditingBoxId(mode.selectedBoxId); setEditingLabel(selectedClass.name) } }} className="flex-1 p-2 bg-[#f5f3ff] text-[#630ed4] rounded-lg text-sm font-bold border-none cursor-pointer">Use Class</button>}
                                <button onClick={() => { saveUndoState(); mode.removeBox(mode.selectedBoxId!) }} className="flex-1 p-2 bg-red-50 text-red-800 rounded-lg text-sm font-bold border-none cursor-pointer">🗑️ Delete</button>
                            </div>
                        </div>
                    )}

                    {/* Tips */}
                    <div className="bg-white/85 border border-gray-200 rounded-xl p-4 flex-1 min-h-0 overflow-hidden">
                        <h3 className="text-sm font-bold text-[#131b2e] mb-2.5">💡 Tips</h3>
                        <div className="flex flex-col gap-2">
                            <span className="text-xs text-[#4a4455]">• Double-click box to rename</span>
                            <span className="text-xs text-[#4a4455]">• Drag boxes to move them</span>
                            <span className="text-xs text-[#4a4455]">• Use corners to resize</span>
                            <span className="text-xs text-[#4a4455]">• Press <kbd className="py-0.5 px-1.5 bg-[#f5f3ff] rounded text-[11px]">B</kbd> for box tool</span>
                            <span className="text-xs text-[#4a4455]">• Press <kbd className="py-0.5 px-1.5 bg-[#f5f3ff] rounded text-[11px]">L</kbd> to hide/show labels</span>
                            <span className="text-xs text-[#4a4455]">• Press <kbd className="py-0.5 px-1.5 bg-[#f5f3ff] rounded text-[11px]">DEL</kbd> to remove</span>
                            <span className="text-xs text-[#4a4455]">• Press <kbd className="py-0.5 px-1.5 bg-[#f5f3ff] rounded text-[11px]">Ctrl+Z</kbd> to undo</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
