import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import { useCamera } from '../../hooks/useCamera'
import { HandPoseClassifier } from '../../ml/classifiers/HandPoseClassifier'
import { MAX_SAMPLES_PER_CLASS } from '../../types/neura.types'
import { nudgeToNonColliding, layoutNonColliding, layoutInitialClasses } from '../../ui/layoutCollision'
import AccuracyChart from '../../ui/components/AccuracyChart'
import NotRelatedModal from '../../ui/components/NotRelatedModal'
import ConfirmModal from '../../ui/components/ConfirmModal'
import { classifyFingerCount } from '../../ml/utils/ruleBasedClassifiers'
import { openSingleImage } from '../../ui/components/neuraImageViewer'
import { RELATEDNESS_THRESHOLD } from '../../ml/KNNClassifier'

interface FingerCounterPanelProps {
    mode: UseNeuraProjectReturn
}

type CaptureStatus = 'idle' | 'loading-model' | 'detecting' | 'success' | 'no-hand' | 'error'

const FINGER_LABELS: Record<string, number> = {
    'One': 1, 'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5
}
const COUNT_COLORS: Record<number, string> = {
    1: '#10b981', 2: '#3b82f6', 3: '#8b5cf6', 4: '#f59e0b', 5: '#ef4444'
}

function createThumbnailFromCanvas(srcCanvas: HTMLCanvasElement, maxW = 160, maxH = 120, quality = 0.6): string {
    try {
        const w = srcCanvas.width, h = srcCanvas.height
        if (w === 0 || h === 0) return srcCanvas.toDataURL('image/jpeg', quality)
        const scale = Math.min(maxW / w, maxH / h, 1)
        if (scale >= 1) return srcCanvas.toDataURL('image/jpeg', quality)
        const tw = Math.round(w * scale), th = Math.round(h * scale)
        const c = document.createElement('canvas')
        c.width = tw; c.height = th
        const ctx = c.getContext('2d')!
        ctx.drawImage(srcCanvas, 0, 0, tw, th)
        return c.toDataURL('image/jpeg', quality)
    } catch { return '' }
}
async function createThumbnailFromDataUrl(dataUrl: string, maxW = 160, maxH = 120, quality = 0.6): Promise<string> {
    return new Promise(resolve => {
        const img = new Image()
        img.onload = () => {
            try {
                const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
                const tw = Math.round(img.naturalWidth * scale), th = Math.round(img.naturalHeight * scale)
                const c = document.createElement('canvas')
                c.width = tw; c.height = th
                const ctx = c.getContext('2d')!
                ctx.drawImage(img, 0, 0, tw, th)
                resolve(c.toDataURL('image/jpeg', quality))
            } catch { resolve(dataUrl) }
        }
        img.onerror = () => resolve(dataUrl)
        img.src = dataUrl
    })
}
function getSampleImageSrc(sample: { type: string; data: string }): string | null {
    if (!sample?.data) return null
    if (sample.data.startsWith('data:image')) return sample.data
    try {
        const parsed = JSON.parse(sample.data)
        if (parsed && typeof parsed === 'object' && typeof parsed.image === 'string' && parsed.image.startsWith('data:image')) return parsed.image
        if (parsed && typeof parsed.thumb === 'string' && parsed.thumb.startsWith('data:image')) return parsed.thumb
        if (parsed && typeof parsed.data === 'string' && parsed.data.startsWith('data:image')) return parsed.data
    } catch {}
    return null
}
function getSampleFullSrc(sample: { type: string; data: string }): string | null {
    if (!sample?.data) return null
    try {
        const parsed = JSON.parse(sample.data)
        if (parsed && typeof parsed === 'object') {
            if (typeof parsed.original === 'string' && parsed.original.startsWith('data:image')) return parsed.original
        }
    } catch {}
    return getSampleImageSrc(sample)
}

