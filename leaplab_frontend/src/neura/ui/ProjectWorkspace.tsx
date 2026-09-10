import React, { useState, useEffect, useRef, useCallback } from 'react'
import { IgniteTopbar } from '../../Electra/Client/Src/components/Layout/Topbar'
import type { ProjectType, NeuraProject } from '../types/neura.types'
import type { ClassifierMode } from '../hooks/useNeuraProject'
import { useNeuraProject } from '../hooks/useNeuraProject'
import { fileService } from '../../Electra/Client/Src/services/FileService'
import ClassCard from './components/ClassCard'
import DiscardConfirmModal from './components/DiscardConfirmModal'
import { useCloudProjectStore } from '../../store/cloudProjectStore'
import { useKeyboardShortcuts } from '../../creova/hooks/useKeyboardShortcuts'
import { showToast } from '../../leapignite/client/components/Toast'

interface ProjectWorkspaceProps {
    type: ProjectType
    onBack: (hasChanges?: boolean) => void
    template?: { name: string; classes: string[] }
    children: (props: {
        mode: ReturnType<typeof useNeuraProject>
    }) => React.ReactNode
}

const MODE_EMOJI: Record<string, string> = {
    collect: '📸',
    train: '🏋️',
    test: '🧪',
    annotate: '🏷️',
    evaluate: '📊'
}

