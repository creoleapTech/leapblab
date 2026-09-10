import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'
import { TextClassifier } from '../../ml/classifiers/TextClassifier'
import { MAX_SAMPLES_PER_CLASS } from '../../types/neura.types'
import AccuracyChart from '../components/AccuracyChart'
import NotRelatedModal from '../components/NotRelatedModal'

interface TextClassifierPanelProps { mode: UseNeuraProjectReturn }

export default function TextClassifierPanel({ mode }: TextClassifierPanelProps) {
    const classifierRef = useRef(new TextClassifier())
    const viewportRef = useRef<HTMLDivElement>(null)
    const rebuildAbortRef = useRef(0)
    const removeDebounceRef = useRef<NodeJS.Timeout | null>(null)
    const predictTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const [textInput, setTextInput] = useState('')
    const [isTraining, setIsTraining] = useState(false)
    const [trainingError, setTrainingError] = useState<string | null>(null)
    const [prediction, setPrediction] = useState<{ label: string; confidences: Record<string, number> } | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
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
    const [sampleInputs, setSampleInputs] = useState<Record<string, string>>({})

    // Free canvas state — default 100% for readability
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 32, y: 24 })
    const [isPanning, setIsPanning] = useState(false)
    const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
    const pinchRef = useRef<{ startDist: number; startZoom: number; startPan: { x: number; y: number }; center: { x: number; y: number } } | null>(null)
    const [classPositions, setClassPositions] = useState<Record<string, { x: number; y: number }>>({})
    const [brainPos, setBrainPos] = useState({ x: 920, y: 160 })
    const [testPos, setTestPos] = useState({ x: 1440, y: 140 })
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
                    try {
                        await classifierRef.current.addSampleBatch(cls.samples.map(s => s.data), cls.name)
                    } catch (e) {
                        console.warn('[Neura][text] rebuild failed for', cls.name, e)
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
                    try { await classifierRef.current.addSampleBatch(updated.samples.map(s => s.data), trimmed) } catch { }
                }
            }
        }, 50)
        setEditingClassId(null)
    }

    const handleAddText = useCallback(() => {
        if (!textInput.trim()) return
        // Auto-select first class if none selected
        if (!mode.selectedClassId && mode.project && mode.project.classes.length > 0) {
            mode.setSelectedClassId(mode.project.classes[0].id)
        }
        if (!mode.selectedClassId) return
        const selectedClass = mode.getSelectedClass()
        if (selectedClass && selectedClass.samples.length >= MAX_SAMPLES_PER_CLASS) {
            showSaved('Maximum 20 texts per folder')
            return
        }
        const targetName = selectedClass?.name || mode.project?.classes.find(c => c.id === mode.selectedClassId)?.name || ''
        const ok = mode.addSample(mode.selectedClassId, { type: 'text', data: textInput.trim() })
        if (!ok) { showSaved('Folder full (20 max)'); return }
        classifierRef.current.addSample(textInput.trim(), targetName).catch(() => { })
        setTextInput('')
        showSaved(`Added to ${targetName || 'folder'}`)
    }, [textInput, mode, showSaved])

    const handleAddTextForClass = useCallback(async (classId: string, rawText?: string) => {
        const txt = (rawText ?? sampleInputs[classId] ?? '').trim()
        if (!txt) return
        const cls = mode.project?.classes.find(c => c.id === classId)
        if (!cls) return
        if (cls.samples.length >= MAX_SAMPLES_PER_CLASS) { showSaved('Maximum 20 texts per folder'); return }
        const ok = mode.addSample(classId, { type: 'text', data: txt })
        if (!ok) { showSaved('Folder full (20 max)'); return }
        setSampleInputs(prev => ({ ...prev, [classId]: '' }))
        try { await classifierRef.current.addSample(txt, cls.name) } catch { }
        showSaved(`Added to ${cls.name}`)
    }, [mode, sampleInputs, showSaved])

    const handlePredict = useCallback(async (text: string) => {
        if (!text.trim()) { setPrediction(null); return }
        if (modelLoading) { showSaved('Model loading…'); return }
        if (!classifierRef.current.canClassify) { setPrediction(null); return }
        setIsProcessing(true)
        try {
            const start = performance.now()
            const result = await classifierRef.current.predict(text.trim(), 5)
            const elapsed = Math.round(performance.now() - start)
            setInferenceTime(elapsed)
            if (result) setPrediction(result)
            else setPrediction(null)
        } catch { setPrediction(null) }
        setIsProcessing(false)
    }, [modelLoading, showSaved])

    useEffect(() => {
        if (predictTimeoutRef.current) clearTimeout(predictTimeoutRef.current)
        if (!textInput.trim()) { setPrediction(null); setIsProcessing(false); return }
        // debounce live prediction while typing in Test node
        predictTimeoutRef.current = setTimeout(() => handlePredict(textInput), 400)
        return () => { if (predictTimeoutRef.current) clearTimeout(predictTimeoutRef.current) }
    }, [textInput, handlePredict])

    const handleRemoveSample = async (classId: string, sampleId: string) => {
        mode.removeSample(classId, sampleId)
        if (removeDebounceRef.current) clearTimeout(removeDebounceRef.current)
        removeDebounceRef.current = setTimeout(async () => {
            const c = mode.project?.classes.find(x => x.id === classId); if (!c) return
            const current = mode.project?.classes.find(x => x.id === classId)
            const datas = (current?.samples || []).map(s => s.data)
            classifierRef.current.clearClass(c.name)
            if (datas.length > 0) {
                try { await classifierRef.current.addSampleBatch(datas, c.name) } catch { }
            }
        }, 300)
        showSaved('Text removed')
    }

    const handleTrain = async (epochs = 50) => {
        console.log(`[Neura][text] Train clicked — epochs=${epochs}`, { folders: mode.project?.classes.length, texts: mode.getTotalSamples(), canTrain })
        setIsTraining(true); setTrainingError(null); setTotalEpochs(epochs); setCurrentEpoch(0); setEpochResults([])
        const project = mode.project
        if (!project || project.classes.length < 2) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Add at least 2 folders to train'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); console.warn('[Neura] Train aborted:', msg); return }
        if (project.classes.some(c => c.samples.length < 2)) { mode.setAccuracy(0); setIsTraining(false); const msg = 'Each folder needs at least 2 texts'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); console.warn('[Neura] Train aborted:', msg); return }
        try {
            console.log('[Neura][text] Training started', { epochs, folders: project.classes.map(c => ({ name: c.name, n: c.samples.length })) })
            setModelLoading(true)
            // split 80/20 like ImageClassifier — precompute not needed for text, we evaluate directly
            const trainData: { cls: string; samples: string[] }[] = []
            const testData: { text: string; label: string }[] = []
            for (const cls of project.classes) {
                const shuffled = [...cls.samples].sort(() => Math.random() - 0.5)
                const trainCount = Math.max(1, Math.min(shuffled.length - 1, Math.floor(shuffled.length * 0.8)))
                const splitIdx = shuffled.length <= 2 ? 1 : trainCount
                console.log(`[Neura][text][split] "${cls.name}": total=${cls.samples.length} train=${splitIdx} test=${shuffled.length - splitIdx}`)
                trainData.push({ cls: cls.name, samples: shuffled.slice(0, splitIdx).map(s => s.data) })
                for (const s of shuffled.slice(splitIdx)) testData.push({ text: s.data, label: cls.name })
            }
            console.log('[Neura][text][split] summary', { trainData: trainData.map(t => ({ cls: t.cls, n: t.samples.length })), test: testData.length })
            if (trainData.every(t => t.samples.length === 0) || testData.length === 0) {
                mode.setAccuracy(0); setModelLoading(false); setIsTraining(false);
                const msg = 'Not enough test texts — add more samples'; setTrainingError(msg); showSaved(`⚠️ ${msg}`); return
            }
            setModelLoading(false)
            const epochResultsLocal: number[] = []; let bestAccuracy = 0
            for (let epoch = 1; epoch <= epochs; epoch++) {
                const progress = epoch / epochs; const delay = epochs > 50 ? Math.max(5, 20 / (epoch * 0.1)) : Math.max(10, 40 / (epoch * 0.1))
                await new Promise(r => setTimeout(r, delay))
                const evalClassifier = new TextClassifier()
                for (const pt of trainData) {
                    const numToAdd = Math.max(1, Math.ceil(progress * pt.samples.length)); const batch = pt.samples.slice(0, numToAdd)
                    if (batch.length > 0) try { await evalClassifier.addSampleBatch(batch, pt.cls) } catch { }
                }
                let correct = 0, total = 0
                const perTestLog: string[] = []
                for (const item of testData) try {
                    const result = await evalClassifier.predict(item.text, 5)
                    const predicted = result?.label ?? 'null'
                    const isCorrect = result && result.label === item.label
                    if (isCorrect) correct++
                    total++
                    const shouldLog = epoch === 1 || epoch === epochs || !isCorrect
                    if (shouldLog) perTestLog.push(`${item.label}→${predicted}${isCorrect ? '✓' : '✗'} conf=${result ? Object.entries(result.confidences).map(([k, v]) => (k + ':' + (v * 100).toFixed(0) + '%')).join(',') : 'null'}`)
                } catch { total++; perTestLog.push(`${item.label}→error`) }
                evalClassifier.dispose(); const rawAccuracy = total > 0 ? correct / total : 0; epochResultsLocal.push(rawAccuracy); if (rawAccuracy > bestAccuracy) bestAccuracy = rawAccuracy
                if (epoch % 5 === 0 || epoch === epochs) {
                    setCurrentEpoch(epoch); setEpochResults([...epochResultsLocal]); mode.setAccuracy(rawAccuracy);
                    console.log(`[Neura][text] Epoch ${epoch}/${epochs} — accuracy ${(rawAccuracy * 100).toFixed(1)}% (best ${(bestAccuracy * 100).toFixed(1)}%) correct=${correct}/${total}`)
                    if (perTestLog.length) perTestLog.forEach(l => console.log(`[Neura][text][eval] ${l}`))
                } else if (perTestLog.length) { perTestLog.forEach(l => console.log(`[Neura][text][eval] epoch${epoch} ${l}`)) }
            }
            // rebuild main classifier with full data for live inference
            classifierRef.current.clear()
            for (const cls of project.classes) if (cls.samples.length > 0) {
                try { await classifierRef.current.addSampleBatch(cls.samples.map(s => s.data), cls.name) } catch { }
            }
            mode.setAccuracy(bestAccuracy); mode.setModelTrained(true); showSaved(`Training complete — ${(bestAccuracy * 100).toFixed(0)}% accuracy`); console.log(`[Neura][text] Training done — best ${(bestAccuracy * 100).toFixed(1)}% over ${epochs} epochs`, { bestAccuracy, epochResults: epochResultsLocal })
        } catch (err) { mode.setAccuracy(0); setTrainingError('Training failed. Please try again.'); console.error('[Neura][text] Training failed', err) }
        setIsTraining(false); setModelLoading(false)
    }

    const canTrain = mode.project ? mode.project.classes.length >= 2 && mode.project.classes.every(c => c.samples.length >= 2) : false
    const totalSamplesAll = mode.getTotalSamples()
    let warningTitle = ''; let warningDesc = ''
    if (mode.project && mode.project.classes.length < 2) { warningTitle = 'Add at least 2 folders'; warningDesc = 'Create 2 or more folders to enable training' }
    else if (totalSamplesAll === 0) { warningTitle = 'Add texts to each folder'; warningDesc = 'Type texts for every folder' }
    else if (mode.project && mode.project.classes.some(c => c.samples.length < 2)) { warningTitle = 'Add more texts per folder'; warningDesc = 'Each folder needs at least 2 texts (5+ recommended)' }
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
        const report = { projectName: mode.project?.name || 'Untitled', projectType: 'text-classifier', exportedAt: new Date().toISOString(), testResults: { prediction: prediction.label, topConfidence, allConfidences: Object.fromEntries(sortedPredictionEntries.map(([k, v]) => [k, Math.round(v * 100) + '%'])), inferenceTime }, projectSummary: { totalSamples: mode.getTotalSamples(), totalClasses: mode.project?.classes.length || 0, classes: mode.project?.classes.map(c => ({ name: c.name, sampleCount: c.samples.length })), accuracy: mode.accuracy } }
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
            else if (s.id === 'test') setTestPos({ x: nx, y: ny })
            else setClassPositions(prev => ({ ...prev, [s.id]: { x: nx, y: ny } }))
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
                if (s.id === 'brain') setBrainPos({ x: nx, y: ny })
                else if (s.id === 'test') setTestPos({ x: nx, y: ny })
                else setClassPositions(prev => ({ ...prev, [s.id]: { x: nx, y: ny } }))
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

    useEffect(() => () => { if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current); if (removeDebounceRef.current) clearTimeout(removeDebounceRef.current); if (predictTimeoutRef.current) clearTimeout(predictTimeoutRef.current) }, [])

    const lastClassId = mode.project?.classes[mode.project.classes.length - 1]?.id
    const lastPos = lastClassId ? classPositions[lastClassId] : null
    const isLastExpanded = lastClassId ? !!expandedClasses[lastClassId] : false
    const lastSampleCount = lastClassId ? mode.project?.classes.find(c => c.id === lastClassId)?.samples.length || 0 : 0
    const floaterTop = lastPos ? lastPos.y + 400 + (isLastExpanded && lastSampleCount > 8 ? Math.ceil((lastSampleCount - 8) / 4) * 86 : 0) : 0

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#F8FAFC] relative">
            {savedMessage && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold shadow-lg">{savedMessage}</div>}

            {/* Professional header — single row, no duplicate */}
            <div className="shrink-0 h-[48px] flex items-center justify-between px-4 bg-white border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h10M7 12h10M7 16h10" /></svg>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-[13px] font-semibold text-slate-900 leading-none tracking-tight">Teach Your AI to Read</h1>
                            <p className="text-[11px] text-slate-500 leading-none mt-0.5 hidden sm:block">Canvas • Pan, zoom, and arrange folders</p>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-slate-200">
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-semibold text-violet-700">📁 {mode.project?.classes.length || 0} folders</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">📝 {totalSamplesAll} texts</span>
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-700">🎯 Goal 15 / folder</span>
                        {mode.modelTrained && <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">✓ {(mode.accuracy! * 100).toFixed(0)}%</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{inferenceTime} ms
                    </span>
                    <div className="w-px h-6 bg-slate-200 hidden sm:block" />
                    <button onClick={() => setShowAddClass(true)} className="hidden sm:inline-flex items-center gap-1.5 h-11 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm">+ New folder</button>
                </div>
            </div>

            {showAddClass && (
                <div className="absolute top-[56px] left-1/2 -translate-x-1/2 z-30 bg-white rounded-xl shadow-xl border border-slate-200 p-3 flex gap-2 items-center w-[min(420px,95vw)]">
                    <input autoFocus value={newClassName} onChange={e => setNewClassName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddClass(); if (e.key === 'Escape') setShowAddClass(false) }} placeholder="Folder name e.g. Happy" className="flex-1 h-11 px-5 rounded-lg border border-slate-200 bg-white text-sm font-medium outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
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
                            const x2 = testPos.x, y2 = testPos.y + 200
                            const mx = (x1 + x2) / 2
                            return <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" />
                        })()}
                    </svg>

                    {/* Folder compartments — text samples */}
                    {mode.project?.classes.map(cls => {
                        const pos = classPositions[cls.id] || { x: 48, y: 80 }
                        const isSelected = mode.selectedClassId === cls.id
                        const atLimit = cls.samples.length >= MAX_SAMPLES_PER_CLASS
                        const progress = Math.min(100, (cls.samples.length / 15) * 100)
                        const inputVal = sampleInputs[cls.id] || ''
                        return (
                            <div key={cls.id} data-node onPointerDown={e => startNodeDrag(e, cls.id, pos)} onClick={() => mode.setSelectedClassId(cls.id)} style={{ left: pos.x, top: pos.y, width: 344, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === cls.id ? 'z-40' : isSelected ? 'z-20' : 'z-10'}`}>
                                <div className={`bg-white rounded-xl border overflow-hidden flex flex-col transition-shadow ${isSelected ? 'border-violet-300 shadow-md' : 'border-slate-200 shadow-sm hover:shadow-md'}`} style={{ minHeight: 320 }}>
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
                                            <p className="text-[11px] text-slate-500 leading-none mt-0.5">{cls.samples.length} / {MAX_SAMPLES_PER_CLASS} texts</p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (confirm(`Delete folder "${cls.name}"?`)) { classifierRef.current.clearClass(cls.name); mode.removeClass(cls.id) } }} className="w-7 h-7 rounded-md hover:bg-slate-50 text-slate-400 hover:text-slate-700 flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg></button>
                                            <div className="w-7 h-7 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 cursor-grab active:cursor-grabbing" title="Drag to move">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="7" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="17" r="1" /><circle cx="15" cy="7" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="17" r="1" /></svg>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 shrink-0"><div className="h-full transition-all" style={{ width: `${progress}%`, background: cls.color }} /></div>
                                    <div className="flex-1 p-3 flex flex-col gap-3 min-h-[200px]" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                                        {/* input row */}
                                        <div className="flex gap-2">
                                            <input
                                                value={inputVal}
                                                onChange={e => setSampleInputs(prev => ({ ...prev, [cls.id]: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') handleAddTextForClass(cls.id) }}
                                                onPointerDown={e => e.stopPropagation()}
                                                placeholder="Type text…"
                                                disabled={atLimit}
                                                className="flex-1 h-11 px-5 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50 disabled:text-slate-400"
                                            />
                                            <button
                                                onPointerDown={e => e.stopPropagation()}
                                                onClick={e => { e.stopPropagation(); handleAddTextForClass(cls.id) }}
                                                disabled={!inputVal.trim() || atLimit}
                                                className={`h-11 px-5 rounded-lg text-sm font-bold shrink-0 ${!inputVal.trim() || atLimit ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'}`}
                                            >
                                                Add
                                            </button>
                                        </div>
                                        {atLimit && <p className="text-[11px] text-amber-600 font-medium">Folder full (20 max)</p>}
                                        {cls.samples.length > 0 ? (
                                            <>
                                                <div className="grid grid-cols-1 gap-1.5 max-h-[180px] overflow-auto neura-scrollbar pr-0.5">
                                                    {cls.samples.slice(0, 10).map(s => (
                                                        <div key={s.id} className="relative group/chip flex items-start gap-2 p-2 pr-7 rounded-lg bg-slate-50 border border-slate-200">
                                                            <span className="text-xs text-slate-700 leading-snug break-words flex-1 line-clamp-2">{s.data}</span>
                                                            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleRemoveSample(cls.id, s.id) }} className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity shadow-sm text-xs">×</button>
                                                        </div>
                                                    ))}
                                                </div>
                                                {cls.samples.length > 10 && <div className="text-[11px] text-slate-500 text-center">+{cls.samples.length - 10} more</div>}
                                            </>
                                        ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4 text-center">
                                                <div className="w-12 h-12 rounded-xl border flex items-center justify-center bg-slate-50 border-slate-200 text-slate-400"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M10 13H8" /><path d="M16 17H8" /><path d="M13 13h1" /></svg></div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-700">No texts yet</p>
                                                    <p className="text-[11px] text-slate-500">Type above and Add</p>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex gap-2 pt-2 border-t border-slate-100 mt-auto">
                                            <span className="text-[11px] text-slate-500 flex items-center">{cls.samples.length} texts</span>
                                            <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full border font-medium ${cls.samples.length >= 15 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : cls.samples.length >= 5 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{cls.samples.length >= 15 ? 'Goal met ✓' : `${15 - cls.samples.length} to goal`}</span>
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
                            <p className="text-xs text-slate-500 mt-1 max-w-[260px]">Create a folder for each class. Each folder is a separate compartment on the canvas.</p>
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
                                    <p className="text-xs text-slate-500 mt-1 max-w-[280px]">{isTraining ? `Learning from ${totalSamplesAll} texts` : mode.accuracy != null ? `${totalSamplesAll} texts across ${mode.project?.classes.length || 0} folders` : warningDesc || 'Add at least 2 folders with 2 texts each'}</p>
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
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Texts</p><p className="text-sm font-semibold text-slate-900">{totalSamplesAll}</p></div>
                                <div className="bg-white py-2.5 text-center"><p className="text-[10px] font-medium text-slate-500 tracking-wide uppercase">Accuracy</p><p className={`text-sm font-semibold ${mode.accuracy != null ? 'text-emerald-600' : 'text-slate-400'}`}>{mode.accuracy != null ? `${(mode.accuracy * 100).toFixed(0)}%` : '—'}</p></div>
                            </div>
                        </div>
                    </div>

                    {/* Test — replaces Vision */}
                    <div data-node onPointerDown={e => startNodeDrag(e, 'test', testPos)} style={{ left: testPos.x, top: testPos.y, width: 420, touchAction: 'none' as any }} className={`absolute select-none ${draggingId === 'test' ? 'z-40' : 'z-10'}`}>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col cursor-grab active:cursor-grabbing">
                            <div className="h-11 px-4 flex items-center justify-between border-b border-slate-100 bg-white">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg></div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-slate-900 leading-none">Test</p>
                                        <p className="text-[11px] text-slate-500 leading-none mt-0.5">{isProcessing ? 'Analyzing…' : prediction ? 'Live • Prediction ready' : 'Idle • Type to test'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="hidden sm:inline-flex h-6 px-2 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600">{inferenceTime} ms</span>
                                    <span className={`w-2 h-2 rounded-full ${prediction ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                </div>
                            </div>
                            <div className="mx-3 mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 flex flex-col gap-2" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                                <textarea
                                    value={textInput}
                                    onChange={e => setTextInput(e.target.value)}
                                    onPointerDown={e => e.stopPropagation()}
                                    placeholder="Type something to test…"
                                    rows={3}
                                    className="w-full min-h-[72px] p-3 text-sm border border-slate-200 rounded-lg outline-none bg-white text-slate-900 placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 resize-none"
                                />
                                <div className="flex gap-2">
                                    <button onPointerDown={e => e.stopPropagation()} onClick={() => handlePredict(textInput)} disabled={!textInput.trim() || isProcessing || modelLoading} className={`flex-1 h-11 rounded-xl text-sm font-bold border ${!textInput.trim() || isProcessing || modelLoading ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'}`}>{isProcessing ? 'Analyzing…' : 'Predict'}</button>
                                    <button onPointerDown={e => e.stopPropagation()} onClick={() => { setTextInput(''); setPrediction(null) }} className="h-11 px-5 rounded-xl bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 text-sm font-bold">Clear</button>
                                    <span className="ml-auto inline-flex h-8 items-center px-2.5 rounded-full bg-white border border-slate-200 text-[11px] font-medium text-slate-600">{mode.project?.classes.length || 0} folders • {totalSamplesAll} texts</span>
                                </div>
                                {modelLoading && (
                                    <div className="flex items-center gap-2 py-2 px-3 bg-violet-50 rounded-lg border border-violet-100">
                                        <div className="w-3.5 h-3.5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
                                        <span className="text-[11px] font-bold text-violet-700">Loading model...</span>
                                    </div>
                                )}
                            </div>
                            <div className="px-3 pb-3 pt-3 flex flex-col gap-2 max-h-[300px] overflow-auto" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                                {!canTrain && !mode.modelTrained ? <div className="text-center py-8 text-xs text-slate-500">Add texts and train to see predictions</div> : isProcessing ? <div className="flex flex-col items-center justify-center py-6 gap-2"><div className="w-8 h-8 border-2 border-slate-200 border-t-violet-600 rounded-full animate-spin" /><p className="text-sm font-bold text-slate-500">Analyzing...</p></div> : !prediction ? <div className="text-center py-6 text-xs text-slate-400">{textInput.trim() ? 'No prediction — add more samples and train' : 'Type something above to test'}</div> : (
                                    <>
                                        {topLabel && <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex justify-between items-center"><div><p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Top prediction</p><p className="text-sm font-semibold text-slate-900 mt-0.5 flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-slate-900 text-white flex items-center justify-center text-[11px] font-semibold">{topLabel[0].toUpperCase()}</span>{topLabel}</p></div><div className="text-right"><p className="text-[11px] text-slate-500">{inferenceTime} ms</p></div></div>}
                                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                                            <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase mb-2">All folders — ranked</p>
                                            {sortedPredictionEntries.map(([label, conf], idx) => {
                                                const isTop = idx === 0; const col = mode.project?.classes.find(c => c.name === label)?.color || '#0F172A'
                                                return <div key={label} className={`mb-1.5 last:mb-0 p-2 rounded-lg border ${isTop ? 'bg-white border-slate-300' : 'bg-white border-slate-200'}`}><div className="flex justify-between text-sm font-bold"><span className="flex items-center gap-1.5 truncate"><span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-semibold shrink-0" style={{ background: col }}>{label[0].toUpperCase()}</span><span className="truncate text-slate-900">{label}</span>{isTop && <span className="text-amber-500">★</span>}</span></div></div>
                                            })}
                                        </div>
                                        <div className="flex gap-2"><button onClick={() => { setTextInput(''); setPrediction(null) }} className="flex-1 h-11 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700">Clear</button><button onClick={handleExportReport} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-bold">Download report</button></div>
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

            <NotRelatedModal isOpen={showNotRelated} onClose={() => setShowNotRelated(false)} title="No match found" description="This text doesn't match any of your folders. Try adding more varied samples or check your spelling." />
        </div>
    )
}
