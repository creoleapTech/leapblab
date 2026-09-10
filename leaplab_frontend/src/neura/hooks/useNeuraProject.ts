import { useState, useCallback, useEffect, useRef } from 'react'
import type { NeuraProject, ClassData, Sample, ProjectType, BoundingBox, Annotation, AnnotationToolType } from '../types/neura.types'
import { MAX_SAMPLES_PER_CLASS } from '../types/neura.types'
import { saveNeuraProject, loadNeuraProject, migrateLocalStorageToIDB, deleteNeuraProject } from '../storage/neuraIDB'

const generateId = () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36)

const CLASS_COLORS = [
    '#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
    '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#14B8A6',
    '#6366F1', '#84CC16', '#E11D48', '#0EA5E9', '#D946EF'
]

function getNextColor(existingColors: string[]): string {
    return CLASS_COLORS.find(c => !existingColors.includes(c)) || CLASS_COLORS[0]
}

export type ClassifierMode = 'collect' | 'annotate' | 'train' | 'evaluate' | 'test'

export interface UseNeuraProjectReturn {
    project: NeuraProject | null
    mode: ClassifierMode
    setMode: (mode: ClassifierMode) => void
    selectedClassId: string | null
    setSelectedClassId: (id: string | null) => void
    accuracy: number | null
    setAccuracy: (acc: number | null) => void
    modelTrained: boolean
    setModelTrained: (trained: boolean) => void
    setProjectName: (name: string) => void
    addClass: (name: string) => void
    removeClass: (classId: string) => void
    renameClass: (classId: string, name: string) => void
    addSample: (classId: string, sample: Omit<Sample, 'id' | 'timestamp'>) => boolean
    updateSample: (classId: string, sampleId: string, newData: Partial<Sample>) => void
    removeSample: (classId: string, sampleId: string) => void
    clearSamples: (classId: string) => void
    resetProject: () => void
    getSelectedClass: () => ClassData | undefined
    getTotalSamples: () => number
    parseSample: (data: string) => { imageUrl: string; boxes: BoundingBox[]; imageName?: string } | null
    isSampleAnnotated: (sample: Sample) => boolean
    getAnnotatedSampleCount: () => number
    getUnannotatedSampleCount: () => number
    getTotalAnnotatedRegions: () => number
    getPerClassAnnotatedCounts: () => Record<string, number>
    getPerClassRegionCounts: () => Record<string, number>
    canTrainObjectDetection: () => { ok: boolean; reason: string }
    loadProject: (project: NeuraProject) => void
    // Annotation state
    annotations: Annotation[]
    currentAnnotation: Annotation | null
    selectedBoxId: string | null
    activeTool: AnnotationToolType
    zoom: number
    setCurrentAnnotation: (annotation: Annotation | null) => void
    setSelectedBoxId: (id: string | null) => void
    setActiveTool: (tool: AnnotationToolType) => void
    setZoom: (zoom: number) => void
    addBox: (box: Omit<BoundingBox, 'id'>) => void
    removeBox: (boxId: string) => void
    updateBox: (boxId: string, updates: Partial<BoundingBox>) => void
    addAnnotation: (annotation: Omit<Annotation, 'id' | 'timestamp'>) => void
    // Sidebar visibility (for Data Mode in numbers-cr)
    hideSidebar: boolean
    setHideSidebar: (hide: boolean) => void
    // Data view mode (guided vs dashboard)
    dataViewMode: 'guided' | 'dashboard'
    setDataViewMode: (mode: 'guided' | 'dashboard') => void
    // Data Mode separate training state
    dataAccuracy: number | null
    setDataAccuracy: (acc: number | null) => void
    dataModelTrained: boolean
    setDataModelTrained: (trained: boolean) => void
    // Auto-save status for UI (fixes false "Auto-saved" when localStorage quota exceeded)
    saveStatus: 'idle' | 'saving' | 'saved' | 'error'
    saveError: string | null
}