function ModeSwitcher({ mode, onModeChange, canTrain, projectType }: { mode: ClassifierMode; onModeChange: (m: ClassifierMode) => void; canTrain: boolean; projectType: ProjectType }) {
    const isObjectDetection = projectType === 'object-detection'
    const modes = isObjectDetection
        ? [{ id: 'collect' as const, label: 'Collect', emoji: '📸' }, { id: 'annotate' as const, label: 'Label', emoji: '🏷️' }, { id: 'train' as const, label: 'Train', emoji: '🏋️' }, { id: 'evaluate' as const, label: 'Evaluate', emoji: '📊' }, { id: 'test' as const, label: 'Test', emoji: '🧪' }]
        : [{ id: 'collect' as const, label: 'Collect', emoji: '📸' }, { id: 'train' as const, label: 'Train', emoji: '🏋️' }, { id: 'test' as const, label: 'Test', emoji: '🧪' }]

    return (
        <div className="flex items-center bg-white/15 rounded-[14px] p-1 gap-[3px]">
            {modes.map((m) => {
                const isActive = mode === m.id
                return (
                    <button
                        key={m.id}
                        onClick={() => onModeChange(m.id)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.75 rounded-[11px] text-xs font-bold border-none cursor-pointer transition-all duration-200 ${
                            isActive ? 'bg-white text-[#630ed4] shadow-sm' : 'bg-transparent text-white/80'
                        }`}
                    >
                        <span className="text-sm">{m.emoji}</span>
                        <span className="hidden sm:inline">{m.label}</span>
                    </button>
                )
            })}
        </div>
    )
}

export default function ProjectWorkspace({ type, onBack, template, children }: ProjectWorkspaceProps) {
    const mode = useNeuraProject(type, template?.name)
    const [newClassName, setNewClassName] = useState('')
    const [showAddClass, setShowAddClass] = useState(false)
    const [showDiscardModal, setShowDiscardModal] = useState(false)
    const [pendingAction, setPendingAction] = useState<'home' | 'new' | 'open' | null>(null)
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [isMobile, setIsMobile] = useState(false)

    const isObjectDetection = type === 'object-detection'

    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 768
            setIsMobile(mobile)
            if (mobile) setSidebarOpen(false)
            else setSidebarOpen(true)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    useEffect(() => {
        if (template && template.classes.length > 0 && mode.project && mode.project.classes.length === 0) {
            template.classes.forEach(className => {
                mode.addClass(className)
            })
        }
    }, [])

    const canTrain = mode.project
        ? mode.project.classes.length >= 2 && mode.project.classes.every(c => c.samples.length >= 2)
        : false

    const handleAddClass = () => {
        if (newClassName.trim()) {
            mode.addClass(newClassName.trim())
            setNewClassName('')
            setShowAddClass(false)
        }
    }

    const totalSamples = mode.getTotalSamples()

    const fileInputRef = useRef<HTMLInputElement>(null)
    const [isSaving, setIsSaving] = useState(false)

    const handleSave = useCallback(async () => {
        if (!mode.project) return
        if (isSaving) return
        setIsSaving(true)
        showToast('Saving project...', 'info', 30000)
        try {
            await fileService.saveProject(mode.project.name, 'neura', mode.project)
            showToast('Project saved successfully!', 'success')
        } catch (e: any) {
            console.error('[Neura] Save failed', e)
            showToast(e?.message || 'Failed to save project.', 'error')
            throw e
        } finally {
            setIsSaving(false)
        }
    }, [mode.project, isSaving])

    const handleDownload = useCallback(() => {
        if (!mode.project) return
        fileService.saveProjectLocally(mode.project.name, 'neura', mode.project)
    }, [mode.project])

    const handleSaveAs = useCallback(async () => {
        if (!mode.project) return
        const win = window as any;
        // Electron: native dialog
        if (win.electronAPI?.saveProject) {
            try {
                const result = await win.electronAPI.saveProject(mode.project);
                if (result?.success && result.projectPath) {
                    const parts = result.projectPath.split(/[\\/]/);
                    const name = parts[parts.length - 1]?.replace(/\.(leap|lbp)$/i, '');
                    if (name) mode.setProjectName(name);
                }
                return;
            } catch (e) { console.warn('[Neura] electron saveAs failed', e); }
        }
        // Web: File System Access API with filename prompt
        try {
            const res = await fileService.saveProjectAsLocally(mode.project.name, 'neura', mode.project);
            if (res.saved && res.newName) mode.setProjectName(res.newName);
        } catch (e) { console.warn('[Neura] Save As failed', e); }
    }, [mode.project])

    const hasUnsavedWork = mode.project && mode.project.classes.length > 0

    const handleNewProject = useCallback(() => {
        if (hasUnsavedWork) {
            setPendingAction('new')
            setShowDiscardModal(true)
        } else {
            mode.resetProject()
            localStorage.removeItem(`neura-project-${type}`)
        }
    }, [hasUnsavedWork, mode, type])

    useEffect(() => {
        const { pendingProject, clearPendingProject } = useCloudProjectStore.getState()
        if (pendingProject && pendingProject.mode === 'neura') {
            const data = pendingProject.data
            clearPendingProject()
            const projectData: NeuraProject = {
                id: data.id || Date.now().toString(36),
                type: data.type || type || 'image-classifier',
                name: data.projectName || data.name || 'Cloud Project',
                classes: data.classes || [],
                createdAt: data.createdAt || data.timestamp || Date.now(),
                updatedAt: data.updatedAt || Date.now(),
                modelTrained: data.modelTrained || false,
                accuracy: data.accuracy,
                projectData: data.projectData
            }
            mode.loadProject(projectData)
        }
    }, [mode, type])

    const handleHomeClick = useCallback(() => {
        if (hasUnsavedWork) {
            setPendingAction('home')
            setShowDiscardModal(true)
        } else {
            onBack(false)
        }
    }, [hasUnsavedWork, onBack])

    const handleOpenProject = useCallback(() => {
        if (hasUnsavedWork) {
            setPendingAction('open')
            setShowDiscardModal(true)
        } else {
            fileInputRef.current?.click()
        }
    }, [hasUnsavedWork])

    const handleDiscardConfirm = useCallback(() => {
        setShowDiscardModal(false)
        if (pendingAction === 'home') {
            onBack()
        } else if (pendingAction === 'new') {
            mode.resetProject()
            localStorage.removeItem(`neura-project-${type}`)
            // Re-add template classes after reset
            if (template && template.classes.length > 0) {
                setTimeout(() => {
                    template.classes.forEach(className => {
                        mode.addClass(className)
                    })
                }, 100)
            }
        } else if (pendingAction === 'open') {
            fileInputRef.current?.click()
        }
        setPendingAction(null)
    }, [pendingAction, onBack, mode, type, template])

    const handleDiscardCancel = useCallback(() => {
        setShowDiscardModal(false)
        setPendingAction(null)
    }, [])

    const handleImport = useCallback(() => {
        fileInputRef.current?.click()
    }, [])

    const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        try {
            const data = await fileService.loadProject(file)
            const validation = fileService.validateNeuraImport(data)
            if (!validation.isValid) {
                alert(validation.error || 'Invalid project file.')
                return
            }
            let projectData: NeuraProject
            if (data.mode === 'neura' && data.classes) {
                projectData = {
                    id: data.id || Date.now().toString(36),
                    type: data.type || 'image-classifier',
                    name: data.projectName || data.name || 'Imported Project',
                    classes: data.classes || [],
                    createdAt: data.createdAt || data.timestamp || Date.now(),
                    updatedAt: data.updatedAt || Date.now(),
                    modelTrained: data.modelTrained || false,
                    accuracy: data.accuracy,
                    projectData: data.projectData
                }
            } else if (data.classes && data.type) {
                projectData = data as NeuraProject
            } else {
                alert('This file does not appear to be a valid Neura project.')
                return
            }
            if (!Array.isArray(projectData.classes)) {
                alert('Invalid project file: missing classes data.')
                return
            }
            mode.loadProject(projectData)
        } catch (err: any) {
            console.error('[Neura] Failed to import project:', err)
            alert('Failed to read project file: ' + (err?.message || 'Unknown error'))
        }
        e.target.value = ''
    }, [mode])

    // Keyboard shortcuts for File actions (Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, Ctrl/Cmd+N, Ctrl/Cmd+O)
    // These match the shortcuts displayed in the File dropdown menu (FileDropdownMenu.tsx:59,76,113)
    useKeyboardShortcuts({
        onSave: handleSave,
        onSaveAs: handleSaveAs,
        onNew: handleNewProject,
        onOpen: handleOpenProject,
    })

    const sidebarContent = (
        <>
            <div className="p-3.5 pb-3">
                <div className="flex items-center justify-between mb-3.5">
                    <h2 className="flex items-center text-sm font-extrabold text-[#131b2e] gap-2">
                        <span className="text-lg">{isObjectDetection ? '🏷️' : '📁'}</span>
                        {isObjectDetection ? 'Objects' : 'Classes'}
                    </h2>
                    <button
                        onClick={() => setShowAddClass(true)}
                        className="w-8 h-8 rounded-xl bg-gradient-to-r from-[#630ed4] to-[#7c3aed] text-white flex items-center justify-center text-base border-none cursor-pointer shadow-md shadow-purple-600/30 transition-all hover:scale-105"
                        title={isObjectDetection ? 'Add New Label' : 'Add Class'}
                    >
                        +
                    </button>
                </div>

                {showAddClass && (
                    <div className="flex gap-2 mb-3 animate-fade-in">
                        <input
                            autoFocus
                            value={newClassName}
                            onChange={(e) => setNewClassName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddClass()
                                if (e.key === 'Escape') setShowAddClass(false)
                            }}
                            placeholder={isObjectDetection ? 'Label name...' : 'Class name...'}
                            className="flex-1 px-3 py-2 text-xs font-semibold border-1.5 border-gray-200 rounded-xl outline-none bg-white text-[#131b2e] transition-colors focus:border-[#630ed4]"
                        />
                        <button
                            onClick={handleAddClass}
                            className="px-3.5 py-2 bg-gradient-to-r from-[#630ed4] to-[#7c3aed] text-white rounded-xl text-xs font-bold border-none cursor-pointer hover:opacity-90"
                        >
                            ✓
                        </button>
                    </div>
                )}
            </div>

            {/* Class list */}
            <div className="flex-1 overflow-y-auto neura-scrollbar px-2.5">
                {mode.project?.classes.map((classData, index) => (
                    <ClassCard
                        key={classData.id}
                        classData={classData}
                        isSelected={classData.id === mode.selectedClassId}
                        onSelect={() => {
                            mode.setSelectedClassId(classData.id)
                            if (isMobile) setSidebarOpen(false)
                        }}
                        onRemove={() => mode.removeClass(classData.id)}
                        onRename={(name) => mode.renameClass(classData.id, name)}
                        index={index}
                    />
                ))}

                {mode.project && mode.project.classes.length === 0 && !showAddClass && (
                    <div className="flex flex-col items-center text-center py-10 px-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center text-3xl mb-3.5 shadow-md shadow-amber-500/15">
                            📂
                        </div>
                        <p className="text-xs font-bold text-[#131b2e] mb-1">
                            No classes yet
                        </p>
                        <p className="text-[11px] text-gray-400">
                            Click + to add some! 👆
                        </p>
                    </div>
                )}
            </div>

            {/* Workflow Stepper */}
            <div className="p-3.5 border-t-1.5 border-gray-200">
                {isObjectDetection ? (
                    <div className="flex items-center justify-between">
                        {['Collect', 'Label', 'Train', 'Eval', 'Test'].map((step, idx) => {
                            const modeId = ['collect', 'annotate', 'train', 'evaluate', 'test'][idx] as ClassifierMode
                            const isCurrent = mode.mode === modeId
                            const isCompleted = idx < ['collect', 'annotate', 'train', 'evaluate', 'test'].indexOf(mode.mode)
                            const stepEmojis = ['📸', '🏷️', '🏋️', '📊', '🧪']
                            return (
                                <button
                                    key={step}
                                    onClick={() => mode.setMode(modeId)}
                                    className="flex flex-col items-center gap-1 cursor-pointer bg-transparent border-none"
                                >
                                    <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs transition-all ${
                                        isCurrent ? 'bg-gradient-to-r from-[#630ed4] to-[#7c3aed] text-white shadow-md shadow-purple-600/30' : isCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
                                    }`}>
                                        {isCompleted ? '✓' : stepEmojis[idx]}
                                    </div>
                                    <span className={`text-[9px] font-bold ${isCurrent ? 'text-[#630ed4]' : 'text-gray-400'}`}>
                                        {step}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                ) : (
                    <div className="flex gap-1.5">
                        {[
                            { id: 'collect' as const, label: 'Collect', emoji: '📸' },
                            { id: 'train' as const, label: 'Train', emoji: '🏋️' },
                            { id: 'test' as const, label: 'Test', emoji: '🧪' }
                        ].map((m) => (
                            <button
                                key={m.id}
                                onClick={() => mode.setMode(m.id)}
                                className={`flex-1 py-2 text-[10px] font-bold rounded-xl border-none cursor-pointer flex items-center justify-center gap-1 transition-all ${
                                    mode.mode === m.id ? 'bg-gradient-to-r from-[#630ed4] to-[#7c3aed] text-white shadow-md shadow-purple-600/30' : 'bg-purple-50 text-gray-500'
                                }`}
                            >
                                <span className="text-xs">{m.emoji}</span>
                                {m.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </>
    )

    return (
        <div className="h-screen flex flex-col bg-[#faf8ff]">
            <input
                type="file"
                ref={fileInputRef}
                hidden
                accept=".leap,.lbproject,application/json"
                onChange={handleFileImport}
            />
            <IgniteTopbar
                title={mode.project?.name || 'Classifier'}
                onBack={handleHomeClick}
                onSave={handleSave}
                onDownload={handleDownload}
                onNew={handleNewProject}
                onOpen={handleOpenProject}
                onSaveAs={handleSaveAs}
                onTitleChange={(name) => mode.setProjectName(name)}
                brandName="NEURA"
                isSaving={isSaving}
                rightContent={
                    <div className="flex items-center gap-2">
                        {!mode.hideSidebar && (
                            <button
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                                className="md:hidden w-8 h-8 rounded-lg bg-white/20 text-white flex items-center justify-center hover:bg-white/30 transition-all"
                                title="Toggle sidebar"
                            >
                                {sidebarOpen ? '✕' : '☰'}
                            </button>
                        )}
                    </div>
                }
            />

            <div className="flex-1 flex overflow-hidden relative">
                {/* Desktop sidebar - hidden when hideSidebar is true */}
                {!mode.hideSidebar && (
                    <aside className="hidden md:flex flex-col z-40 animate-fade-in shrink-0 w-56 bg-white/95 backdrop-blur-md border-r-1.5 border-gray-200">
                        {sidebarContent}
                    </aside>
                )}

                {/* Mobile sidebar overlay - hidden when hideSidebar is true */}
                {isMobile && sidebarOpen && !mode.hideSidebar && (
                    <div className="fixed inset-0 z-50 flex">
                        <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
                        <div className="relative flex flex-col animate-slide-in-left w-[min(256px,80vw)] max-w-[80vw] bg-white/98 backdrop-blur-md shadow-2xl">
                            <div className="flex items-center justify-end pt-3 px-3.5">
                                <button
                                    onClick={() => setSidebarOpen(false)}
                                    className="w-7 h-7 rounded-lg bg-red-100 text-red-800 flex items-center justify-center text-xs border-none cursor-pointer hover:bg-red-200"
                                >
                                    ✕
                                </button>
                            </div>
                            {sidebarContent}
                        </div>
                    </div>
                )}

                {/* Main content */}
                <main className="flex-1 bg-[#faf8ff] min-w-0 flex flex-col overflow-y-auto neura-scrollbar relative">
                    <div className="animate-fade-in flex-1 flex flex-col min-h-0 relative">
                        {children({ mode })}
                    </div>
                </main>
            </div>

            {/* Status Bar */}
            <footer className="flex items-center justify-between bg-white/90 backdrop-blur-md border-t-1.5 border-gray-200 px-4 py-2.5">
                <div className="flex items-center gap-3">
                    {!mode.hideSidebar && (
                        <>
                            {/* Pics */}
                            <div className="flex items-center gap-1.5 px-3 py-1.25 rounded-xl bg-purple-50 text-xs font-semibold text-[#630ed4]">
                                <span className="text-sm">🖼️</span>
                                <span>{mode.getTotalSamples()} pics</span>
                            </div>
                            {/* Types */}
                            <div className="flex items-center gap-1.5 px-3 py-1.25 rounded-xl bg-emerald-50 text-xs font-semibold text-emerald-800">
                                <span className="text-sm">📁</span>
                                <span>{mode.project?.classes.length || 0} types</span>
                            </div>
                        </>
                    )}
                    {/* Auto-saved – now reflects real IDB persistence (fixes false "Auto Saved" when localStorage quota exceeded) */}
                    <div
                        title={mode.saveStatus === 'error' ? (mode.saveError || 'Save failed – storage full. Try fewer/larger images or export via File > Save.') : mode.saveStatus === 'saving' ? 'Saving to browser storage…' : 'All changes are stored in this browser (IndexedDB) and survive refresh'}
                        className={`hidden sm:flex items-center gap-1.5 px-3 py-1.25 rounded-xl text-xs font-semibold border ${
                            mode.saveStatus === 'error'
                                ? 'bg-red-50 text-red-700 border-red-200 cursor-pointer'
                                : mode.saveStatus === 'saving'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                        }`}
                        onClick={() => {
                            if (mode.saveStatus === 'error') {
                                // Force a re-save attempt by touching project timestamp
                                mode.setProjectName(mode.project?.name || 'My Image Classifier')
                            }
                        }}
                    >
                        <span className="text-sm">{mode.saveStatus === 'saving' ? '⏳' : mode.saveStatus === 'error' ? '⚠️' : '💾'}</span>
                        <span>
                            {mode.saveStatus === 'saving' ? 'Saving…' : mode.saveStatus === 'error' ? 'Save failed – tap to retry' : mode.saveStatus === 'saved' ? 'Auto-saved ✓' : 'Auto-saved'}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            if (document.fullscreenElement) {
                                document.exitFullscreen?.()
                            } else {
                                document.documentElement.requestFullscreen?.()
                            }
                        }}
                        title="Toggle fullscreen"
                        className="px-2 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200 cursor-pointer flex items-center gap-1 hover:bg-gray-200"
                    >
                        <span className="text-xs">⛶</span>
                        <span className="hidden sm:inline">Fullscreen</span>
                    </button>
                    <div className={`w-2 h-2 rounded-full ${mode.project?.modelTrained ? 'bg-emerald-600 shadow-[0_0_8px_rgba(5,150,105,0.5)]' : 'bg-gray-300'}`} />
                    <span className="text-xs font-semibold text-gray-500">
                        {mode.project?.modelTrained ? '✅ Ready' : '⏳ No model'}
                    </span>
                </div>
            </footer>

            <DiscardConfirmModal
                isOpen={showDiscardModal}
                classCount={mode.project?.classes.length || 0}
                onConfirm={handleDiscardConfirm}
                onCancel={handleDiscardCancel}
                title={
                    pendingAction === 'home'
                        ? 'Leave without saving?'
                        : pendingAction === 'new'
                            ? 'Start a new project?'
                            : 'Open another project?'
                }
                description={
                    pendingAction === 'home'
                        ? `You created ${mode.project?.classes.length || 0} ${(mode.project?.classes.length || 0) === 1 ? 'class' : 'classes'} but haven't added any training data yet. Your progress will be lost! 😢`
                        : pendingAction === 'new'
                            ? 'This will reset your workspace and remove all classes. You can start fresh with a new project!'
                            : 'Any unsaved changes will be lost when you open another project.'
                }
                confirmText={
                    pendingAction === 'home'
                        ? 'Leave 🚪'
                        : pendingAction === 'new'
                            ? 'Reset 🔄'
                            : 'Leave 🚪'
                }
            />
        </div>
    )
}
