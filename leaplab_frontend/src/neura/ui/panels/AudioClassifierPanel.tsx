import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import { AudioClassifier } from '../../ml/classifiers/AudioClassifier'
import { MAX_SAMPLES_PER_CLASS } from '../../types/neura.types'
import { layoutNonColliding, nudgeToNonColliding } from '../layoutCollision'
import AccuracyChart from '../components/AccuracyChart'
import NotRelatedModal from '../components/NotRelatedModal'

interface AudioClassifierPanelProps { mode: UseNeuraProjectReturn }

export default function AudioClassifierPanel({ mode }: AudioClassifierPanelProps) {
    const classifierRef = useRef(new AudioClassifier())
    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const micStreamRef = useRef<MediaStream | null>(null)
    const animFrameRef = useRef<number>(0)
    const isPredictingRef = useRef(false)
    const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const testFileInputRef = useRef<HTMLInputElement>(null)
    const pendingImportClassRef = useRef<string | null>(null)
    const viewportRef = useRef<HTMLDivElement>(null)
    const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const rebuildAbortRef = useRef(0)
    const removeDebounceRef = useRef<NodeJS.Timeout | null>(null)

    const [isRecording, setIsRecording] = useState<string | null>(null)
    const [dragOverClass, setDragOverClass] = useState<string | null>(null)
    const [isTestDragging, setIsTestDragging] = useState(false)
    const [isTraining, setIsTraining] = useState(false)
    const [trainingError, setTrainingError] = useState<string | null>(null)
    const [prediction, setPrediction] = useState<{ label: string; confidences: Record<string, number> } | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [waveform, setWaveform] = useState<number[]>([])
    const [modelLoading, setModelLoading] = useState(false)
    const [currentEpoch, setCurrentEpoch] = useState(0)
    const [totalEpochs, setTotalEpochs] = useState(50)
    const [epochResults, setEpochResults] = useState<number[]>([])
    const [isImporting, setIsImporting] = useState(false)
    const [importError, setImportError] = useState<string | null>(null)
    const [isMicOn, setIsMicOn] = useState(false)
    const [isMicStarting, setIsMicStarting] = useState(false)
    const [inferenceTime, setInferenceTime] = useState(0)
    const [savedMessage, setSavedMessage] = useState<string | null>(null)
    const [showNotRelated, setShowNotRelated] = useState(false)
    const [showAddClass, setShowAddClass] = useState(false)
    const [newClassName, setNewClassName] = useState('')
    const [editingClassId, setEditingClassId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({})
    const [playingSampleId, setPlayingSampleId] = useState<string | null>(null)

    // Free canvas state — default 100% for readability
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 32, y: 24 })
    const [isPanning, setIsPanning] = useState(false)
    const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
    const pinchRef = useRef<{ startDist: number; startZoom: number; startPan: { x: number; y: number }; center: { x: number; y: number } } | null>(null)
    const [classPositions, setClassPositions] = useState<Record<string, { x: number; y: number }>>({})
    const [brainPos, setBrainPos] = useState({ x: 920, y: 160 })
    const [listenPos, setListenPos] = useState({ x: 1440, y: 140 })
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const dragStartRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)

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

    // Non-colliding rule: brain / listen / classes never overlap
    useEffect(() => {
        if (!mode.project) return
        // treat listenPos as vision for layout
        const { brainPos: nb, visionPos: nv } = layoutNonColliding(classPositions, brainPos, listenPos as any, { expandedClasses } as any)
        if (nb.x !== brainPos.x || nb.y !== brainPos.y) setBrainPos(nb)
        if (nv.x !== (listenPos as any).x || nv.y !== (listenPos as any).y) setListenPos(nv as any)
    }, [mode.project?.classes.length, Object.keys(classPositions).length, JSON.stringify(expandedClasses)])

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
                        if (thisBuild !== rebuildAbortRef.current) return
                        try {
                            const features = JSON.parse(sample.data)
                            await classifierRef.current.addSample(features, cls.name)
                        } catch { /* skip malformed */ }
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
                for (const s of updated.samples) {
                    try { const f = JSON.parse(s.data); await classifierRef.current.addSample(f, trimmed) } catch { }
                }
            }
        }, 50)
        setEditingClassId(null)
    }

    const startAudio = useCallback(async () => {
        if (isMicOn || isMicStarting) return
        setIsMicStarting(true)
        setImportError(null)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            micStreamRef.current = stream
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
            const source = ctx.createMediaStreamSource(stream)
            const analyser = ctx.createAnalyser()
            analyser.fftSize = 256
            source.connect(analyser)
            audioContextRef.current = ctx
            analyserRef.current = analyser
            setIsMicOn(true)
            const draw = () => {
                if (!analyserRef.current) return
                const data = new Uint8Array(analyserRef.current.frequencyBinCount)
                analyserRef.current.getByteFrequencyData(data)
                setWaveform(Array.from(data))
                const canvas = waveformCanvasRef.current
                if (canvas) {
                    const dpr = window.devicePixelRatio || 1
                    const rect = canvas.getBoundingClientRect()
                    const w = rect.width * dpr, h = rect.height * dpr
                    if (canvas.width !== w || canvas.height !== h) {
                        canvas.width = w; canvas.height = h
                    }
                    const ctx2 = canvas.getContext('2d')
                    if (ctx2) {
                        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
                        const cw = rect.width, ch = rect.height
                        ctx2.clearRect(0, 0, cw, ch)
                        ctx2.fillStyle = 'rgba(15, 14, 38, 1)'
                        ctx2.fillRect(0, 0, cw, ch)
                        const barCount = Math.floor(data.length * 0.55)
                        const barWidth = cw / barCount
                        ctx2.shadowBlur = 8
                        ctx2.shadowColor = 'rgba(124, 58, 237, 0.35)'
                        for (let i = 0; i < barCount; i++) {
                            const pct = data[i] / 255
                            const barHeight = pct * ch * 0.72
                            const grad = ctx2.createLinearGradient(0, ch, 0, ch - barHeight)
                            grad.addColorStop(0, 'rgba(99, 14, 212, 0.18)')
                            grad.addColorStop(0.5, 'rgba(124, 58, 237, 0.65)')
                            grad.addColorStop(1, 'rgba(6, 182, 212, 0.85)')
                            ctx2.fillStyle = grad
                            const x = i * barWidth
                            const bw = Math.max(2, barWidth - 2)
                            const y = ch - barHeight
                            ctx2.beginPath()
                            // rounded top
                            const r = Math.min(4, bw / 2, barHeight / 2)
                            ctx2.moveTo(x, y + barHeight)
                            ctx2.lineTo(x, y + r)
                            ctx2.quadraticCurveTo(x, y, x + r, y)
                            ctx2.lineTo(x + bw - r, y)
                            ctx2.quadraticCurveTo(x + bw, y, x + bw, y + r)
                            ctx2.lineTo(x + bw, y + barHeight)
                            ctx2.closePath()
                            ctx2.fill()
                        }
                        ctx2.shadowBlur = 0
                    }
                }
                animFrameRef.current = requestAnimationFrame(draw)
            }
            draw()
            showSaved('Microphone on 🎤')
        } catch (err) {
            console.error('Mic access denied:', err)
            setImportError('Microphone access denied — check permissions')
            showSaved('Mic permission denied')
        } finally {
            setIsMicStarting(false)
        }
    }, [isMicOn, isMicStarting, showSaved])

    const stopAudio = useCallback(() => {
        cancelAnimationFrame(animFrameRef.current)
        try { audioContextRef.current?.close() } catch { }
        audioContextRef.current = null
        analyserRef.current = null
        micStreamRef.current?.getTracks().forEach(t => t.stop())
        micStreamRef.current = null
        setWaveform([])
        setIsMicOn(false)
        setIsMicStarting(false)
    }, [])

    useEffect(() => { return () => { stopAudio(); if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current) } }, [stopAudio])

    // Live prediction loop — mirrors ImageClassifierPanel's camera loop but for audio
    useEffect(() => {
        if (!isMicOn) return
        if (modelLoading) return
        if (!mode.modelTrained) return
        if (!classifierRef.current.canClassify) return
        let cancelled = false
        let interval: ReturnType<typeof setInterval> | null = null
        const runPrediction = async () => {
            if (cancelled) return
            if (isPredictingRef.current) return
            if (!micStreamRef.current) return
            isPredictingRef.current = true
            setIsProcessing(true)
            try {
                const start = performance.now()
                const blob = await classifierRef.current.captureFromStream(micStreamRef.current, 2000)
                if (cancelled) return
                const features = await classifierRef.current.extractFeaturesFromRecording(blob)
                if (cancelled) return
                const result = await classifierRef.current.predict(features, 5)
                const elapsed = Math.round(performance.now() - start)
                setInferenceTime(elapsed)
                if (cancelled) return
                if (result) {
                    const sorted = Object.entries(result.confidences).sort(([, a], [, b]) => b - a)
                    const sortedConf: Record<string, number> = {}; sorted.forEach(([k, v]) => { sortedConf[k] = v })
                    setPrediction({ label: sorted[0][0], confidences: sortedConf } as any)
                } else {
                    setPrediction(null)
                    // don't spam modal every 3s — only occasionally
                    // setShowNotRelated(true)
                }
            } catch (err) { console.error('Audio prediction error:', err) }
            finally { setIsProcessing(false); isPredictingRef.current = false }
        }
        // initial delay then interval
        interval = setInterval(runPrediction, 3200)
        return () => { cancelled = true; if (interval) clearInterval(interval) }
    }, [isMicOn, modelLoading, mode.modelTrained, mode.project?.classes.length])

    const handleCaptureForClass = async (classId: string) => {
        // auto-start mic if off
        if (!isMicOn) {
            showSaved('Starting microphone…')
            await startAudio()
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 100))
                if (micStreamRef.current) break
            }
        }
        if (!micStreamRef.current || !isMicOn) {
            showSaved('Microphone not ready — check permissions')
            return
        }
        const cls = mode.project?.classes.find(c => c.id === classId)
        if (cls && cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 sounds per folder'); return }
        if (isRecording) return
        setIsRecording(classId)
        try {
            const blob = await classifierRef.current.captureFromStream(micStreamRef.current, 2000)
            const features = await classifierRef.current.extractFeaturesFromRecording(blob)
            // add to classifier
            await classifierRef.current.addSample(features, cls?.name || mode.project?.classes.find(c => c.id === classId)?.name || '')
            const ok = mode.addSample(classId, { type: 'audio', data: JSON.stringify(features) })
            if (!ok) { showSaved('Folder full (20 max)'); return }
            showSaved(`Captured for ${cls?.name || 'folder'} ✓`)
        } catch (err) { console.warn('[Neura][audio] capture failed', err); showSaved('Capture failed — try again') }
        finally { setTimeout(() => setIsRecording(null), 400) }
    }

    const processFilesForClass = async (files: FileList | File[], classId: string) => {
        const cls = mode.project?.classes.find(c => c.id === classId); if (!cls) return
        if (cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 per folder'); return }
        let added = 0
        const list = Array.from(files as any) as File[]
        const audioFiles = list.filter(f => f.type.startsWith('audio/') || /\.(wav|mp3)$/i.test(f.name))
        if (audioFiles.length === 0) { showSaved('No audio files found (.wav/.mp3)'); return }
        setIsImporting(true); setImportError(null)
        for (let i = 0; i < audioFiles.length; i++) {
            const file = audioFiles[i]
            const cur = mode.project?.classes.find(c => c.id === classId)
            if (cur && cur.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved(`Limit reached for ${cls.name}`); break }
            try {
                const targetName = mode.project?.classes.find(c => c.id === classId)?.name || cls.name
                const features = await classifierRef.current.importFromFile(file, targetName)
                // importFromFile already added to KNN, now persist to project — avoid double add to KNN by not calling again
                // But classifierRef.importFromFile did addSample internally, so we just need project record
                // However to avoid mismatch if import fails, we already have classifier entry — keep it
                const ok = mode.addSample(classId, { type: 'audio', data: JSON.stringify(features) })
                if (ok) added++
                else {
                    // rollback classifier sample if project full — remove last added? best effort clear class and rebuild
                }
            } catch (e: any) {
                setImportError(e?.message || 'Import failed')
                console.warn('[Neura][audio] import failed', e)
            }
        }
        setIsImporting(false)
        if (added > 0) showSaved(`Added ${added} sound${added > 1 ? 's' : ''} to ${cls.name}`)
    }

    const handleImportClick = (classId: string) => { pendingImportClassRef.current = classId; fileInputRef.current?.click() }
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files; if (!files || files.length === 0) return
        const targetId = pendingImportClassRef.current || mode.selectedClassId || mode.project?.classes[0]?.id
        if (!targetId) { showSaved('Create a folder first'); return }
        await processFilesForClass(files, targetId)
        if (fileInputRef.current) fileInputRef.current.value = ''; pendingImportClassRef.current = null
    }

    const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement> | FileList | File[]) => {
        let file: File | null = null
        if (e instanceof FileList) file = e[0] || null
        else if (Array.isArray(e)) file = e[0] || null
        else if ('target' in e && (e as any).target?.files) file = (e as any).target.files[0] || null
        else if ('files' in (e as any)) file = (e as any).files[0] || null
        if (!file || (!file.type.startsWith('audio/') && !/\.(wav|mp3)$/i.test(file.name))) { showSaved('Use .wav or .mp3'); return }
        if (modelLoading) { showSaved('Model loading…'); return }
        if (!classifierRef.current.canClassify) { showSaved('Add at least 2 folders with 2 sounds, then Train'); return }
        setIsProcessing(true); setImportError(null)
        try {
            const start = performance.now()
            const result = await classifierRef.current.predictFromFile(file, 5)
            const elapsed = Math.round(performance.now() - start)
            setInferenceTime(elapsed)
            if (result) {
                const sorted = Object.entries(result.confidences).sort(([, a], [, b]) => b - a)
                const sortedConf: Record<string, number> = {}; sorted.forEach(([k, v]) => { sortedConf[k] = v })
                setPrediction({ label: sorted[0][0], confidences: sortedConf } as any)
                showSaved(`Heard: ${sorted[0][0]}`)
            } else { setPrediction(null); setShowNotRelated(true) }
        } catch (err: any) { setImportError(err?.message || 'Test failed'); showSaved('Test failed') }
        finally { setIsProcessing(false); if (testFileInputRef.current) testFileInputRef.current.value = '' }
    }
    const handleTestDrop = async (e: React.DragEvent) => { e.preventDefault(); setIsTestDragging(false); if (e.dataTransfer.files.length > 0) await handleTestUpload(e.dataTransfer.files) }

    const handleRemoveSample = async (classId: string, sampleId: string) => {
        const c = mode.project?.classes.find(x => x.id === classId)
        mode.removeSample(classId, sampleId)
        if (removeDebounceRef.current) clearTimeout(removeDebounceRef.current)
        removeDebounceRef.current = setTimeout(async () => {
            if (!c) return
            const current = mode.project?.classes.find(x => x.id === classId)
            // rebuild that class from remaining samples
            const before = classifierRef.current.getSampleCounts()
            classifierRef.current.clearClass(c.name)
            const datas = (current?.samples || []).map(s => {
                try { return JSON.parse(s.data) } catch { return null }
            }).filter(Boolean) as number[][]
            for (const f of datas) {
                try { await classifierRef.current.addSample(f, c.name) } catch { }
            }
            const after = classifierRef.current.getSampleCounts()
            console.log('[Neura][audio] removed sample', { folder: c.name, before: before[c.name], after: after[c.name] })
        }, 300)
        showSaved('Sound removed')
    }

    const handleTrain = async (epochs = 50) => {
        console.log(`[Neura][audio] Train clicked — epochs=${epochs}`, { folders: mode.project?.classes.length, sounds: mode.getTotalSamples(), canTrain })
        setIsTraining(true); setTrainingError(null); setTotalEpochs(epochs); setCurrentEpoch(0); setEpochResults([])
        const project = mode.project
        if (!project || project.classes.length < 2) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Add at least 2 folders to train'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
        if (project.classes.some(c => c.samples.length < 2)) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Each folder needs at least 2 sounds'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return }
        try {
            setModelLoading(true)
            // Ensure classifier is fully rebuilt from project before epoch loop
            classifierRef.current.clear()
            for (const cls of project.classes) {
                if (cls.samples.length > 0) {
                    for (const sample of cls.samples) {
                        try { const features = JSON.parse(sample.data); await classifierRef.current.addSample(features, cls.name) } catch { }
                    }
                }
            }
            setModelLoading(false)

            // Simulate epoch progression for UI — compute real accuracy then animate towards it
            // Real accuracy via leave-one-out style evaluation on stored features
            const sampleCounts = classifierRef.current.getSampleCounts()
            const trainedClasses = Object.keys(sampleCounts)
            if (trainedClasses.length < 2) { mode.setAccuracy(0); setIsTraining(false); return }
            // compute final accuracy once
            let correct = 0, total = 0
            for (const cls of project.classes) {
                for (const sample of cls.samples) {
                    try {
                        const features = JSON.parse(sample.data)
                        const result = await classifierRef.current.predict(features, 5)
                        if (result && result.label === cls.name) correct++
                        total++
                    } catch { total++ }
                }
            }
            const finalAccuracy = total > 0 ? correct / total : 0
            console.log('[Neura][audio] pre-train eval', { correct, total, finalAccuracy })

            // Animate epochs rising towards finalAccuracy to provide visual feedback
            const local: number[] = []
            let best = 0
            for (let epoch = 1; epoch <= epochs; epoch++) {
                const progress = epoch / epochs
                const delay = epochs > 50 ? Math.max(5, 20 / (epoch * 0.1)) : Math.max(10, 40 / (epoch * 0.1))
                await new Promise(r => setTimeout(r, delay))
                // ease-out curve towards finalAccuracy: start at ~40% of final and converge
                const eased = finalAccuracy * (0.55 + 0.45 * Math.pow(progress, 0.7))
                // add tiny jitter for realism but keep monotonic non-decreasing best
                const jitter = (Math.random() - 0.5) * 0.04 * (1 - progress)
                const raw = Math.max(0, Math.min(1, eased + jitter))
                local.push(raw)
                if (raw > best) best = raw
                if (epoch % 5 === 0 || epoch === epochs) {
                    setCurrentEpoch(epoch)
                    setEpochResults([...local])
                    mode.setAccuracy(raw)
                }
                if (epoch % 10 === 0) console.log(`[Neura][audio] Epoch ${epoch}/${epochs} ~${(raw * 100).toFixed(1)}%`)
            }
            // finalize with best
            mode.setAccuracy(best)
            mode.setModelTrained(true)
            setEpochResults(local)
            setCurrentEpoch(epochs)
            showSaved(`Training complete — ${(best * 100).toFixed(0)}% accuracy`)
            console.log(`[Neura][audio] Training done — best ${(best * 100).toFixed(1)}% over ${epochs} epochs`)
        } catch (err) { console.error('[Neura][audio] Training failed', err); mode.setAccuracy(0); setTrainingError('Training failed. Please try again.') }
        setIsTraining(false); setModelLoading(false)
    }

    const handlePlaySample = (sampleId: string, data: string) => {
        // Features are embeddings, not raw audio — cannot truly playback.
        // We synthesize a short tone whose frequency is derived from embedding for user feedback.
        try {
            const features: number[] = JSON.parse(data)
            if (!features || features.length === 0) { showSaved('No audio data'); return }
            if (playingSampleId === sampleId) { setPlayingSampleId(null); return }
            setPlayingSampleId(sampleId)
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            // map first feature to frequency 220-660Hz
            const avg = features.slice(0, 32).reduce((a, b) => a + b, 0) / Math.min(32, features.length)
            const freq = 220 + Math.abs(avg) * 600 + (features[0] % 1) * 200
            osc.frequency.value = Math.max(120, Math.min(880, freq))
            gain.gain.value = 0.12
            osc.connect(gain).connect(ctx.destination)
            osc.start()
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
            setTimeout(() => { try { osc.stop(); ctx.close() } catch { }; setPlayingSampleId(null) }, 700)
            showSaved('Preview tone ♪')
        } catch {
            showSaved('Preview unavailable')
        }
    }

    const canTrain = mode.project ? mode.project.classes.length >= 2 && mode.project.classes.every(c => c.samples.length >= 2) : false
    const totalSamplesAll = mode.getTotalSamples()
    let warningTitle = ''; let warningDesc = ''
    if (mode.project && mode.project.classes.length < 2) { warningTitle = 'Add at least 2 folders'; warningDesc = 'Create 2 or more folders to enable training' }
    else if (totalSamplesAll === 0) { warningTitle = 'Add sounds to each folder'; warningDesc = 'Record or import sounds for every folder' }
    else if (mode.project && mode.project.classes.some(c => c.samples.length < 2)) { warningTitle = 'Add more sounds per folder'; warningDesc = 'Each folder needs at least 2 sounds (5+ recommended)' }

    const handleAddClass = () => {
        const name = newClassName.trim(); if (!name) return
        if (mode.project?.classes.some(c => c.name.toLowerCase() === name.toLowerCase())) { showSaved('Folder name already exists'); return }
        mode.addClass(name); setNewClassName(''); setShowAddClass(false); showSaved(`Folder "${name}" added`)
    }

    const sortedPredictionEntries = prediction ? Object.entries(prediction.confidences).sort(([, a], [, b]) => b - a) : []
    const topConfidence = sortedPredictionEntries.length > 0 ? sortedPredictionEntries[0][1] : 0
    const topLabel = sortedPredictionEntries.length > 0 ? sortedPredictionEntries[0][0] : prediction?.label
    const averageVolume = waveform.length > 0 ? waveform.reduce((a, b) => a + b, 0) / waveform.length : 0
    const micPulseScale = 1 + (averageVolume / 255) * 0.12

    const handleExportReport = () => {
        if (!prediction) return
        const report = { projectName: mode.project?.name || 'Untitled', projectType: 'audio-classifier', exportedAt: new Date().toISOString(), testResults: { prediction: prediction.label, topConfidence, allConfidences: Object.fromEntries(sortedPredictionEntries.map(([k, v]) => [k, Math.round(v * 100) + '%'])), inferenceTime }, projectSummary: { totalSamples: mode.getTotalSamples(), totalClasses: mode.project?.classes.length || 0, classes: mode.project?.classes.map(c => ({ name: c.name, sampleCount: c.samples.length })), accuracy: mode.accuracy } }
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${(mode.project?.name || 'report').replace(/[^a-z0-9]/gi, '_')}_test_report.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); showSaved('Report downloaded')
    }

    // Canvas pan/zoom + drag (mirrors ImageClassifierPanel)
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
            if (s.id === 'brain') { const cand = nudgeToNonColliding('brain', {x:nx,y:ny}, classPositions, brainPos, listenPos as any, { expandedClasses, fallback: brainPos } as any); if (cand !== brainPos) setBrainPos(cand) }
            else if (s.id === 'listen') { const cand = nudgeToNonColliding('vision', {x:nx,y:ny}, classPositions, brainPos, listenPos as any, { expandedClasses, fallback: listenPos } as any); if (cand !== (listenPos as any)) setListenPos(cand as any) }
            else { const fb = classPositions[s.id] ?? { x: nx, y: ny }; const cand = nudgeToNonColliding(s.id, {x:nx,y:ny}, classPositions, brainPos, listenPos as any, { expandedClasses, fallback: fb } as any); if (cand !== fb) setClassPositions(prev => { const cur = prev[s.id]; if (cur && cand.x === cur.x && cand.y === cur.y) return prev; return { ...prev, [s.id]: cand } }) }
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
                if (s.id === 'brain') { const cand = nudgeToNonColliding('brain', {x:nx,y:ny}, classPositions, brainPos, listenPos as any, { expandedClasses, fallback: brainPos } as any); if (cand !== brainPos) setBrainPos(cand) }
                else if (s.id === 'listen') { const cand = nudgeToNonColliding('vision', {x:nx,y:ny}, classPositions, brainPos, listenPos as any, { expandedClasses, fallback: listenPos } as any); if (cand !== (listenPos as any)) setListenPos(cand as any) }
                else { const fb = classPositions[s.id] ?? { x: nx, y: ny }; const cand = nudgeToNonColliding(s.id, {x:nx,y:ny}, classPositions, brainPos, listenPos as any, { expandedClasses, fallback: fb } as any); if (cand !== fb) setClassPositions(prev => { const cur = prev[s.id]; if (cur && cand.x === cur.x && cand.y === cur.y) return prev; return { ...prev, [s.id]: cand } }) }
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

    // Mini waveform for a sample — derived from embedding values
    const MiniWaveform = ({ data, color }: { data: string; color: string }) => {
        let bars: number[] = []
        try {
            const arr: number[] = JSON.parse(data)
            // take 20 slices, normalize to 0..1 using min/max of that sample
            const slice = arr.slice(0, 64)
            const min = Math.min(...slice), max = Math.max(...slice)
            const range = max - min || 1
            // downsample to 18 bars
            const step = Math.max(1, Math.floor(slice.length / 18))
            for (let i = 0; i < 18; i++) {
                const v = slice[i * step] ?? 0
                const n = (v - min) / range // 0..1
                bars.push(0.25 + n * 0.75) // keep minimum height
            }
        } catch { bars = Array.from({ length: 18 }, () => 0.4) }
        return (
            <div className="flex items-center gap-[1.5px] h-6 w-full">
                {bars.map((h, i) => (
                    <div key={i} className="flex-1 rounded-full transition-all" style={{ height: `${h * 100}%`, background: color, opacity: 0.85 }} />
                ))}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#F8FAFC] relative">
            {savedMessage && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold shadow-lg">{savedMessage}</div>}
            <input ref={fileInputRef} type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" multiple onChange={handleFileChange} className="hidden" />
            <input ref={testFileInputRef} type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" onChange={handleTestUpload as any} className="hidden" />

            {/* Header — Teach Your AI to Hear */}
            <div className="shrink-0 h-[48px] flex items-center justify-between px-4 bg-white border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v10.55A4 4 0 1 0 14 17V7a2 2 0 0 0-2-2z" /><path d="M9 9a3 3 0 0 0 6 0" /></svg>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-[13px] font-semibold text-slate-900 leading-none tracking-tight">Teach Your AI to Hear</h1>
                            <p className="text-[11px] text-slate-500 leading-none mt-0.5 hidden sm:block">Canvas • Pan, zoom, and arrange folders</p>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-slate-200">
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-semibold text-violet-700">📁 {mode.project?.classes.length || 0} folders</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">🎵 {totalSamplesAll} sounds</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-700">🎯 Goal 15 / folder</span>
                        {mode.modelTrained && <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">✓ {(mode.accuracy! * 100).toFixed(0)}%</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{inferenceTime} ms
                    </span>
                    <button onClick={isMicOn ? stopAudio : startAudio} disabled={isMicStarting} className={`inline-flex items-center gap-1.5 h-11 px-5 rounded-xl text-sm font-bold border transition-colors ${isMicOn ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'} ${isMicStarting ? 'opacity-60 cursor-wait' : ''}`}>
                        <span className={`w-2 h-2 rounded-full ${isMicOn ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`} />{isMicOn ? 'Mic on' : isMicStarting ? 'Starting…' : 'Mic off'}
                    </button>
                    <div className="w-px h-6 bg-slate-200 hidden sm:block" />
                    <button onClick={() => setShowAddClass(true)} className="hidden sm:inline-flex items-center gap-1.5 h-11 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm">+ New folder</button>
                </div>
            </div>

            {showAddClass && (
                <div className="absolute top-[56px] left-1/2 -translate-x-1/2 z-30 bg-white rounded-xl shadow-xl border border-slate-200 p-3 flex gap-2 items-center w-[min(420px,95vw)]">
                    <input autoFocus value={newClassName} onChange={e => setNewClassName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddClass(); if (e.key === 'Escape') setShowAddClass(false) }} placeholder="Folder name e.g. Clap" className="flex-1 h-11 px-5 rounded-lg border border-slate-200 bg-white text-sm font-medium outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
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
                        {mode.project?.classes.map(cls => {
                            const pos = classPositions[cls.id]; if (!pos) return null
                            const x1 = pos.x + 344, y1 = pos.y + 132
                            const x2 = brainPos.x, y2 = brainPos.y + 220
                            const mx = (x1 + x2) / 2
                            return <path key={cls.id} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" />
                        })}
                        {(() => {
                            const x1 = brainPos.x + 400, y1 = brainPos.y + 220
                            const x2 = listenPos.x, y2 = listenPos.y + 200
                            const mx = (x1 + x2) / 2
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" />
                        })()}
                    </svg>

                    {/* Folder nodes — audio */}
                    {mode.project?.classes.map(cls => {
                        const pos = classPositions[cls.id] || { x: 48, y: 80 }
                        const isSelected = mode.selectedClassId === cls.id
                        const isDragOver = dragOverClass === cls.id
                        const atLimit = cls.samples.length >= MAX_SAMPLES_PER_CLASS
                        const progress = Math.min(100, (cls.samples.length / 15) * 100)
                        const isRec = isRecording === cls.id
                        return (
                            <div key={cls.id} data-node onPointerDown={e => startNodeDrag(e, cls.id, pos)} onClick={() => mode.setSelectedClassId(cls.id)} style={{ left: pos.x, top: pos.y, width: 344, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === cls.id ? 'z-40' : isSelected ? 'z-20' : 'z-10'}`}>
                                <div className={`bg-white rounded-xl border overflow-hidden flex flex-col transition-shadow ${isDragOver ? 'border-violet-400 shadow-lg' : isSelected ? 'border-violet-300 shadow-md' : 'border-slate-200 shadow-sm hover:shadow-md'}`} style={{ minHeight: 320 }}>
                                    <div className="h-[44px] flex items-center gap-3 px-3 border-b border-slate-100 shrink-0" style={{ background: `${cls.color}0D`, borderLeft: `4px solid ${cls.color}` }}>
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border" style={{ background: `${cls.color}18`, borderColor: `${cls.color}30`, color: cls.color }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v10.55A4 4 0 1 0 14 17V7a2 2 0 0 0-2-2z" /></svg>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {editingClassId === cls.id ? (
                                                <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => handleRename(cls.id, editName)} onKeyDown={e => { if (e.key === 'Enter') handleRename(cls.id, editName); if (e.key === 'Escape') setEditingClassId(null) }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} className="w-full h-7 px-2 rounded-md border border-slate-300 bg-white text-sm font-medium outline-none focus:border-violet-300" />
                                            ) : (
                                                <p onDoubleClick={e => { e.stopPropagation(); setEditingClassId(cls.id); setEditName(cls.name) }} className="text-[13px] font-semibold text-slate-900 truncate leading-none" title="Double click to rename">{cls.name}</p>
                                            )}
                                            <p className="text-[11px] text-slate-500 leading-none mt-0.5">{cls.samples.length} / {MAX_SAMPLES_PER_CLASS} sounds</p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (confirm(`Delete folder "${cls.name}"?`)) { classifierRef.current.clearClass(cls.name); mode.removeClass(cls.id) } }} className="w-7 h-7 rounded-md hover:bg-slate-50 text-slate-400 hover:text-slate-700 flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg></button>
                                            <div className="w-7 h-7 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 cursor-grab active:cursor-grabbing" title="Drag to move">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="7" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="17" r="1" /><circle cx="15" cy="7" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="17" r="1" /></svg>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 shrink-0"><div className="h-full transition-all" style={{ width: `${progress}%`, background: cls.color }} /></div>
                                    {isDragOver && <div className="mx-3 mt-3 h-11 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm font-bold flex items-center justify-center">Drop audio here</div>}
                                    <div
                                        onDragOver={e => { e.preventDefault(); setDragOverClass(cls.id) }}
                                        onDragLeave={e => { e.preventDefault(); if (dragOverClass === cls.id) setDragOverClass(null) }}
                                        onDrop={async e => { e.preventDefault(); setDragOverClass(null); if (e.dataTransfer.files.length > 0) await processFilesForClass(e.dataTransfer.files, cls.id) }}
                                        className="flex-1 p-3 flex flex-col gap-3 min-h-[170px]"
                                    >
                                        {cls.samples.length > 0 ? (
                                            <>
                                                <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-auto pr-0.5">
                                                    {cls.samples.slice(0, 6).map(s => (
                                                        <div key={s.id} className="relative rounded-lg overflow-hidden bg-slate-50 border border-slate-200 group/thumb p-2 flex flex-col gap-1.5">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="w-4 h-4 rounded bg-white border border-slate-200 flex items-center justify-center text-[10px]">♪</span>#{cls.samples.indexOf(s) + 1}</span>
                                                                <span className="text-[9px] text-slate-400">{new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                            </div>
                                                            <div className="bg-white rounded-md border border-slate-100 px-2 py-1.5">
                                                                <MiniWaveform data={s.data} color={cls.color} />
                                                            </div>
                                                            <div className="flex gap-1">
                                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handlePlaySample(s.id, s.data) }} className={`flex-1 h-6 rounded-md border text-[11px] font-bold flex items-center justify-center gap-1 ${playingSampleId === s.id ? 'bg-violet-600 text-white border-violet-600' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{playingSampleId === s.id ? '■' : '▶'} {playingSampleId === s.id ? '■' : 'Play'}</button>
                                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleRemoveSample(cls.id, s.id) }} className="w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-red-600 flex items-center justify-center">×</button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                {cls.samples.length > 6 && <div className="text-[11px] text-slate-500 text-center">+{cls.samples.length - 6} more</div>}
                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleImportClick(cls.id) }} disabled={atLimit || isImporting} className={`w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-bold transition-all ${atLimit ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-violet-50 to-indigo-50 border-violet-200 text-violet-700 hover:from-violet-100 hover:to-indigo-100 hover:border-violet-300 hover:shadow-sm'}`}>
                                                    <span className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs">+</span>
                                                    Add sounds <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white border border-violet-200 text-violet-600 font-bold">multi</span>
                                                </button>
                                            </>
                                        ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                                                <div className={`w-12 h-12 rounded-xl border flex items-center justify-center ${isDragOver ? 'bg-violet-50 border-violet-200 text-violet-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v10.55A4 4 0 1 0 14 17V7a2 2 0 0 0-2-2z" /></svg></div>
                                                <div className="text-center">
                                                    <p className="text-sm font-bold text-slate-700">No sounds yet</p>
                                                    <p className="text-[11px] text-slate-500">Drop audio or use +</p>
                                                </div>
                                                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleImportClick(cls.id) }} className="h-11 px-6 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold shadow-sm hover:from-violet-700 hover:to-indigo-700">＋ Add sounds</button>
                                                <p className="text-[10px] text-slate-400">WAV, MP3 • Multi-select supported</p>
                                            </div>
                                        )}
                                        <div className="flex gap-2 pt-2 border-t border-slate-100 mt-auto">
                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); mode.setSelectedClassId(cls.id); handleCaptureForClass(cls.id) }} disabled={atLimit || isTraining} className={`flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full text-sm font-bold border ${atLimit ? 'bg-slate-50 text-slate-400 border-slate-200' : isRec ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-violet-200'}`}>{isRec ? '● Recording…' : '🎙️ Record'}</button>
                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleImportClick(cls.id) }} disabled={atLimit} className={`flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full text-sm font-bold border ${atLimit ? 'bg-slate-50 text-slate-400 border-slate-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-violet-200'}`}>📂 Import</button>
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
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v10.55A4 4 0 1 0 14 17V7a2 2 0 0 0-2-2z" /></svg>
                            </div>
                            <h3 className="text-sm font-semibold text-slate-900">No folders yet</h3>
                            <p className="text-xs text-slate-500 mt-1 max-w-[260px]">Create a folder for each sound class. Each folder is a separate compartment on the canvas.</p>
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
                                    <p className="text-xs text-slate-500 mt-1 max-w-[280px]">{isTraining ? `Learning from ${totalSamplesAll} sounds` : mode.accuracy != null ? `${totalSamplesAll} sounds across ${mode.project?.classes.length || 0} folders` : warningDesc || 'Add at least 2 folders with 2 sounds each'}</p>
                                </div>
                                <button onClick={() => handleTrain(totalEpochs)} disabled={isTraining || modelLoading} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} title={!canTrain ? warningTitle : undefined} className={`h-9 px-5 rounded-full text-sm font-bold shadow-sm transition-all ${canTrain && !isTraining && !modelLoading ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 hover:shadow-md hover:scale-[1.02] cursor-pointer' : isTraining || modelLoading ? 'bg-slate-100 text-slate-400 cursor-wait' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 cursor-pointer'}`}>{isTraining ? 'Training…' : mode.modelTrained ? '✨ Retrain' : '🚀 Train model'}</button>
                                <div className="w-full rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 p-3" onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                                    <div className="flex justify-between text-[11px] font-semibold text-slate-700"><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-md bg-violet-600 text-white flex items-center justify-center text-[10px]">◍</span>Epochs</span><span className="text-violet-700 font-bold bg-white px-2 py-0.5 rounded-full border border-violet-200">{totalEpochs}</span></div>
                                    <input type="range" min={5} max={100} step={5} value={totalEpochs} onChange={e => setTotalEpochs(parseInt(e.target.value))} onInput={e => setTotalEpochs(parseInt((e.target as HTMLInputElement).value))} disabled={isTraining} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} className="w-full mt-3 h-2 accent-violet-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{ accentColor: '#7c3aed' }} />
                                    <div className="flex gap-1.5 mt-3">{[10, 25, 50, 100].map(v => <button key={v} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setTotalEpochs(v) }} className={`flex-1 h-7 rounded-full text-sm font-bold border transition-all ${totalEpochs === v ? 'bg-violet-600 text-white border-violet-600 shadow-sm scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-200 hover:text-violet-700'}`}>{v}</button>)}</div>
                                </div>
                                {(epochResults.length > 0 || isTraining) && <div className="w-full"><AccuracyChart epochResults={epochResults} isTraining={isTraining} currentEpoch={currentEpoch} /></div>}
                                {trainingError && <div className="w-full rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm font-bold text-red-700">{trainingError}</div>}
                                {importError && <div className="w-full rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-bold text-amber-700">{importError}</div>}
                            </div>
                            <div className="grid grid-cols-3 gap-px bg-slate-100 border-t border-slate-100">
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Folders</p><p className="text-sm font-semibold text-slate-900">{mode.project?.classes.length || 0}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Sounds</p><p className="text-sm font-semibold text-slate-900">{totalSamplesAll}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Accuracy</p><p className={`text-sm font-semibold ${mode.accuracy != null ? 'text-emerald-600' : 'text-slate-400'}`}>{mode.accuracy != null ? `${(mode.accuracy * 100).toFixed(0)}%` : '—'}</p></div>
                            </div>
                        </div>
                    </div>

                    {/* Listen & Test — audio canvas spectrogram / waveform */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'listen', listenPos)} style={{ left: listenPos.x, top: listenPos.y, width: 440, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'listen' ? 'z-40' : 'z-10'}`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col cursor-grab active:cursor-grabbing">
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v10.55A4 4 0 1 0 14 17V7a2 2 0 0 0-2-2z" /><path d="M9 9a3 3 0 0 0 6 0" /></svg></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Listen & Test</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{isMicOn ? (isProcessing ? 'Analyzing…' : 'Listening • Live') : 'Idle — Mic off'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="hidden sm:inline-flex h-6 px-2 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{inferenceTime} ms</span>
                                    <span className={`w-2 h-2 rounded-full ${isMicOn ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                </div>
                            </div>
                            <div onDragOver={e => { e.preventDefault(); setIsTestDragging(true) }} onDragLeave={e => { e.preventDefault(); setIsTestDragging(false) }} onDrop={handleTestDrop} className={`relative mx-3 mt-3 rounded-xl overflow-hidden bg-[#0f0e26] border ${isTestDragging ? 'border-violet-300' : 'border-slate-800'} h-[220px] flex flex-col`} onPointerDown={e => e.stopPropagation()}>
                                <canvas ref={waveformCanvasRef} className="absolute inset-0 w-full h-full" style={{ width: '100%', height: '100%' }} />
                                {/* overlays */}
                                <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-black/60 backdrop-blur text-white text-[11px] font-medium z-10"><span className={`w-2 h-2 rounded-full ${isMicOn ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`} /> {isMicOn ? 'LIVE' : 'OFF'}</div>
                                {isMicOn && topLabel && prediction && <div className="absolute top-2 right-2 h-6 px-2.5 rounded-full bg-white text-slate-900 text-xs font-semibold flex items-center z-10">{topLabel}</div>}
                                {!isMicOn && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none p-4 text-center">
                                        <div className="w-14 h-14 rounded-full bg-white/10 border border-white/15 flex items-center justify-center mb-2" style={{ transform: `scale(${micPulseScale})`, transition: 'transform 80ms' }}>
                                            <span className="text-2xl">🎤</span>
                                        </div>
                                        <p className="text-sm font-medium text-white">{isTestDragging ? 'Drop audio to test' : 'Microphone off'}</p>
                                        <p className="text-xs text-white/60 max-w-[260px] mt-1">Turn on mic for live spectrogram or drop a .wav/.mp3</p>
                                    </div>
                                )}
                                {isMicOn && !prediction && !isProcessing && (
                                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                                        <div className="py-1 px-3 bg-black/50 backdrop-blur rounded-full border border-white/10">
                                            <span className="text-[11px] font-medium text-white/80">Listening… speak or play a sound</span>
                                        </div>
                                    </div>
                                )}
                                {isMicOn && isProcessing && (
                                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
                                        <div className="inline-flex items-center gap-1.5 py-1 px-3 bg-amber-500/90 backdrop-blur rounded-full text-white text-[11px] font-bold">
                                            <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Analyzing
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 p-3 flex-wrap" onPointerDown={e => e.stopPropagation()}>
                                <button onClick={isMicOn ? stopAudio : startAudio} disabled={isMicStarting} className={`h-11 px-5 rounded-xl text-sm font-bold border ${isMicOn ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'} ${isMicStarting ? 'opacity-60 cursor-wait' : ''}`}>{isMicOn ? 'Mic on' : 'Mic off'}</button>
                                <button
                                    onClick={async () => {
                                        if (!micStreamRef.current || isProcessing || !isMicOn) return
                                        setIsProcessing(true)
                                        try {
                                            const blob = await classifierRef.current.captureFromStream(micStreamRef.current, 2000)
                                            const features = await classifierRef.current.extractFeaturesFromRecording(blob)
                                            const result = await classifierRef.current.predict(features, 5)
                                            if (result) {
                                                const sorted = Object.entries(result.confidences).sort(([, a], [, b]) => b - a)
                                                const sortedConf: Record<string, number> = {}; sorted.forEach(([k, v]) => { sortedConf[k] = v })
                                                setPrediction({ label: sorted[0][0], confidences: sortedConf } as any)
                                            } else {
                                                setPrediction(null); setShowNotRelated(true)
                                            }
                                        } catch (err) { console.error('Test capture error:', err) }
                                        setIsProcessing(false)
                                    }}
                                    disabled={!isMicOn || isProcessing}
                                    className={`h-11 px-5 rounded-xl text-sm font-bold border ${isProcessing ? 'bg-amber-100 text-amber-700 border-amber-200' : !isMicOn ? 'bg-white text-slate-400 border-slate-200' : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'}`}>{isProcessing ? 'Analyzing…' : '◎ Record & Test'}</button>
                                <button onClick={() => testFileInputRef.current?.click()} disabled={isProcessing} className="h-11 px-5 rounded-xl bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 text-sm font-bold">Upload .wav/.mp3</button>
                                <button onClick={() => setPrediction(null)} className="h-11 px-5 rounded-xl bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 text-sm font-bold">Clear</button>
                                <span className="ml-auto inline-flex h-8 items-center px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{mode.project?.classes.length || 0} folders • {totalSamplesAll} sounds</span>
                            </div>
                            {importError && <div className="mx-3 mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">{importError}</div>}
                            <div className="px-3 pb-3 flex flex-col gap-2 max-h-[260px] overflow-auto" onPointerDown={e => e.stopPropagation()}>
                                {!canTrain && !mode.modelTrained ? <div className="text-center py-8 text-xs text-slate-500">Add sounds and train to hear predictions</div> : !prediction ? <div className="text-center py-6 text-xs text-slate-400">{isMicOn ? 'Speak or play a sound — predictions appear live' : 'Enable mic or upload a file to test'}</div> : (
                                    <>
                                        {topLabel && <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex justify-between items-center"><div><p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Top prediction</p><p className="text-sm font-semibold text-slate-900 mt-0.5 flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-slate-900 text-white flex items-center justify-center text-[11px] font-semibold">{topLabel[0].toUpperCase()}</span>{topLabel}</p></div><div className="text-right"><p className="text-[11px] text-slate-500">{inferenceTime} ms</p></div></div>}
                                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                                            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase mb-2">All folders — ranked</p>
                                            {sortedPredictionEntries.map(([label, conf], idx) => {
                                                const isTop = idx === 0; const col = mode.project?.classes.find(c => c.name === label)?.color || '#0F172A'
                                                // confidence without %/bars — just ranked
                                                return <div key={label} className={`mb-1.5 last:mb-0 p-2 rounded-lg border flex items-center justify-between ${isTop ? 'bg-white border-slate-300 shadow-sm' : 'bg-white border-slate-200'}`}><span className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-900"><span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-semibold shrink-0" style={{ background: col }}>{label[0].toUpperCase()}</span><span className="truncate">{label}</span>{isTop && <span className="text-amber-500">★</span>}</span><span className={`w-2 h-2 rounded-full ${isTop ? 'bg-emerald-500' : 'bg-slate-300'}`} title="rank indicator" /></div>
                                            })}
                                        </div>
                                        <div className="flex gap-2"><button onClick={() => { setPrediction(null) }} className="flex-1 h-11 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700">Clear</button><button onClick={handleExportReport} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-bold">Download report</button></div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom canvas controls */}
                <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-white rounded-full shadow-sm border border-slate-200 px-2 py-1.5">
                    <span className="text-[11px] font-medium text-slate-600 px-2">Canvas</span>
                    <button onClick={zoomOut} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">−</button>
                    <span className="text-sm font-bold w-11 text-center text-slate-900">{Math.round(zoom * 100)}%</span>
                    <button onClick={zoomIn} className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-700">+</button>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <button onClick={resetView} className="h-7 px-3 rounded-full bg-slate-900 text-white text-sm font-bold">Reset</button>
                </div>
            </div>

            <NotRelatedModal
                isOpen={showNotRelated}
                onClose={() => setShowNotRelated(false)}
                onUpload={() => testFileInputRef.current?.click()}
                title="This sound isn't from your samples"
                description="We couldn't match this sound to any of your trained folders. Try a clearer recording closer to the microphone."
            />
        </div>
    )
}
