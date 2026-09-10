import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import { useCamera } from '../../hooks/useCamera'
import { HandPoseClassifier } from '../../ml/classifiers/HandPoseClassifier'
import { MAX_SAMPLES_PER_CLASS } from '../../types/neura.types'
import WorkflowIndicator from '../../ui/components/WorkflowIndicator'
import ClassScores from '../../ui/components/ClassScores'
import SampleWarningModal from '../../ui/components/SampleWarningModal'
import { classifyFingerCount } from '../../ml/utils/ruleBasedClassifiers'
import { openSingleImage, openImageViewer } from '../../ui/components/neuraImageViewer'

interface FingerCounterPanelProps {
    mode: UseNeuraProjectReturn
}

type CaptureStatus = 'idle' | 'loading-model' | 'detecting' | 'success' | 'no-hand' | 'error'

const DETECT_THROTTLE_MS = 33
const PREDICT_THROTTLE_MS = 100

const FINGER_LABELS: Record<string, number> = {
    'One': 1, 'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5
}

const COUNT_COLORS: Record<number, string> = {
    1: '#10b981', 2: '#3b82f6', 3: '#8b5cf6', 4: '#f59e0b', 5: '#ef4444'
}

// ── Helpers for sample image management (fix for invisible uploaded images) ──
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
        if (parsed && typeof parsed.data === 'string' && parsed.data.startsWith('data:image')) return parsed.data
    } catch {}
    return null
}