export function useNeuraProject(
    type: ProjectType,
    projectName?: string
): UseNeuraProjectReturn {
    const [project, setProject] = useState<NeuraProject>(() => {
        const defaultName = getDefaultName(type)
        const requestedName = projectName || defaultName
        const saved = localStorage.getItem(`neura-project-${type}`)
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as NeuraProject
                const savedMatchesRequest =
                    parsed.type === type &&
                    parsed.classes &&
                    (parsed.name === requestedName || parsed.name === defaultName)
                if (savedMatchesRequest) {
                    if (projectName && parsed.name === defaultName) {
                        return { ...parsed, name: projectName, updatedAt: Date.now() }
                    }
                    return parsed
                }
            } catch {
                // Invalid data, create new
            }
        }
        return {
            id: generateId(),
            type,
            name: requestedName,
            classes: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            modelTrained: false,
            accuracy: undefined
        }
    })

    const [mode, setMode] = useState<ClassifierMode>('collect')
    const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
    const [accuracy, setAccuracy] = useState<number | null>(() => {
        const saved = localStorage.getItem(`neura-project-${type}`)
        if (saved) {
            try { return (JSON.parse(saved) as NeuraProject).accuracy ?? null } catch { /* ignore */ }
        }
        return null
    })
    const [modelTrained, setModelTrainedState] = useState<boolean>(() => {
        const saved = localStorage.getItem(`neura-project-${type}`)
        if (saved) {
            try { return (JSON.parse(saved) as NeuraProject).modelTrained || false } catch { /* ignore */ }
        }
        return false
    })

    const setModelTrained = useCallback((trained: boolean) => {
        setModelTrainedState(trained)
        setProject(prev => ({ ...prev, modelTrained: trained, updatedAt: Date.now() }))
    }, [])

    // Auto-save status – true persistence via IndexedDB (fixes localStorage quota false "Auto-saved")
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [saveError, setSaveError] = useState<string | null>(null)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const isHydratingRef = useRef(true)

    // Data Mode separate training state
    const [dataAccuracy, setDataAccuracyState] = useState<number | null>(() => {
        const saved = localStorage.getItem(`neura-project-${type}`)
        if (saved) {
            try { return (JSON.parse(saved) as NeuraProject).dataAccuracy ?? null } catch { /* ignore */ }
        }
        return null
    })
    const [dataModelTrained, setDataModelTrainedState] = useState<boolean>(() => {
        const saved = localStorage.getItem(`neura-project-${type}`)
        if (saved) {
            try { return (JSON.parse(saved) as NeuraProject).dataModelTrained || false } catch { /* ignore */ }
        }
        return false
    })

    const setDataAccuracy = useCallback((acc: number | null) => {
        setDataAccuracyState(acc)
        setProject(prev => ({ ...prev, dataAccuracy: acc ?? undefined, updatedAt: Date.now() }))
    }, [])

    const setDataModelTrained = useCallback((trained: boolean) => {
        setDataModelTrainedState(trained)
        setProject(prev => ({ ...prev, dataModelTrained: trained, updatedAt: Date.now() }))
    }, [])

    const setProjectName = useCallback((name: string) => {
        setProject(prev => ({ ...prev, name, updatedAt: Date.now() }))
    }, [])

    // Annotation state
    const [annotations, setAnnotations] = useState<Annotation[]>(() => {
        try {
            const saved = localStorage.getItem(`neura-annotations-${type}`)
            return saved ? JSON.parse(saved) : []
        } catch {
            return []
        }
    })
    const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null)
    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null)
    const [activeTool, setActiveTool] = useState<AnnotationToolType>('box')
    const [zoom, setZoom] = useState<number>(100)
    const [hideSidebar, setHideSidebar] = useState<boolean>(false)
    const [dataViewMode, setDataViewMode] = useState<'guided' | 'dashboard'>(
        project?.dataViewMode ?? (project?.modelTrained ? 'dashboard' : 'guided')
    )

    const addClass = useCallback((name: string) => {
        setProject(prev => {
            const existingColors = prev.classes.map(c => c.color)
            const newClass: ClassData = {
                id: generateId(),
                name,
                color: getNextColor(existingColors),
                samples: []
            }
            return { ...prev, classes: [...prev.classes, newClass], updatedAt: Date.now() }
        })
    }, [])

    const removeClass = useCallback((classId: string) => {
        setProject(prev => ({
            ...prev,
            classes: prev.classes.filter(c => c.id !== classId),
            updatedAt: Date.now()
        }))
    }, [])

    const renameClass = useCallback((classId: string, name: string) => {
        setProject(prev => ({
            ...prev,
            classes: prev.classes.map(c => c.id === classId ? { ...c, name } : c),
            updatedAt: Date.now()
        }))
    }, [])

    const addSample = useCallback((classId: string, sampleData: Omit<Sample, 'id' | 'timestamp'>): boolean => {
        const cls = project.classes.find(c => c.id === classId)
        if (cls && cls.samples.length >= MAX_SAMPLES_PER_CLASS) return false
        const sample: Sample = { ...sampleData, id: generateId(), timestamp: Date.now() }
        setProject(prev => ({
            ...prev,
            classes: prev.classes.map(c => c.id === classId ? { ...c, samples: [...c.samples, sample] } : c),
            updatedAt: Date.now()
        }))
        return true
    }, [project.classes])

    const removeSample = useCallback((classId: string, sampleId: string) => {
        setProject(prev => ({
            ...prev,
            classes: prev.classes.map(c =>
                c.id === classId ? { ...c, samples: c.samples.filter(s => s.id !== sampleId) } : c
            ),
            updatedAt: Date.now()
        }))
    }, [])

    const updateSample = useCallback((classId: string, sampleId: string, newData: Partial<Sample>) => {
        setProject(prev => ({
            ...prev,
            classes: prev.classes.map(c =>
                c.id === classId
                    ? { ...c, samples: c.samples.map(s => s.id === sampleId ? { ...s, ...newData } : s) }
                    : c
            ),
            updatedAt: Date.now()
        }))
    }, [])

    const clearSamples = useCallback((classId: string) => {
        setProject(prev => ({
            ...prev,
            classes: prev.classes.map(c =>
                c.id === classId ? { ...c, samples: [] } : c
            ),
            updatedAt: Date.now()
        }))
    }, [])

    const resetProject = useCallback(() => {
        setProject(prev => ({
            ...prev,
            classes: [],
            modelTrained: false,
            accuracy: undefined,
            updatedAt: Date.now()
        }))
        setAccuracy(null)
        setMode('collect')
        setAnnotations([])
        setCurrentAnnotation(null)
        try { localStorage.removeItem(`neura-annotations-${type}`) } catch { /* ignore */ }
        try { localStorage.removeItem(`neura-project-${type}`) } catch {}
        deleteNeuraProject(type).catch(() => {})
        setSaveStatus('idle')
        setSaveError(null)
    }, [type])

    const getSelectedClass = useCallback(() => {
        return project?.classes.find(c => c.id === selectedClassId)
    }, [project, selectedClassId])

    const getTotalSamples = useCallback(() => {
        if (!project) return 0
        return project.classes.reduce((total, c) => total + c.samples.length, 0)
    }, [project])

    // Helpers for object-detection annotation validation
    const parseSample = useCallback((data: string): { imageUrl: string; boxes: BoundingBox[]; imageName?: string } | null => {
        try {
            const parsed = JSON.parse(data)
            if (parsed && typeof parsed.imageUrl === 'string' && parsed.imageUrl) {
                return { imageUrl: parsed.imageUrl, boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [], imageName: parsed.imageName }
            }
            if (parsed && typeof parsed.data === 'string' && parsed.data) {
                // legacy wrap
                return { imageUrl: parsed.data, boxes: [], imageName: parsed.imageName }
            }
        } catch {}
        if (data && data.startsWith('data:image')) {
            return { imageUrl: data, boxes: [], imageName: 'image' }
        }
        return null
    }, [])

    const isSampleAnnotated = useCallback((sample: Sample): boolean => {
        const parsed = parseSample(sample.data)
        return !!parsed && parsed.boxes.length > 0
    }, [parseSample])

    const getAnnotatedSampleCount = useCallback((): number => {
        if (!project) return 0
        let count = 0
        for (const cls of project.classes) {
            for (const s of cls.samples) if (isSampleAnnotated(s)) count++
        }
        return count
    }, [project, isSampleAnnotated])

    const getUnannotatedSampleCount = useCallback((): number => {
        if (!project) return 0
        return getTotalSamples() - getAnnotatedSampleCount()
    }, [project, getTotalSamples, getAnnotatedSampleCount])

    const getTotalAnnotatedRegions = useCallback((): number => {
        if (!project) return 0
        let total = 0
        for (const cls of project.classes) {
            for (const s of cls.samples) {
                const p = parseSample(s.data)
                if (p) total += p.boxes.length
            }
        }
        return total
    }, [project, parseSample])

    const getPerClassAnnotatedCounts = useCallback((): Record<string, number> => {
        if (!project) return {}
        const out: Record<string, number> = {}
        for (const cls of project.classes) {
            let c = 0
            for (const s of cls.samples) if (isSampleAnnotated(s)) c++
            out[cls.id] = c
        }
        return out
    }, [project, isSampleAnnotated])

    const getPerClassRegionCounts = useCallback((): Record<string, number> => {
        if (!project) return {}
        const out: Record<string, number> = {}
        for (const cls of project.classes) {
            let c = 0
            for (const s of cls.samples) {
                const p = parseSample(s.data)
                if (p) c += p.boxes.length
            }
            out[cls.id] = c
        }
        return out
    }, [project, parseSample])

    const canTrainObjectDetection = useCallback((): { ok: boolean; reason: string } => {
        if (!project) return { ok: false, reason: 'No project' }
        // Collect box-label stats across all images (true object-detection dataset)
        const labelToImageCount: Record<string, number> = {}
        const labelToBoxCount: Record<string, number> = {}
        const validClassNames = new Set(project.classes.map(c => c.name.toLowerCase()))
        let totalBoxes = 0
        for (const cls of project.classes) {
            for (const s of cls.samples) {
                const p = parseSample(s.data)
                if (!p || p.boxes.length === 0) continue
                const seenInThisImage = new Set<string>()
                for (const b of p.boxes) {
                    if (!b.label || b.width < 1 || b.height < 1) return { ok: false, reason: `Invalid box in "${cls.name}" — fix before training` }
                    const low = b.label.toLowerCase()
                    if (!validClassNames.has(low)) return { ok: false, reason: `Box label "${b.label}" is not a folder name — create a folder for it or fix the label` }
                    totalBoxes++
                    labelToBoxCount[low] = (labelToBoxCount[low] || 0) + 1
                    if (!seenInThisImage.has(low)) {
                        seenInThisImage.add(low)
                        labelToImageCount[low] = (labelToImageCount[low] || 0) + 1
                    }
                }
            }
        }
        const distinctLabels = Object.keys(labelToBoxCount)
        // Support both patterns:
        //  - Classic: 2+ folders, each with its own images (per-folder count)
        //  - Mixed: 1 folder with boxes of many labels (per-label count)
        if (distinctLabels.length < 2) {
            if (project.classes.length < 2) return { ok: false, reason: 'Add at least 2 classes (folders)' }
            // fall back to per-folder check for legacy
            const perClassAnnotated = getPerClassAnnotatedCounts()
            for (const cls of project.classes) {
                const n = perClassAnnotated[cls.id] || 0
                if (n < 2) return { ok: false, reason: `Class "${cls.name}" needs at least 2 annotated images (${n}/2)` }
            }
            if (distinctLabels.length < 2) return { ok: false, reason: `Need at least 2 object types with boxes — currently only "${distinctLabels[0] || 'none'}" has boxes` }
        }
        // Each distinct label needs at least 2 images containing it (few-shot threshold)
        for (const low of distinctLabels) {
            const imgCount = labelToImageCount[low] || 0
            if (imgCount < 2) {
                const pretty = project.classes.find(c => c.name.toLowerCase() === low)?.name || low
                return { ok: false, reason: `Label "${pretty}" needs at least 2 annotated images (${imgCount}/2) — draw boxes for it in 2+ images (can be in any folder)` }
            }
        }
        const minBoxes = distinctLabels.length * 2
        if (totalBoxes < minBoxes) return { ok: false, reason: `Need at least ${minBoxes} boxes total (${distinctLabels.length} labels ×2), have ${totalBoxes}` }
        return { ok: true, reason: 'Ready' }
    }, [project, getPerClassAnnotatedCounts, parseSample])

    const loadProject = useCallback((importedProject: NeuraProject) => {
        setProject(importedProject)
        setAccuracy(importedProject.accuracy ?? null)
        setMode('collect')
        setSelectedClassId(null)
        setAnnotations([])
        setCurrentAnnotation(null)
    }, [])

    // ── Annotation functions ──

    const addAnnotation = useCallback((annotationData: Omit<Annotation, 'id' | 'timestamp'>) => {
        const newAnnotation: Annotation = {
            ...annotationData,
            id: generateId(),
            timestamp: Date.now()
        }
        setAnnotations(prev => [...prev, newAnnotation])
        setCurrentAnnotation(newAnnotation)
    }, [])

    const addBox = useCallback((boxData: Omit<BoundingBox, 'id'>) => {
        const newBox: BoundingBox = {
            ...boxData,
            id: generateId()
        }
        if (currentAnnotation) {
            const updatedAnnotation = {
                ...currentAnnotation,
                boxes: [...currentAnnotation.boxes, newBox]
            }
            setCurrentAnnotation(updatedAnnotation)
            setAnnotations(prev =>
                prev.map(a => a.id === currentAnnotation.id ? updatedAnnotation : a)
            )
        }
    }, [currentAnnotation])

    const removeBox = useCallback((boxId: string) => {
        if (currentAnnotation) {
            const updatedAnnotation = {
                ...currentAnnotation,
                boxes: currentAnnotation.boxes.filter(b => b.id !== boxId)
            }
            setCurrentAnnotation(updatedAnnotation)
            setAnnotations(prev =>
                prev.map(a => a.id === currentAnnotation.id ? updatedAnnotation : a)
            )
            if (selectedBoxId === boxId) {
                setSelectedBoxId(null)
            }
        }
    }, [currentAnnotation, selectedBoxId])

    const updateBox = useCallback((boxId: string, updates: Partial<BoundingBox>) => {
        if (currentAnnotation) {
            const updatedAnnotation = {
                ...currentAnnotation,
                boxes: currentAnnotation.boxes.map(b =>
                    b.id === boxId ? { ...b, ...updates } : b
                )
            }
            setCurrentAnnotation(updatedAnnotation)
            setAnnotations(prev =>
                prev.map(a => a.id === currentAnnotation.id ? updatedAnnotation : a)
            )
        }
    }, [currentAnnotation])

    useEffect(() => {
        if (project && project.classes.length > 0) {
            const selectedStillExists = selectedClassId && project.classes.some(c => c.id === selectedClassId)
            if (!selectedStillExists) {
                setSelectedClassId(project.classes[0].id)
            }
        } else if (project && project.classes.length === 0) {
            setSelectedClassId(null)
        }
    }, [project, selectedClassId])

    // Hydrate from IndexedDB on mount (large image projects exceed localStorage quota)
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                // Migrate any existing localStorage project to IDB once
                await migrateLocalStorageToIDB(type)
                const idbProject = await loadNeuraProject(type)
                if (cancelled || !idbProject) {
                    isHydratingRef.current = false
                    return
                }
                // Validate that IDB project matches requested type/name (same logic as localStorage init)
                const defaultName = getDefaultName(type)
                const savedMatches = idbProject.type === type && idbProject.classes && (idbProject.name === project.name || idbProject.name === defaultName || !projectName || idbProject.name === projectName)
                if (!savedMatches) {
                    isHydratingRef.current = false
                    return
                }
                // Only hydrate if IDB is newer or has more samples (prevents overwriting fresh empty project)
                const localSampleCount = project.classes.reduce((s, c) => s + c.samples.length, 0)
                const idbSampleCount = (idbProject.classes || []).reduce((s: number, c: any) => s + (c.samples?.length || 0), 0)
                const shouldHydrate = idbSampleCount > localSampleCount || (idbProject.updatedAt || 0) > (project.updatedAt || 0)
                if (shouldHydrate) {
                    setProject(idbProject)
                    if (typeof idbProject.accuracy !== 'undefined') setAccuracy(idbProject.accuracy ?? null)
                    if (typeof idbProject.modelTrained !== 'undefined') setModelTrainedState(!!idbProject.modelTrained)
                    if (typeof idbProject.dataAccuracy !== 'undefined') setDataAccuracyState(idbProject.dataAccuracy ?? null)
                    if (typeof idbProject.dataModelTrained !== 'undefined') setDataModelTrainedState(!!idbProject.dataModelTrained)
                    console.log(`[Neura] Hydrated ${type} from IndexedDB (${idbSampleCount} samples)`)
                }
            } catch (e) {
                console.warn('[Neura] IDB hydrate failed', e)
            } finally {
                if (!cancelled) isHydratingRef.current = false
            }
        })()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type])

    // Persist to IndexedDB (primary) + localStorage (fallback) – debounced, with real status
    useEffect(() => {
        if (isHydratingRef.current) return
        if (!project) return
        // Don't spam saves for empty initial project
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        setSaveStatus('saving')
        setSaveError(null)
        saveTimeoutRef.current = setTimeout(async () => {
            // Try IDB first (handles large base64 images)
            const idbRes = await saveNeuraProject(type, project)
            if (idbRes.ok) {
                setSaveStatus('saved')
                setSaveError(null)
                // Also try lightweight localStorage for fast boot next time (best-effort, ignore quota)
                try {
                    // If project is huge, localStorage will throw – that's ok, IDB is source of truth
                    localStorage.setItem(`neura-project-${type}`, JSON.stringify(project))
                } catch {}
                setTimeout(() => setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev)), 2200)
                return
            }
            // IDB failed – try localStorage as fallback and surface error
            try {
                localStorage.setItem(`neura-project-${type}`, JSON.stringify(project))
                setSaveStatus('saved')
                setSaveError(null)
                setTimeout(() => setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev)), 2200)
            } catch (e: any) {
                const msg = idbRes.error || e?.message || 'Storage full'
                setSaveStatus('error')
                setSaveError(msg)
                console.warn('[Neura] Auto-save failed (IDB+localStorage)', msg)
            }
        }, 550)
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        }
    }, [project, type])

    // Persist annotations to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(`neura-annotations-${type}`, JSON.stringify(annotations))
        } catch {
            // localStorage full — silently ignore
        }
    }, [annotations, type])

    const autoDownloadBackup = useCallback((proj: NeuraProject) => {
        try {
            const data = JSON.stringify(proj, null, 2)
            const blob = new Blob([data], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${proj.name.replace(/[^a-z0-9]/gi, '_')}_backup_${new Date().toISOString().slice(0, 10)}.neura`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('[Neura] Auto-download backup failed:', err)
        }
    }, [])

    return {
        project,
        mode,
        setMode,
        selectedClassId,
        setSelectedClassId,
        accuracy,
        setAccuracy,
        modelTrained,
        setModelTrained,
        setProjectName,
        addClass,
        removeClass,
        renameClass,
        addSample,
        updateSample,
        removeSample,
        clearSamples,
        resetProject,
        getSelectedClass,
        getTotalSamples,
        parseSample,
        isSampleAnnotated,
        getAnnotatedSampleCount,
        getUnannotatedSampleCount,
        getTotalAnnotatedRegions,
        getPerClassAnnotatedCounts,
        getPerClassRegionCounts,
        canTrainObjectDetection,
        loadProject,
        // Annotation state
        annotations,
        currentAnnotation,
        selectedBoxId,
        activeTool,
        zoom,
        setCurrentAnnotation,
        setSelectedBoxId,
        setActiveTool,
        setZoom,
        addBox,
        removeBox,
        updateBox,
        addAnnotation,
        // Sidebar visibility
        hideSidebar,
        setHideSidebar,
        // Data view mode
        dataViewMode,
        setDataViewMode: (mode: 'guided' | 'dashboard') => {
            setDataViewMode(mode)
            setProject(prev => ({ ...prev, dataViewMode: mode, updatedAt: Date.now() }))
        },
        // Data Mode separate training state
        dataAccuracy,
        setDataAccuracy,
        dataModelTrained,
        setDataModelTrained,
        saveStatus,
        saveError,
    }
}

function getDefaultName(type: ProjectType): string {
    const names: Record<ProjectType, string> = {
        'image-classifier': 'My Image Classifier',
        'audio-classifier': 'My Audio Classifier',
        'pose-classifier': 'My Pose Classifier',
        'text-classifier': 'My Text Classifier',
        'numbers-cr': 'My Number Classifier',
        'object-detection': 'My Object Detector',
        'hand-pose-classifier': 'My Hand Pose Classifier',
        'finger-counter': 'AI Finger Counter',
        'virtual-piano': 'Virtual Piano',
        'drawing-canvas': 'Virtual Drawing Canvas',
        'yoga-checker': 'Yoga Pose Checker',
        'rep-counter': 'Exercise Rep Counter',
        'dance-pose': 'Dance Pose Recognition',
        'posture-monitor': 'Sitting Posture Monitor'
    }
    return names[type] || 'My Classifier'
}
