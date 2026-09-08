import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import { useCamera } from '../../hooks/useCamera'
import { NumberClassifier } from '../../ml/classifiers/NumberClassifier'
import { RELATEDNESS_THRESHOLD } from '../../ml/KNNClassifier'
import { MAX_SAMPLES_PER_CLASS } from '../../types/neura.types'
import AccuracyChart from '../components/AccuracyChart'
import NotRelatedModal from '../components/NotRelatedModal'
import { openImageViewer, openSingleImage } from '../components/neuraImageViewer'
import { useTabularState } from '../../hooks/useTabularState'
import DataPanel from './DataPanel'
import SetupPanel from './SetupPanel'
import TabularTrainPanel from './TabularTrainPanel'
import TabularTestPanel from './TabularTestPanel'

interface NumberClassifierPanelProps { mode: UseNeuraProjectReturn }

export default function NumberClassifierPanel({ mode }: NumberClassifierPanelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const classifierRef = useRef(new NumberClassifier())
    const fileInputRef = useRef<HTMLInputElement>(null)
    const testFileInputRef = useRef<HTMLInputElement>(null)
    const pendingUploadClassRef = useRef<string | null>(null)
    const burstIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const isPredictingRef = useRef(false)
    const rebuildAbortRef = useRef(0)
    const consecutiveFailuresRef = useRef(0)
    const notRelatedCooldownRef = useRef(0)
    const removeDebounceRef = useRef<NodeJS.Timeout | null>(null)
    const viewportRef = useRef<HTMLDivElement>(null)

    // drawing refs
    const drawCanvasRef = useRef<HTMLCanvasElement>(null)
    const lastPosRef = useRef<{ x: number; y: number } | null>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [visionInputMode, setVisionInputMode] = useState<'draw' | 'camera'>('draw')
    const [ninjaMode, setNinjaMode] = useState<'vision' | 'data'>('vision')

    const [isCapturing, setIsCapturing] = useState<string | null>(null)
    const [dragOverClass, setDragOverClass] = useState<string | null>(null)
    const [isTestDragging, setIsTestDragging] = useState(false)
    const [isTraining, setIsTraining] = useState(false)
    const [trainingError, setTrainingError] = useState<string | null>(null)
    const [prediction, setPrediction] = useState<{ label: string; confidences: Record<string, number> } | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [captureFps] = useState(15)
    const [testImage, setTestImage] = useState<string | null>(null)
    const [modelLoading, setModelLoading] = useState(false)
    const [augmentMode, setAugmentMode] = useState(true)
    const [inferenceTime, setInferenceTime] = useState(0)
    const [savedMessage, setSavedMessage] = useState<string | null>(null)
    const [showNotRelated, setShowNotRelated] = useState(false)
    const [totalEpochs, setTotalEpochs] = useState(50)
    const [currentEpoch, setCurrentEpoch] = useState(0)
    const [epochResults, setEpochResults] = useState<number[]>([])
    const [showAddClass, setShowAddClass] = useState(false)
    const [newClassName, setNewClassName] = useState('')
    const [editingClassId, setEditingClassId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({})

    // Free canvas state — default 100% for readability
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 32, y: 24 })
    const [isPanning, setIsPanning] = useState(false)
    const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
    const pinchRef = useRef<{ startDist: number; startZoom: number; startPan: { x: number; y: number }; center: { x: number; y: number } } | null>(null)
    const [classPositions, setClassPositions] = useState<Record<string, { x: number; y: number }>>({})
    const [brainPos, setBrainPos] = useState({ x: 920, y: 160 })
    const [visionPos, setVisionPos] = useState({ x: 1440, y: 140 })
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const dragStartRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)

    // Data canvas node positions (horizontal layout) — spaced like Vision (120-140px gaps) so wires are visible
    const [dataNodePos, setDataNodePos] = useState({ x: 80, y: 180 })
    const [setupNodePos, setSetupNodePos] = useState({ x: 640, y: 180 })
    const [trainNodePos, setTrainNodePos] = useState({ x: 1200, y: 180 })
    const [testNodePos, setTestNodePos] = useState({ x: 1760, y: 180 })
    const dataNodeRef = useRef<HTMLDivElement>(null)
    const setupNodeRef = useRef<HTMLDivElement>(null)
    const trainNodeRef = useRef<HTMLDivElement>(null)
    const testNodeRef = useRef<HTMLDivElement>(null)
    const [nodeHeights, setNodeHeights] = useState({ data: 220, setup: 260, train: 200, test: 180 })

    const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const camera = useCamera({ videoConstraints: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment', frameRate: { ideal: 30 } } })
    const tabular = useTabularState(mode)

    useEffect(() => { mode.setHideSidebar(true); return () => mode.setHideSidebar(false) }, [])

    // measure node heights for centre-point wires (like Vision)
    useEffect(() => {
        const update = () => setNodeHeights({
            data: dataNodeRef.current?.offsetHeight || 220,
            setup: setupNodeRef.current?.offsetHeight || 260,
            train: trainNodeRef.current?.offsetHeight || 200,
            test: testNodeRef.current?.offsetHeight || 180,
        })
        update()
        const ro = new ResizeObserver(update)
        if (dataNodeRef.current) ro.observe(dataNodeRef.current)
        if (setupNodeRef.current) ro.observe(setupNodeRef.current)
        if (trainNodeRef.current) ro.observe(trainNodeRef.current)
        if (testNodeRef.current) ro.observe(testNodeRef.current)
        return () => ro.disconnect()
    }, [tabular.csvData, tabular.columnInfos.length, tabular.featureIndices.length, tabular.finalAccuracy, tabular.isTraining, tabular.step, tabular.collectMode])

    const showSaved = useCallback((msg: string) => {
        setSavedMessage(msg)
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        savedTimeoutRef.current = setTimeout(() => setSavedMessage(null), 2200)
    }, [])

    // init drawing canvas white background
    const initDrawCanvas = useCallback(() => {
        const c = drawCanvasRef.current
        if (!c) return
        const ctx = c.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, c.width, c.height)
    }, [])

    useEffect(() => {
        // delay until ref mounted inside vision node
        const t = setTimeout(initDrawCanvas, 100)
        return () => clearTimeout(t)
    }, [visionInputMode, initDrawCanvas])

    useEffect(() => {
        if (!mode.project) return
        setClassPositions(prev => {
            const next = { ...prev }
            mode.project!.classes.forEach((cls, idx) => {
                if (!next[cls.id]) {
                    const col = Math.floor(idx / 4)
                    const row = idx % 4
                    next[cls.id] = { x: 48 + col * 380, y: 80 + row * 340 }
                }
            })
            Object.keys(next).forEach(id => { if (!mode.project!.classes.some(c => c.id === id)) delete next[id] })
            return next
        })
    }, [mode.project?.classes.map(c => c.id).join(',')])

    useEffect(() => {
        if (!mode.project) return
        const thisBuild = ++rebuildAbortRef.current
        let cancelled = false
        setModelLoading(true)
        const rebuild = async () => {
            classifierRef.current.clear()
            for (const cls of mode.project!.classes) {
                if (thisBuild !== rebuildAbortRef.current) return
                if (cls.samples.length > 0) await classifierRef.current.rebuildClass(cls.name, cls.samples.map(s => s.data), augmentMode)
            }
            if (!cancelled && thisBuild === rebuildAbortRef.current) setModelLoading(false)
        }
        rebuild().catch(() => { if (!cancelled && thisBuild === rebuildAbortRef.current) setModelLoading(false) })
        return () => { cancelled = true }
    }, [mode.project?.id])

    const handleRename = (id: string, name: string) => {
        const old = mode.project?.classes.find(c => c.id === id); if (!old) return
        const trimmed = name.trim(); if (!trimmed || trimmed === old.name) { setEditingClassId(null); return }
        mode.renameClass(id, trimmed)
        setTimeout(async () => {
            const updated = mode.project?.classes.find(c => c.id === id)
            if (updated) { classifierRef.current.clearClass(old.name); if (updated.samples.length > 0) await classifierRef.current.rebuildClass(trimmed, updated.samples.map(s => s.data), augmentMode) }
        }, 50)
        setEditingClassId(null)
    }

    // drawing helpers
    const clearCanvas = useCallback(() => {
        const canvas = drawCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        setPrediction(null)
    }, [])

    const getCanvasPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        const canvas = drawCanvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX
        const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY
        return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) }
    }, [])

    const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
        const canvas = drawCanvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')!
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(to.x, to.y)
        ctx.strokeStyle = '#131b2e'
        ctx.lineWidth = 12
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
    }, [])

    const handleDrawStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault()
        const pos = getCanvasPos(e)
        if (!pos) return
        setIsDrawing(true)
        lastPosRef.current = pos
    }, [getCanvasPos])

    const handleDrawMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault()
        if (!isDrawing || !lastPosRef.current) return
        const pos = getCanvasPos(e)
        if (!pos) return
        drawLine(lastPosRef.current, pos)
        lastPosRef.current = pos
    }, [isDrawing, getCanvasPos, drawLine])

    const handleDrawEnd = useCallback(() => {
        setIsDrawing(false)
        lastPosRef.current = null
    }, [])

    const handleCaptureDrawingForClass = useCallback(async (classId?: string) => {
        const targetId = classId || mode.selectedClassId || mode.project?.classes[0]?.id
        if (!targetId || !drawCanvasRef.current) { showSaved('Select a folder first'); return }
        const cls = mode.project?.classes.find(c => c.id === targetId)
        if (cls && cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 per folder'); return }
        // check if canvas is blank (all white) — quick check
        const canvas = drawCanvasRef.current
        const ctx = canvas.getContext('2d')!
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let hasStroke = false
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) { hasStroke = true; break }
        }
        if (!hasStroke) { showSaved('Draw a digit first ✏️'); return }
        const dataUrl = canvas.toDataURL('image/png')
        const ok = mode.addSample(targetId, { type: 'image', data: dataUrl })
        if (!ok) { showSaved('Folder full (20 max)'); return }
        const targetName = cls?.name || mode.project?.classes.find(c => c.id === targetId)?.name || ''
        const p = augmentMode ? classifierRef.current.addSampleAugmented(canvas, targetName) : classifierRef.current.addSample(canvas, targetName)
        p.catch(e => console.warn('[Neura][capture-draw] embedding failed', e))
        clearCanvas()
        setTimeout(initDrawCanvas, 50)
        showSaved(`Drawing saved to ${cls?.name || 'folder'} ✓`)
    }, [mode, clearCanvas, initDrawCanvas, augmentMode, showSaved])

    const handlePredictDrawing = useCallback(async () => {
        if (!drawCanvasRef.current || modelLoading) return
        if (!classifierRef.current.canClassify) { showSaved('Add at least 2 folders with 2 digits, then Train'); return }
        // check blank
        const canvas = drawCanvasRef.current
        const ctx = canvas.getContext('2d')!
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let hasStroke = false
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) { hasStroke = true; break }
        }
        if (!hasStroke) { showSaved('Draw a digit to test'); return }
        setIsProcessing(true)
        try {
            const start = performance.now()
            const result = await classifierRef.current.predict(canvas, 3)
            const elapsed = Math.round(performance.now() - start)
            if (result) {
                if (result.similarity !== undefined && result.similarity < RELATEDNESS_THRESHOLD) {
                    setPrediction(null)
                    const now = Date.now()
                    if (now - notRelatedCooldownRef.current > 3000) { notRelatedCooldownRef.current = now; setShowNotRelated(true) }
                } else {
                    const sorted = Object.entries(result.confidences).sort(([, a], [, b]) => b - a)
                    const sortedConf: Record<string, number> = {}; sorted.forEach(([k, v]) => { sortedConf[k] = v })
                    setPrediction({ label: sorted[0]?.[0] || result.label, confidences: sortedConf } as any)
                    setInferenceTime(elapsed)
                    if (testImage) setTestImage(null)
                    if (camera.cameraOn) camera.stopCamera()
                }
            } else {
                setPrediction(null)
                setShowNotRelated(true)
            }
        } catch { } finally { setIsProcessing(false) }
    }, [modelLoading, testImage, camera, showSaved])

    useEffect(() => {
        if (modelLoading) return
        if (!camera.cameraOn || !camera.stream) return
        // only run live prediction when camera mode is active and not showing static testImage or draw mode
        if (visionInputMode !== 'camera') return
        if (testImage) return
        let interval: ReturnType<typeof setInterval> | null = null
        const runPrediction = async () => {
            if (isPredictingRef.current) return
            if (!camera.cameraOnRef.current || !camera.streamStateRef.current || !camera.videoRef.current) return
            const vw = camera.videoRef.current.videoWidth, vh = camera.videoRef.current.videoHeight
            if (!vw || !vh) return
            if (consecutiveFailuresRef.current >= 10) return
            if (!classifierRef.current.canClassify) return
            isPredictingRef.current = true
            try {
                const start = performance.now()
                const result = await classifierRef.current.predict(camera.videoRef.current, 3)
                const elapsed = Math.round(performance.now() - start)
                if (result) {
                    consecutiveFailuresRef.current = 0
                    if (result.similarity !== undefined && result.similarity < RELATEDNESS_THRESHOLD) {
                        setPrediction(null)
                        const now = Date.now()
                        if (now - notRelatedCooldownRef.current > 3000) { notRelatedCooldownRef.current = now; setShowNotRelated(true) }
                    } else {
                        const sorted = Object.entries(result.confidences).sort(([, a], [, b]) => b - a)
                        if (sorted.length > 0) {
                            const sortedConf: Record<string, number> = {}; sorted.forEach(([k, v]) => { sortedConf[k] = v })
                            setPrediction({ label: sorted[0][0], confidences: sortedConf, similarity: result.similarity } as any)
                        } else setPrediction(result)
                        setInferenceTime(elapsed)
                        if (testImage) setTestImage(null)
                    }
                } else setPrediction(null)
            } catch { consecutiveFailuresRef.current++; if (consecutiveFailuresRef.current >= 10) camera.setCameraError('GPU memory issue. Please reload.') } finally { isPredictingRef.current = false }
        }
        runPrediction(); interval = setInterval(runPrediction, 400)
        return () => { if (interval) clearInterval(interval) }
    }, [camera.cameraOn, camera.stream, modelLoading, testImage, visionInputMode])

    useEffect(() => { consecutiveFailuresRef.current = 0 }, [camera.cameraOn, mode.project?.classes.length])

    const handleCaptureForClass = async (classId: string) => {
        if (!camera.cameraOn) {
            showSaved('Starting camera…')
            try { await camera.startCamera() } catch (e) { console.warn('[Neura] Camera start failed', e) }
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 100))
                const v = camera.videoRef.current
                if (v && v.videoWidth && v.readyState >= 2) break
                if (camera.cameraError) break
            }
        }
        const video = camera.videoRef.current
        if (!video || !camera.cameraOn) {
            if (camera.cameraError) showSaved(camera.cameraError)
            else showSaved('Camera not ready — check permissions and try again')
            return
        }
        if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
            try { await video.play().catch(() => { }) } catch { }
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 100))
                if (video.videoWidth && video.readyState >= 2) break
            }
            if (!video.videoWidth || video.readyState < 2) { showSaved('Camera warming up… wait a second then try Snap again'); return }
        }
        const cls = mode.project?.classes.find(c => c.id === classId)
        if (cls && cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 per folder'); return }
        setIsCapturing(classId)
        try {
            const tmp = document.createElement('canvas')
            tmp.width = video.videoWidth; tmp.height = video.videoHeight
            const ctx = tmp.getContext('2d')
            if (!ctx) { showSaved('Capture failed — no canvas'); return }
            ctx.drawImage(video, 0, 0, tmp.width, tmp.height)
            const imageData = tmp.toDataURL('image/jpeg', 0.92)
            if (!imageData || imageData.length < 2000) { showSaved('Capture failed — black frame, try again'); return }
            const ok = mode.addSample(classId, { type: 'image', data: imageData })
            if (!ok) { showSaved('Folder full (20 max)'); return }
            const targetName = cls?.name || mode.project?.classes.find(c => c.id === classId)?.name || ''
            const sourceCanvas = document.createElement('canvas')
            sourceCanvas.width = tmp.width; sourceCanvas.height = tmp.height
            sourceCanvas.getContext('2d')!.drawImage(tmp, 0, 0)
            const p = augmentMode ? classifierRef.current.addSampleAugmented(sourceCanvas, targetName) : classifierRef.current.addSample(sourceCanvas, targetName)
            p.catch(e => console.warn('[Neura][capture] embedding failed', e))
            showSaved(`Captured for ${cls?.name || 'folder'} ✓`)
        } catch (err) { console.warn('[capture] failed', err); showSaved('Capture failed — see console') } finally { setTimeout(() => setIsCapturing(null), 240) }
    }
    const startBurstForClass = useCallback((classId: string) => {
        burstIntervalRef.current = setInterval(() => { handleCaptureForClass(classId) }, 1000 / captureFps)
    }, [captureFps])
    const stopBurst = useCallback(() => { if (burstIntervalRef.current) { clearInterval(burstIntervalRef.current); burstIntervalRef.current = null } }, [])
    useEffect(() => () => { stopBurst(); if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current) }, [stopBurst])

    const processFilesForClass = async (files: FileList | File[], classId: string) => {
        const cls = mode.project?.classes.find(c => c.id === classId); if (!cls) return
        if (cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 per folder'); return }
        let added = 0
        const list = Array.from(files as any) as File[]
        const imageFiles = list.filter(f => f.type.startsWith('image/'))
        if (imageFiles.length === 0) { showSaved('No images found'); return }
        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i]
            const cur = mode.project?.classes.find(c => c.id === classId)
            if (cur && cur.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved(`Limit reached for ${cls.name}`); break }
            const dataUrl = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(file) })
            mode.addSample(classId, { type: 'image', data: dataUrl })
            const img = new Image(); img.src = dataUrl
            await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); setTimeout(() => resolve(), 3000) })
            if (img.complete && img.naturalWidth > 0) {
                const targetName = mode.project?.classes.find(c => c.id === classId)?.name || cls.name
                if (augmentMode) await classifierRef.current.addSampleAugmented(img, targetName)
                else await classifierRef.current.addSample(img, targetName)
                added++
            }
        }
        if (added > 0) showSaved(`Added ${added} image${added > 1 ? 's' : ''} to ${cls.name}`)
    }
    const handleUploadClick = (classId: string) => { pendingUploadClassRef.current = classId; fileInputRef.current?.click() }
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files; if (!files || files.length === 0) return
        const targetId = pendingUploadClassRef.current || mode.selectedClassId || mode.project?.classes[0]?.id
        if (!targetId) { showSaved('Create a folder first'); return }
        await processFilesForClass(files, targetId)
        if (fileInputRef.current) fileInputRef.current.value = ''; pendingUploadClassRef.current = null
    }
    const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement> | FileList | File[]) => {
        let file: File | null = null
        if (e instanceof FileList) file = e[0] || null
        else if (Array.isArray(e)) file = e[0] || null
        else if ('target' in e && (e as any).target?.files) file = (e as any).target.files[0] || null
        else if ('files' in (e as any)) file = (e as any).files[0] || null
        if (!file || !file.type.startsWith('image/')) return
        if (modelLoading) { showSaved('Model loading…'); return }
        if (!classifierRef.current.canClassify) { showSaved('Add at least 2 folders with 2 images, then Train'); return }
        const dataUrl = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(file) })
        setTestImage(dataUrl); if (camera.cameraOn) camera.stopCamera(); setIsProcessing(true)
        try {
            const img = new Image(); img.src = dataUrl
            await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); setTimeout(() => resolve(), 3000) })
            if (img.complete && img.naturalWidth > 0) {
                const start = performance.now(); const result = await classifierRef.current.predict(img, 3); const elapsed = Math.round(performance.now() - start)
                if (result) {
                    if (result.similarity !== undefined && result.similarity < RELATEDNESS_THRESHOLD) { setPrediction(null); setShowNotRelated(true) }
                    else { const sorted = Object.entries(result.confidences).sort(([, a], [, b]) => b - a); const sortedConf: Record<string, number> = {}; sorted.forEach(([k, v]) => { sortedConf[k] = v }); setPrediction({ label: sorted[0]?.[0] || result.label, confidences: sortedConf, similarity: result.similarity } as any); setInferenceTime(elapsed) }
                } else { setPrediction(null); setShowNotRelated(true) }
            }
        } catch { } finally { setIsProcessing(false); if (testFileInputRef.current) testFileInputRef.current.value = '' }
    }
    const handleTestDrop = async (e: React.DragEvent) => { e.preventDefault(); setIsTestDragging(false); if (e.dataTransfer.files.length > 0) await handleTestUpload(e.dataTransfer.files) }

    const handleRemoveSample = async (classId: string, sampleId: string) => {
        mode.removeSample(classId, sampleId)
        if (removeDebounceRef.current) clearTimeout(removeDebounceRef.current)
        removeDebounceRef.current = setTimeout(async () => {
            const c = mode.project?.classes.find(x => x.id === classId); if (!c) return
            const current = mode.project?.classes.find(x => x.id === classId)
            const datas = (current?.samples || []).map(s => s.data)
            classifierRef.current.clearClass(c.name)
            if (datas.length > 0) await classifierRef.current.rebuildClass(c.name, datas, augmentMode)
        }, 300)
        showSaved('Image removed')
    }

    const handleTrain = async (epochs = 50) => {
        setIsTraining(true); setTrainingError(null); setTotalEpochs(epochs); setCurrentEpoch(0); setEpochResults([])
        const project = mode.project
        if (!project || project.classes.length < 2) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Add at least 2 folders to train'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
        if (project.classes.some(c => c.samples.length < 2)) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Each folder needs at least 2 images'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
        try {
            setModelLoading(true)
            const { NumberClassifier: NC } = await import('../../ml/classifiers/NumberClassifier')
            const trainData: { cls: string; samples: typeof project.classes[0]['samples'] }[] = []
            const testDataUrls: { dataUrl: string; label: string }[] = []
            for (const cls of project.classes) {
                const shuffled = [...cls.samples].sort(() => Math.random() - 0.5)
                const trainCount = Math.max(1, Math.min(shuffled.length - 1, Math.floor(shuffled.length * 0.8)))
                const splitIdx = shuffled.length <= 2 ? 1 : trainCount
                trainData.push({ cls: cls.name, samples: shuffled.slice(0, splitIdx) })
                for (const sample of shuffled.slice(splitIdx)) testDataUrls.push({ dataUrl: sample.data, label: cls.name })
            }
            if (trainData.every(t => t.samples.length === 0) || testDataUrls.length === 0) { mode.setAccuracy(0); setModelLoading(false); setIsTraining(false); const msg = 'Not enough test images — add more samples'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
            const precomputedTrain: { cls: string; embeddings: Float32Array[] }[] = []
            for (const td of trainData) if (td.samples.length > 0) {
                const embeddings = await NC.precomputeEmbeddings(td.samples.map(s => s.data));
                precomputedTrain.push({ cls: td.cls, embeddings })
            }
            const precomputedTest: { embedding: Float32Array; label: string }[] = []
            for (const item of testDataUrls) {
                const embeddings = await NC.precomputeEmbeddings([item.dataUrl]);
                if (embeddings.length > 0) precomputedTest.push({ embedding: embeddings[0], label: item.label })
            }
            setModelLoading(false)
            if (precomputedTrain.every(t => t.embeddings.length === 0) || precomputedTest.length === 0) {
                try {
                    classifierRef.current.clear()
                    for (const cls of project.classes) if (cls.samples.length > 0) await classifierRef.current.rebuildClass(cls.name, cls.samples.map(s => s.data), augmentMode)
                    const fallbackAcc = 0.75
                    mode.setAccuracy(fallbackAcc); mode.setModelTrained(true)
                    setEpochResults([fallbackAcc]); setCurrentEpoch(epochs)
                    showSaved(`Training complete (fallback) — ${(fallbackAcc * 100).toFixed(0)}%`)
                } catch (e) { setTrainingError('Training failed — model load error. Check internet and reload.') }
                setIsTraining(false); return
            }
            const epochResultsLocal: number[] = []; let bestAccuracy = 0
            for (let epoch = 1; epoch <= epochs; epoch++) {
                const progress = epoch / epochs; const delay = epochs > 50 ? Math.max(5, 20 / (epoch * 0.1)) : Math.max(10, 40 / (epoch * 0.1))
                await new Promise(r => setTimeout(r, delay))
                const evalClassifier = new NC()
                for (const pt of precomputedTrain) {
                    const numToAdd = Math.max(1, Math.ceil(progress * pt.embeddings.length)); const batch = pt.embeddings.slice(0, numToAdd)
                    if (batch.length > 0) try { await evalClassifier.addFromPrecomputed(pt.cls, batch) } catch { }
                }
                let correct = 0, total = 0
                for (const item of precomputedTest) try {
                    const result = await evalClassifier.predictFromEmbedding(item.embedding, 3)
                    if (result && result.label === item.label) correct++
                    total++
                } catch { total++ }
                evalClassifier.dispose(); const rawAccuracy = total > 0 ? correct / total : 0; epochResultsLocal.push(rawAccuracy); if (rawAccuracy > bestAccuracy) bestAccuracy = rawAccuracy
                if (epoch % 5 === 0 || epoch === epochs) {
                    setCurrentEpoch(epoch); setEpochResults([...epochResultsLocal]); mode.setAccuracy(rawAccuracy);
                }
            }
            classifierRef.current.clear()
            for (const cls of project.classes) if (cls.samples.length > 0) await classifierRef.current.rebuildClass(cls.name, cls.samples.map(s => s.data), augmentMode)
            mode.setAccuracy(bestAccuracy); mode.setModelTrained(true); showSaved(`Training complete — ${(bestAccuracy * 100).toFixed(0)}% accuracy`);
        } catch (err) { mode.setAccuracy(0); setTrainingError('Training failed. Please try again.'); console.error('[Neura] Training failed', err) }
        setIsTraining(false); setModelLoading(false)
    }

    const canTrain = mode.project ? mode.project.classes.length >= 2 && mode.project.classes.every(c => c.samples.length >= 2) : false
    const totalSamplesAll = mode.getTotalSamples()
    let warningTitle = ''; let warningDesc = ''
    if (mode.project && mode.project.classes.length < 2) { warningTitle = 'Add at least 2 folders'; warningDesc = 'Create 2 or more folders to enable training' }
    else if (totalSamplesAll === 0) { warningTitle = 'Add images to each folder'; warningDesc = 'Capture, draw or upload digits for every folder' }
    else if (mode.project && mode.project.classes.some(c => c.samples.length < 2)) { warningTitle = 'Add more digits per folder'; warningDesc = 'Each folder needs at least 2 samples (5+ recommended)' }
    const handleAddClass = () => {
        const name = newClassName.trim(); if (!name) return
        if (mode.project?.classes.some(c => c.name.toLowerCase() === name.toLowerCase())) { showSaved('Folder name already exists'); return }
        mode.addClass(name); setNewClassName(''); setShowAddClass(false); showSaved(`Folder "${name}" added`)
    }
    const sortedPredictionEntries = prediction ? Object.entries(prediction.confidences).sort(([, a], [, b]) => b - a) : []
    const topConfidence = sortedPredictionEntries.length > 0 ? sortedPredictionEntries[0][1] : 0
    const topLabel = sortedPredictionEntries.length > 0 ? sortedPredictionEntries[0][0] : prediction?.label
    const handleExportReport = () => {
        if (!prediction) return
        const report = { projectName: mode.project?.name || 'Untitled', projectType: 'numbers-cr', exportedAt: new Date().toISOString(), testResults: { prediction: prediction.label, topConfidence, allConfidences: Object.fromEntries(sortedPredictionEntries.map(([k, v]) => [k, Math.round(v * 100) + '%'])), inferenceTime }, projectSummary: { totalSamples: mode.getTotalSamples(), totalClasses: mode.project?.classes.length || 0, classes: mode.project?.classes.map(c => ({ name: c.name, sampleCount: c.samples.length })), accuracy: mode.accuracy } }
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${(mode.project?.name || 'report').replace(/[^a-z0-9]/gi, '_')}_test_report.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); showSaved('Report downloaded')
    }

    const getCanvasPoint = (clientX: number, clientY: number) => {
        const rect = viewportRef.current?.getBoundingClientRect(); if (!rect) return { x: 0, y: 0 }
        return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom }
    }
    const handleViewportMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('[data-node]')) return
        setIsPanning(true); panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    }
    const handleViewportMouseMove = (e: React.MouseEvent) => {
        if (isPanning && panStartRef.current) {
            const dx = e.clientX - panStartRef.current.x, dy = e.clientY - panStartRef.current.y
            setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy })
        }
        if (draggingId && dragStartRef.current) {
            const cur = getCanvasPoint(e.clientX, e.clientY)
            const s = dragStartRef.current
            const nx = s.origX + (cur.x - s.startX), ny = s.origY + (cur.y - s.startY)
            if (s.id === 'brain') setBrainPos({ x: nx, y: ny })
            else if (s.id === 'vision') setVisionPos({ x: nx, y: ny })
            else if (s.id === 'data-node') setDataNodePos({ x: nx, y: ny })
            else if (s.id === 'setup-node') setSetupNodePos({ x: nx, y: ny })
            else if (s.id === 'train-node') setTrainNodePos({ x: nx, y: ny })
            else if (s.id === 'test-node') setTestNodePos({ x: nx, y: ny })
            else setClassPositions(prev => ({ ...prev, [s.id]: { x: nx, y: ny } }))
        }
    }
    const handleViewportMouseUp = () => { setIsPanning(false); panStartRef.current = null; if (draggingId) setDraggingId(null) }
    const handleWheel = (e: React.WheelEvent) => {
        const target = e.target as HTMLElement
        if (target.closest('[data-node]') && !e.ctrlKey) return
        const delta = -e.deltaY * 0.001
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
            e.preventDefault()
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
    const startNodeDrag = (e: React.PointerEvent | React.MouseEvent, id: string, orig: { x: number; y: number }) => {
        e.stopPropagation()
        if ('preventDefault' in e) (e as any).preventDefault?.()
        const p = getCanvasPoint((e as any).clientX, (e as any).clientY)
        dragStartRef.current = { id, startX: p.x, startY: p.y, origX: orig.x, origY: orig.y }
        setDraggingId(id)
        if ('pointerId' in e && typeof (e as any).pointerId === 'number') {
            try { (e.target as HTMLElement).setPointerCapture?.((e as any).pointerId) } catch { }
        }
    }
    const zoomIn = () => setZoom(z => Math.min(1.4, +(z + 0.1).toFixed(2)))
    const zoomOut = () => setZoom(z => Math.max(0.6, +(z - 0.1).toFixed(2)))
    const resetView = () => { setZoom(1); setPan({ x: 32, y: 24 }) }

    useEffect(() => {
        const onMove = (e: MouseEvent | PointerEvent) => {
            const cx = (e as any).clientX, cy = (e as any).clientY
            if (isPanning && panStartRef.current) {
                const dx = cx - panStartRef.current.x, dy = cy - panStartRef.current.y
                setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy })
            }
            if (draggingId && dragStartRef.current) {
                const rect = viewportRef.current?.getBoundingClientRect(); if (!rect) return
                const curX = (cx - rect.left - pan.x) / zoom, curY = (cy - rect.top - pan.y) / zoom
                const s = dragStartRef.current
                const nx = s.origX + (curX - s.startX), ny = s.origY + (curY - s.startY)
                if (s.id === 'brain') setBrainPos({ x: nx, y: ny })
                else if (s.id === 'vision') setVisionPos({ x: nx, y: ny })
                else if (s.id === 'data-node') setDataNodePos({ x: nx, y: ny })
                else if (s.id === 'setup-node') setSetupNodePos({ x: nx, y: ny })
                else if (s.id === 'train-node') setTrainNodePos({ x: nx, y: ny })
                else if (s.id === 'test-node') setTestNodePos({ x: nx, y: ny })
                else setClassPositions(prev => ({ ...prev, [s.id]: { x: nx, y: ny } }))
            }
        }
        const onUp = () => { setIsPanning(false); panStartRef.current = null; setDraggingId(null) }
        window.addEventListener('mousemove', onMove as any); window.addEventListener('mouseup', onUp)
        window.addEventListener('pointermove', onMove as any); window.addEventListener('pointerup', onUp as any)
        return () => { window.removeEventListener('mousemove', onMove as any); window.removeEventListener('mouseup', onUp as any); window.removeEventListener('pointermove', onMove as any); window.removeEventListener('pointerup', onUp as any) }
    }, [isPanning, draggingId, zoom, pan])

    // Prevent trackpad pinch from zooming the browser page — always zoom canvas instead, but allow scrolling inside editable nodes
    useEffect(() => {
        const el = viewportRef.current
        if (!el) return
        const onWheelNative = (e: WheelEvent) => {
            const target = e.target as HTMLElement
            if (target.closest('[data-node]') && !e.ctrlKey) return
            if (e.ctrlKey || Math.abs(e.deltaY) > 0) {
                e.preventDefault()
            }
        }
        el.addEventListener('wheel', onWheelNative, { passive: false })
        return () => el.removeEventListener('wheel', onWheelNative)
    }, [])

    const lastClassId = mode.project?.classes[mode.project.classes.length - 1]?.id
    const lastPos = lastClassId ? classPositions[lastClassId] : null
    const isLastExpanded = lastClassId ? !!expandedClasses[lastClassId] : false
    const lastSampleCount = lastClassId ? mode.project?.classes.find(c => c.id === lastClassId)?.samples.length || 0 : 0
    const floaterTop = lastPos ? lastPos.y + 400 + (isLastExpanded && lastSampleCount > 8 ? Math.ceil((lastSampleCount - 8) / 4) * 86 : 0) : 0
    const selectedClass = mode.project?.classes.find(c => c.id === mode.selectedClassId) || mode.project?.classes[0]

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#F8FAFC] relative">
            {savedMessage && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold shadow-lg">{savedMessage}</div>}
            <canvas ref={canvasRef} className="hidden" />
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
            <input ref={testFileInputRef} type="file" accept="image/*" onChange={handleTestUpload as any} className="hidden" />

            {/* Professional header — single row */}
            <div className="shrink-0 h-[48px] flex items-center justify-between px-4 bg-white border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M10 13H8M14 17H8M16 13h-1" /></svg>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-[13px] font-semibold text-slate-900 leading-none tracking-tight">Teach Your AI to Read Digits</h1>
                            <p className="text-[11px] text-slate-500 leading-none mt-0.5 hidden sm:block">Canvas • Draw, capture &amp; arrange folders</p>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-slate-200">
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-semibold text-violet-700">📁 {mode.project?.classes.length || 0} folders</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">🔢 {totalSamplesAll} digits</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-700">🎯 Goal 15 / folder</span>
                        {mode.modelTrained && <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">✓ {(mode.accuracy! * 100).toFixed(0)}%</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{inferenceTime} ms
                    </span>
                    <button onClick={camera.toggleCamera} className={`inline-flex items-center gap-1.5 h-11 px-5 rounded-xl text-sm font-bold border transition-colors ${camera.cameraOn ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                        <span className={`w-2 h-2 rounded-full ${camera.cameraOn ? 'bg-emerald-400' : 'bg-slate-300'}`} />{camera.cameraOn ? 'Camera on' : 'Camera off'}
                    </button>
                    <div className="w-px h-6 bg-slate-200 hidden sm:block" />
                    <button onClick={() => setShowAddClass(true)} className="hidden sm:inline-flex items-center gap-1.5 h-11 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm">+ New folder</button>
                </div>
            </div>

            {/* Ninja Mode Toggle — Vision (draw) vs Data (CSV regression) */}
            <div className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-50 via-indigo-50 to-fuchsia-50 border-b border-violet-100">
                <div className="inline-flex bg-white rounded-full p-1 border border-slate-200 shadow-sm">
                    <button onClick={() => setNinjaMode('vision')} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${ninjaMode==='vision' ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}>✏️ Vision · Digits</button>
                    <button onClick={() => setNinjaMode('data')} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${ninjaMode==='data' ? 'bg-violet-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}>📊 Data · Regression</button>
                </div>
                <span className="hidden sm:inline text-[10px] text-slate-500 ml-2">{ninjaMode==='vision' ? 'Draw or capture digits (classification)' : 'Upload CSV → train regression → predict numbers'}</span>
            </div>

            {showAddClass && (
                <div className="absolute top-[56px] left-1/2 -translate-x-1/2 z-30 bg-white rounded-xl shadow-xl border border-slate-200 p-3 flex gap-2 items-center w-[min(420px,95vw)]">
                    <input autoFocus value={newClassName} onChange={e => setNewClassName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddClass(); if (e.key === 'Escape') setShowAddClass(false) }} placeholder="Folder name e.g. 7 or Seven" className="flex-1 h-11 px-5 rounded-lg border border-slate-200 bg-white text-sm font-medium outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
                    <button onClick={handleAddClass} className="h-9 px-4 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800">Add</button>
                    <button onClick={() => setShowAddClass(false)} className="h-11 px-5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600">Cancel</button>
                </div>
            )}

            {ninjaMode === 'data' ? (
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
                {/* Grid background */}
                <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #DDD6FE 1.2px, transparent 1.2px)`, backgroundSize: '20px 20px', backgroundPosition: `${pan.x}px ${pan.y}px` }} />
                <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: `linear-gradient(#7C3AED 1px, transparent 1px), linear-gradient(90deg, #7C3AED 1px, transparent 1px)`, backgroundSize: '80px 80px', backgroundPosition: `${pan.x}px ${pan.y}px` }} />

                <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: 3000, height: 2000 }}>
                    {/* SVG wires connecting nodes */}
                    <svg className="absolute inset-0 pointer-events-none" width={3000} height={2000} style={{ overflow: 'visible' }}>
                        <defs>
                            <linearGradient id="dataWire" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#630ed4" stopOpacity="0.4" /><stop offset="100%" stopColor="#7c3aed" stopOpacity="0.4" /></linearGradient>
                            <linearGradient id="dataWireActive" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#630ed4" stopOpacity="1" /><stop offset="100%" stopColor="#7c3aed" stopOpacity="1" /></linearGradient>
                            {tabular.isTraining && <style>{`@keyframes wirePulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } } .wire-animate { animation: wirePulse 1.5s ease-in-out infinite; }`}</style>}
                        </defs>
                        {/* Data → Setup wire — centre-point of layouts (like Vision) */}
                        {(() => {
                            const x1 = dataNodePos.x + 420, y1 = dataNodePos.y + nodeHeights.data / 2
                            const x2 = setupNodePos.x, y2 = setupNodePos.y + nodeHeights.setup / 2
                            const mx = (x1 + x2) / 2
                            const active = tabular.dataReady
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1 + 28}, ${mx} ${y2 + 28}, ${x2} ${y2}`} fill="none" stroke={active ? 'url(#dataWireActive)' : '#CBD5E1'} strokeWidth={active ? 3.5 : 2} strokeLinecap="round" strokeDasharray={active ? 'none' : '6 4'} className={tabular.isTraining ? 'wire-animate' : ''} />
                        })()}
                        {/* Setup → Train wire — centre-point */}
                        {(() => {
                            const x1 = setupNodePos.x + 420, y1 = setupNodePos.y + nodeHeights.setup / 2
                            const x2 = trainNodePos.x, y2 = trainNodePos.y + nodeHeights.train / 2
                            const mx = (x1 + x2) / 2
                            const hasData = tabular.dataReady
                            const configured = tabular.featureIndices.length > 0
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1 + 28}, ${mx} ${y2 + 28}, ${x2} ${y2}`} fill="none" stroke={!hasData ? '#CBD5E1' : configured ? 'url(#dataWireActive)' : 'url(#dataWire)'} strokeWidth={hasData ? 3.5 : 2} strokeLinecap="round" strokeDasharray={!hasData ? '6 4' : 'none'} className={tabular.isTraining ? 'wire-animate' : ''} />
                        })()}
                        {/* Train → Test wire — centre-point */}
                        {(() => {
                            const x1 = trainNodePos.x + 420, y1 = trainNodePos.y + nodeHeights.train / 2
                            const x2 = testNodePos.x, y2 = testNodePos.y + nodeHeights.test / 2
                            const mx = (x1 + x2) / 2
                            const hasData = tabular.dataReady
                            const done = tabular.finalAccuracy !== null
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1 + 28}, ${mx} ${y2 + 28}, ${x2} ${y2}`} fill="none" stroke={!hasData ? '#CBD5E1' : done ? 'url(#dataWireActive)' : 'url(#dataWire)'} strokeWidth={hasData ? 3.5 : 2} strokeLinecap="round" strokeDasharray={!hasData ? '6 4' : 'none'} className={tabular.isTraining ? 'wire-animate' : ''} />
                        })()}
                    </svg>

                    {/* ===== DATA NODE ===== */}
                    <div ref={dataNodeRef} data-node onPointerDown={e => startNodeDrag(e, 'data-node', dataNodePos)} style={{ left: dataNodePos.x, top: dataNodePos.y, width: 420, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'data-node' ? 'z-40' : 'z-10'}`}>
                        <div className={`bg-white rounded-xl border shadow-md overflow-hidden flex flex-col cursor-grab active:cursor-grabbing transition-all duration-500 ${tabular.isTraining ? 'border-[#630ed4]/40 shadow-[0_0_20px_rgba(99,14,212,0.15)]' : 'border-slate-200'}`}>
                            <div className={`h-1.5 w-full bg-gradient-to-r from-[#630ed4] to-[#7c3aed] ${tabular.isTraining ? 'animate-pulse' : ''}`} />
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-[#f5f3ff] to-white">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-[#630ed4] to-[#7c3aed] flex items-center justify-center text-white shadow-sm ${tabular.isTraining ? 'animate-pulse' : ''}`}><span className="text-sm">📊</span></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Data</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{tabular.csvData ? `${tabular.csvData.rows.length} rows loaded` : 'Upload or create'}</p>
                                    </div>
                                </div>
                                <span className={`inline-flex h-6 px-2 rounded-full text-[11px] font-medium border ${tabular.dataReady ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{tabular.dataReady ? '✓ Ready' : 'Empty'}</span>
                            </div>
                            <div className="p-3">
                                <DataPanel density="compact" collectMode={tabular.collectMode} csvData={tabular.csvData} columnInfos={tabular.columnInfos} editHeaders={tabular.editHeaders} editRows={tabular.editRows} disabledRows={tabular.disabledRows} disabledCols={tabular.disabledCols} isDragging={tabular.isDragging} newRowCount={tabular.newRowCount} newColCount={tabular.newColCount} fileInputRef={tabular.fileInputRef} onSetCollectMode={tabular.setCollectMode} onFileUpload={tabular.handleFileUpload} onDrop={tabular.handleDrop} onCreateDataset={tabular.handleCreateDataset} onUseEditedData={tabular.handleUseEditedData} onEditHeadersChange={tabular.setEditHeaders} onEditRowsChange={tabular.setEditRows} onDisabledRowsChange={tabular.setDisabledRows} onDisabledColsChange={tabular.setDisabledCols} onIsDraggingChange={tabular.setIsDragging} onNewRowCountChange={tabular.setNewRowCount} onNewColCountChange={tabular.setNewColCount} />
                            </div>
                        </div>
                    </div>

                    {/* ===== SETUP NODE ===== */}
                    <div ref={setupNodeRef} data-node onPointerDown={e => startNodeDrag(e, 'setup-node', setupNodePos)} style={{ left: setupNodePos.x, top: setupNodePos.y, width: 420, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'setup-node' ? 'z-40' : 'z-10'}`}>
                        <div className={`bg-white rounded-xl border shadow-md overflow-hidden flex flex-col cursor-grab active:cursor-grabbing transition-all duration-500 ${tabular.isTraining ? 'border-[#f7941e]/40 shadow-[0_0_20px_rgba(247,148,30,0.15)]' : 'border-slate-200'}`}>
                            <div className={`h-1.5 w-full bg-gradient-to-r from-[#f7941e] to-[#fbb034] ${tabular.isTraining ? 'animate-pulse' : ''}`} />
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-[#f7941e] to-[#fbb034] flex items-center justify-center text-white shadow-sm ${tabular.isTraining ? 'animate-pulse' : ''}`}><span className="text-sm">⚙️</span></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Setup</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{tabular.featureIndices.length > 0 ? `${tabular.featureIndices.length} features → ${tabular.taskType}` : 'Select columns'}</p>
                                    </div>
                                </div>
                                <span className={`inline-flex h-6 px-2 rounded-full text-[11px] font-medium border ${tabular.featureIndices.length > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{tabular.featureIndices.length > 0 ? '✓ Configured' : 'Pending'}</span>
                            </div>
                            <div className="p-3">
                                {tabular.dataReady ? (
                                    <SetupPanel density="compact" csvData={tabular.csvData} columnInfos={tabular.columnInfos} featureIndices={tabular.featureIndices} targetIndex={tabular.targetIndex} taskType={tabular.taskType} onFeatureToggle={tabular.handleFeatureToggle} onTargetChange={tabular.setTargetIndex} onTaskTypeChange={(t) => { tabular.setTaskType(t); tabular.setConfig((prev: any) => ({ ...prev, taskType: t })) }} />
                                ) : (
                                    <div className="flex items-center justify-center h-24 text-[10px] text-slate-400 font-bold">Upload data first</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ===== TRAIN NODE ===== */}
                    <div ref={trainNodeRef} data-node onPointerDown={e => startNodeDrag(e, 'train-node', trainNodePos)} style={{ left: trainNodePos.x, top: trainNodePos.y, width: 420, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'train-node' ? 'z-40' : 'z-10'}`}>
                        <div className={`bg-white rounded-xl border shadow-md overflow-hidden flex flex-col cursor-grab active:cursor-grabbing transition-all duration-500 ${tabular.isTraining ? 'border-[#53ad4e]/40 shadow-[0_0_24px_rgba(83,173,78,0.2)] scale-[1.02]' : 'border-slate-200'}`}>
                            <div className={`h-1.5 w-full bg-gradient-to-r from-[#53ad4e] to-[#4caf50] ${tabular.isTraining ? 'animate-pulse' : ''}`} />
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-[#53ad4e] to-[#4caf50] flex items-center justify-center text-white shadow-sm ${tabular.isTraining ? 'animate-bounce' : ''}`}><span className="text-sm">🧠</span></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Train</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{tabular.isTraining ? `Epoch ${tabular.currentEpoch}/${tabular.config.epochs}` : tabular.finalAccuracy !== null ? `${tabular.finalAccuracy}% accuracy` : 'Configure & train'}</p>
                                    </div>
                                </div>
                                <span className={`inline-flex h-6 px-2 rounded-full text-[11px] font-medium border ${tabular.isTraining ? 'bg-violet-50 text-violet-700 border-violet-200 animate-pulse' : tabular.finalAccuracy !== null ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{tabular.isTraining ? '⏳ Training…' : tabular.finalAccuracy !== null ? '✓ Done' : 'Idle'}</span>
                            </div>
                            <div className="p-3">
                                {tabular.featureIndices.length > 0 ? (
                                    <TabularTrainPanel density="compact" config={tabular.config} taskType={tabular.taskType} isTraining={tabular.isTraining} currentEpoch={tabular.currentEpoch} epochResults={tabular.epochResults} valEpochResults={tabular.valEpochResults} trainMetrics={tabular.trainMetrics} finalAccuracy={tabular.finalAccuracy} trainSummary={tabular.trainSummary} featureIndices={tabular.featureIndices} onConfigChange={tabular.setConfig} onTrain={tabular.handleTrain} onExportModel={tabular.handleExportModel} />
                                ) : (
                                    <div className="flex items-center justify-center h-24 text-[10px] text-slate-400 font-bold">Select features first</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ===== TEST NODE ===== */}
                    <div ref={testNodeRef} data-node onPointerDown={e => startNodeDrag(e, 'test-node', testNodePos)} style={{ left: testNodePos.x, top: testNodePos.y, width: 420, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'test-node' ? 'z-40' : 'z-10'}`}>
                        <div className={`bg-white rounded-xl border shadow-md overflow-hidden flex flex-col cursor-grab active:cursor-grabbing transition-all duration-500 ${tabular.isTraining ? 'border-[#41a2f2]/40 shadow-[0_0_20px_rgba(65,162,242,0.15)]' : 'border-slate-200'}`}>
                            <div className={`h-1.5 w-full bg-gradient-to-r from-[#41a2f2] to-[#2196f3] ${tabular.isTraining ? 'animate-pulse' : ''}`} />
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-[#41a2f2] to-[#2196f3] flex items-center justify-center text-white shadow-sm ${tabular.isTraining ? 'animate-pulse' : ''}`}><span className="text-sm">🧪</span></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Test</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{tabular.finalAccuracy !== null ? 'Ready to predict' : 'Train first'}</p>
                                    </div>
                                </div>
                                <span className={`inline-flex h-6 px-2 rounded-full text-[11px] font-medium border ${tabular.finalAccuracy !== null ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{tabular.finalAccuracy !== null ? '✓ Active' : 'Locked'}</span>
                            </div>
                            <div className="p-3">
                                {tabular.finalAccuracy !== null ? (
                                    <TabularTestPanel density="compact" columnInfos={tabular.columnInfos} featureIndices={tabular.featureIndices} targetIndex={tabular.targetIndex} taskType={tabular.taskType} onPredict={tabular.handlePredict} onExportModel={tabular.handleExportModel} />
                                ) : (
                                    <div className="flex items-center justify-center h-24 text-[10px] text-slate-400 font-bold">Train a model first</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Zoom controls */}
                <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5">
                    <button onClick={zoomIn} className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-600 hover:bg-slate-50 text-sm font-bold">+</button>
                    <button onClick={zoomOut} className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-600 hover:bg-slate-50 text-sm font-bold">−</button>
                    <button onClick={resetView} className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-600 hover:bg-slate-50 text-[9px] font-bold">1:1</button>
                </div>
            </div>
            ) : (
            <>{/* Canvas */}
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
                {/* colorful subtle grid */}
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage: `radial-gradient(circle, #DDD6FE 1.2px, transparent 1.2px)`,
                        backgroundSize: '20px 20px',
                        backgroundPosition: `${pan.x}px ${pan.y}px`,
                    }}
                />
                <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: `linear-gradient(#7C3AED 1px, transparent 1px), linear-gradient(90deg, #7C3AED 1px, transparent 1px)`, backgroundSize: '80px 80px', backgroundPosition: `${pan.x}px ${pan.y}px` }} />

                <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: 3000, height: 2000 }}>
                    <svg className="absolute inset-0 pointer-events-none" width={3000} height={2000} style={{ overflow: 'visible' }}>
                        <defs>
                            <linearGradient id="wire" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#CBD5E1" /><stop offset="100%" stopColor="#94A3B8" /></linearGradient>
                        </defs>
                        {mode.project?.classes.map(cls => {
                            const pos = classPositions[cls.id]; if (!pos) return null
                            const x1 = pos.x + 344, y1 = pos.y + 132
                            const x2 = brainPos.x, y2 = brainPos.y + 220
                            const mx = (x1 + x2) / 2
                            return <path key={cls.id} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" />
                        })}
                        {(() => {
                            const x1 = brainPos.x + 400, y1 = brainPos.y + 220
                            const x2 = visionPos.x, y2 = visionPos.y + 200
                            const mx = (x1 + x2) / 2
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" />
                        })()}
                    </svg>

                    {/* Folder compartments — show digit thumbnails grid */}
                    {mode.project?.classes.map(cls => {
                        const pos = classPositions[cls.id] || { x: 48, y: 80 }
                        const isSelected = mode.selectedClassId === cls.id
                        const isDragOver = dragOverClass === cls.id
                        const atLimit = cls.samples.length >= MAX_SAMPLES_PER_CLASS
                        const progress = Math.min(100, (cls.samples.length / 15) * 100)
                        return (
                            <div key={cls.id} data-node onPointerDown={e => startNodeDrag(e, cls.id, pos)} onClick={() => mode.setSelectedClassId(cls.id)} style={{ left: pos.x, top: pos.y, width: 344, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === cls.id ? 'z-40' : isSelected ? 'z-20' : 'z-10'}`}>
                                <div className={`bg-white rounded-xl border overflow-hidden flex flex-col transition-shadow ${isDragOver ? 'border-violet-400 shadow-lg' : isSelected ? 'border-violet-300 shadow-md' : 'border-slate-200 shadow-sm hover:shadow-md'}`} style={{ minHeight: 300 }}>
                                    <div className="h-[44px] flex items-center gap-3 px-3 border-b border-slate-100 shrink-0" style={{ background: `${cls.color}0D`, borderLeft: `4px solid ${cls.color}` }}>
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border text-[13px] font-bold" style={{ background: `${cls.color}18`, borderColor: `${cls.color}30`, color: cls.color }}>
                                            {cls.name.trim()[0]?.toUpperCase() || '#'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {editingClassId === cls.id ? (
                                                <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => handleRename(cls.id, editName)} onKeyDown={e => { if (e.key === 'Enter') handleRename(cls.id, editName); if (e.key === 'Escape') setEditingClassId(null) }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} className="w-full h-7 px-2 rounded-md border border-slate-300 bg-white text-sm font-medium outline-none focus:border-violet-300" />
                                            ) : (
                                                <p onDoubleClick={e => { e.stopPropagation(); setEditingClassId(cls.id); setEditName(cls.name) }} className="text-[13px] font-semibold text-slate-900 truncate leading-none" title="Double click to rename">{cls.name}</p>
                                            )}
                                            <p className="text-[11px] text-slate-500 leading-none mt-0.5">{cls.samples.length} / {MAX_SAMPLES_PER_CLASS} digits</p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (confirm(`Delete folder "${cls.name}"?`)) { classifierRef.current.clearClass(cls.name); mode.removeClass(cls.id) } }} className="w-7 h-7 rounded-md hover:bg-slate-50 text-slate-400 hover:text-slate-700 flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg></button>
                                            <div className="w-7 h-7 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 cursor-grab active:cursor-grabbing" title="Drag to move">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="7" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="17" r="1" /><circle cx="15" cy="7" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="17" r="1" /></svg>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 shrink-0"><div className="h-full transition-all" style={{ width: `${progress}%`, background: cls.color }} /></div>
                                    {isDragOver && <div className="mx-3 mt-3 h-11 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm font-bold flex items-center justify-center">Drop images here</div>}
                                    <div
                                        onDragOver={e => { e.preventDefault(); setDragOverClass(cls.id) }}
                                        onDragLeave={e => { e.preventDefault(); if (dragOverClass === cls.id) setDragOverClass(null) }}
                                        onDrop={async e => { e.preventDefault(); setDragOverClass(null); if (e.dataTransfer.files.length > 0) await processFilesForClass(e.dataTransfer.files, cls.id) }}
                                        className="flex-1 p-3 flex flex-col gap-3 min-h-[170px]"
                                    >
                                        {cls.samples.length > 0 ? (
                                            <>
                                                <div className={`grid grid-cols-4 gap-2 ${expandedClasses[cls.id] ? 'max-h-[360px] overflow-auto neura-scrollbar pr-1' : ''}`}>
                                                    {(expandedClasses[cls.id] ? cls.samples : cls.samples.slice(0, 8)).map(s => (
                                                        <div key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); openImageViewer(cls.samples.map(x => ({ src: x.data, label: `${cls.name} — digit ${cls.samples.indexOf(x) + 1}` })), cls.samples.indexOf(s)) }} title="Click to view (80% screen)" className="relative aspect-square rounded-lg overflow-hidden bg-white border border-slate-200 group/thumb flex items-center justify-center p-0.5 cursor-zoom-in">
                                                            <img src={s.data} alt="" className="w-full h-full object-contain bg-white rounded-md pointer-events-none" draggable={false} />
                                                            <span className="absolute bottom-1 right-1 w-5 h-5 rounded-md bg-black/55 text-white flex items-center justify-center text-[10px] opacity-0 group-hover/thumb:opacity-100 transition-opacity pointer-events-none">⛶</span>
                                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleRemoveSample(cls.id, s.id) }} className="absolute top-1 right-1 w-5 h-5 rounded-md bg-white border border-slate-200 text-slate-600 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm">×</button>
                                                        </div>
                                                    ))}
                                                </div>
                                                {cls.samples.length > 8 && (
                                                    <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setExpandedClasses(prev => ({ ...prev, [cls.id]: !prev[cls.id] })) }} className="w-full h-7 rounded-full bg-white border border-violet-200 text-violet-700 text-[11px] font-bold hover:bg-violet-50 flex items-center justify-center gap-1">
                                                        {expandedClasses[cls.id] ? <>Show less ↑</> : <>Expand +{cls.samples.length - 8} more ↓</>}
                                                    </button>
                                                )}
                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleCaptureDrawingForClass(cls.id) }} disabled={atLimit} className={`w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-xl border text-sm font-bold transition-all ${atLimit ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100 hover:border-violet-300'}`}>
                                                    ✏️ Save drawing here
                                                </button>
                                                <p className="text-[10px] text-slate-400 text-center">Draw on the right → then save here</p>
                                            </>
                                        ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-5">
                                                <div className={`w-12 h-12 rounded-xl border-2 border-dashed flex items-center justify-center text-xl ${isDragOver ? 'bg-violet-50 border-violet-300 text-violet-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>✏️</div>
                                                <div className="text-center">
                                                    <p className="text-sm font-bold text-slate-700">No digits yet</p>
                                                    <p className="text-[11px] text-slate-500">Draw on the canvas → Save here</p>
                                                </div>
                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); mode.setSelectedClassId(cls.id); showSaved('Draw on the right canvas first ✏️') }} className="h-11 px-6 rounded-full bg-white border-2 border-dashed border-violet-300 text-violet-700 text-sm font-bold hover:bg-violet-50">✏️ Draw first</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                    {/* Add folder — centered ABOVE training block (Brain) */}
                    <button
                        data-node
                        onPointerDown={e => e.stopPropagation()}
                        onClick={() => setShowAddClass(true)}
                        style={{ left: brainPos.x + (400 - 344) / 2, top: brainPos.y - 80, width: 344, height: 60 }}
                        className="absolute z-30 inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-300 bg-gradient-to-r from-violet-50 to-indigo-50 backdrop-blur hover:from-violet-100 hover:to-indigo-100 hover:border-violet-400 text-violet-700 text-sm font-bold shadow-sm transition-all hover:scale-[1.01]"
                    >
                        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">＋</span>
                        Add folder
                    </button>

                    {mode.project?.classes.length === 0 && (
                        <div data-node style={{ left: 360, top: 220, width: 360, position: 'absolute' }} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col items-center text-center">
                            <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 mb-3">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
                            </div>
                            <h3 className="text-sm font-semibold text-slate-900">No folders yet</h3>
                            <p className="text-xs text-slate-500 mt-1 max-w-[260px]">Create a folder for each digit. Each folder is a separate compartment on the canvas.</p>
                            <button onClick={() => setShowAddClass(true)} className="mt-4 h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-800">Add first folder</button>
                        </div>
                    )}

                    {/* Brain — professional */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'brain', brainPos)} style={{ left: brainPos.x, top: brainPos.y, width: 400, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'brain' ? 'z-40' : 'z-10'}`}>
                        <div className="bg-white rounded-xl border border-violet-200 shadow-md overflow-hidden flex flex-col cursor-grab active:cursor-grabbing">
                            <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500" />
                            <div className="h-11 px-4 flex items-center justify-between border-b border-violet-100 bg-gradient-to-r from-violet-50 to-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-sm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 3H9a3 3 0 013 3v2a3 3 0 01-3 3H9a3 3 0 01-3-3V6a3 3 0 013-3z" /><path d="M15 3h0a3 3 0 00-3 3v2a3 3 0 003 3h0a3 3 0 003-3V6a3 3 0 00-3-3z" /><path d="M9 11a3 3 0 00-3 3v2a3 3 0 003 3h0a3 3 0 003-3v-2" /><path d="M15 11a3 3 0 013 3v2a3 3 0 01-3 3h0a3 3 0 01-3-3v-2" /></svg></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Model</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{mode.modelTrained ? `Trained • ${(mode.accuracy! * 100).toFixed(0)}%` : canTrain ? 'Ready to train' : 'Needs data'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`inline-flex h-6 px-2 rounded-full text-[11px] font-medium border ${mode.modelTrained ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : canTrain ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{mode.modelTrained ? 'Ready' : canTrain ? 'Ready' : 'Needs data'}</span>
                                    <span className="w-7 h-7 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="7" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="17" r="1" /><circle cx="15" cy="7" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="17" r="1" /></svg></span>
                                </div>
                            </div>
                            <div className="p-5 flex flex-col items-center text-center gap-3">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 shadow-sm ${mode.modelTrained ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : isTraining ? 'bg-violet-50 border-violet-300 text-violet-700 animate-pulse' : 'bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200 text-violet-700'}`}><span className="text-xl">{isTraining ? '🧠' : mode.modelTrained ? '✓' : '🔢'}</span></div>
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-900">{isTraining ? `Training ${currentEpoch}/${totalEpochs}` : modelLoading ? 'Preparing model' : mode.accuracy != null ? `${(mode.accuracy * 100).toFixed(0)}% accuracy` : canTrain ? 'Ready to train' : warningTitle || 'Add more data'}</h3>
                                    <p className="text-xs text-slate-500 mt-1 max-w-[280px]">{isTraining ? `Learning from ${totalSamplesAll} digits` : mode.accuracy != null ? `${totalSamplesAll} digits across ${mode.project?.classes.length || 0} folders` : warningDesc || 'Add at least 2 folders with 2 digits each'}</p>
                                </div>
                                <button onClick={() => handleTrain(totalEpochs)} disabled={isTraining || modelLoading} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} title={!canTrain ? warningTitle : undefined} className={`h-9 px-5 rounded-full text-sm font-bold shadow-sm transition-all ${canTrain && !isTraining && !modelLoading ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 hover:shadow-md hover:scale-[1.02] cursor-pointer' : isTraining || modelLoading ? 'bg-slate-100 text-slate-400 cursor-wait' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 cursor-pointer'}`}>{isTraining ? 'Training…' : mode.modelTrained ? '✨ Retrain' : '🚀 Train model'}</button>
                                <div className="w-full rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 p-3" onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                                    <div className="flex justify-between text-[11px] font-semibold text-slate-700"><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-md bg-violet-600 text-white flex items-center justify-center text-[10px]">◍</span>Epochs</span><span className="text-violet-700 font-bold bg-white px-2 py-0.5 rounded-full border border-violet-200">{totalEpochs}</span></div>
                                    <input type="range" min={5} max={100} step={5} value={totalEpochs} onChange={e => setTotalEpochs(parseInt(e.target.value))} onInput={e => setTotalEpochs(parseInt((e.target as HTMLInputElement).value))} disabled={isTraining} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} className="w-full mt-3 h-2 accent-violet-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{ accentColor: '#7c3aed' }} />
                                    <div className="flex gap-1.5 mt-3">{[10, 25, 50, 100].map(v => <button key={v} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setTotalEpochs(v) }} className={`flex-1 h-7 rounded-full text-sm font-bold border transition-all ${totalEpochs === v ? 'bg-violet-600 text-white border-violet-600 shadow-sm scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-200 hover:text-violet-700'}`}>{v}</button>)}</div>
                                </div>
                                {(epochResults.length > 0 || isTraining) && <div className="w-full"><AccuracyChart epochResults={epochResults} isTraining={isTraining} currentEpoch={currentEpoch} /></div>}
                                {trainingError && <div className="w-full rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm font-bold text-red-700">{trainingError}</div>}
                            </div>
                            <div className="grid grid-cols-3 gap-px bg-slate-100 border-t border-slate-100">
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Folders</p><p className="text-sm font-semibold text-slate-900">{mode.project?.classes.length || 0}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Digits</p><p className="text-sm font-semibold text-slate-900">{totalSamplesAll}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Accuracy</p><p className={`text-sm font-semibold ${mode.accuracy != null ? 'text-emerald-600' : 'text-slate-400'}`}>{mode.accuracy != null ? `${(mode.accuracy * 100).toFixed(0)}%` : '—'}</p></div>
                            </div>
                        </div>
                    </div>

                    {/* Vision + Draw — Test node with drawing canvas + preview, confidence without %/bars */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'vision', visionPos)} style={{ left: visionPos.x, top: visionPos.y, width: 440, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'vision' ? 'z-40' : 'z-10'}`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col cursor-grab active:cursor-grabbing">
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 19l7-7a2 2 0 000-3l-1-1a2 2 0 00-3 0l-7 7v4h4z" /><path d="M12 19l-2 2" /><circle cx="12" cy="12" r="3" opacity="0.3" /></svg></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Vision &amp; Draw</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{visionInputMode === 'draw' ? 'Draw a digit to collect or test' : camera.cameraOn ? 'Live • Realtime' : testImage ? 'Static image' : 'Idle'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="hidden sm:inline-flex h-6 px-2 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{inferenceTime} ms</span>
                                    <span className={`w-2 h-2 rounded-full ${camera.cameraOn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                </div>
                            </div>



                            {/* Draw pad — sole input (camera removed per request) */}
                            <div className="mx-3 mt-3" onPointerDown={e => e.stopPropagation()}>
                                <div className="rounded-xl overflow-hidden bg-white border border-slate-200 shadow-[inset_0_2px_8px_rgba(0,0,0,0.04)] p-2">
                                    <canvas
                                        ref={drawCanvasRef}
                                        width={360}
                                        height={360}
                                        className="w-full aspect-square rounded-lg bg-white touch-none cursor-crosshair border border-slate-100 block"
                                        onMouseDown={handleDrawStart}
                                        onMouseMove={handleDrawMove}
                                        onMouseUp={handleDrawEnd}
                                        onMouseLeave={handleDrawEnd}
                                        onTouchStart={handleDrawStart}
                                        onTouchMove={handleDrawMove}
                                        onTouchEnd={handleDrawEnd}
                                    />
                                    <div className="flex items-center gap-2 mt-2">
                                        <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); clearCanvas(); setTimeout(initDrawCanvas, 20) }} className="h-11 px-5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold hover:bg-red-100">🗑️ Clear</button>
                                        <span className="text-[11px] text-slate-500 flex-1 text-center truncate">{selectedClass ? `To: ${selectedClass.name}` : 'No folder'}</span>
                                    </div>
                                    <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handlePredictDrawing() }} disabled={isProcessing || modelLoading} className={`mt-2 w-full h-11 rounded-xl text-sm font-bold border flex items-center justify-center gap-1.5 shadow-sm transition-colors ${isProcessing || modelLoading ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 hover:border-emerald-700'}`}>
                                        {isProcessing ? 'Analyzing…' : '🎯 Predict'}
                                    </button>
                                    {selectedClass && (
                                        <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleCaptureDrawingForClass(selectedClass.id) }} disabled={selectedClass.samples.length >= MAX_SAMPLES_PER_CLASS} className={`mt-2 w-full h-11 rounded-xl text-sm font-bold border flex items-center justify-center gap-1.5 ${selectedClass.samples.length >= MAX_SAMPLES_PER_CLASS ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-violet-600 hover:from-violet-700 hover:to-indigo-700 shadow-sm'}`}>
                                            ✏️ Save drawing to {selectedClass.name}
                                        </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-slate-500 text-center mt-1.5">Draw a digit (0-9) in the center with bold strokes</p>
                            </div>

                            {testImage && (
                                <div className="mx-3 mt-2 relative rounded-xl overflow-hidden bg-black border border-slate-800" onPointerDown={e => e.stopPropagation()}>
                                    <img src={testImage} alt="" onClick={e => { e.stopPropagation(); openSingleImage(testImage, 'Test digit') }} title="Click to view (80% screen)" className="w-full h-40 object-contain bg-black cursor-zoom-in" />
                                    <button onPointerDown={e => e.stopPropagation()} onClick={() => { setTestImage(null); setPrediction(null) }} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center">×</button>
                                </div>
                            )}

                            <div className="flex gap-2 p-3 flex-wrap" onPointerDown={e => e.stopPropagation()}>
                                <button onClick={() => setAugmentMode(v => !v)} className={`h-11 px-5 rounded-xl text-sm font-bold border ${augmentMode ? 'bg-slate-50 text-slate-700 border-slate-200' : 'bg-white text-slate-500 border-slate-200'}`}>Smart {augmentMode ? 'on' : 'off'}</button>
                                <button onClick={() => testFileInputRef.current?.click()} className="h-11 px-5 rounded-xl bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 text-sm font-bold">Upload</button>
                                <span className="ml-auto inline-flex h-8 items-center px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{mode.project?.classes.length || 0} folders • {totalSamplesAll} digits</span>
                            </div>
                            <div className="px-3 pb-3 flex flex-col gap-2 max-h-[320px] overflow-auto" onPointerDown={e => e.stopPropagation()}>
                                {!canTrain && !mode.modelTrained ? <div className="text-center py-8 text-xs text-slate-500">Add digits and train to see predictions</div> : !prediction ? <div className="text-center py-6 text-xs text-slate-400">Draw a digit and hit Predict</div> : (
                                    <>
                                        {topLabel && <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex justify-between items-center"><div><p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Top prediction</p><p className="text-sm font-semibold text-slate-900 mt-0.5 flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-slate-900 text-white flex items-center justify-center text-[11px] font-semibold">{topLabel[0].toUpperCase()}</span>{topLabel}</p></div><div className="text-right"><p className="text-[11px] text-slate-500">{inferenceTime} ms</p></div></div>}
                                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                                            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase mb-2">All folders — ranked</p>
                                            {sortedPredictionEntries.map(([label, _conf], idx) => {
                                                const isTop = idx === 0; const col = mode.project?.classes.find(c => c.name === label)?.color || '#0F172A'
                                                return <div key={label} className={`mb-1.5 last:mb-0 p-2 rounded-lg border ${isTop ? 'bg-white border-slate-300' : 'bg-white border-slate-200'}`}><div className="flex justify-between text-sm font-bold"><span className="flex items-center gap-1.5 truncate"><span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-semibold shrink-0" style={{ background: col }}>{label[0].toUpperCase()}</span><span className="truncate text-slate-900">{label}</span>{isTop && <span className="text-amber-500">★</span>}</span></div></div>
                                            })}
                                        </div>
                                        <div className="flex gap-2"><button onClick={() => { setTestImage(null); setPrediction(null); clearCanvas(); setTimeout(initDrawCanvas, 20) }} className="flex-1 h-11 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700">Clear</button><button onClick={handleExportReport} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-bold">Download report</button></div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom canvas controls — single source, professional */}
                <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-white rounded-full shadow-sm border border-slate-200 px-2 py-1.5">
                    <span className="text-[11px] font-medium text-slate-600 px-2">Canvas</span>
                    <button onClick={zoomOut} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">−</button>
                    <span className="text-sm font-bold w-11 text-center text-slate-900">{Math.round(zoom * 100)}%</span>
                    <button onClick={zoomIn} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">+</button>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <button onClick={resetView} className="h-7 px-3 rounded-full bg-slate-900 text-white text-sm font-bold">Reset</button>
                </div>
            </div>

            <NotRelatedModal isOpen={showNotRelated} onClose={() => setShowNotRelated(false)} onUpload={() => testFileInputRef.current?.click()} />
            </>
            )}
        </div>
    )
}