export default function FingerCounterPanel({ mode }: FingerCounterPanelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
    const classifierRef = useRef(new HandPoseClassifier())
    const animFrameRef = useRef<number>(0)
    const isPredictingRef = useRef(false)
    const testCameraStartedRef = useRef(false)
    const lastDetectTimeRef = useRef(0)
    const lastPredictTimeRef = useRef(0)
    const audioContextRef = useRef<AudioContext | null>(null)
    const lastSoundCountRef = useRef(0)

    const [isCapturing, setIsCapturing] = useState(false)
    const [captureFps, setCaptureFps] = useState(15)
    const burstIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const handleCaptureRef = useRef<() => Promise<void>>(null)
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

    const showSaved = useCallback((msg: string) => {
        setSavedMessage(msg)
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        savedTimeoutRef.current = setTimeout(() => setSavedMessage(null), 2000)
    }, [])

    const playCountSound = useCallback((count: number) => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContext()
            }
            const ctx = audioContextRef.current
            const frequencies: Record<number, number> = {
                1: 261.63, 2: 329.63, 3: 392.00, 4: 523.25, 5: 659.25
            }
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.value = frequencies[count] || 440
            gain.gain.setValueAtTime(0.3, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start()
            osc.stop(ctx.currentTime + 0.3)
        } catch { /* ignore audio errors */ }
    }, [])

    const camera = useCamera({ videoConstraints: { width: 640, height: 480, facingMode: 'user' } })

    const handleStopCamera = useCallback(() => {
        camera.stopCamera()
        setHandDetected(false)
        setPrediction(null)
        setCurrentCount(0)
    }, [camera])

    useEffect(() => {
        return () => {
            cancelAnimationFrame(animFrameRef.current)
            classifierRef.current.dispose()
        }
    }, [])

    useEffect(() => {
        if (mode.mode !== 'collect' && mode.mode !== 'test') handleStopCamera()
    }, [mode.mode, handleStopCamera])

    useEffect(() => {
        if (mode.mode !== 'test') testCameraStartedRef.current = false
    }, [mode.mode])

    // New file / LeapLab open – clear previous dataset images and train state
    useEffect(() => {
        if (!mode.project?.id) return
        setIsCapturing(false)
        setCaptureStatus('idle')
        setPrediction(null)
        setIsProcessing(false)
        setHandDetected(false)
        setInferenceTime(0)
        setSavedMessage(null)
        setCurrentCount(0)
        setCountHistory([])
        setTestImage(null)
        setFingerFlags([0, 0, 0, 0, 0])
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
        classifierRef.current.clear()
        if (burstIntervalRef.current) { clearInterval(burstIntervalRef.current); burstIntervalRef.current = null }
        // Clear overlay canvases
        if (overlayCanvasRef.current) {
            const ctx = overlayCanvasRef.current.getContext('2d')
            ctx?.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
        }
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d')
            ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
    }, [mode.project?.id])

    // Rule-based classifier: no KNN rebuild needed
    useEffect(() => {
        if (mode.mode !== 'test' || testImage) return
        // Camera starts OFF in test mode — user chooses to turn on camera or upload
        const runPrediction = async () => {
            if (isPredictingRef.current) return
            if (camera.streamStateRef.current && camera.videoRef.current && canvasRef.current) {
                isPredictingRef.current = true
                setIsProcessing(true)
                try {
                    const start = performance.now()
                    const ctx = canvasRef.current.getContext('2d')
                    if (ctx) {
                        canvasRef.current.width = 640
                        canvasRef.current.height = 480
                        ctx.drawImage(camera.videoRef.current, 0, 0, 640, 480)
                        
                        // Rule-based classification: detect hand, extract features, count fingers
                        const keypoints = await classifierRef.current.detectHand(canvasRef.current)
                        if (keypoints && keypoints.length > 0) {
                            const features = classifierRef.current.extractFeatures(keypoints)
                            setFingerFlags([features[67], features[63], features[64], features[65], features[66]])
                            const result = classifyFingerCount(features)
                            
                            const elapsed = Math.round(performance.now() - start)
                            setInferenceTime(elapsed)
                            
                            const confidences: Record<string, number> = { [result.label]: result.confidence }
                            
                            const predConfidence = result.confidence
                            if (predConfidence < confidenceThreshold) {
                                setPrediction(null)
                                setHandDetected(false)
                                setCurrentCount(0)
                                if (overlayCanvasRef.current) {
                                    const overlayCtx = overlayCanvasRef.current.getContext('2d')
                                    if (overlayCtx) {
                                        overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
                                    }
                                }
                            } else {
                                setPrediction({ label: result.label, confidences })
                                setHandDetected(true)
                                
                                const count = FINGER_LABELS[result.label] || 0
                                setCurrentCount(count)
                                setCountHistory(prev => [...prev.slice(-19), count])
                                
                                if (lastSoundCountRef.current !== count) {
                                    playCountSound(count)
                                    lastSoundCountRef.current = count
                                }

                                // Draw hand skeleton onto overlay canvas for real-time tracking feedback
                                if (overlayCanvasRef.current) {
                                    overlayCanvasRef.current.width = camera.videoRef.current.videoWidth || 640
                                    overlayCanvasRef.current.height = camera.videoRef.current.videoHeight || 480
                                    classifierRef.current.drawHand(overlayCanvasRef.current, keypoints, undefined, { readableLabels: true })
                                }
                            }
                        } else {
                            setPrediction(null)
                            setHandDetected(false)
                            setCurrentCount(0)
                            lastSoundCountRef.current = 0
                            // Clear overlay canvas when no hand is detected
                            if (overlayCanvasRef.current) {
                                const overlayCtx = overlayCanvasRef.current.getContext('2d')
                                if (overlayCtx) {
                                    overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }
                setIsProcessing(false)
                isPredictingRef.current = false
            }
        }
        lastPredictTimeRef.current = performance.now()
        const tick = () => {
            if (!autoPredict) {
                animFrameRef.current = requestAnimationFrame(tick)
                return
            }
            const now = performance.now()
            if (now - lastPredictTimeRef.current >= PREDICT_THROTTLE_MS) {
                lastPredictTimeRef.current = now
                runPrediction()
            }
            animFrameRef.current = requestAnimationFrame(tick)
        }
        animFrameRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(animFrameRef.current)
    }, [mode.mode, camera.stream, camera.startCamera, playCountSound, autoPredict, confidenceThreshold])

    const manualPredict = useCallback(async () => {
        if (isPredictingRef.current) return
        let elementToDetect: HTMLVideoElement | HTMLImageElement | null = null
        let width = 640
        let height = 480
        
        if (testImage) {
            const img = new Image()
            img.src = testImage
            await new Promise<void>((resolve) => {
                img.onload = () => resolve()
                img.onerror = () => resolve()
            })
            if (img.complete && img.naturalWidth > 0) {
                elementToDetect = img
                width = img.naturalWidth
                height = img.naturalHeight
            }
        } else if (camera.streamStateRef.current && camera.videoRef.current) {
            elementToDetect = camera.videoRef.current
            width = camera.videoRef.current.videoWidth || 640
            height = camera.videoRef.current.videoHeight || 480
        }
        
        if (!elementToDetect || !canvasRef.current) return
        
        isPredictingRef.current = true
        setIsProcessing(true)
        try {
            const start = performance.now()
            const ctx = canvasRef.current.getContext('2d')
            if (ctx) {
                canvasRef.current.width = width
                canvasRef.current.height = height
                ctx.drawImage(elementToDetect, 0, 0, width, height)
                
                const keypoints = await classifierRef.current.detectHand(canvasRef.current)
                if (keypoints && keypoints.length > 0) {
                    const features = classifierRef.current.extractFeatures(keypoints)
                    setFingerFlags([features[67], features[63], features[64], features[65], features[66]])
                    const result = classifyFingerCount(features)
                    
                    const elapsed = Math.round(performance.now() - start)
                    setInferenceTime(elapsed)
                    
                    const confidences: Record<string, number> = { [result.label]: result.confidence }
                    
                    const predConfidence = result.confidence
                    if (predConfidence < confidenceThreshold) {
                        setPrediction(null)
                        setHandDetected(false)
                        setCurrentCount(0)
                        showSaved('⚠️ Confidence below threshold!')
                        if (overlayCanvasRef.current) {
                            const overlayCtx = overlayCanvasRef.current.getContext('2d')
                            if (overlayCtx) {
                                overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
                            }
                        }
                    } else {
                        setPrediction({ label: result.label, confidences })
                        setHandDetected(true)
                        const count = FINGER_LABELS[result.label] || 0
                        setCurrentCount(count)
                        setCountHistory(prev => [...prev.slice(-19), count])
                        
                        if (lastSoundCountRef.current !== count) {
                            playCountSound(count)
                            lastSoundCountRef.current = count
                        }
                        
                        if (overlayCanvasRef.current) {
                            overlayCanvasRef.current.width = width
                            overlayCanvasRef.current.height = height
                            classifierRef.current.drawHand(overlayCanvasRef.current, keypoints, undefined, { readableLabels: true })
                        }
                    }
                } else {
                    setPrediction(null)
                    setHandDetected(false)
                    setCurrentCount(0)
                    lastSoundCountRef.current = 0
                    showSaved('⚠️ No hand detected!')
                    if (overlayCanvasRef.current) {
                        const overlayCtx = overlayCanvasRef.current.getContext('2d')
                        if (overlayCtx) {
                            overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
                        }
                    }
                }
            }
        } catch { /* ignore */ }
        setIsProcessing(false)
        isPredictingRef.current = false
    }, [testImage, confidenceThreshold, playCountSound, showSaved])

    const handleTestUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !file.type.startsWith('image/')) return
        
        const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(file)
        })
        
        setTestImage(dataUrl)
        camera.stopCamera()
        
        setTimeout(() => {
            const img = new Image()
            img.src = dataUrl
            img.onload = async () => {
                setIsProcessing(true)
                try {
                    const start = performance.now()
                    if (canvasRef.current) {
                        const width = img.naturalWidth || 640
                        const height = img.naturalHeight || 480
                        canvasRef.current.width = width
                        canvasRef.current.height = height
                        const ctx = canvasRef.current.getContext('2d')
                        if (ctx) {
                            ctx.drawImage(img, 0, 0, width, height)
                            const keypoints = await classifierRef.current.detectHand(canvasRef.current)
                            if (keypoints && keypoints.length > 0) {
                                const features = classifierRef.current.extractFeatures(keypoints)
                                setFingerFlags([features[67], features[63], features[64], features[65], features[66]])
                                const result = classifyFingerCount(features)
                                
                                const elapsed = Math.round(performance.now() - start)
                                setInferenceTime(elapsed)
                                
                                const confidences: Record<string, number> = { [result.label]: result.confidence }
                                
                                const predConfidence = result.confidence
                                if (predConfidence < confidenceThreshold) {
                                    setPrediction(null)
                                    setHandDetected(false)
                                    setCurrentCount(0)
                                    showSaved('⚠️ Confidence below threshold!')
                                    if (overlayCanvasRef.current) {
                                        const overlayCtx = overlayCanvasRef.current.getContext('2d')
                                        if (overlayCtx) {
                                            overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
                                        }
                                    }
                                } else {
                                    setPrediction({ label: result.label, confidences })
                                    setHandDetected(true)
                                    const count = FINGER_LABELS[result.label] || 0
                                    setCurrentCount(count)
                                    
                                    if (overlayCanvasRef.current) {
                                        overlayCanvasRef.current.width = width
                                        overlayCanvasRef.current.height = height
classifierRef.current.drawHand(overlayCanvasRef.current, keypoints, undefined, { readableLabels: true })
                                    }
                                }
                            } else {
                                setPrediction(null)
                                setHandDetected(false)
                                setCurrentCount(0)
                                showSaved('⚠️ No hand detected in the uploaded image.')
                                if (overlayCanvasRef.current) {
                                    const overlayCtx = overlayCanvasRef.current.getContext('2d')
                                    if (overlayCtx) {
                                        overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
                                    }
                                }
                            }
                        }
                    }
                } catch {
                    showSaved('⚠️ Failed to analyze image.')
                }
                setIsProcessing(false)
            }
        }, 100)
    }, [confidenceThreshold, showSaved])

    // Collect mode: throttled hand detection loop for overlay drawing
    useEffect(() => {
        if (mode.mode !== 'collect' || !camera.stream) return
        const detectLoop = async () => {
            if (isPredictingRef.current) return
            if (camera.videoRef.current && overlayCanvasRef.current) {
                isPredictingRef.current = true
                try {
                    const canvas = overlayCanvasRef.current
                    const ctx = canvas.getContext('2d')
                    if (ctx) {
                        canvas.width = camera.videoRef.current.videoWidth || 640
                        canvas.height = camera.videoRef.current.videoHeight || 480
                        ctx.clearRect(0, 0, canvas.width, canvas.height)
                        const keypoints = await classifierRef.current.detectHand(camera.videoRef.current)
                        if (keypoints.length > 0) {
                            setHandDetected(true)
                            classifierRef.current.drawHand(canvas, keypoints, undefined, { readableLabels: true })
                        } else {
                            setHandDetected(false)
                        }
                    }
                } catch { /* ignore detection loop errors */ }
                isPredictingRef.current = false
            }
        }
        lastDetectTimeRef.current = performance.now()
        const tick = () => {
            const now = performance.now()
            if (now - lastDetectTimeRef.current >= DETECT_THROTTLE_MS) {
                lastDetectTimeRef.current = now
                detectLoop()
            }
            animFrameRef.current = requestAnimationFrame(tick)
        }
        animFrameRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(animFrameRef.current)
    }, [mode.mode, camera.stream])

    const handleCapture = useCallback(async () => {
        if (!camera.videoRef.current || !mode.selectedClassId || !camera.cameraOn || isCapturing) return
        const selectedClass = mode.getSelectedClass()
        if (selectedClass && selectedClass.samples.length >= MAX_SAMPLES_PER_CLASS) {
            showSaved('⚠️ Sample limit reached! (20 per class)')
            return
        }
        setIsCapturing(true)
        setCaptureStatus('detecting')
        try {
            const video = camera.videoRef.current
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = video.videoWidth || 640
            tempCanvas.height = video.videoHeight || 480
            const ctx = tempCanvas.getContext('2d')!
            ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height)
            const keypoints = await classifierRef.current.detectHand(tempCanvas)
            if (keypoints && keypoints.length > 0) {
                const features = classifierRef.current.extractFeatures(keypoints)
                const thumb = createThumbnailFromCanvas(tempCanvas, 160, 120, 0.6)
                const payload = JSON.stringify({ image: thumb, keypoints: Array.from(features) })
                const added = mode.addSample(mode.selectedClassId, { type: 'image', data: thumb } as any)
                // Fallback: if image type fails due to storage, try keypoints with embedded preview
                let finalAdded = added
                if (!added) {
                    finalAdded = mode.addSample(mode.selectedClassId, { type: 'keypoints', data: payload } as any)
                }
                // Also try to store rich payload as update if image-only succeeded (keep keypoints for rebuild)
                if (finalAdded) {
                    // Patch the just-added sample to include keypoints for future rebuilds (non-breaking)
                    const cls = mode.getSelectedClass()
                    const last = cls?.samples[cls.samples.length - 1]
                    if (last && last.type === 'image') {
                        // Store keypoints alongside image in a separate hidden sample? Instead update to rich payload
                        // Keep image as display, but also ensure classifier has features
                    }
                }
                if (!finalAdded) {
                    showSaved('⚠️ Sample limit reached! (20 per class)')
                    setCaptureStatus('idle')
                    setIsCapturing(false)
                    return
                }
                classifierRef.current.addSample(features, mode.getSelectedClass()?.name || '').catch(() => {})
                setCaptureStatus('success')
                showSaved(`📸 Saved to ${mode.getSelectedClass()?.name}! (${mode.getSelectedClass()?.samples.length || 0} total)`)
            } else {
                setCaptureStatus('no-hand')
                showSaved('⚠️ No hand detected. Try again!')
            }
        } catch (err) {
            console.error('[FingerCounter] Capture error:', err)
            setCaptureStatus('error')
        } finally {
            setIsCapturing(false)
            setTimeout(() => setCaptureStatus('idle'), 1500)
        }
    }, [camera.cameraOn, isCapturing, mode, showSaved])

    handleCaptureRef.current = handleCapture

    const startBurstCapture = useCallback(() => {
        if (!mode.selectedClassId || !camera.cameraOn) return
        burstIntervalRef.current = setInterval(() => {
            handleCaptureRef.current?.()
        }, 1000 / captureFps)
    }, [captureFps, mode.selectedClassId, camera.cameraOn])

    const stopBurstCapture = useCallback(() => {
        if (burstIntervalRef.current) {
            clearInterval(burstIntervalRef.current)
            burstIntervalRef.current = null
        }
    }, [])

    useEffect(() => {
        return () => { stopBurstCapture() }
    }, [])

    const handleCollectUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return
        if (!mode.selectedClassId && mode.project && mode.project.classes.length > 0) {
            mode.setSelectedClassId(mode.project.classes[0].id)
        }
        if (!mode.selectedClassId) { showSaved('⚠️ Create a class first!'); return }
        const selectedCls = mode.getSelectedClass()
        if (selectedCls && selectedCls.samples.length >= MAX_SAMPLES_PER_CLASS) {
            showSaved('⚠️ Sample limit reached! (20 per class)')
            if (collectFileInputRef.current) collectFileInputRef.current.value = ''
            return
        }
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            if (!file.type.startsWith('image/')) continue
            const currentCls = mode.getSelectedClass()
            if (currentCls && currentCls.samples.length >= MAX_SAMPLES_PER_CLASS) break
            const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as string)
                reader.readAsDataURL(file)
            })
            const img = new Image()
            img.src = dataUrl
            await new Promise<void>((resolve) => {
                img.onload = () => resolve()
                img.onerror = () => resolve()
                setTimeout(() => resolve(), 3000)
            })
            if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
                setIsCapturing(true)
                setCaptureStatus('detecting')
                try {
                    const tempCanvas = document.createElement('canvas')
                    tempCanvas.width = img.naturalWidth
                    tempCanvas.height = img.naturalHeight
                    const ctx = tempCanvas.getContext('2d')
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height)
                        const keypoints = await classifierRef.current.detectHand(tempCanvas)
                        if (keypoints && keypoints.length > 0) {
                            const features = classifierRef.current.extractFeatures(keypoints)
                            const thumb = await createThumbnailFromDataUrl(dataUrl, 160, 120, 0.6)
                            const added = mode.addSample(mode.selectedClassId!, { type: 'image', data: thumb } as any)
                            let finalAdded = added
                            if (!finalAdded) {
                                const payload = JSON.stringify({ image: thumb, keypoints: Array.from(features) })
                                finalAdded = mode.addSample(mode.selectedClassId!, { type: 'keypoints', data: payload } as any)
                            }
                            if (!finalAdded) {
                                showSaved('⚠️ Sample limit reached! (20 per class)')
                            } else {
                                classifierRef.current.addSample(features, mode.getSelectedClass()?.name || '').catch(() => {})
                                setCaptureStatus('success')
                                showSaved(`📁 Uploaded to ${mode.getSelectedClass()?.name}! (${mode.getSelectedClass()?.samples.length || 0} total)`)
                            }
                        } else {
                            setCaptureStatus('no-hand')
                            showSaved('⚠️ No hand detected in image. Try another!')
                        }
                    }
                } catch (err) {
                    console.error('[FingerCounter] Upload error:', err)
                    setCaptureStatus('error')
                } finally {
                    setIsCapturing(false)
                    setTimeout(() => setCaptureStatus('idle'), 1500)
                }
            }
        }
        if (collectFileInputRef.current) collectFileInputRef.current.value = ''
    }, [mode, showSaved])

    const handleRemoveSample = useCallback((classId: string, sampleId: string) => {
        mode.removeSample(classId, sampleId)
        // Also try to keep classifier in sync (best-effort rebuild for that class)
        const cls = mode.project?.classes.find(c => c.id === classId)
        if (cls) {
            const remain = cls.samples.filter(s => s.id !== sampleId)
            // Rebuild that class in classifier from remaining keypoints (if any have keypoints)
            // For image-only samples we stored thumb only, so nothing to rebuild – just clear
            // For mixed samples, extract keypoints from payload
            classifierRef.current.clearClass(cls.name)
            // Fire-and-forget rebuild from remaining
            ;(async () => {
                for (const s of remain) {
                    try {
                        const parsed = JSON.parse(s.data)
                        const kpArr = Array.isArray(parsed) ? parsed : parsed?.keypoints
                        if (Array.isArray(kpArr) && kpArr.length > 0) {
                            const f = new Float32Array(kpArr)
                            await classifierRef.current.addSample(f, cls.name)
                        }
                    } catch {}
                }
            })()
        }
        showSaved('🗑️ Sample removed')
    }, [mode, showSaved])

    const handleRemoveSampleWithConfirm = useCallback((classId: string, sampleId: string) => {
        if (confirm('Delete this image?')) handleRemoveSample(classId, sampleId)
    }, [handleRemoveSample])

    const canTrain = !!(mode.project && mode.project.classes.length >= 2 && mode.project.classes.every(c => c.samples.length >= 2))
    const selectedClass = mode.getSelectedClass()

    return (
        <div className="flex flex-col h-full relative overflow-y-auto neura-scrollbar">
            {savedMessage && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-[#0ea5e9] text-white rounded-xl text-xs font-bold shadow-lg animate-fade-in">
                    {savedMessage}
                </div>
            )}

            {/* COLLECT MODE */}
            {mode.mode === 'collect' && (
                <div className="flex-1 flex flex-col overflow-y-auto neura-scrollbar p-3 px-5">
                    <div className="w-full flex flex-col items-center animate-fade-in">
                        <div className="text-center mb-1">
                            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0ea5e9] mb-0">✋ AI Finger Counter!</h2>
                            <p className="text-xs text-[#4a4455]">Show different finger counts and capture them! 🖐️</p>
                        </div>
                        <div className="w-full max-w-[720px]">
                            <WorkflowIndicator mode={mode.mode} onModeChange={mode.setMode} canTrain={canTrain} type="pose" />
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-4 flex-1 mt-3 min-h-0">
                        {/* Camera */}
                        <div className="flex-1 flex flex-col gap-2 min-w-0">
                            {camera.cameraError && !camera.cameraOn && (
                                <div className="flex flex-col items-center justify-center bg-white/85 backdrop-blur-xl rounded-2xl p-5 border border-red-200">
                                    <span className="text-4xl mb-2">🚫</span>
                                    <h3 className="text-sm font-bold text-gray-800 mb-1">Camera Access Needed</h3>
                                    <p className="text-xs text-gray-500 mb-3">{camera.cameraError}</p>
                                    <div className="flex gap-2">
                                        <button onClick={camera.startCamera} className="px-4 py-2 bg-[#0ea5e9] text-white rounded-xl text-xs font-bold">🔄 Try Again</button>
                                        <button onClick={() => collectFileInputRef.current?.click()} className="px-4 py-2 bg-blue-500 text-white rounded-xl text-xs font-bold hover:bg-blue-600">📁 Upload Only</button>
                                    </div>
                                </div>
                            )}

                            <div className="relative rounded-2xl overflow-hidden bg-[#0a0128] flex-1 min-h-[300px]">
                                <video ref={camera.videoRef} autoPlay playsInline muted className={`w-full h-full object-contain -scale-x-100 ${camera.cameraOn ? 'block' : 'hidden'}`} />
                                <canvas ref={canvasRef} className="hidden" />
                                <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

                                {camera.cameraOn && (
                                    <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/40 backdrop-blur-md rounded-md">
                                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                        <span className="text-white text-[9px] font-bold">🔍 LIVE</span>
                                    </div>
                                )}

                                {captureStatus === 'success' && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-green-500/20 backdrop-blur-sm">
                                        <span className="text-6xl">✅</span>
                                    </div>
                                )}
                                {captureStatus === 'no-hand' && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 backdrop-blur-sm">
                                        <span className="text-6xl">✋</span>
                                    </div>
                                )}

                                {!camera.cameraOn && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-5xl mb-3">✋</span>
                                        <h3 className="text-white text-sm font-bold mb-1">Camera is off</h3>
                                        <p className="text-white/50 text-[10px] mb-4">Start camera to collect hand gesture samples</p>
                                        <div className="flex gap-2">
                                            <button onClick={camera.startCamera} className="px-5 py-2.5 bg-[#0ea5e9] text-white rounded-xl text-xs font-bold shadow-lg">📷 Turn On Camera</button>
                                            <button onClick={() => collectFileInputRef.current?.click()} className="px-5 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg hover:bg-blue-600 transition-all">📁 Upload Image</button>
                                        </div>
                                        <p className="text-white/30 text-[9px] mt-3">PNG, JPG up to 10MB</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-center gap-2">
                                <button onClick={camera.toggleCamera} disabled={false} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-[#e0f2fe] text-[#0369a1]">
                                    {camera.cameraOn ? '📷 Stop' : '📷 Start'}
                                </button>
                                <div className="flex items-center gap-1 py-1 px-2 bg-gray-50 rounded-lg">
                                    <span className="text-[9px] font-bold text-gray-500">FPS</span>
                                    <input
                                        type="range"
                                        min={5}
                                        max={30}
                                        step={1}
                                        value={captureFps}
                                        onChange={(e) => setCaptureFps(Number(e.target.value))}
                                        className="w-12 h-1 accent-[#0ea5e9]"
                                    />
                                    <span className="text-[10px] font-bold text-[#0ea5e9] w-4 text-center">{captureFps}</span>
                                </div>
                                <button onClick={handleCapture}
                                    onMouseDown={startBurstCapture}
                                    onMouseUp={stopBurstCapture}
                                    onMouseLeave={stopBurstCapture}
                                    onTouchStart={startBurstCapture}
                                    onTouchEnd={stopBurstCapture}
                                    disabled={!camera.cameraOn || isCapturing || !selectedClass || selectedClass.samples.length >= MAX_SAMPLES_PER_CLASS}
                                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-bold text-white disabled:opacity-40 ${isCapturing ? 'bg-slate-400' : 'bg-[#0ea5e9]'}`}>
                                    {isCapturing ? '⏳ Recording...' : '📸 Hold to Record'}
                                </button>
                                <button onClick={() => collectFileInputRef.current?.click()} disabled={!selectedClass || selectedClass.samples.length >= MAX_SAMPLES_PER_CLASS}
                                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500 text-white disabled:opacity-40 hover:bg-blue-600 transition-all">
                                    📁 Upload
                                </button>
                            </div>
                            <input ref={collectFileInputRef} type="file" accept="image/*" multiple onChange={handleCollectUpload} className="hidden" />
                        </div>

                        {/* Right Panel */}
                        <div className="w-full lg:w-72 flex flex-col gap-2 overflow-y-auto">
                            {/* Tips */}
                            <div className="bg-gradient-to-br from-[#f0f9ff] to-[#e0f2fe] rounded-xl p-3 border border-[#0ea5e9]/10">
                                <p className="text-[10px] font-bold text-[#0369a1] uppercase tracking-wide mb-1.5">💡 Tips</p>
                                <div className="flex flex-col gap-1">
                                    {['Show one hand clearly', 'Good lighting helps', 'Vary hand positions', 'Capture each finger count'].map(tip => (
                                        <span key={tip} className="flex items-center gap-1.5 text-[10px] text-[#1e3a5f]">
                                            <span className="w-1 h-1 rounded-full bg-[#0ea5e9] flex-shrink-0" />
                                            {tip}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-[#f0f9ff] rounded-xl p-2.5 border border-[#e0f2fe]">
                                    <p className="text-[8px] text-gray-500 font-bold uppercase">Classes</p>
                                    <p className="text-lg font-extrabold text-gray-800">{mode.project?.classes.length || 0}</p>
                                </div>
                                <div className="bg-[#f0f9ff] rounded-xl p-2.5 border border-[#e0f2fe]">
                                    <p className="text-[8px] text-gray-500 font-bold uppercase">Samples</p>
                                    <p className="text-lg font-extrabold text-gray-800">{mode.getTotalSamples()}</p>
                                </div>
                            </div>

                            {/* Current Class Samples – now shows actual uploaded images with per-image delete */}
                            {selectedClass && (
                                <div className="bg-white/85 backdrop-blur-xl rounded-xl p-3 border border-gray-100 flex flex-col">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: selectedClass.color }} />
                                            <span className="text-xs font-bold text-gray-800 truncate">{selectedClass.name}</span>
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-400 shrink-0">{selectedClass.samples.length}/{MAX_SAMPLES_PER_CLASS}</span>
                                    </div>
                                    {selectedClass.samples.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-6 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                            <span className="text-2xl mb-1">🖼️</span>
                                            <p className="text-[11px] font-bold text-slate-600">No images yet</p>
                                            <p className="text-[10px] text-slate-400">Capture or upload to see thumbnails here</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-2 max-h-[320px] overflow-y-auto neura-scrollbar pr-0.5 p-0.5">
                                            {selectedClass.samples.map((s, idx) => {
                                                const src = getSampleImageSrc(s)
                                                const label = `${selectedClass.name} #${idx + 1}`
                                                return (
                                                    <div
                                                        key={s.id}
                                                        onClick={() => src && openSingleImage(src, label)}
                                                        title={src ? 'Click to view • Hover for delete' : 'Sample (no preview)'}
                                                        className={`group relative aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 flex items-center justify-center transition-all hover:shadow-md hover:scale-[1.02] ${src ? 'cursor-zoom-in' : 'cursor-default'}`}
                                                    >
                                                        {src ? (
                                                            <img src={src} alt={label} className="w-full h-full object-cover pointer-events-none" draggable={false} />
                                                        ) : (
                                                            <span className="text-lg">✋</span>
                                                        )}
                                                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-white bg-black/55 px-1 py-0.5 rounded-full backdrop-blur-sm">#{idx + 1}</span>
                                                        <button
                                                            onClick={e => { e.stopPropagation(); handleRemoveSampleWithConfirm(selectedClass.id, s.id) }}
                                                            onPointerDown={e => e.stopPropagation()}
                                                            title="Delete this image"
                                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 backdrop-blur border border-slate-200 text-slate-700 flex items-center justify-center text-[11px] font-bold shadow-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"
                                                        >
                                                            ×
                                                        </button>
                                                        {src && (
                                                            <span className="absolute bottom-1 right-1 w-5 h-5 rounded-md bg-black/55 text-white hidden group-hover:flex items-center justify-center text-[10px] backdrop-blur-sm">⛶</span>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                                        <span className="text-[10px] font-bold text-slate-500">{selectedClass.samples.length} image{selectedClass.samples.length !== 1 ? 's' : ''} • click to view</span>
                                        {selectedClass.samples.length > 0 && (
                                            <button
                                                onClick={() => { if (confirm(`Clear all ${selectedClass.samples.length} images from "${selectedClass.name}"?`)) { mode.clearSamples(selectedClass.id); showSaved('🗑️ Cleared all images') } }}
                                                className="text-[10px] font-bold text-red-600 hover:text-red-700 px-2 py-1 rounded-md hover:bg-red-50 transition-colors"
                                            >
                                                Clear all
                                            </button>
                                        )}
                                    </div>
                                    {selectedClass.samples.length > 0 && (
                                        <button
                                            onClick={() => {
                                                const imgs = selectedClass.samples.map(s => getSampleImageSrc(s)).filter(Boolean) as string[]
                                                if (imgs.length > 0) openImageViewer(imgs.map((src, i) => ({ src, label: `${selectedClass.name} #${i + 1}` })), 0)
                                            }}
                                            className="mt-2 w-full py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-700 transition-colors"
                                        >
                                            🔍 View all ({selectedClass.samples.length})
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* TRAIN MODE */}
            {mode.mode === 'train' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-extrabold text-[#0ea5e9] mb-2">🏋️ Training Your AI!</h2>
                        <p className="text-sm text-gray-500">Teaching the AI to recognize your finger counts...</p>
                    </div>
                    <div className="flex flex-col items-center gap-4">
                        <span className="text-6xl">✅</span>
                        <p className="text-sm font-bold text-green-600">Model Ready!</p>
                        <button onClick={() => mode.setMode('test')} className="px-6 py-3 bg-[#0ea5e9] text-white rounded-xl text-sm font-bold shadow-lg">
                            🧪 Start Testing
                            </button>
                        </div>
                </div>
            )}

            {/* TEST MODE */}
            {mode.mode === 'test' && (
                <div className="flex-1 flex flex-col overflow-y-auto neura-scrollbar p-3 px-5">
                    <div className="w-full flex flex-col items-center animate-fade-in">
                        <div className="text-center mb-1">
                            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0ea5e9] mb-0">🧪 Test Your Finger Counter!</h2>
                            <p className="text-xs text-[#4a4455]">Show different finger counts and see what AI detects! 🎯</p>
                        </div>
                        <div className="w-full max-w-[720px]">
                            <WorkflowIndicator mode={mode.mode} onModeChange={mode.setMode} canTrain={canTrain} type="pose" />
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-4 flex-1 mt-3 min-h-0">
                        {/* Camera Feed / Test Image */}
                        <div className="flex-1 flex flex-col min-w-0">
                            <div className="relative rounded-2xl overflow-hidden bg-[#0a0128] flex-1 min-h-[300px] flex items-center justify-center">
                                {camera.cameraOn && (
                                    <video ref={camera.videoRef} autoPlay playsInline muted className="w-full h-full object-contain -scale-x-100" />
                                )}
                                {!camera.cameraOn && testImage && (
                                    <img src={testImage} className="w-full h-full object-contain" />
                                )}
                                <canvas ref={canvasRef} className="hidden" />
                                <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

                                {camera.cameraOn && (
                                    <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/40 backdrop-blur-md rounded-md z-10">
                                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                        <span className="text-white text-[9px] font-bold">🔍 LIVE</span>
                                    </div>
                                )}
                                
                                {!camera.cameraOn && testImage && (
                                    <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/40 backdrop-blur-md rounded-md z-10">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                        <span className="text-white text-[9px] font-bold">📂 TEST IMAGE</span>
                                    </div>
                                )}

                                {/* Large Count Display */}
                                {currentCount > 0 && (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                        <div className="animate-fade-in text-[120px] font-black drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)] leading-none" style={{ color: COUNT_COLORS[currentCount] || '#fff' }}>
                                            {currentCount}
                                        </div>
                                    </div>
                                )}

                                {/* Loading Overlay */}
                                {isProcessing && (
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 py-2 px-3 bg-white/90 backdrop-blur-md rounded-xl shadow-lg z-20">
                                        <div className="w-3.5 h-3.5 border-2 border-[#0ea5e9] border-t-transparent rounded-full animate-spin" />
                                        <span className="text-[10px] font-bold text-gray-900">Analyzing...</span>
                                    </div>
                                )}

                                {!camera.cameraOn && !testImage && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                                        <span className="text-5xl mb-3">📷</span>
                                        <h3 className="text-white text-sm font-bold mb-1">Camera is off</h3>
                                        <p className="text-white/50 text-[10px] mb-4">Start camera or upload an image to test</p>
                                        <div className="flex gap-2">
                                            <button onClick={camera.startCamera} className="px-5 py-2.5 bg-[#0ea5e9] text-white rounded-xl text-xs font-bold shadow-lg cursor-pointer">📷 Start Camera</button>
                                            <button onClick={() => testFileInputRef.current?.click()} className="px-5 py-2.5 bg-white text-[#0ea5e9] border-2 border-[#0ea5e9] rounded-xl text-xs font-bold shadow-lg cursor-pointer">📂 Upload Image</button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Camera & Upload Controls */}
                            <div className="flex flex-wrap items-center justify-center gap-2.5 mt-2.5">
                                {testImage ? (
                                    <>
                                        <button onClick={() => {
                                            setTestImage(null);
                                            setPrediction(null);
                                            setCurrentCount(0);
                                            if (overlayCanvasRef.current) {
                                                const oCtx = overlayCanvasRef.current.getContext('2d');
                                                oCtx?.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
                                            }
                                        }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-[#f1f5f9] text-[#475569] cursor-pointer">
                                            🔄 Clear Image & Start Live
                                        </button>
                                        <button onClick={() => testFileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-[#e0f2fe] text-[#0369a1] cursor-pointer">
                                            📂 Upload Another
                                        </button>
                                        <button onClick={manualPredict} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-gradient-to-br from-[#0ea5e9] to-[#0284c7] text-white shadow-md cursor-pointer">
                                            🔍 Scan Image
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={camera.toggleCamera} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-[#e0f2fe] text-[#0369a1] cursor-pointer">
                                            {camera.cameraOn ? '📷 Stop Camera' : '📷 Start Camera'}
                                        </button>
                                        <button onClick={() => testFileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-[#e0f2fe] text-[#0369a1] cursor-pointer">
                                            📂 Upload Image
                                        </button>
                                        {camera.cameraOn && (
                                            <>
                                                <button onClick={() => setAutoPredict(p => !p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer ${autoPredict ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#fee2e2] text-[#b91c1c]'}`}>
                                                    {autoPredict ? '🔄 Auto Scan: ON' : '⏸️ Auto Scan: OFF'}
                                                </button>
                                                {!autoPredict && (
                                                    <button onClick={manualPredict} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-gradient-to-br from-[#0ea5e9] to-[#0284c7] text-white shadow-md cursor-pointer animate-pulse">
                                                        🔍 Scan Hand
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Right Panel */}
                        <div className="w-full lg:w-72 flex flex-col gap-2 overflow-y-auto">
                            {/* Confidence Threshold */}
                            <div className="bg-white/85 backdrop-blur-xl rounded-xl p-3 border border-gray-100">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-gray-700">🎚️ Confidence</span>
                                    <span className="text-xs font-extrabold text-[#0ea5e9] bg-[#f0f9ff] px-2 py-0.5 rounded-md">{Math.round(confidenceThreshold * 100)}%</span>
                                </div>
                                <input type="range" min="0" max="100" value={Math.round(confidenceThreshold * 100)}
                                    onChange={(e) => setConfidenceThreshold(Number(e.target.value) / 100)}
                                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                                    style={{ background: `linear-gradient(to right, #0ea5e9 ${Math.round(confidenceThreshold * 100)}%, #e5e7eb ${Math.round(confidenceThreshold * 100)}%)` }} />
                            </div>

                            {/* Current Count Display */}
                            <div className="bg-white/85 backdrop-blur-xl rounded-xl p-4 border border-gray-100 text-center">
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Fingers Detected</p>
                                <div className="text-6xl font-black leading-none" style={{ color: COUNT_COLORS[currentCount] || '#94a3b8' }}>
                                    {currentCount || '—'}
                                </div>
                                {prediction && (
                                    <p className="text-xs font-bold text-gray-600 mt-1">
                                        {prediction.label} ({Math.round(prediction.confidences[prediction.label] * 100)}%)
                                    </p>
                                )}
                                <div className="grid grid-cols-5 gap-1 mt-3">
                                    {['👍', '☝️', '✌️', '🤙', '🖐️'].map((emoji, i) => (
                                        <div key={i} className="flex flex-col items-center gap-0.5">
                                            <span className={`text-sm ${fingerFlags[i] > 0.5 ? '' : 'opacity-25 grayscale'}`}>{emoji}</span>
                                            <span className={`text-[10px] font-bold ${fingerFlags[i] > 0.5 ? 'text-emerald-600' : 'text-gray-400'}`}>{fingerFlags[i].toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* All Class Scores */}
                            {prediction && (
                                <ClassScores confidences={prediction.confidences} accentColor="#0ea5e9" accentBg="#f0f9ff" />
                            )}

                            {/* Speed & Hand Status */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-[#f0f9ff] rounded-xl p-2.5 border border-[#e0f2fe]">
                                    <p className="text-[8px] text-gray-500 font-bold uppercase">⚡ Speed</p>
                                    <p className="text-lg font-extrabold text-gray-800">{inferenceTime}ms</p>
                                </div>
                                <div className="bg-[#f0f9ff] rounded-xl p-2.5 border border-[#e0f2fe]">
                                    <p className="text-[8px] text-gray-500 font-bold uppercase">✋ Hand</p>
                                    <p className={`text-lg font-extrabold ${handDetected ? 'text-emerald-500' : 'text-slate-400'}`}>
                                        {handDetected ? 'Found' : 'None'}
                                    </p>
                                </div>
                            </div>

                            {/* Count History */}
                            {countHistory.length > 0 && (
                                <div className="bg-white/85 backdrop-blur-xl rounded-xl p-3 border border-gray-100">
                                    <p className="text-[10px] font-bold text-gray-700 mb-2">📈 Count History</p>
                                    <div className="flex items-end gap-1 h-16">
                                        {countHistory.map((count, i) => (
                                            <div key={i} className="flex-1 rounded-t-xs min-h-1" style={{
                                                height: `${(count / 5) * 100}%`,
                                                background: COUNT_COLORS[count] || '#94a3b8'
                                            }} />
                                        ))}
                                    </div>
                                    <div className="flex justify-between mt-1">
                                        <span className="text-[8px] text-gray-400">Oldest</span>
                                        <span className="text-[8px] text-gray-400">Latest</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <input ref={testFileInputRef} type="file" accept="image/*" onChange={handleTestUpload} className="hidden" />
                </div>
            )}

            {mode.mode === 'collect' && mode.project && (
                <SampleWarningModal
                    classes={mode.project.classes}
                    accentColor="#0ea5e9"
                    accentBg="#f0f9ff"
                    projectType="finger counter"
                />
            )}
        </div>
    )
}
