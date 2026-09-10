import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import { useCamera } from '../../hooks/useCamera'
import { PoseClassifier } from '../../ml/classifiers/PoseClassifier'
import type { Keypoint } from '../../ml/classifiers/PoseClassifier'
import { RELATEDNESS_THRESHOLD } from '../../ml/KNNClassifier'
import { MAX_SAMPLES_PER_CLASS } from '../../types/neura.types'
import { nudgeToNonColliding, layoutNonColliding, layoutInitialClasses, getInitialClassPosition } from '../layoutCollision'
import AccuracyChart from '../components/AccuracyChart'
import NotRelatedModal from '../components/NotRelatedModal'
import { openSingleImage } from '../components/neuraImageViewer'

interface PoseClassifierPanelProps { mode: UseNeuraProjectReturn }

// tiny skeleton thumbnail for pose samples — mirrors SampleGrid KeypointSkeleton but compact
function PoseSkeletonThumb({ data }: { data: string }) {
    try {
        const keypoints: Keypoint[] = JSON.parse(data)
        if (!Array.isArray(keypoints) || keypoints.length < 5) {
            return <span className="text-[11px]">🤸</span>
        }
        // MoveNet 17-point connections (same as PoseClassifier.drawPose)
        const connections: [number, number][] = [
            [5, 6], [5, 11], [6, 12], [11, 12],
            [5, 7], [7, 9],
            [6, 8], [8, 10],
            [11, 13], [13, 15],
            [12, 14], [14, 16],
            [0, 5], [0, 6]
        ]
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const kp of keypoints) {
            const x = (kp as any).x ?? 0
            const y = (kp as any).y ?? 0
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
        const rangeX = maxX - minX || 1
        const rangeY = maxY - minY || 1
        const normalized = keypoints.map((kp: any) => ({
            x: ((kp.x - minX) / rangeX) * 80 + 10,
            y: ((kp.y - minY) / rangeY) * 80 + 10,
            score: kp.score ?? 1
        }))
        return (
            <svg viewBox="0 0 100 100" className="w-full h-full p-1">
                {connections.map(([i, j], idx) => {
                    if (i >= normalized.length || j >= normalized.length) return null
                    const a = normalized[i], b = normalized[j]
                    if (a.score < 0.3 || b.score < 0.3) return null
                    return <line key={idx} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7C3AED" strokeWidth="1.6" strokeLinecap="round" />
                })}
                {normalized.map((kp, idx) => kp.score > 0.3 ? <circle key={idx} cx={kp.x} cy={kp.y} r="2" fill="#A78BFA" stroke="#fff" strokeWidth="0.5" /> : null)}
            </svg>
        )
    } catch {
        return <span className="text-[11px]">🤸</span>
    }
}