export default function FingerCounterPanel({ mode }: FingerCounterPanelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
    const classifierRef = useRef(new HandPoseClassifier())
    const animFrameRef = useRef<number>(0)
    const visionAnimRef = useRef<number>(0)
    const isPredictingRef = useRef(false)
    const testCameraStartedRef = useRef(false)
    const lastDetectTimeRef = useRef(0)
    const lastPredictTimeRef = useRef(0)
    const audioContextRef = useRef<AudioContext | null>(null)
    const lastSoundCountRef = useRef(0)

    const [isCapturing, setIsCapturing] = useState<string | null>(null)
    const [captureFps] = useState(15)
    const burstIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const handleCaptureRef = useRef<(() => Promise<void>) | null>(null)
    const [prediction, setPrediction] = useState<{ label: string; confidences: Record<string, number> } | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [handDetected, setHandDetected] = useState(false)
    const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle')
    const [inferenceTime, setInferenceTime] = useState(0)
    const [savedMessage, setSavedMessage] = useState<string | null>(null)
    const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [currentCount, setCurrentCount] = useState(0)
    const [countHistory, setCountHistory] = useState<number[]>([])
    const [confidenceThreshold, setConfidenceThreshold] = useState(0.5)
    const [testImage, setTestImage] = useState<string | null>(null)
    const [autoPredict, setAutoPredict] = useState(true)
    const testFileInputRef = useRef<HTMLInputElement>(null)
    const collectFileInputRef = useRef<HTMLInputElement>(null)
    const [fingerFlags, setFingerFlags] = useState<number[]>([0, 0, 0, 0, 0])

    // Infinite canvas state — like HandPoseClassifier
    const viewportRef = useRef<HTMLDivElement>(null)
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 32, y: 24 })
    const isWheelOverDatasetPanel = useCallback((target: EventTarget | null) => {
        const el = target as HTMLElement | null
        if (!el) return false
        const datasetEl = el.closest('[data-dataset-panel]') as HTMLElement | null
        if (!datasetEl) return false
        return datasetEl.scrollHeight > datasetEl.clientHeight
    }, [])
    const [isPanning, setIsPanning] = useState(false)
    const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
    const pinchRef = useRef<{ startDist: number; startZoom: number; startPan: { x: number; y: number }; center: { x: number; y: number } } | null>(null)
    const [classPositions, setClassPositions] = useState<Record<string, { x: number; y: number }>>({})
    const [brainPos, setBrainPos] = useState({ x: 920, y: 160 })
    const [visionPos, setVisionPos] = useState({ x: 1440, y: 140 })
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const dragStartRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({})
    const [uploadingByClass, setUploadingByClass] = useState<Record<string, number>>({})
    const [confirmState, setConfirmState] = useState<{ title: string; message: string; confirmText: string; variant: 'danger' | 'primary' | 'warning'; icon?: string; onConfirm: () => void } | null>(null)
    const [showNotRelated, setShowNotRelated] = useState(false)
    const [isTraining, setIsTraining] = useState(false)
    const [trainingError, setTrainingError] = useState<string | null>(null)
    const [totalEpochs, setTotalEpochs] = useState(50)
    const [currentEpoch, setCurrentEpoch] = useState(0)
    const [epochResults, setEpochResults] = useState<number[]>([])
    const [showAddClass, setShowAddClass] = useState(false)
    const [newClassName, setNewClassName] = useState('')
    const [editingClassId, setEditingClassId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [dragOverClass, setDragOverClass] = useState<string | null>(null)
    const [isTestDragging, setIsTestDragging] = useState(false)
    const [modelLoading, setModelLoading] = useState(false)
    const [augmentMode, setAugmentMode] = useState(true)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const pendingUploadClassRef = useRef<string | null>(null)
    const removeDebounceRef = useRef<NodeJS.Timeout | null>(null)
    const rebuildAbortRef = useRef(0)
    const consecutiveFailuresRef = useRef(0)
    const notRelatedCooldownRef = useRef(0)

    const showSaved = useCallback((msg: string) => {
        setSavedMessage(msg)
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        savedTimeoutRef.current = setTimeout(() => setSavedMessage(null), 2000)
    }, [])

    const playCountSound = useCallback((count: number) => {
        try {
            if (!audioContextRef.current) audioContextRef.current = new AudioContext()
            const ctx = audioContextRef.current
            const frequencies: Record<number, number> = { 1: 261.63, 2: 329.63, 3: 392.00, 4: 523.25, 5: 659.25 }
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.value = frequencies[count] || 440
            gain.gain.setValueAtTime(0.3, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
            osc.connect(gain); gain.connect(ctx.destination)
            osc.start(); osc.stop(ctx.currentTime + 0.3)
        } catch {}
    }, [])

    const camera = useCamera({
        videoConstraints: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
        onStreamAcquired: () => {
            if (overlayCanvasRef.current) classifierRef.current.attachWebGLHandlers(overlayCanvasRef.current)
        }
    })

    const handleStopCamera = useCallback(() => {
        camera.stopCamera()
        setHandDetected(false)
        setPrediction(null)
        setCurrentCount(0)
    }, [camera])

    useEffect(() => { mode.setHideSidebar(true); return () => mode.setHideSidebar(false) }, [])

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
        if (!mode.project?.id) return
        setExpandedClasses({}); setZoom(1); setPan({ x: 32, y: 24 }); setIsCapturing(null); setDragOverClass(null); setIsTestDragging(false); setIsTraining(false); setTrainingError(null); setPrediction(null); setIsProcessing(false); setHandDetected(false); setInferenceTime(0); setSavedMessage(null); setCurrentCount(0); setCountHistory([]); setTestImage(null); setFingerFlags([0,0,0,0,0]); if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        classifierRef.current.clear()
        if (burstIntervalRef.current) { clearInterval(burstIntervalRef.current); burstIntervalRef.current=null }
        if (overlayCanvasRef.current) { const ctx=overlayCanvasRef.current.getContext('2d'); ctx?.clearRect(0,0,overlayCanvasRef.current.width,overlayCanvasRef.current.height) }
        if (canvasRef.current) { const ctx=canvasRef.current.getContext('2d'); ctx?.clearRect(0,0,canvasRef.current.width,canvasRef.current.height) }
        setTimeout(()=>{ setClassPositions(prev=>{ const ids=mode.project!.classes.map(c=>c.id); const laid=layoutInitialClasses(ids,prev); const {brainPos:nb,visionPos:nv}=layoutNonColliding(laid,brainPos,visionPos,{expandedClasses:{}}); setBrainPos(nb); setVisionPos(nv); return laid }) },0)
    }, [mode.project?.id])

    // Helper to extract keypoints Float32Array from FingerCounter's enriched JSON or legacy array
    const extractKeypointsArray = useCallback((dataStr: string): Float32Array | null => {
        try {
            const parsed = JSON.parse(dataStr)
            if (Array.isArray(parsed)) return new Float32Array(parsed)
            if (parsed && Array.isArray(parsed.keypoints)) return new Float32Array(parsed.keypoints)
            if (parsed && typeof parsed === 'object' && parsed.keypoints) return new Float32Array(parsed.keypoints)
        } catch {}
        return null
    }, [])

    useEffect(() => {
        if (!mode.project) return
        const thisBuild = ++rebuildAbortRef.current
        let cancelled=false; setModelLoading(true)
        const rebuild=async()=>{
            classifierRef.current.clear()
            for(const cls of mode.project!.classes){
                if(thisBuild!==rebuildAbortRef.current) return
                if(cls.samples.length===0) continue
                // FingerCounter stores {thumb, original, keypoints} — extract keypoints array
                for (const s of cls.samples) {
                    if(thisBuild!==rebuildAbortRef.current) return
                    const features = extractKeypointsArray(s.data)
                    if (!features) continue
                    try {
                        if (augmentMode) await classifierRef.current.addSampleAugmented(features, cls.name)
                        else await classifierRef.current.addSample(features, cls.name)
                    } catch {}
                }
            }
            if(!cancelled && thisBuild===rebuildAbortRef.current) setModelLoading(false)
        }
        rebuild().catch(()=>{ if(!cancelled && thisBuild===rebuildAbortRef.current) setModelLoading(false) })
        return()=>{cancelled=true}
    }, [mode.project?.id, augmentMode, extractKeypointsArray])

    const handleRename = (id: string, name: string) => {
        const old = mode.project?.classes.find(c=>c.id===id); if(!old) return
        const trimmed=name.trim(); if(!trimmed||trimmed===old.name){setEditingClassId(null);return}
        mode.renameClass(id, trimmed)
        setTimeout(async()=>{
            const updated=mode.project?.classes.find(c=>c.id===id);
            if(updated){
                classifierRef.current.clearClass(old.name);
                if(updated.samples.length>0){
                    for (const s of updated.samples) {
                        const f = extractKeypointsArray(s.data)
                        if (!f) continue
                        try { if (augmentMode) await classifierRef.current.addSampleAugmented(f, trimmed); else await classifierRef.current.addSample(f, trimmed)} catch{}
                    }
                }
            }
        },50)
        setEditingClassId(null)
    }

    useEffect(() => {
        if (mode.mode !== 'collect' && mode.mode !== 'test') handleStopCamera()
    }, [mode.mode, handleStopCamera])
    useEffect(()=>{ if(mode.mode!=='test') testCameraStartedRef.current=false },[mode.mode])

    // Live hand detection for overlay
    useEffect(() => {
        if (mode.mode !== 'collect' || !camera.stream) return
        const detectLoop = async () => {
            if (isPredictingRef.current) return
            if (camera.videoRef.current && overlayCanvasRef.current) {
                isPredictingRef.current=true
                try{
                    const canvas=overlayCanvasRef.current; const ctx=canvas.getContext('2d')
                    if(ctx){
                        canvas.width=camera.videoRef.current.videoWidth||640
                        canvas.height=camera.videoRef.current.videoHeight||480
                        ctx.clearRect(0,0,canvas.width,canvas.height)
                        const keypoints=await classifierRef.current.detectHand(camera.videoRef.current)
                        if(keypoints.length>0){ setHandDetected(true); classifierRef.current.drawHand(canvas,keypoints,undefined,{readableLabels:true}) }
                        else setHandDetected(false)
                    }
                }catch{}
                isPredictingRef.current=false
            }
        }
        lastDetectTimeRef.current=performance.now()
        const tick=()=>{
            const now=performance.now()
            if(now-lastDetectTimeRef.current>=33){ lastDetectTimeRef.current=now; detectLoop() }
            animFrameRef.current=requestAnimationFrame(tick)
        }
        animFrameRef.current=requestAnimationFrame(tick)
        return()=>cancelAnimationFrame(animFrameRef.current)
    }, [mode.mode, camera.stream])

    // Test mode prediction
    useEffect(() => {
        if (mode.mode !== 'test' || testImage) return
        const runPrediction = async () => {
            if (isPredictingRef.current) return
            if (camera.streamStateRef.current && camera.videoRef.current && canvasRef.current) {
                isPredictingRef.current=true; setIsProcessing(true)
                try{
                    const start=performance.now()
                    const ctx=canvasRef.current.getContext('2d')
                    if(ctx){
                        canvasRef.current.width=640; canvasRef.current.height=480
                        ctx.drawImage(camera.videoRef.current,0,0,640,480)
                        const keypoints=await classifierRef.current.detectHand(canvasRef.current)
                        if(keypoints && keypoints.length>0){
                            const features=classifierRef.current.extractFeatures(keypoints)
                            setFingerFlags([features[67],features[63],features[64],features[65],features[66]])
                            const result=classifyFingerCount(features)
                            const elapsed=Math.round(performance.now()-start)
                            setInferenceTime(elapsed)
                            const predConfidence=result.confidence
                            if(predConfidence < confidenceThreshold){ setPrediction(null); setHandDetected(false); setCurrentCount(0) }
                            else{ setPrediction({label:result.label, confidences:{[result.label]:result.confidence}}); setHandDetected(true); const count=FINGER_LABELS[result.label]||0; setCurrentCount(count); setCountHistory(prev=>[...prev.slice(-19),count]); if(lastSoundCountRef.current!==count){playCountSound(count); lastSoundCountRef.current=count} if(overlayCanvasRef.current){ overlayCanvasRef.current.width=camera.videoRef.current.videoWidth||640; overlayCanvasRef.current.height=camera.videoRef.current.videoHeight||480; classifierRef.current.drawHand(overlayCanvasRef.current,keypoints,undefined,{readableLabels:true}) } }
                        }else{ setPrediction(null); setHandDetected(false); setCurrentCount(0); lastSoundCountRef.current=0 }
                    }
                }catch{} setIsProcessing(false); isPredictingRef.current=false
            }
        }
        lastPredictTimeRef.current=performance.now()
        const tick=()=>{
            if(!autoPredict){ animFrameRef.current=requestAnimationFrame(tick); return }
            const now=performance.now()
            if(now-lastPredictTimeRef.current>=100){ lastPredictTimeRef.current=now; runPrediction() }
            animFrameRef.current=requestAnimationFrame(tick)
        }
        animFrameRef.current=requestAnimationFrame(tick)
        return()=>cancelAnimationFrame(animFrameRef.current)
    }, [mode.mode, camera.stream, playCountSound, autoPredict, confidenceThreshold])

    const manualPredict = useCallback(async()=>{
        if(isPredictingRef.current) return
        let elementToDetect: HTMLVideoElement|HTMLImageElement|null=null
        let width=640,height=480
        if(testImage){
            const img=new Image(); img.src=testImage
            await new Promise<void>(r=>{img.onload=()=>r(); img.onerror=()=>r()})
            if(img.complete&&img.naturalWidth>0){ elementToDetect=img; width=img.naturalWidth; height=img.naturalHeight }
        }else if(camera.streamStateRef.current && camera.videoRef.current){ elementToDetect=camera.videoRef.current; width=camera.videoRef.current.videoWidth||640; height=camera.videoRef.current.videoHeight||480 }
        if(!elementToDetect||!canvasRef.current) return
        isPredictingRef.current=true; setIsProcessing(true)
        try{
            const start=performance.now()
            const ctx=canvasRef.current.getContext('2d')
            if(ctx){
                canvasRef.current.width=width; canvasRef.current.height=height
                ctx.drawImage(elementToDetect as any,0,0,width,height)
                const keypoints=await classifierRef.current.detectHand(canvasRef.current)
                if(keypoints && keypoints.length>0){
                    const features=classifierRef.current.extractFeatures(keypoints)
                    setFingerFlags([features[67],features[63],features[64],features[65],features[66]])
                    const result=classifyFingerCount(features)
                    const elapsed=Math.round(performance.now()-start)
                    setInferenceTime(elapsed)
                    if(result.confidence < confidenceThreshold){ setPrediction(null); setHandDetected(false); setCurrentCount(0); showSaved('⚠️ Confidence below threshold!') }
                    else{ setPrediction({label:result.label,confidences:{[result.label]:result.confidence}}); setHandDetected(true); const count=FINGER_LABELS[result.label]||0; setCurrentCount(count); setCountHistory(prev=>[...prev.slice(-19),count]); if(lastSoundCountRef.current!==count){playCountSound(count); lastSoundCountRef.current=count} if(overlayCanvasRef.current){ overlayCanvasRef.current.width=width; overlayCanvasRef.current.height=height; classifierRef.current.drawHand(overlayCanvasRef.current,keypoints,undefined,{readableLabels:true}) } }
                }else{ setPrediction(null); setHandDetected(false); setCurrentCount(0); lastSoundCountRef.current=0; showSaved('⚠️ No hand detected!') }
            }
        }catch{} setIsProcessing(false); isPredictingRef.current=false
    },[testImage,confidenceThreshold,playCountSound,showSaved])

    const handleTestUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file=e.target.files?.[0]
        if(!file||!file.type.startsWith('image/')) return
        const dataUrl=await new Promise<string>(r=>{ const reader=new FileReader(); reader.onload=()=>r(reader.result as string); reader.readAsDataURL(file) })
        setTestImage(dataUrl); camera.stopCamera()
        setTimeout(()=>{ const img=new Image(); img.src=dataUrl; img.onload=async()=>{ setIsProcessing(true); try{ const start=performance.now(); if(canvasRef.current){ const w=img.naturalWidth||640,h=img.naturalHeight||480; canvasRef.current.width=w; canvasRef.current.height=h; const ctx=canvasRef.current.getContext('2d'); if(ctx){ ctx.drawImage(img,0,0,w,h); const kp=await classifierRef.current.detectHand(canvasRef.current); if(kp&&kp.length>0){ const f=classifierRef.current.extractFeatures(kp); setFingerFlags([f[67],f[63],f[64],f[65],f[66]]); const res=classifyFingerCount(f); const elapsed=Math.round(performance.now()-start); setInferenceTime(elapsed); if(res.confidence < confidenceThreshold){ setPrediction(null); setHandDetected(false); setCurrentCount(0); showSaved('⚠️ Confidence below threshold!') } else{ setPrediction({label:res.label,confidences:{[res.label]:res.confidence}}); setHandDetected(true); const c=FINGER_LABELS[res.label]||0; setCurrentCount(c); if(overlayCanvasRef.current){ overlayCanvasRef.current.width=w; overlayCanvasRef.current.height=h; classifierRef.current.drawHand(overlayCanvasRef.current,kp,undefined,{readableLabels:true}) } } }else{ setPrediction(null); setHandDetected(false); setCurrentCount(0); showSaved('⚠️ No hand detected.') } } } }catch{ showSaved('⚠️ Failed.') } setIsProcessing(false) } },100)
    },[confidenceThreshold,showSaved])

    // ——— Per-class capture with auto camera start (parity with HandPoseClassifier) ———
    const handleCaptureForClass = useCallback(async (classId: string) => {
        if (!camera.cameraOn) {
            showSaved('Starting camera…')
            try { await camera.startCamera() } catch (e) { console.warn('[FingerCounter] Camera start failed', e) }
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
            else showSaved('Camera not ready — check permissions')
            return
        }
        if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
            try { await video.play().catch(() => {}) } catch {}
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 100))
                if (video.videoWidth && video.readyState >= 2) break
            }
            if (!video.videoWidth || video.readyState < 2) { showSaved('Camera warming up… try again'); return }
        }
        const cls = mode.project?.classes.find(c => c.id === classId)
        if (cls && cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 per folder'); return }
        setIsCapturing(classId); setCaptureStatus('detecting')
        try {
            const tempCanvas = document.createElement('canvas'); tempCanvas.width = video.videoWidth || 640; tempCanvas.height = video.videoHeight || 480
            const ctx = tempCanvas.getContext('2d')!; ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height)
            const keypoints = await classifierRef.current.detectHand(tempCanvas)
            if (keypoints && keypoints.length > 0) {
                const features = classifierRef.current.extractFeatures(keypoints)
                const thumb = createThumbnailFromCanvas(tempCanvas, 160, 120, 0.6)
                const full = tempCanvas.toDataURL('image/jpeg', 0.85)
                const enriched = JSON.stringify({ thumb, original: full, image: thumb, keypoints: Array.from(features) })
                const added = mode.addSample(classId, { type: 'image', data: enriched } as any)
                let finalAdded = added
                if (!added) { const payload = JSON.stringify({ image: thumb, thumb, original: full, keypoints: Array.from(features) }); finalAdded=mode.addSample(classId,{type:'keypoints', data:payload} as any) }
                if (!finalAdded) { showSaved('Folder full (20 max)'); setCaptureStatus('idle'); setIsCapturing(null); return }
                const targetName = cls?.name || mode.project?.classes.find(c=>c.id===classId)?.name || ''
                if (augmentMode) classifierRef.current.addSampleAugmented(features, targetName).catch(e=>console.warn('[FingerCounter][capture] embedding failed', e))
                else classifierRef.current.addSample(features, targetName).catch(()=>{})
                setCaptureStatus('success'); showSaved(`📸 Captured for ${cls?.name || 'folder'} ✓`)
            } else { setCaptureStatus('no-hand'); showSaved('No hand detected — show your hand clearly') }
        } catch (err) { console.warn('[capture] failed', err); showSaved('Capture failed — see console') } finally { setIsCapturing(null); setTimeout(()=>setCaptureStatus('idle'), 1200) }
    }, [camera, mode, showSaved, augmentMode])

    const handleCapture = useCallback(async () => {
        if (!mode.selectedClassId) {
            if (mode.project && mode.project.classes.length>0) mode.setSelectedClassId(mode.project.classes[0].id)
            else { showSaved('Create a gesture first!'); return }
        }
        const target = mode.selectedClassId || mode.project?.classes[0]?.id
        if (!target) return
        await handleCaptureForClass(target)
    }, [mode, handleCaptureForClass, showSaved])

    handleCaptureRef.current = handleCapture
    const startBurstCapture = useCallback(()=>{ if(!mode.selectedClassId||!camera.cameraOn) return; burstIntervalRef.current=setInterval(()=>{ handleCaptureRef.current?.() },1000/captureFps)},[captureFps,mode.selectedClassId,camera.cameraOn])
    const stopBurstCapture = useCallback(()=>{ if(burstIntervalRef.current){ clearInterval(burstIntervalRef.current); burstIntervalRef.current=null }},[])
    useEffect(()=>()=>{ stopBurstCapture() },[stopBurstCapture])

    // ——— Per-class multi-file upload with hand detection + thumbnail + enriched storage (HandPose parity) ———
    const processFilesForClass = useCallback(async (files: FileList | File[], classId: string) => {
        const cls = mode.project?.classes.find(c=>c.id===classId); if(!cls) return
        if (cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 per folder'); return }
        let added=0; let noHand=0
        const list = Array.from(files as any) as File[]
        const imageFiles = list.filter(f=>{ if(f.type && f.type.startsWith('image/')) return true; return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(f.name) })
        if (imageFiles.length===0){ showSaved('No images found'); return }
        const remaining = MAX_SAMPLES_PER_CLASS - cls.samples.length
        const toProcess = imageFiles.slice(0, remaining)
        if (imageFiles.length>remaining) showSaved(`Only ${remaining} of ${imageFiles.length} will be added (20 max per folder)`)
        if (toProcess.length===0) return
        setUploadingByClass(prev=>({...prev, [classId]: (prev[classId]||0)+toProcess.length}))
        const decrementLoader = ()=> setUploadingByClass(prev=>{ const cur=(prev[classId]||0)-1; if(cur<=0){ const{[classId]:_,...rest}=prev as any; return rest } return {...prev, [classId]:cur }})
        for (let i=0;i<toProcess.length;i++){
            const file=toProcess[i]
            const cur=mode.project?.classes.find(c=>c.id===classId)
            if (cur && cur.samples.length>=MAX_SAMPLES_PER_CLASS){ showSaved(`Limit reached for ${cls.name}`); decrementLoader(); break }
            try{
                const dataUrl = await new Promise<string>(resolve=>{
                    const r=new FileReader(); r.onload=()=>resolve(r.result as string); r.onerror=()=>{ console.warn('[FingerCounter] FileReader error for',file.name,r.error); resolve('') }
                    try{ r.readAsDataURL(file)}catch(e){ console.warn(e); resolve('')}
                })
                if(!dataUrl||dataUrl.length<100){ noHand++; decrementLoader(); continue }
                const img=new Image(); img.src=dataUrl
                await new Promise<void>(r=>{ img.onload=()=>r(); img.onerror=()=>r(); setTimeout(()=>r(),3000)})
                if(!img.complete||img.naturalWidth===0){ noHand++; decrementLoader(); continue }
                setIsCapturing(classId); setCaptureStatus('detecting')
                try{
                    const tempCanvas=document.createElement('canvas'); tempCanvas.width=img.naturalWidth; tempCanvas.height=img.naturalHeight
                    const ctx=tempCanvas.getContext('2d')!; ctx.drawImage(img,0,0)
                    const keypoints=await classifierRef.current.detectHand(tempCanvas)
                    if(keypoints && keypoints.length>0){
                        const features=classifierRef.current.extractFeatures(keypoints)
                        const thumb=await createThumbnailFromDataUrl(dataUrl,160,120,0.6)
                        const enriched=JSON.stringify({thumb, original:dataUrl, image:thumb, keypoints:Array.from(features)})
                        const addedOk=mode.addSample(classId,{type:'image', data:enriched} as any)
                        let finalAdded=addedOk
                        if(!finalAdded){ const payload=JSON.stringify({image:thumb, thumb, original:dataUrl, keypoints:Array.from(features)}); finalAdded=mode.addSample(classId,{type:'keypoints', data:payload} as any)}
                        if(!finalAdded){ showSaved(`Limit reached for ${cls.name}`); decrementLoader(); break }
                        const targetName=mode.project?.classes.find(c=>c.id===classId)?.name || cls.name
                        try{ if(augmentMode) await classifierRef.current.addSampleAugmented(features, targetName); else await classifierRef.current.addSample(features, targetName)}catch(e){ console.warn('[FingerCounter] classifier addSample failed', e)}
                        added++; decrementLoader(); setCaptureStatus('success')
                    }else{ noHand++; decrementLoader(); setCaptureStatus('no-hand')}
                }catch(e){ console.warn('[FingerCounter] upload detect failed',e); noHand++; decrementLoader(); setCaptureStatus('error')}
                finally{ setIsCapturing(null); setTimeout(()=>setCaptureStatus('idle'),400) }
            }catch(e){ console.warn('[FingerCounter] process file failed',file.name,e); noHand++; decrementLoader()}
        }
        setUploadingByClass(prev=>{ const{[classId]:_,...rest}=prev as any; return rest })
        if(added>0) showSaved(`Added ${added} gesture${added>1?'s':''} to ${cls.name} ✓`)
        if(noHand>0) showSaved(`No hand in ${noHand} image(s)`)
    }, [mode, showSaved, augmentMode])

    const handleCollectUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files=e.target.files
        if(!files||files.length===0) return
        const targetId = mode.selectedClassId || mode.project?.classes[0]?.id
        if(!targetId){ showSaved('Create a class first!'); if(collectFileInputRef.current) collectFileInputRef.current.value=''; return }
        await processFilesForClass(files, targetId)
        if(collectFileInputRef.current) collectFileInputRef.current.value=''
    }, [mode, showSaved, processFilesForClass])

    const handleUploadClick = useCallback((classId: string) => {
        mode.setSelectedClassId(classId)
        pendingUploadClassRef.current=classId
        if(fileInputRef.current){ try{ (fileInputRef.current as any).dataset.targetClassId=classId }catch{}}
        // also keep collect input for legacy callers
        fileInputRef.current?.click()
    }, [mode])

    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files=e.target.files
        const attrTarget=(e.currentTarget as any)?.dataset?.targetClassId as string|undefined
        const targetId=attrTarget || pendingUploadClassRef.current || mode.selectedClassId || mode.project?.classes[0]?.id
        if(!files||files.length===0){ if(fileInputRef.current) try{ delete (fileInputRef.current as any).dataset.targetClassId }catch{}; return }
        if(!targetId){ showSaved('Create a folder first'); return }
        await processFilesForClass(files, targetId)
        if(fileInputRef.current){ fileInputRef.current.value=''; try{ delete (fileInputRef.current as any).dataset.targetClassId }catch{} }
        pendingUploadClassRef.current=null
    }, [mode, showSaved, processFilesForClass])

    // Paste images from clipboard (Ctrl+V) — parity with HandPoseClassifier
    useEffect(()=>{
        const extractImagesFromClipboard = async (e: ClipboardEvent): Promise<File[]>=>{
            const out: File[]=[]
            const items=e.clipboardData?.items
            if(items){
                for(let i=0;i<items.length;i++){
                    const it=items[i]
                    if(it.kind==='file'){
                        const f=it.getAsFile()
                        if(f && (f.type.startsWith('image/')|| /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(f.name))){ if(out.length>=20) break; out.push(f) }
                    }else if(it.type==='text/html'){
                        const html=await new Promise<string>(res=>it.getAsString(s=>res(s||'')))
                        const matches=[...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
                        for(const match of matches){
                            if(out.length>=20) break
                            const src=match[1]
                            try{
                                if(src.startsWith('data:image')){ const res=await fetch(src); const blob=await res.blob(); out.push(new File([blob],'pasted.png',{type:blob.type||'image/png'}))}
                                else if(src.startsWith('http')){ const res=await fetch(src,{mode:'cors'}).catch(()=>null); if(res&&res.ok){ const blob=await res.blob(); out.push(new File([blob],'pasted.png',{type:blob.type}))}}
                            }catch{}
                        }
                    }else if(it.type==='text/plain'){
                        const text=await new Promise<string>(res=>it.getAsString(s=>res(s||'')))
                        const t=text.trim()
                        if(t.startsWith('data:image')&&t.length>100){ try{ const res=await fetch(t); const blob=await res.blob(); if(out.length<20) out.push(new File([blob],'pasted.png',{type:blob.type}))}catch{}}
                    }
                    if(out.length>=20) break
                }
            }
            if(out.length===0 && e.clipboardData?.files?.length){
                for(let i=0;i<e.clipboardData.files.length;i++){ if(out.length>=20) break; const f=e.clipboardData.files[i]; if(f.type.startsWith('image/')|| /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(f.name)) out.push(f) }
            }
            return out.slice(0,20)
        }
        const handlePaste = async (e: ClipboardEvent)=>{
            const active=document.activeElement as HTMLElement|null
            if(active && (active.tagName==='INPUT'||active.tagName==='TEXTAREA'||active.isContentEditable)) return
            const imageFiles=await extractImagesFromClipboard(e)
            if(imageFiles.length===0) return
            e.preventDefault()
            const targetId=mode.selectedClassId || mode.project?.classes[0]?.id
            if(!targetId){ showSaved('Create a folder first, then paste (Ctrl+V)'); return }
            await processFilesForClass(imageFiles, targetId)
        }
        window.addEventListener('paste', handlePaste as any)
        return()=>window.removeEventListener('paste', handlePaste as any)
    }, [mode.selectedClassId, mode.project?.classes, processFilesForClass, showSaved])

    const handleRemoveSample = useCallback((classId: string, sampleId: string) => {
        mode.removeSample(classId, sampleId)
        if (removeDebounceRef.current) clearTimeout(removeDebounceRef.current)
        removeDebounceRef.current=setTimeout(async()=>{
            const c=mode.project?.classes.find(x=>x.id===classId); if(!c) return
            const current=mode.project?.classes.find(x=>x.id===classId)
            const datas=(current?.samples||[]).map(s=>s.data)
            classifierRef.current.clearClass(c.name)
            for(const d of datas){
                const f=extractKeypointsArray(d); if(!f) continue
                try{ await classifierRef.current.addSample(f,c.name)}catch{}
            }
        },300)
        showSaved('🗑️ Sample removed')
    }, [mode, showSaved, extractKeypointsArray])

    const handleRemoveSampleWithConfirm = useCallback((classId: string, sampleId: string) => {
        setConfirmState({ title:'Delete this image?', message:'This sample will be permanently removed.', confirmText:'Delete', variant:'danger', icon:'🗑️', onConfirm:()=>{ handleRemoveSample(classId,sampleId); setConfirmState(null) }})
    }, [handleRemoveSample])

    const canTrain = !!(mode.project && mode.project.classes.length >= 2 && mode.project.classes.every(c => c.samples.length >= 2))
    const selectedClass = mode.getSelectedClass()
    const totalSamplesAll = mode.getTotalSamples()

    // Infinite canvas helpers
    const getCanvasPoint = (clientX:number, clientY:number)=>{ const r=viewportRef.current?.getBoundingClientRect(); if(!r) return {x:0,y:0}; return {x:(clientX-r.left-pan.x)/zoom, y:(clientY-r.top-pan.y)/zoom} }
    const handleViewportMouseDown=(e:React.MouseEvent)=>{ if((e.target as HTMLElement).closest('[data-node]'))return; setIsPanning(true); panStartRef.current={x:e.clientX,y:e.clientY,panX:pan.x,panY:pan.y} }
    const handleViewportMouseMove=(e:React.MouseEvent)=>{
        if(isPanning && panStartRef.current){ const dx=e.clientX-panStartRef.current.x, dy=e.clientY-panStartRef.current.y; setPan({x:panStartRef.current.panX+dx, y:panStartRef.current.panY+dy}) }
        if(draggingId && dragStartRef.current){
            const cur=getCanvasPoint(e.clientX,e.clientY); const s=dragStartRef.current; const nx=s.origX+(cur.x-s.startX), ny=s.origY+(cur.y-s.startY)
            if(s.id==='brain'){ const cand=nudgeToNonColliding('brain',{x:nx,y:ny},classPositions,brainPos,visionPos,{expandedClasses,fallback:brainPos} as any); if(cand!==brainPos) setBrainPos(cand)}
            else if(s.id==='vision'){ const cand=nudgeToNonColliding('vision',{x:nx,y:ny},classPositions,brainPos,visionPos,{expandedClasses,fallback:visionPos} as any); if(cand!==visionPos) setVisionPos(cand)}
            else{ const fb=classPositions[s.id]??{x:nx,y:ny}; const cand=nudgeToNonColliding(s.id,{x:nx,y:ny},classPositions,brainPos,visionPos,{expandedClasses,fallback:fb} as any); if(cand!==fb) setClassPositions(prev=>{ const cur=prev[s.id]; if(cur&&cand.x===cur.x&&cand.y===cur.y) return prev; return {...prev,[s.id]:cand}}) }
        }
    }
    const handleViewportMouseUp=()=>{ setIsPanning(false); panStartRef.current=null; if(draggingId) setDraggingId(null) }
    // Wheel/pinch handled via native passive:false listener below to avoid React passive warning.
    // This React handler only updates canvas zoom; preventDefault is handled by native listener.
    const handleWheel=(e:React.WheelEvent)=>{
        if(isWheelOverDatasetPanel(e.target)){ e.stopPropagation(); return }
        e.stopPropagation()
        const isPinch=e.ctrlKey||(e as any).ctrlKey
        const delta=-e.deltaY*(isPinch?0.008:0.0012)
        const newZoom=Math.min(1.4,Math.max(0.6,zoom+delta))
        const rect=viewportRef.current?.getBoundingClientRect()
        if(rect){ const mx=e.clientX-rect.left, my=e.clientY-rect.top; const wx=(mx-pan.x)/zoom, wy=(my-pan.y)/zoom; const nx=mx-wx*newZoom, ny=my-wy*newZoom; setPan({x:nx,y:ny}) }
        setZoom(newZoom)
    }
    const handleTouchStart=(e:React.TouchEvent)=>{ if(e.touches.length===2){ const dx=e.touches[0].clientX-e.touches[1].clientX; const dy=e.touches[0].clientY-e.touches[1].clientY; const dist=Math.hypot(dx,dy); const cx=(e.touches[0].clientX+e.touches[1].clientX)/2, cy=(e.touches[0].clientY+e.touches[1].clientY)/2; pinchRef.current={startDist:dist,startZoom:zoom,startPan:{...pan},center:{x:cx,y:cy}} } }
    const handleTouchMove=(e:React.TouchEvent)=>{ if(e.touches.length===2&&pinchRef.current){ const dx=e.touches[0].clientX-e.touches[1].clientX; const dy=e.touches[0].clientY-e.touches[1].clientY; const dist=Math.hypot(dx,dy); const scale=dist/pinchRef.current.startDist; const newZoom=Math.min(1.4,Math.max(0.6,pinchRef.current.startZoom*scale)); const rect=viewportRef.current?.getBoundingClientRect(); if(rect){ const mx=pinchRef.current.center.x-rect.left; const my=pinchRef.current.center.y-rect.top; const wx=(mx-pinchRef.current.startPan.x)/pinchRef.current.startZoom; const wy=(my-pinchRef.current.startPan.y)/pinchRef.current.startZoom; const nx=mx-wx*newZoom, ny=my-wy*newZoom; setPan({x:nx,y:ny}) } setZoom(newZoom) } }
    const handleTouchEnd=()=>{ if(pinchRef.current) pinchRef.current=null }
    const startNodeDrag=(e:React.PointerEvent|React.MouseEvent,id:string,orig:{x:number,y:number})=>{ e.stopPropagation(); if('preventDefault' in e) (e as any).preventDefault?.(); const p=getCanvasPoint((e as any).clientX,(e as any).clientY); dragStartRef.current={id,startX:p.x,startY:p.y,origX:orig.x,origY:orig.y}; setDraggingId(id); if('pointerId' in e && typeof (e as any).pointerId==='number'){ try{(e.target as HTMLElement).setPointerCapture?.((e as any).pointerId)}catch{}} }
    const zoomIn=()=>setZoom(z=>Math.min(1.4,+(z+0.1).toFixed(2)))
    const zoomOut=()=>setZoom(z=>Math.max(0.6,+(z-0.1).toFixed(2)))
    const resetView=()=>{ setZoom(1); setPan({x:32,y:24}) }
    useEffect(()=>{
        const onMove=(e:MouseEvent|PointerEvent)=>{
            const cx=(e as any).clientX, cy=(e as any).clientY
            if(isPanning && panStartRef.current){ const dx=cx-panStartRef.current.x, dy=cy-panStartRef.current.y; setPan({x:panStartRef.current.panX+dx, y:panStartRef.current.panY+dy}) }
            if(draggingId && dragStartRef.current){
                const rect=viewportRef.current?.getBoundingClientRect(); if(!rect) return
                const curX=(cx-rect.left-pan.x)/zoom, curY=(cy-rect.top-pan.y)/zoom
                const s=dragStartRef.current; const nx=s.origX+(curX-s.startX), ny=s.origY+(curY-s.startY)
                if(s.id==='brain'){ const cand=nudgeToNonColliding('brain',{x:nx,y:ny},classPositions,brainPos,visionPos,{expandedClasses,fallback:brainPos} as any); if(cand!==brainPos) setBrainPos(cand)}
                else if(s.id==='vision'){ const cand=nudgeToNonColliding('vision',{x:nx,y:ny},classPositions,brainPos,visionPos,{expandedClasses,fallback:visionPos} as any); if(cand!==visionPos) setVisionPos(cand)}
                else{ const fb=classPositions[s.id]??{x:nx,y:ny}; const cand=nudgeToNonColliding(s.id,{x:nx,y:ny},classPositions,brainPos,visionPos,{expandedClasses,fallback:fb} as any); if(cand!==fb) setClassPositions(prev=>{ const cur=prev[s.id]; if(cur&&cand.x===cur.x&&cand.y===cur.y) return prev; return {...prev,[s.id]:cand}})}
            }
        }
        const onUp=()=>{ setIsPanning(false); panStartRef.current=null; setDraggingId(null) }
        window.addEventListener('mousemove',onMove as any); window.addEventListener('mouseup',onUp)
        window.addEventListener('pointermove',onMove as any); window.addEventListener('pointerup',onUp as any)
        return()=>{ window.removeEventListener('mousemove',onMove as any); window.removeEventListener('mouseup',onUp as any); window.removeEventListener('pointermove',onMove as any); window.removeEventListener('pointerup',onUp as any)}
    },[isPanning,draggingId,zoom,pan])
    useEffect(()=>{
        const el=viewportRef.current; if(!el) return
        const onWheelNative=(e:WheelEvent)=>{
            const target=e.target as HTMLElement | null
            if(target?.closest('[data-dataset-panel]')){ const de=target.closest('[data-dataset-panel]') as HTMLElement; if(de && de.scrollHeight>de.clientHeight) return }
            if(e.cancelable) e.preventDefault()
        }
        const onTouchMoveNative=(e:TouchEvent)=>{
            if(e.touches.length===2){
                if(e.cancelable) e.preventDefault()
            }
        }
        el.addEventListener('wheel',onWheelNative,{passive:false})
        el.addEventListener('touchmove',onTouchMoveNative,{passive:false})
        return()=>{ el.removeEventListener('wheel',onWheelNative); el.removeEventListener('touchmove',onTouchMoveNative) }
    },[])

    const handleTrain = async (epochs=50)=>{
        setIsTraining(true); setTrainingError(null); setTotalEpochs(epochs); setCurrentEpoch(0); setEpochResults([])
        const project=mode.project
        if(!project || project.classes.length <2){ mode.setAccuracy(0); setIsTraining(false); const msg='Add at least 2 folders to train'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
        if(project.classes.some(c=>c.samples.length<2)){ mode.setAccuracy(0); setIsTraining(false); const msg='Each folder needs at least 2 samples'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
        try{
            setModelLoading(true)
            const trainData: {cls:string,features:Float32Array}[]=[]
            const testData:{features:Float32Array,label:string}[]=[]
            for(const cls of project.classes){
                const shuffled=[...cls.samples].sort(()=>Math.random()-0.5)
                const trainCount=Math.max(1,Math.min(shuffled.length-1,Math.floor(shuffled.length*0.8)))
                const splitIdx=shuffled.length<=2?1:trainCount
                for(let i=0;i<shuffled.length;i++){
                    try{
                        const raw = extractKeypointsArray(shuffled[i].data)
                        if (!raw) continue
                        const features=raw.length<78?(()=>{const p=new Float32Array(78); p.set(raw); return p})():raw
                        if(i<splitIdx) trainData.push({cls:cls.name,features})
                        else testData.push({features,label:cls.name})
                    }catch{}
                }
            }
            if(trainData.length===0||testData.length===0){ mode.setAccuracy(0); setModelLoading(false); setIsTraining(false); const msg='Not enough test data — add more samples'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
            setModelLoading(false)
            const epochResultsLocal:number[]=[]; let bestAccuracy=0
            for(let epoch=1;epoch<=epochs;epoch++){
                const progress=epoch/epochs; const delay=epochs>50?Math.max(5,20/(epoch*0.1)):Math.max(10,40/(epoch*0.1))
                await new Promise(r=>setTimeout(r,delay))
                const evalClassifier=new HandPoseClassifier()
                const numToAdd=Math.max(1,Math.ceil(progress*trainData.length))
                for(let i=0;i<numToAdd;i++){ const item=trainData[i]; try{ await evalClassifier.addSample(item.features,item.cls)}catch{}}
                let correct=0,total=0
                for(const item of testData) try{ const result=await evalClassifier.predict(item.features,3); if(result && result.label===item.label) correct++; total++ }catch{ total++ }
                evalClassifier.dispose(); const rawAccuracy=total>0?correct/total:0; epochResultsLocal.push(rawAccuracy); if(rawAccuracy>bestAccuracy) bestAccuracy=rawAccuracy
                if(epoch%5===0||epoch===epochs){ setCurrentEpoch(epoch); setEpochResults([...epochResultsLocal]); mode.setAccuracy(rawAccuracy) }
            }
            classifierRef.current.clear()
            for(const cls of project.classes){
                if(cls.samples.length===0) continue
                for(const s of cls.samples){
                    const f=extractKeypointsArray(s.data); if(!f) continue
                    try{ if(augmentMode) await classifierRef.current.addSampleAugmented(f, cls.name); else await classifierRef.current.addSample(f, cls.name)}catch{}
                }
            }
            mode.setAccuracy(bestAccuracy); mode.setModelTrained(true); showSaved(`Training complete — ${(bestAccuracy*100).toFixed(0)}% accuracy`)
        }catch(err){ mode.setAccuracy(0); setTrainingError('Training failed. Please try again.') } setIsTraining(false); setModelLoading(false)
    }
    let warningTitle=''; let warningDesc=''
    if(mode.project && mode.project.classes.length<2){ warningTitle='Add at least 2 folders'; warningDesc='Create 2 or more folders to enable training' }
    else if(totalSamplesAll===0){ warningTitle='Add samples to each folder'; warningDesc='Capture hand gestures for every folder' }
    else if(mode.project && mode.project.classes.some(c=>c.samples.length<2)){ warningTitle='Add more samples per folder'; warningDesc='Each folder needs at least 2 samples' }
    const handleAddClass=()=>{ const name=newClassName.trim(); if(!name) return; if(mode.project?.classes.some(c=>c.name.toLowerCase()===name.toLowerCase())){ showSaved('Folder name already exists'); return } mode.addClass(name); setNewClassName(''); setShowAddClass(false); showSaved(`Folder "${name}" added`) }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#F8FAFC] relative">
            {savedMessage && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold shadow-lg">{savedMessage}</div>}
            <canvas ref={canvasRef} className="hidden" />
            <input ref={collectFileInputRef} type="file" accept="image/*" multiple onChange={handleCollectUpload} className="hidden" />
            <input ref={testFileInputRef} type="file" accept="image/*" onChange={handleTestUpload as any} className="hidden" />
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />

            {/* Header — like HandPose */}
            <div className="shrink-0 h-[48px] flex items-center justify-between px-4 bg-white border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white">✋</div>
                        <div className="min-w-0">
                            <h1 className="text-[13px] font-semibold text-slate-900 leading-none tracking-tight">Teach Your AI to Count</h1>
                            <p className="text-[11px] text-slate-500 leading-none mt-0.5 hidden sm:block">Canvas • Pan, zoom, and arrange folders</p>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-slate-200">
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-semibold text-violet-700">✋ {mode.project?.classes.length||0} gestures</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">🖐️ {totalSamplesAll} samples</span>
                        {mode.modelTrained && <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">✓ {(mode.accuracy!*100).toFixed(0)}%</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600"><span className={`w-1.5 h-1.5 rounded-full ${handDetected?'bg-emerald-500':'bg-slate-300'}`}/>{handDetected?'Hand':'Scanning'} • {inferenceTime}ms</span>
                    <button onClick={camera.toggleCamera} className={`inline-flex items-center gap-1.5 h-11 px-5 rounded-xl text-sm font-bold border ${camera.cameraOn?'bg-slate-900 text-white border-slate-900':'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}><span className={`w-2 h-2 rounded-full ${camera.cameraOn?'bg-emerald-400':'bg-slate-300'}`}/>{camera.cameraOn?'Camera on':'Camera off'}</button>
                    <button onClick={()=>setShowAddClass(true)} className="hidden sm:inline-flex items-center gap-1.5 h-11 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm">+ New gesture</button>
                </div>
            </div>
            {showAddClass && (
                <div className="absolute top-[56px] left-1/2 -translate-x-1/2 z-30 bg-white rounded-xl shadow-xl border border-slate-200 p-3 flex gap-2 items-center w-[min(420px,95vw)]">
                    <input autoFocus value={newClassName} onChange={e=>setNewClassName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') handleAddClass(); if(e.key==='Escape') setShowAddClass(false)}} placeholder="Gesture name e.g. Three" className="flex-1 h-11 px-5 rounded-lg border border-slate-200 bg-white text-sm font-medium outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
                    <button onClick={handleAddClass} className="h-9 px-4 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800">Add</button>
                    <button onClick={()=>setShowAddClass(false)} className="h-11 px-5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600">Cancel</button>
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
                style={{touchAction:'none'}}
                className={`flex-1 relative overflow-hidden ${isPanning?'cursor-grabbing':'cursor-grab'} bg-[#F8FAFC]`}
            >
                <div className="absolute inset-0" style={{backgroundImage:`radial-gradient(circle, #DDD6FE 1.2px, transparent 1.2px)`,backgroundSize:'20px 20px',backgroundPosition:`${pan.x}px ${pan.y}px`}}/>
                <div className="absolute inset-0 opacity-[0.04]" style={{backgroundImage:`linear-gradient(#7C3AED 1px, transparent 1px), linear-gradient(90deg, #7C3AED 1px, transparent 1px)`,backgroundSize:'80px 80px',backgroundPosition:`${pan.x}px ${pan.y}px`}}/>
                <div className="absolute inset-0" style={{transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,transformOrigin:'0 0',width:3000,height:2000}}>
                    <svg className="absolute inset-0 pointer-events-none" width={3000} height={2000} style={{overflow:'visible'}}>
                        <defs><linearGradient id="wire" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#CBD5E1"/><stop offset="100%" stopColor="#94A3B8"/></linearGradient></defs>
                        {mode.project?.classes.map(cls=>{ const pos=classPositions[cls.id]; if(!pos) return null; const x1=pos.x+344, y1=pos.y+132, x2=brainPos.x, y2=brainPos.y+220, mx=(x1+x2)/2; return <path key={cls.id} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round"/>})}
                        {(()=>{ const x1=brainPos.x+400, y1=brainPos.y+220, x2=visionPos.x, y2=visionPos.y+200, mx=(x1+x2)/2; return <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round"/>})()}
                    </svg>

                    {mode.project?.classes.map(cls=>{
                        const pos=classPositions[cls.id]||{x:48,y:80}
                        const isSelected=mode.selectedClassId===cls.id
                        const isDragOver=dragOverClass===cls.id
                        const atLimit=cls.samples.length>=MAX_SAMPLES_PER_CLASS
                        const progress=Math.min(100, (cls.samples.length/15)*100)
                        return (
                            <div key={cls.id} data-node onPointerDown={e=>startNodeDrag(e,cls.id,pos)} onClick={()=>mode.setSelectedClassId(cls.id)} style={{left:pos.x,top:pos.y,width:344,touchAction:'none' as any}} className={`absolute select-none ${draggingId===cls.id?'z-40':isSelected?'z-20':'z-10'}`}>
                                <div className={`bg-white rounded-xl border overflow-hidden flex flex-col transition-shadow ${isDragOver?'border-violet-400 shadow-lg':isSelected?'border-violet-300 shadow-md':'border-slate-200 shadow-sm hover:shadow-md'}`} style={{minHeight:280}}>
                                    <div className="h-[44px] flex items-center gap-3 px-3 border-b border-slate-100 shrink-0" style={{background:`${cls.color}0D`,borderLeft:`4px solid ${cls.color}`}}>
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border" style={{background:`${cls.color}18`,borderColor:`${cls.color}30`,color:cls.color}}>✋</div>
                                        <div className="flex-1 min-w-0">
                                            {editingClassId===cls.id ? (
                                                <input autoFocus value={editName} onChange={e=>setEditName(e.target.value)} onBlur={()=>handleRename(cls.id,editName)} onKeyDown={e=>{if(e.key==='Enter')handleRename(cls.id,editName); if(e.key==='Escape')setEditingClassId(null)}} onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()} className="w-full h-7 px-2 rounded-md border border-slate-300 bg-white text-sm font-medium outline-none focus:border-violet-300"/>
                                            ) : (
                                                <p onDoubleClick={e=>{e.stopPropagation(); setEditingClassId(cls.id); setEditName(cls.name)}} className="text-[13px] font-semibold text-slate-900 truncate leading-none" title="Double click to rename">{cls.name}</p>
                                            )}
                                            <p className="text-[11px] text-slate-500 leading-none mt-0.5">{cls.samples.length} / {MAX_SAMPLES_PER_CLASS} samples</p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation(); setConfirmState({ title:`Delete gesture "${cls.name}"?`, message:`All ${cls.samples.length} samples will be permanently removed.`, confirmText:'Delete gesture', variant:'danger', icon:'🗑️', onConfirm:()=>{ classifierRef.current.clearClass(cls.name); mode.removeClass(cls.id); setConfirmState(null); showSaved(`Deleted gesture "${cls.name}"`) }})}} className="w-7 h-7 rounded-md hover:bg-slate-50 text-slate-400 hover:text-slate-700 flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg></button>
                                            <div className="w-7 h-7 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 cursor-grab active:cursor-grabbing" title="Drag to move"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="7" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="17" r="1"/><circle cx="15" cy="7" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="17" r="1"/></svg></div>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 shrink-0"><div className="h-full transition-all" style={{width:`${progress}%`,background:cls.color}}/></div>
                                    {isDragOver && <div className="mx-3 mt-3 h-11 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm font-bold flex items-center justify-center">Drop images here</div>}
                                    <div
                                        onDragOver={e=>{e.preventDefault(); setDragOverClass(cls.id)}}
                                        onDragLeave={e=>{e.preventDefault(); if(dragOverClass===cls.id) setDragOverClass(null)}}
                                        onDrop={async e=>{e.preventDefault(); setDragOverClass(null); if(e.dataTransfer.files.length>0) await processFilesForClass(e.dataTransfer.files, cls.id)}}
                                        className="flex-1 p-3 flex flex-col gap-3 min-h-[150px]"
                                    >
                                        {(cls.samples.length>0 || (uploadingByClass[cls.id]||0)>0) ? (
                                            <>
                                                <div data-dataset-panel className={`grid grid-cols-3 gap-2 ${expandedClasses[cls.id]?'max-h-[320px] overflow-auto neura-scrollbar pr-1':''}`}>
                                                    {(expandedClasses[cls.id]?cls.samples:cls.samples.slice(0,8)).map((s,idx)=>{
                                                        const src=getSampleImageSrc(s); const full=getSampleFullSrc(s)||src
                                                        return (
                                                            <div key={s.id} onClick={()=>{ if(!full) return; const all=cls.samples.map((x,i)=>{const f=getSampleFullSrc(x)||getSampleImageSrc(x); return f?{src:f,label:`${cls.name} #${i+1}`}:null}).filter(Boolean) as any; if(all.length>1) openSingleImage(full, `${cls.name} #${idx+1}`) ; else if(full) openSingleImage(full, `${cls.name} #${idx+1}`) }} title={full?'Click to view full size':'No preview'} className={`group relative aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 flex items-center justify-center ${full?'cursor-zoom-in':''}`}>
                                                                {src ? <img src={src} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false}/> : <span className="text-lg">✋</span>}
                                                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-white bg-black/55 px-1 py-0.5 rounded-full">#{idx+1}</span>
                                                                <button onClick={e=>{e.stopPropagation(); handleRemoveSampleWithConfirm(cls.id,s.id)}} onPointerDown={e=>e.stopPropagation()} title="Delete" className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 border border-slate-200 text-slate-700 flex items-center justify-center text-[11px] font-bold shadow-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100 hover:bg-red-500 hover:text-white hover:border-red-500">×</button>
                                                                {full && <span className="absolute bottom-1 right-1 w-5 h-5 rounded-md bg-black/55 text-white hidden group-hover:flex items-center justify-center text-[10px]">⛶</span>}
                                                            </div>
                                                        )
                                                    })}
                                                    {(uploadingByClass[cls.id]||0)>0 && Array.from({length:uploadingByClass[cls.id]}).map((_,i)=>(
                                                        <div key={`uploading-${cls.id}-${i}`} className="aspect-square rounded-lg bg-white border-2 border-violet-200 flex flex-col items-center justify-center gap-1 animate-pulse">
                                                            <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin"/>
                                                            <span className="text-[8px] font-bold text-violet-600">Loading…</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                {cls.samples.length>8 && <button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation(); setExpandedClasses(prev=>({...prev,[cls.id]:!prev[cls.id]}))}} className="w-full h-7 rounded-full bg-white border border-violet-200 text-violet-700 text-[11px] font-bold hover:bg-violet-50 flex items-center justify-center gap-1">{expandedClasses[cls.id]?<>Show less ↑</>:<>Expand +{cls.samples.length-8} more ↓</>}</button>}
                                                <button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation(); handleUploadClick(cls.id)}} disabled={atLimit} className={`w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-bold transition-all ${atLimit?'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed':'bg-gradient-to-r from-violet-50 to-indigo-50 border-violet-200 text-violet-700 hover:from-violet-100 hover:to-indigo-100 hover:border-violet-300 hover:shadow-sm'}`}>
                                                    <span className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs">+</span>
                                                    Add images <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white border border-violet-200 text-violet-600 font-bold">multi</span>
                                                </button>
                                            </>
                                        ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                                                <div className={`w-12 h-12 rounded-xl border flex items-center justify-center ${isDragOver?'bg-violet-50 border-violet-200 text-violet-600':'bg-slate-50 border-slate-200 text-slate-400'}`}><span className="text-lg">✋</span></div>
                                                <div className="text-center">
                                                    <p className="text-sm font-bold text-slate-700">No samples yet</p>
                                                    <p className="text-[11px] text-slate-500">Capture or upload hand images</p>
                                                </div>
                                                <button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation(); handleUploadClick(cls.id)}} className="h-11 px-6 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold shadow-sm hover:from-violet-700 hover:to-indigo-700">＋ Add images</button>
                                            </div>
                                        )}
                                        <div className="flex gap-2 pt-2 border-t border-slate-100 mt-auto">
                                            <button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation(); mode.setSelectedClassId(cls.id); handleCaptureForClass(cls.id)}} disabled={atLimit||isTraining} className={`flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full text-sm font-bold border ${atLimit?'bg-slate-50 text-slate-400 border-slate-200': isCapturing===cls.id?'bg-emerald-500 text-white border-emerald-500':'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-violet-200'}`}>{isCapturing===cls.id?'✓ Captured':'✋ Snap'}</button>
                                            <button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation(); handleUploadClick(cls.id)}} disabled={atLimit} className={`flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full text-sm font-bold border ${atLimit?'bg-slate-50 text-slate-400 border-slate-200':'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-violet-200'}`}>📂 Browse</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}

                    <button
                        data-node
                        onPointerDown={e=>e.stopPropagation()}
                        onClick={()=>setShowAddClass(true)}
                        style={{left:brainPos.x+(400-344)/2,top:brainPos.y-80,width:344,height:60}}
                        className="absolute z-30 inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-300 bg-gradient-to-r from-violet-50 to-indigo-50 backdrop-blur hover:from-violet-100 hover:to-indigo-100 hover:border-violet-400 text-violet-700 text-sm font-bold shadow-sm transition-all hover:scale-[1.01]"
                    >
                        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">＋</span>
                        Add gesture
                    </button>

                    {mode.project?.classes.length===0 && (
                        <div data-node style={{left:360,top:220,width:360,position:'absolute'}} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col items-center text-center">
                            <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 mb-3">✋</div>
                            <h3 className="text-sm font-semibold text-slate-900">No gestures yet</h3>
                            <p className="text-xs text-slate-500 mt-1 max-w-[260px]">Create a folder for each finger count. Each folder is a separate compartment on the canvas.</p>
                            <button onClick={()=>setShowAddClass(true)} className="mt-4 h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-800">Add first gesture</button>
                        </div>
                    )}

                    {/* Brain — Train */}
                    <div data-node onPointerDown={e=>startNodeDrag(e,'brain',brainPos)} style={{left:brainPos.x,top:brainPos.y,width:400,touchAction:'none' as any}} className={`absolute select-none ${draggingId==='brain'?'z-40':'z-10'}`}>
                        <div className="bg-white rounded-xl border border-violet-200 shadow-md overflow-hidden flex flex-col cursor-grab active:cursor-grabbing">
                            <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500"/>
                            <div className="h-11 px-4 flex items-center justify-between border-b border-violet-100 bg-gradient-to-r from-violet-50 to-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-sm">🧠</div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Model</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{mode.modelTrained?`Trained • ${(mode.accuracy!*100).toFixed(0)}%`: canTrain?'Ready to train':'Needs data'}</p>
                                    </div>
                                </div>
                                <span className={`inline-flex h-6 px-2 rounded-full text-[11px] font-medium border ${mode.modelTrained?'bg-emerald-50 text-emerald-700 border-emerald-200':canTrain?'bg-amber-50 text-amber-700 border-amber-200':'bg-slate-50 text-slate-600 border-slate-200'}`}>{mode.modelTrained?'Ready':canTrain?'Ready':'Needs data'}</span>
                            </div>
                            <div className="p-5 flex flex-col items-center text-center gap-3">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 shadow-sm ${mode.modelTrained?'bg-emerald-50 border-emerald-300 text-emerald-700': isTraining?'bg-violet-50 border-violet-300 text-violet-700 animate-pulse':'bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200 text-violet-700'}`}><span className="text-xl">{isTraining?'🧠':mode.modelTrained?'✓':'🤖'}</span></div>
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-900">{isTraining?`Training ${currentEpoch}/${totalEpochs}`: mode.accuracy!=null?`${(mode.accuracy*100).toFixed(0)}% accuracy`: canTrain?'Ready to train': warningTitle||'Add more data'}</h3>
                                    <p className="text-xs text-slate-500 mt-1 max-w-[280px]">{isTraining?`Learning from ${totalSamplesAll} samples`: mode.accuracy!=null?`${totalSamplesAll} samples` : warningDesc}</p>
                                </div>
                                <button onClick={()=>handleTrain(totalEpochs)} disabled={isTraining||modelLoading} title={!canTrain?warningTitle:undefined} className={`h-9 px-5 rounded-full text-sm font-bold shadow-sm transition-all ${canTrain&&!isTraining&&!modelLoading?'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700':'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}`}>{isTraining?'Training…': mode.modelTrained?'✨ Retrain':'🚀 Train model'}</button>
                                <div className="w-full rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 p-3">
                                    <div className="flex justify-between text-[11px] font-semibold text-slate-700"><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-md bg-violet-600 text-white flex items-center justify-center text-[10px]">◍</span>Epochs</span><span className="text-violet-700 font-bold bg-white px-2 py-0.5 rounded-full border border-violet-200">{totalEpochs}</span></div>
                                    <input type="range" min={5} max={100} step={5} value={totalEpochs} onChange={e=>setTotalEpochs(parseInt(e.target.value))} className="w-full mt-3 h-2 accent-violet-600 cursor-pointer" style={{accentColor:'#7c3aed'}}/>
                                    <div className="flex gap-1.5 mt-3">{[10,25,50,100].map(v=><button key={v} onClick={e=>{e.stopPropagation(); setTotalEpochs(v)}} className={`flex-1 h-7 rounded-full text-sm font-bold border ${totalEpochs===v?'bg-violet-600 text-white border-violet-600':'bg-white text-slate-600 border-slate-200'}`}>{v}</button>)}</div>
                                </div>
                                {(epochResults.length>0||isTraining) && <div className="w-full"><AccuracyChart epochResults={epochResults} isTraining={isTraining} currentEpoch={currentEpoch}/></div>}
                                {trainingError && <div className="w-full rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm font-bold text-red-700">{trainingError}</div>}
                            </div>
                            <div className="grid grid-cols-3 gap-px bg-slate-100 border-t border-slate-100">
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 uppercase">Folders</p><p className="text-sm font-semibold text-slate-900">{mode.project?.classes.length||0}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 uppercase">Samples</p><p className="text-sm font-semibold text-slate-900">{totalSamplesAll}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 uppercase">Accuracy</p><p className={`text-sm font-semibold ${mode.accuracy!=null?'text-emerald-600':'text-slate-400'}`}>{mode.accuracy!=null?`${(mode.accuracy*100).toFixed(0)}%`:'—'}</p></div>
                            </div>
                        </div>
                    </div>

                    {/* Vision — Live Finger Preview */}
                    <div data-node onPointerDown={e=>startNodeDrag(e,'vision',visionPos)} style={{left:visionPos.x,top:visionPos.y,width:420,touchAction:'none' as any}} className={`absolute select-none ${draggingId==='vision'?'z-40':'z-10'}`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col cursor-grab active:cursor-grabbing">
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white text-sm">👁️</div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Live preview</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{camera.cameraOn ? (handDetected ? `✋ ${currentCount||'--'} fingers` : 'Scanning…') : testImage ? 'Static image' : 'Idle'}</p>
                                    </div>
                                </div>
                                <span className={`w-2 h-2 rounded-full ${handDetected?'bg-emerald-500':'bg-slate-300'}`}/>
                            </div>
                            <div onDragOver={e=>{e.preventDefault(); setIsTestDragging(true)}} onDragLeave={e=>{e.preventDefault(); setIsTestDragging(false)}} onDrop={async e=>{e.preventDefault(); setIsTestDragging(false); if(e.dataTransfer.files.length>0){ const f=e.dataTransfer.files[0]; if(f.type.startsWith('image/')){ const r=new FileReader(); r.onload=()=>{ setTestImage(r.result as string); if(camera.cameraOn) camera.stopCamera() }; r.readAsDataURL(f) }}}} className={`relative mx-3 mt-3 rounded-xl overflow-hidden bg-slate-950 border ${isTestDragging?'border-violet-300':'border-slate-800'} ${camera.cameraOn||testImage?'aspect-[4/3]':'min-h-[180px]'} flex flex-col`} onPointerDown={e=>e.stopPropagation()}>
                                <video ref={camera.videoRef} autoPlay playsInline muted className={`w-full h-full object-cover -scale-x-100 absolute inset-0 ${camera.cameraOn?'opacity-100':'opacity-0 pointer-events-none'}`}/>
                                <canvas ref={overlayCanvasRef} className={`absolute inset-0 w-full h-full pointer-events-none ${camera.cameraOn?'opacity-100':'opacity-0'}`}/>
                                <canvas ref={canvasRef} className="hidden"/>
                                {camera.cameraOn && <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-black/60 backdrop-blur text-white text-[11px] font-medium z-10"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/> Live</div>}
                                {!camera.cameraOn && testImage && <><img src={testImage} alt="" className="w-full h-full object-contain bg-black relative z-10"/><button onPointerDown={e=>e.stopPropagation()} onClick={()=>{setTestImage(null); setPrediction(null); setCurrentCount(0)}} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center z-10">×</button></>}
                                {!camera.cameraOn && !testImage && (
                                    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center relative z-10">
                                        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${isTestDragging?'bg-white text-slate-900 border-white':'bg-white/10 border-white/20 text-white/80'}`}>✋</div>
                                        <p className="text-sm font-medium text-white">{isTestDragging?'Drop image to test':'No hand'}</p>
                                        <p className="text-xs text-white/60 max-w-[220px]">Turn on camera for live count</p>
                                        <div className="flex gap-2"><button onPointerDown={e=>e.stopPropagation()} onClick={camera.startCamera} className="h-11 px-5 rounded-xl bg-white text-slate-900 text-sm font-bold">Enable camera</button><button onPointerDown={e=>e.stopPropagation()} onClick={()=>testFileInputRef.current?.click()} className="h-11 px-5 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-bold">Upload</button></div>
                                    </div>
                                )}
                                {/* Big count overlay */}
                                {camera.cameraOn && currentCount>0 && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl font-black text-white shadow-xl" style={{background:COUNT_COLORS[currentCount]||'#0ea5e9'}}>{currentCount}</div></div>}
                            </div>
                            <div className="flex gap-2 p-3 flex-wrap" onPointerDown={e=>e.stopPropagation()}>
                                <button onClick={camera.toggleCamera} className={`h-11 px-5 rounded-xl text-sm font-bold border ${camera.cameraOn?'bg-slate-900 text-white border-slate-900':'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{camera.cameraOn?'Camera on':'Camera off'}</button>
                                <button onClick={()=>testFileInputRef.current?.click()} className="h-11 px-5 rounded-xl bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 text-sm font-bold">Upload</button>
                                <span className="ml-auto inline-flex h-8 items-center px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{currentCount? `Count: ${currentCount}`: 'No count'} • {inferenceTime}ms</span>
                            </div>
                            <div className="px-3 pb-3 flex flex-col gap-2" onPointerDown={e=>e.stopPropagation()}>
                                <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-center">
                                    <p className="text-[10px] font-bold text-slate-500 uppercase">Current Count</p>
                                    <p className="text-3xl font-black" style={{color: COUNT_COLORS[currentCount]||'#64748b'}}>{currentCount||'--'}</p>
                                    <div className="flex justify-center gap-1 mt-1">{[0,0,0,0,0].map((_,i)=><div key={i} className="w-2 h-2 rounded-full" style={{background: fingerFlags[i]?'#0ea5e9':'#e2e8f0'}}/>)}</div>
                                </div>
                                {prediction ? (
                                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                                        <p className="text-[11px] font-bold text-slate-500 mb-1">Prediction</p>
                                        <p className="text-sm font-bold text-slate-900">{prediction.label} — {(prediction.confidences[prediction.label]*100).toFixed(0)}%</p>
                                    </div>
                                ) : <div className="text-center py-3 text-xs text-slate-400">{camera.cameraOn ? 'Show fingers' : 'Enable camera or upload'}</div>}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-white rounded-full shadow-sm border border-slate-200 px-2 py-1.5">
                    <span className="text-[11px] font-medium text-slate-600 px-2">Canvas</span>
                    <button onClick={zoomOut} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">−</button>
                    <span className="text-sm font-bold w-11 text-center text-slate-900">{Math.round(zoom*100)}%</span>
                    <button onClick={zoomIn} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">+</button>
                    <div className="w-px h-5 bg-slate-200 mx-1"/>
                    <button onClick={resetView} className="h-7 px-3 rounded-full bg-slate-900 text-white text-sm font-bold">Reset</button>
                </div>
            </div>

            <NotRelatedModal isOpen={showNotRelated} onClose={()=>setShowNotRelated(false)} onUpload={()=>testFileInputRef.current?.click()}/>
            {confirmState && <ConfirmModal isOpen={!!confirmState} title={confirmState.title} message={confirmState.message} confirmText={confirmState.confirmText} variant={confirmState.variant} icon={confirmState.icon} onConfirm={confirmState.onConfirm} onCancel={()=>setConfirmState(null)}/>}
        </div>
    )
}