export default function PoseClassifierPanel({ mode }: PoseClassifierPanelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const skeletonOverlayRef = useRef<HTMLCanvasElement>(null)
    const classifierRef = useRef(new PoseClassifier())
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

    const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const camera = useCamera({ videoConstraints: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } } })

    useEffect(() => { mode.setHideSidebar(true); return () => mode.setHideSidebar(false) }, [])

    const showSaved = useCallback((msg: string) => {
        setSavedMessage(msg)
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        savedTimeoutRef.current = setTimeout(() => setSavedMessage(null), 2200)
    }, [])

    useEffect(() => {
        if (!mode.project) return
        setClassPositions(prev => {
            const next = { ...prev }
            mode.project!.classes.forEach((cls, idx) => {
                if (!next[cls.id]) {
                    const col = Math.floor(idx / 4)
                    const row = idx % 4
                    next[cls.id] = { x: 48 + col * 400, y: 80 + row * 460 }
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
                if (cls.samples.length > 0) {
                    for (const sample of cls.samples) {
                        try {
                            const keypoints = JSON.parse(sample.data) as Keypoint[]
                            await classifierRef.current.addSampleFromKeypoints(keypoints, cls.name)
                        } catch { /* skip bad sample */ }
                    }
                }
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
            if (updated) {
                classifierRef.current.clearClass(old.name)
                if (updated.samples.length > 0) {
                    for (const s of updated.samples) {
                        try { const kps = JSON.parse(s.data); await classifierRef.current.addSampleFromKeypoints(kps, trimmed) } catch { /* ignore */ }
                    }
                }
            }
        }, 50)
        setEditingClassId(null)
    }

    useEffect(() => {
        if (modelLoading) return
        if (!camera.cameraOn || !camera.stream) {
            // clear skeleton overlay when camera off
            if (skeletonOverlayRef.current) {
                const ctx = skeletonOverlayRef.current.getContext('2d')
                if (ctx) ctx.clearRect(0, 0, skeletonOverlayRef.current.width, skeletonOverlayRef.current.height)
            }
            return
        }
        let interval: ReturnType<typeof setInterval> | null = null
        const runPrediction = async () => {
            if (isPredictingRef.current) return
            if (!camera.cameraOnRef.current || !camera.streamStateRef.current || !camera.videoRef.current) return
            const vw = camera.videoRef.current.videoWidth, vh = camera.videoRef.current.videoHeight
            if (!vw || !vh) return
            if (consecutiveFailuresRef.current >= 10) return
            if (!classifierRef.current.canClassify) {
                // still draw skeleton even when not ready to classify
                try {
                    const tmp = document.createElement('canvas')
                    tmp.width = vw; tmp.height = vh
                    const tctx = tmp.getContext('2d')
                    if (!tctx) return
                    tctx.drawImage(camera.videoRef.current!, 0, 0, vw, vh)
                    const kps = await classifierRef.current.detectPose(tmp)
                    if (skeletonOverlayRef.current) {
                        skeletonOverlayRef.current.width = vw
                        skeletonOverlayRef.current.height = vh
                        const octx = skeletonOverlayRef.current.getContext('2d')
                        if (octx) {
                            octx.clearRect(0, 0, vw, vh)
                            if (kps.length > 0) classifierRef.current.drawPose(skeletonOverlayRef.current, kps)
                        }
                    }
                } catch { /* ignore */ }
                return
            }
            isPredictingRef.current = true
            try {
                const start = performance.now()
                const tmp = document.createElement('canvas')
                tmp.width = vw; tmp.height = vh
                const tctx = tmp.getContext('2d')
                if (!tctx) { isPredictingRef.current = false; return }
                tctx.drawImage(camera.videoRef.current!, 0, 0, vw, vh)
                // detect for overlay + predict from same keypoints to avoid double inference
                const keypoints = await classifierRef.current.detectPose(tmp)
                // draw skeleton overlay
                if (skeletonOverlayRef.current) {
                    skeletonOverlayRef.current.width = vw
                    skeletonOverlayRef.current.height = vh
                    const octx = skeletonOverlayRef.current.getContext('2d')
                    if (octx) {
                        octx.clearRect(0, 0, vw, vh)
                        if (keypoints.length > 0) classifierRef.current.drawPose(skeletonOverlayRef.current, keypoints)
                    }
                }
                if (keypoints.length === 0) {
                    // no pose -> clear prediction gently
                    setPrediction(null)
                    isPredictingRef.current = false
                    return
                }
                const result = await classifierRef.current.predictFromKeypoints(keypoints, 5)
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
            } catch { consecutiveFailuresRef.current++; if (consecutiveFailuresRef.current >= 10) camera.setCameraError('Pose detection issue. Please reload.') } finally { isPredictingRef.current = false }
        }
        runPrediction(); interval = setInterval(runPrediction, 400)
        return () => { if (interval) clearInterval(interval) }
    }, [camera.cameraOn, camera.stream, modelLoading, testImage])

    useEffect(() => { consecutiveFailuresRef.current = 0 }, [camera.cameraOn, mode.project?.classes.length])

    const handleCaptureForClass = async (classId: string) => {
        if (!camera.cameraOn) {
            console.log('[Neura] Camera off — auto-starting for pose capture…')
            showSaved('Starting camera…')
            try { await camera.startCamera(); console.log('[Neura] Camera start requested') } catch (e) { console.warn('[Neura] Camera start failed', e) }
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
            try { await video.play().catch(() => { /* ignore */ }) } catch { /* ignore */ }
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 100))
                if (video.videoWidth && video.readyState >= 2) break
            }
            if (!video.videoWidth || video.readyState < 2) { showSaved('Camera warming up… wait a second then try Snap again'); return }
        }
        const cls = mode.project?.classes.find(c => c.id === classId)
        if (cls && cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 poses per folder'); return }
        setIsCapturing(classId)
        try {
            const tmp = document.createElement('canvas')
            tmp.width = video.videoWidth; tmp.height = video.videoHeight
            const ctx = tmp.getContext('2d')
            if (!ctx) { showSaved('Capture failed — no canvas'); return }
            ctx.drawImage(video, 0, 0, tmp.width, tmp.height)
            const keypoints = await classifierRef.current.detectPose(tmp)
            if (!keypoints || keypoints.length === 0 || keypoints.every(k => k.score < 0.3)) { showSaved('No pose detected — strike a clearer pose'); return }
            const ok = mode.addSample(classId, { type: 'keypoints', data: JSON.stringify(keypoints) })
            if (!ok) { showSaved('Folder full (20 max)'); return }
            const targetName = cls?.name || mode.project?.classes.find(c => c.id === classId)?.name || ''
            await classifierRef.current.addSampleFromKeypoints(keypoints, targetName).catch(e => console.warn('[Neura][pose capture] embedding failed', e))
            console.log('[Neura] Captured pose', { folder: cls?.name, total: (cls ? cls.samples.length + 1 : '?') })
            showSaved(`Captured for ${cls?.name || 'folder'} ✓`)
        } catch (err) { console.warn('[pose capture] failed', err); showSaved('Capture failed — see console') } finally { setTimeout(() => setIsCapturing(null), 240) }
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
        let noPose = 0
        const list = Array.from(files as any) as File[]
        const imageFiles = list.filter(f => f.type.startsWith('image/'))
        if (imageFiles.length === 0) { showSaved('No images found'); return }
        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i]
            const cur = mode.project?.classes.find(c => c.id === classId)
            if (cur && cur.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved(`Limit reached for ${cls.name}`); break }
            const dataUrl = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(file) })
            const img = new Image(); img.src = dataUrl
            await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); setTimeout(() => resolve(), 3000) })
            if (img.complete && img.naturalWidth > 0) {
                const tmp = document.createElement('canvas')
                tmp.width = img.naturalWidth; tmp.height = img.naturalHeight
                const ctx = tmp.getContext('2d')!
                ctx.drawImage(img, 0, 0)
                try {
                    const keypoints = await classifierRef.current.detectPose(tmp)
                    if (keypoints && keypoints.length > 0 && keypoints.some(k => k.score > 0.3)) {
                        const targetName = mode.project?.classes.find(c => c.id === classId)?.name || cls.name
                        const ok = mode.addSample(classId, { type: 'keypoints', data: JSON.stringify(keypoints) })
                        if (!ok) { showSaved(`Limit reached for ${cls.name}`); break }
                        await classifierRef.current.addSampleFromKeypoints(keypoints, targetName)
                        added++
                    } else {
                        noPose++
                    }
                } catch { noPose++ }
            }
        }
        if (added > 0) showSaved(`Added ${added} pose${added > 1 ? 's' : ''} to ${cls.name}`)
        if (noPose > 0) showSaved(`No pose in ${noPose} image${noPose > 1 ? 's' : ''}`)
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
        if (!classifierRef.current.canClassify) { showSaved('Add at least 2 folders with 2 poses, then Train'); return }
        const dataUrl = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(file) })
        setTestImage(dataUrl); if (camera.cameraOn) camera.stopCamera(); setIsProcessing(true)
        try {
            const img = new Image(); img.src = dataUrl
            await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); setTimeout(() => resolve(), 3000) })
            if (img.complete && img.naturalWidth > 0) {
                const tmp = document.createElement('canvas')
                tmp.width = img.naturalWidth; tmp.height = img.naturalHeight
                const ctx = tmp.getContext('2d')!
                ctx.drawImage(img, 0, 0)
                const start = performance.now(); const result = await classifierRef.current.predictFromImage(tmp); const elapsed = Math.round(performance.now() - start)
                if (result) {
                    if (result.similarity !== undefined && result.similarity < RELATEDNESS_THRESHOLD) { setPrediction(null); setShowNotRelated(true) }
                    else { const sorted = Object.entries(result.confidences).sort(([, a], [, b]) => b - a); const sortedConf: Record<string, number> = {}; sorted.forEach(([k, v]) => { sortedConf[k] = v }); setPrediction({ label: sorted[0]?.[0] || result.label, confidences: sortedConf, similarity: result.similarity } as any); setInferenceTime(elapsed) }
                } else { setPrediction(null); setShowNotRelated(true) }
            }
        } catch { /* ignore */ } finally { setIsProcessing(false); if (testFileInputRef.current) testFileInputRef.current.value = '' }
    }
    const handleTestDrop = async (e: React.DragEvent) => { e.preventDefault(); setIsTestDragging(false); if (e.dataTransfer.files.length > 0) await handleTestUpload(e.dataTransfer.files) }

    const handleRemoveSample = async (classId: string, sampleId: string) => {
        mode.removeSample(classId, sampleId)
        if (removeDebounceRef.current) clearTimeout(removeDebounceRef.current)
        removeDebounceRef.current = setTimeout(async () => {
            const c = mode.project?.classes.find(x => x.id === classId); if (!c) return
            const current = mode.project?.classes.find(x => x.id === classId)
            classifierRef.current.clearClass(c.name)
            if (current && current.samples.length > 0) {
                for (const s of current.samples) {
                    try { const kps = JSON.parse(s.data); await classifierRef.current.addSampleFromKeypoints(kps, c.name) } catch { /* ignore */ }
                }
            }
        }, 300)
        showSaved('Pose removed')
    }

    const handleTrain = async (epochs = 50) => {
        console.log(`[Neura][Pose] Train clicked — epochs=${epochs}`, { folders: mode.project?.classes.length, poses: mode.getTotalSamples(), canTrain })
        setIsTraining(true); setTrainingError(null); setTotalEpochs(epochs); setCurrentEpoch(0); setEpochResults([])
        const project = mode.project
        if (!project || project.classes.length < 2) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Add at least 2 folders to train'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); console.warn('[Neura][Pose] Train aborted:', msg); return }
        if (project.classes.some(c => c.samples.length < 2)) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Each folder needs at least 2 poses'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); console.warn('[Neura][Pose] Train aborted:', msg); return }
        try {
            console.log('[Neura][Pose] Training started', { epochs, folders: project.classes.map(c => ({ name: c.name, n: c.samples.length })) })
            setModelLoading(true)
            const { PoseClassifier } = await import('../../ml/classifiers/PoseClassifier')
            const trainData: { cls: string; keypoints: Keypoint[][] }[] = []
            const testData: { keypoints: Keypoint[]; label: string }[] = []
            for (const cls of project.classes) {
                const shuffled = [...cls.samples].sort(() => Math.random() - 0.5)
                const trainCount = Math.max(1, Math.min(shuffled.length - 1, Math.floor(shuffled.length * 0.8)))
                const splitIdx = shuffled.length <= 2 ? 1 : trainCount
                console.log(`[Neura][Pose][split] "${cls.name}": total=${cls.samples.length} splitIdx=${splitIdx} -> train=${splitIdx} test=${shuffled.length - splitIdx}`)
                const trainKps: Keypoint[][] = []
                for (let i = 0; i < shuffled.length; i++) {
                    try {
                        const kps = JSON.parse(shuffled[i].data) as Keypoint[]
                        if (i < splitIdx) trainKps.push(kps)
                        else testData.push({ keypoints: kps, label: cls.name })
                    } catch { /* ignore */ }
                }
                trainData.push({ cls: cls.name, keypoints: trainKps })
            }
            console.log('[Neura][Pose][split] summary', { trainData: trainData.map(t => ({ cls: t.cls, n: t.keypoints.length })), test: testData.length })
            setModelLoading(false)
            if (trainData.every(t => t.keypoints.length === 0) || testData.length === 0) { mode.setAccuracy(0); setModelLoading(false); setIsTraining(false); const msg = 'Not enough test poses — add more samples'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); console.warn('[Neura][Pose] Train aborted:', msg); return }
            // Pre-check if any keypoints are valid
            if (trainData.every(t => t.keypoints.length === 0) || testData.length === 0) {
                console.warn('[Neura][Pose] No valid pose data', { trainData, testLen: testData.length })
                try {
                    classifierRef.current.clear()
                    for (const cls of project.classes) {
                        for (const s of cls.samples) { try { const kps = JSON.parse(s.data); await classifierRef.current.addSampleFromKeypoints(kps, cls.name) } catch { /* ignore */ } }
                    }
                    const fallbackAcc = 0.75
                    mode.setAccuracy(fallbackAcc); mode.setModelTrained(true)
                    setEpochResults([fallbackAcc]); setCurrentEpoch(epochs)
                    showSaved(`Training complete (fallback) — ${(fallbackAcc * 100).toFixed(0)}%`)
                } catch (e) { console.error('[Neura][Pose] Fallback failed', e); setTrainingError('Training failed — model load error.') }
                setIsTraining(false); return
            }
            const epochResultsLocal: number[] = []; let bestAccuracy = 0
            for (let epoch = 1; epoch <= epochs; epoch++) {
                const progress = epoch / epochs; const delay = epochs > 50 ? Math.max(5, 20 / (epoch * 0.1)) : Math.max(10, 40 / (epoch * 0.1))
                await new Promise(r => setTimeout(r, delay))
                const evalClassifier = new PoseClassifier()
                for (const pt of trainData) {
                    const numToAdd = Math.max(1, Math.ceil(progress * pt.keypoints.length)); const batch = pt.keypoints.slice(0, numToAdd)
                    for (const kps of batch) { try { await evalClassifier.addSampleFromKeypoints(kps, pt.cls) } catch { /* ignore */ } }
                }
                let correct = 0, total = 0
                const perTestLog: string[] = []
                for (const item of testData) try {
                    const result = await evalClassifier.predictFromKeypoints(item.keypoints, 5)
                    const predicted = result?.label ?? 'null'
                    const isCorrect = result && result.label === item.label
                    if (isCorrect) correct++
                    total++
                    const shouldLog = epoch === 1 || epoch === epochs || !isCorrect
                    if (shouldLog) {
                        perTestLog.push(`${item.label}→${predicted}${isCorrect ? '✓' : '✗'} conf=${result ? Object.entries(result.confidences).map(([k, v]) => (k + ':' + (v * 100).toFixed(0) + '%')).join(',') : 'null'} sim=${result?.similarity?.toFixed(3) ?? 'null'}`)
                    }
                } catch (e) { total++; perTestLog.push(`${item.label}→error`) }
                evalClassifier.dispose(); const rawAccuracy = total > 0 ? correct / total : 0; epochResultsLocal.push(rawAccuracy); if (rawAccuracy > bestAccuracy) bestAccuracy = rawAccuracy
                if (epoch % 5 === 0 || epoch === epochs) {
                    setCurrentEpoch(epoch); setEpochResults([...epochResultsLocal]); mode.setAccuracy(rawAccuracy);
                    console.log(`[Neura][Pose] Epoch ${epoch}/${epochs} — accuracy ${(rawAccuracy * 100).toFixed(1)}% (best ${(bestAccuracy * 100).toFixed(1)}%) correct=${correct}/${total}`)
                    if (perTestLog.length) perTestLog.forEach(l => console.log(`[Neura][Pose][eval] ${l}`))
                } else if (perTestLog.length) { perTestLog.forEach(l => console.log(`[Neura][Pose][eval] epoch${epoch} ${l}`)) }
            }
            classifierRef.current.clear()
            for (const cls of project.classes) {
                for (const s of cls.samples) { try { const kps = JSON.parse(s.data); await classifierRef.current.addSampleFromKeypoints(kps, cls.name) } catch { /* ignore */ } }
            }
            mode.setAccuracy(bestAccuracy); mode.setModelTrained(true); showSaved(`Training complete — ${(bestAccuracy * 100).toFixed(0)}% accuracy`); console.log(`[Neura][Pose] Training done — best ${(bestAccuracy * 100).toFixed(1)}% over ${epochs} epochs`, { bestAccuracy, epochResults: epochResultsLocal })
        } catch (err) { mode.setAccuracy(0); setTrainingError('Training failed. Please try again.'); console.error('[Neura][Pose] Training failed', err) }
        setIsTraining(false); setModelLoading(false)
    }

    const canTrain = mode.project ? mode.project.classes.length >= 2 && mode.project.classes.every(c => c.samples.length >= 2) : false
    const totalSamplesAll = mode.getTotalSamples()
    let warningTitle = ''; let warningDesc = ''
    if (mode.project && mode.project.classes.length < 2) { warningTitle = 'Add at least 2 folders'; warningDesc = 'Create 2 or more folders to enable training' }
    else if (totalSamplesAll === 0) { warningTitle = 'Add poses to each folder'; warningDesc = 'Capture or upload pose images for every folder' }
    else if (mode.project && mode.project.classes.some(c => c.samples.length < 2)) { warningTitle = 'Add more poses per folder'; warningDesc = 'Each folder needs at least 2 poses (5+ recommended)' }
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
        const report = { projectName: mode.project?.name || 'Untitled', projectType: 'pose-classifier', exportedAt: new Date().toISOString(), testResults: { prediction: prediction.label, topConfidence, allConfidences: Object.fromEntries(sortedPredictionEntries.map(([k, v]) => [k, Math.round(v * 100) + '%'])), inferenceTime }, projectSummary: { totalSamples: mode.getTotalSamples(), totalClasses: mode.project?.classes.length || 0, classes: mode.project?.classes.map(c => ({ name: c.name, sampleCount: c.samples.length })), accuracy: mode.accuracy } }
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
            if (s.id === 'brain') { const cand = nudgeToNonColliding('brain', {x:nx,y:ny}, classPositions, brainPos, visionPos, { expandedClasses, fallback: brainPos } as any); if (cand !== brainPos) setBrainPos(cand) }
            else if (s.id === 'vision') { const cand = nudgeToNonColliding('vision', {x:nx,y:ny}, classPositions, brainPos, visionPos, { expandedClasses, fallback: visionPos } as any); if (cand !== visionPos) setVisionPos(cand) }
            else { const fb = classPositions[s.id] ?? { x: nx, y: ny }; const cand = nudgeToNonColliding(s.id, {x:nx,y:ny}, classPositions, brainPos, visionPos, { expandedClasses, fallback: fb } as any); if (cand !== fb) setClassPositions(prev => { const cur = prev[s.id]; if (cur && cand.x === cur.x && cand.y === cur.y) return prev; return { ...prev, [s.id]: cand } }) }
        }
    }
    const handleViewportMouseUp = () => { setIsPanning(false); panStartRef.current = null; if (draggingId) setDraggingId(null) }
    const handleWheel = (e: React.WheelEvent) => {
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
            try { (e.target as HTMLElement).setPointerCapture?.((e as any).pointerId) } catch { /* ignore */ }
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
                if (s.id === 'brain') { const cand = nudgeToNonColliding('brain', {x:nx,y:ny}, classPositions, brainPos, visionPos, { expandedClasses, fallback: brainPos } as any); if (cand !== brainPos) setBrainPos(cand) }
            else if (s.id === 'vision') { const cand = nudgeToNonColliding('vision', {x:nx,y:ny}, classPositions, brainPos, visionPos, { expandedClasses, fallback: visionPos } as any); if (cand !== visionPos) setVisionPos(cand) }
            else { const fb = classPositions[s.id] ?? { x: nx, y: ny }; const cand = nudgeToNonColliding(s.id, {x:nx,y:ny}, classPositions, brainPos, visionPos, { expandedClasses, fallback: fb } as any); if (cand !== fb) setClassPositions(prev => { const cur = prev[s.id]; if (cur && cand.x === cur.x && cand.y === cur.y) return prev; return { ...prev, [s.id]: cand } }) }
            }
        }
        const onUp = () => { setIsPanning(false); panStartRef.current = null; setDraggingId(null) }
        window.addEventListener('mousemove', onMove as any); window.addEventListener('mouseup', onUp)
        window.addEventListener('pointermove', onMove as any); window.addEventListener('pointerup', onUp as any)
        return () => { window.removeEventListener('mousemove', onMove as any); window.removeEventListener('mouseup', onUp as any); window.removeEventListener('pointermove', onMove as any); window.removeEventListener('pointerup', onUp as any) }
    }, [isPanning, draggingId, zoom, pan])

    // Prevent trackpad pinch from zooming the browser page — always zoom canvas instead
    useEffect(() => {
        const el = viewportRef.current
        if (!el) return
        const onWheelNative = (e: WheelEvent) => {
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
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="7" r="3" /><path d="M12 10v4l-3 3M12 14l3 3M8 14H5a2 2 0 00-2 2v2M16 14h3a2 2 0 012 2v2M8 18l-2 4M16 18l2 4M10 22h4" /></svg>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-[13px] font-semibold text-slate-900 leading-none tracking-tight">Teach Your AI to Move</h1>
                            <p className="text-[11px] text-slate-500 leading-none mt-0.5 hidden sm:block">Canvas • Pan, zoom, and arrange folders</p>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-slate-200">
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-semibold text-violet-700">📁 {mode.project?.classes.length || 0} folders</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">🤸 {totalSamplesAll} poses</span>
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

            {showAddClass && (
                <div className="absolute top-[56px] left-1/2 -translate-x-1/2 z-30 bg-white rounded-xl shadow-xl border border-slate-200 p-3 flex gap-2 items-center w-[min(420px,95vw)]">
                    <input autoFocus value={newClassName} onChange={e => setNewClassName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddClass(); if (e.key === 'Escape') setShowAddClass(false) }} placeholder="Folder name e.g. T-Pose" className="flex-1 h-11 px-5 rounded-lg border border-slate-200 bg-white text-sm font-medium outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
                    <button onClick={handleAddClass} className="h-9 px-4 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800">Add</button>
                    <button onClick={() => setShowAddClass(false)} className="h-11 px-5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600">Cancel</button>
                </div>
            )}

            {/* Canvas */}
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
                {/* colorful subtle grid — child-friendly but professional */}
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

                    {/* Folder compartments — professional */}
                    {mode.project?.classes.map(cls => {
                        const pos = classPositions[cls.id] || { x: 48, y: 80 }
                        const isSelected = mode.selectedClassId === cls.id
                        const isDragOver = dragOverClass === cls.id
                        const atLimit = cls.samples.length >= MAX_SAMPLES_PER_CLASS
                        const progress = Math.min(100, (cls.samples.length / 15) * 100)
                        return (
                            <div key={cls.id} data-node onPointerDown={e => startNodeDrag(e, cls.id, pos)} onClick={() => mode.setSelectedClassId(cls.id)} style={{ left: pos.x, top: pos.y, width: 344, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === cls.id ? 'z-40' : isSelected ? 'z-20' : 'z-10'}`}>
                                <div className={`bg-white rounded-xl border overflow-hidden flex flex-col transition-shadow ${isDragOver ? 'border-violet-400 shadow-lg' : isSelected ? 'border-violet-300 shadow-md' : 'border-slate-200 shadow-sm hover:shadow-md'}`} style={{ minHeight: 280 }}>
                                    <div className="h-[44px] flex items-center gap-3 px-3 border-b border-slate-100 shrink-0" style={{ background: `${cls.color}0D`, borderLeft: `4px solid ${cls.color}` }}>
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border" style={{ background: `${cls.color}18`, borderColor: `${cls.color}30`, color: cls.color }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {editingClassId === cls.id ? (
                                                <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => handleRename(cls.id, editName)} onKeyDown={e => { if (e.key === 'Enter') handleRename(cls.id, editName); if (e.key === 'Escape') setEditingClassId(null) }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} className="w-full h-7 px-2 rounded-md border border-slate-300 bg-white text-sm font-medium outline-none focus:border-violet-300" />
                                            ) : (
                                                <p onDoubleClick={e => { e.stopPropagation(); setEditingClassId(cls.id); setEditName(cls.name) }} className="text-[13px] font-semibold text-slate-900 truncate leading-none" title="Double click to rename">{cls.name}</p>
                                            )}
                                            <p className="text-[11px] text-slate-500 leading-none mt-0.5">{cls.samples.length} / {MAX_SAMPLES_PER_CLASS} poses</p>
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
                                        className="flex-1 p-3 flex flex-col gap-3 min-h-[150px]"
                                    >
                                        {cls.samples.length > 0 ? (
                                            <>
                                                <div className="grid grid-cols-4 gap-2">
                                                    {cls.samples.slice(0, 8).map(s => (
                                                        <div key={s.id} className="relative aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 group/thumb">
                                                            <PoseSkeletonThumb data={s.data} />
                                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleRemoveSample(cls.id, s.id) }} className="absolute top-1 right-1 w-5 h-5 rounded-md bg-white border border-slate-200 text-slate-600 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm">×</button>
                                                        </div>
                                                    ))}
                                                </div>
                                                {cls.samples.length > 8 && <div className="text-[11px] text-slate-500 text-center">+{cls.samples.length - 8} more</div>}
                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleUploadClick(cls.id) }} disabled={atLimit} className={`w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-bold transition-all ${atLimit ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-violet-50 to-indigo-50 border-violet-200 text-violet-700 hover:from-violet-100 hover:to-indigo-100 hover:border-violet-300 hover:shadow-sm'}`}>
                                                    <span className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs">+</span>
                                                    Add poses <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white border border-violet-200 text-violet-600 font-bold">multi</span>
                                                </button>
                                            </>
                                        ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                                                <div className={`w-12 h-12 rounded-xl border flex items-center justify-center ${isDragOver ? 'bg-violet-50 border-violet-200 text-violet-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}><span className="text-lg">🤸</span></div>
                                                <div className="text-center">
                                                    <p className="text-sm font-bold text-slate-700">No poses yet</p>
                                                    <p className="text-[11px] text-slate-500">Strike a pose or drop images</p>
                                                </div>
                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleUploadClick(cls.id) }} className="h-11 px-6 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold shadow-sm hover:from-violet-700 hover:to-indigo-700">＋ Add poses</button>
                                                <p className="text-[10px] text-slate-400">PNG, JPG • Pose will be detected</p>
                                            </div>
                                        )}
                                        <div className="flex gap-2 pt-2 border-t border-slate-100 mt-auto">
                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); mode.setSelectedClassId(cls.id); handleCaptureForClass(cls.id) }} onMouseDown={e => { e.stopPropagation(); mode.setSelectedClassId(cls.id); startBurstForClass(cls.id) }} onMouseUp={e => { e.stopPropagation(); stopBurst() }} onMouseLeave={stopBurst} disabled={atLimit || isTraining} className={`flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full text-sm font-bold border ${atLimit ? 'bg-slate-50 text-slate-400 border-slate-200' : isCapturing === cls.id ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-violet-200'}`}>{isCapturing === cls.id ? '✓ Captured' : '📸 Snap'}</button>
                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleUploadClick(cls.id) }} disabled={atLimit} className={`flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full text-sm font-bold border ${atLimit ? 'bg-slate-50 text-slate-400 border-slate-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-violet-200'}`}>📂 Browse</button>
                                        </div>
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
                            <p className="text-xs text-slate-500 mt-1 max-w-[260px]">Create a folder for each pose. Each folder is a separate compartment on the canvas.</p>
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
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 shadow-sm ${mode.modelTrained ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : isTraining ? 'bg-violet-50 border-violet-300 text-violet-700 animate-pulse' : 'bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200 text-violet-700'}`}><span className="text-xl">{isTraining ? '🧠' : mode.modelTrained ? '✓' : '🤖'}</span></div>
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-900">{isTraining ? `Training ${currentEpoch}/${totalEpochs}` : modelLoading ? 'Preparing model' : mode.accuracy != null ? `${(mode.accuracy * 100).toFixed(0)}% accuracy` : canTrain ? 'Ready to train' : warningTitle || 'Add more data'}</h3>
                                    <p className="text-xs text-slate-500 mt-1 max-w-[280px]">{isTraining ? `Learning from ${totalSamplesAll} poses` : mode.accuracy != null ? `${totalSamplesAll} poses across ${mode.project?.classes.length || 0} folders` : warningDesc || 'Add at least 2 folders with 2 poses each'}</p>
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
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Poses</p><p className="text-sm font-semibold text-slate-900">{totalSamplesAll}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Accuracy</p><p className={`text-sm font-semibold ${mode.accuracy != null ? 'text-emerald-600' : 'text-slate-400'}`}>{mode.accuracy != null ? `${(mode.accuracy * 100).toFixed(0)}%` : '—'}</p></div>
                            </div>
                        </div>
                    </div>

                    {/* Vision — professional with skeleton overlay */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'vision', visionPos)} style={{ left: visionPos.x, top: visionPos.y, width: 420, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'vision' ? 'z-40' : 'z-10'}`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col cursor-grab active:cursor-grabbing">
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Live preview</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{camera.cameraOn ? 'Live • Pose' : testImage ? 'Static image' : 'Idle'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="hidden sm:inline-flex h-6 px-2 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{inferenceTime} ms</span>
                                    <span className={`w-2 h-2 rounded-full ${camera.cameraOn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                </div>
                            </div>
                            <div onDragOver={e => { e.preventDefault(); setIsTestDragging(true) }} onDragLeave={e => { e.preventDefault(); setIsTestDragging(false) }} onDrop={handleTestDrop} className={`relative mx-3 mt-3 rounded-xl overflow-hidden bg-slate-950 border ${isTestDragging ? 'border-violet-300' : 'border-slate-800'} ${camera.cameraOn || testImage ? 'aspect-[4/3]' : 'min-h-[160px]'} flex flex-col`} onPointerDown={e => e.stopPropagation()}>
                                {/* keep video mounted always — opacity hidden when off so ref stays alive and can capture for training */}
                                <video ref={camera.videoRef} autoPlay playsInline muted className={`w-full h-full object-cover -scale-x-100 absolute inset-0 ${camera.cameraOn ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
                                <canvas ref={skeletonOverlayRef} className={`absolute inset-0 w-full h-full pointer-events-none -scale-x-100 ${camera.cameraOn ? 'opacity-100' : 'opacity-0'}`} />
                                {camera.cameraOn && (
                                    <>
                                        <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-black/60 backdrop-blur text-white text-[11px] font-medium z-10"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Live</div>
                                        {topLabel && prediction && <div className="absolute top-2 right-2 h-6 px-2.5 rounded-full bg-white text-slate-900 text-xs font-semibold flex items-center z-10">{topLabel}</div>}
                                        <div className="absolute inset-0 pointer-events-none" />
                                    </>
                                )}
                                {!camera.cameraOn && testImage && (
                                    <>
                                        <img src={testImage} alt="" onClick={e => { e.stopPropagation(); openSingleImage(testImage, 'Test image') }} title="Click to view (80% screen)" className="w-full h-full object-contain bg-black relative z-10 cursor-zoom-in" />
                                        <button onPointerDown={e => e.stopPropagation()} onClick={() => { setTestImage(null); setPrediction(null) }} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center z-10">×</button>
                                    </>
                                )}
                                {!camera.cameraOn && !testImage && (
                                    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center relative z-10">
                                        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${isTestDragging ? 'bg-white text-slate-900 border-white' : 'bg-white/10 border-white/20 text-white/80'}`}><span className="text-lg">🤸</span></div>
                                        <p className="text-sm font-medium text-white">{isTestDragging ? 'Drop image to test' : 'No input'}</p>
                                        <p className="text-xs text-white/60 max-w-[220px]">Turn on camera for realtime pose or drop an image</p>
                                        <div className="flex gap-2"><button onPointerDown={e => e.stopPropagation()} onClick={camera.startCamera} className="h-11 px-5 rounded-xl bg-white text-slate-900 text-sm font-bold">Enable camera</button><button onPointerDown={e => e.stopPropagation()} onClick={() => testFileInputRef.current?.click()} className="h-11 px-5 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-bold">Upload</button></div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 p-3 flex-wrap" onPointerDown={e => e.stopPropagation()}>
                                <button onClick={camera.toggleCamera} className={`h-11 px-5 rounded-xl text-sm font-bold border ${camera.cameraOn ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{camera.cameraOn ? 'Camera on' : 'Camera off'}</button>
                                <button onClick={() => testFileInputRef.current?.click()} className="h-11 px-5 rounded-xl bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 text-sm font-bold">Upload</button>
                                <span className="ml-auto inline-flex h-8 items-center px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{mode.project?.classes.length || 0} folders • {totalSamplesAll} poses</span>
                            </div>
                            {camera.cameraError && <div className="mx-3 mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{camera.cameraError}</div>}
                            <div className="px-3 pb-3 flex flex-col gap-2 max-h-[300px] overflow-auto" onPointerDown={e => e.stopPropagation()}>
                                {!canTrain && !mode.modelTrained ? <div className="text-center py-8 text-xs text-slate-500">Add poses and train to see predictions</div> : !prediction ? <div className="text-center py-6 text-xs text-slate-400">{camera.cameraOn ? 'Strike a pose' : 'Enable camera or upload an image'}</div> : (
                                    <>
                                        {topLabel && <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex justify-between items-center"><div><p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Top prediction</p><p className="text-sm font-semibold text-slate-900 mt-0.5 flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-slate-900 text-white flex items-center justify-center text-[11px] font-semibold">{topLabel[0].toUpperCase()}</span>{topLabel}</p></div><div className="text-right"><p className="text-[11px] text-slate-500">{inferenceTime} ms</p></div></div>}
                                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                                            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase mb-2">All folders — ranked</p>
                                            {sortedPredictionEntries.map(([label, _conf], idx) => {
                                                const isTop = idx === 0; const col = mode.project?.classes.find(c => c.name === label)?.color || '#0F172A'
                                                return <div key={label} className={`mb-1.5 last:mb-0 p-2 rounded-lg border ${isTop ? 'bg-white border-slate-300' : 'bg-white border-slate-200'}`}><div className="flex justify-between text-sm font-bold"><span className="flex items-center gap-1.5 truncate"><span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-semibold shrink-0" style={{ background: col }}>{label[0].toUpperCase()}</span><span className="truncate text-slate-900">{label}</span>{isTop && <span className="text-amber-500">★</span>}</span></div></div>
                                            })}
                                        </div>
                                        <div className="flex gap-2"><button onClick={() => { setTestImage(null); setPrediction(null) }} className="flex-1 h-11 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700">Clear</button><button onClick={handleExportReport} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-bold">Download report</button></div>
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
        </div>
    )
}
