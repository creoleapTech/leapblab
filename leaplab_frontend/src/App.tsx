/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, lazy, Suspense, useCallback, useEffect } from 'react';
import { ToastProvider } from './leapignite/client/components/Toast';

import Loader from './components/Loader';
import { UpdateBanner } from './components/UpdateBanner';
import { getSharedProject, fetchCloudProjectContent } from './services/cloudProjectApi';
import { useCloudProjectStore } from './store/cloudProjectStore';
import { isEmbedded } from './hooks/useIsEmbedded';
import { lazyWithRetry, isChunkLoadError } from './utils/lazyWithRetry';
// vite:preloadError global handler is registered inside lazyWithRetry module

const LandingPage = lazyWithRetry(() => import('./LandingPage'), 'LandingPage');

const IntermediateApp = lazyWithRetry(() => {
    if (typeof window !== 'undefined' && typeof (window as any).define === 'function' && (window as any).define.amd) {
        (window as any).define = undefined;
    }
    return import('./embed/IntermediateApp');
}, 'IntermediateApp');

// @ts-ignore
const JuniorApp = lazyWithRetry(() => {
    if (typeof window !== 'undefined' && typeof (window as any).define === 'function' && (window as any).define.amd) {
        (window as any).define = undefined;
    }
    return import('./leapignite/client/JuniorApp');
}, 'JuniorApp');

// @ts-ignore
const PythonApp = lazyWithRetry(() => import('./leaplogix/client/LogixApp'), 'PythonApp');

// @ts-ignore
const PythonNotebook = lazyWithRetry(() => import('./python/PythonNotebook'), 'PythonNotebook');

// @ts-ignore
const AppInventor = lazyWithRetry(() => {
    if (typeof window !== 'undefined' && typeof (window as any).define === 'function' && (window as any).define.amd) {
        (window as any).define = undefined;
    }
    return import('./creova');
}, 'AppInventor');

// @ts-ignore
const ElectraWorkspace = lazyWithRetry(() => import('./Electra/Client/Src/ElectraWorkspace'), 'ElectraWorkspace');

const NeuraApp = lazyWithRetry(() => import('./neura/NeuraApp'), 'NeuraApp');

const Leap3DApp = lazyWithRetry(() => import('./vision3d'), 'Leap3DApp');

const PulseApp = lazyWithRetry(() => import('./PulseApp'), 'PulseApp');

type AppMode = 'home' | 'intermediate' | 'junior' | 'python' | 'notebook' | 'creova' | 'appforge' | 'electra' | 'neura' | 'vision3d' | 'pulse';


class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: any) {
        return { hasError: true, error };
    }
    componentDidCatch(error: any, errorInfo: any) {
        console.error("ErrorBoundary caught:", error, errorInfo);
        // Auto-recover stale chunk: reload once with cache-bust before showing error UI
        if (isChunkLoadError(error)) {
            try {
                const hasRetried = sessionStorage.getItem('chunk-retry') === '1';
                if (!hasRetried) {
                    console.warn('[chunk-retry] ErrorBoundary auto-reload for stale chunk', (error as any)?.message);
                    sessionStorage.setItem('chunk-retry', '1');
                    const url = new URL(window.location.href);
                    url.searchParams.set('_r', Date.now().toString());
                    window.location.replace(url.toString());
                    setTimeout(() => { try { window.location.reload(); } catch {} }, 150);
                    return;
                }
            } catch {}
        }
        // Notify parent frame if embedded
        try {
            if (isEmbedded()) {
                window.parent.postMessage({ type: 'leaplab-error', error: error?.message || String(error) }, '*');
            }
        } catch { }
    }
    render() {
        if (this.state.hasError) {
            const isChunkError = isChunkLoadError(this.state.error);
            const handleDismiss = () => {
                try { sessionStorage.removeItem('chunk-retry'); } catch {}
                this.setState({ hasError: false, error: null });
            };
            const handleReload = () => {
                try { sessionStorage.removeItem('chunk-retry'); } catch {}
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.set('_r', Date.now().toString());
                    // force bypass of cached index.html
                    window.location.replace(url.toString());
                    setTimeout(() => { try { window.location.reload(); } catch {} }, 200);
                } catch {
                    window.location.reload();
                }
            };
            if (isEmbedded()) {
                // Compact inline error bar for embed context — does not cover the whole page
                return (
                    <div className="fixed bottom-0 left-0 right-0 z-[99999] bg-[#2a1a1a] text-[#ff6b6b] font-mono px-4 py-2.5 flex items-center justify-between border-t-2 border-red-500">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                            <span className="font-bold whitespace-nowrap">{isChunkError ? 'Update:' : 'Error:'}</span>
                            <span className="text-xs opacity-85 overflow-hidden text-ellipsis whitespace-nowrap">
                                {isChunkError ? 'New version available — please reload.' : (this.state.error?.message || String(this.state.error))}
                            </span>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            {!isChunkError && (
                                <button
                                    type="button"
                                    onClick={handleDismiss}
                                    className="px-3 py-1 rounded border border-gray-600 bg-transparent text-gray-300 cursor-pointer text-xs hover:bg-white/5"
                                >
                                    Dismiss
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleReload}
                                className="px-3 py-1 rounded border-0 bg-red-500 text-white cursor-pointer text-xs font-semibold hover:bg-red-600"
                            >
                                Reload
                            </button>
                        </div>
                    </div>
                );
            }
            // Full-page error for non-embedded context
            return (
                <div className="p-5 bg-white text-red-500 font-mono">
                    <h1 className="text-xl font-bold mb-2">{isChunkError ? 'Update available' : 'Something went wrong.'}</h1>
                    {isChunkError ? (
                        <p className="p-3 bg-amber-50 rounded border border-amber-200 text-xs text-amber-900">A new version of the app is available. The previous page is cached. Click Reload to get the latest version.</p>
                    ) : (
                        <pre className="p-3 bg-red-50 rounded border border-red-200 text-xs overflow-auto">{this.state.error?.toString()}</pre>
                    )}
                    <div className="flex gap-2.5 mt-3">
                        {!isChunkError && (
                            <button type="button" onClick={handleDismiss} className="px-3.5 py-1.5 rounded border border-slate-300 bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer hover:bg-slate-200">
                                Dismiss
                            </button>
                        )}
                        <button type="button" onClick={handleReload} className="px-3.5 py-1.5 rounded border-0 bg-red-500 text-white text-xs font-semibold cursor-pointer hover:bg-red-600">
                            Reload
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function App() {
    // Check for ?project=<url> query param — auto-open in correct mode
    const params = new URLSearchParams(window.location.search);
    const projectUrl = params.get('project') || params.get('projectUrl') || null;
    const shareId = params.get('share') || null;
    const urlMode = params.get('mode') as AppMode | null;
    const isElectraMode = urlMode === 'electra';

    const [mode, setMode] = useState<AppMode>(isElectraMode ? 'electra' : 'home');
    const [projectUrlReady, setProjectUrlReady] = useState(false);
    const [resolvedProjectUrl, setResolvedProjectUrl] = useState<string | null>(projectUrl);
    const [juniorKey, setJuniorKey] = useState(0);
    const modeRef = React.useRef(mode);
    modeRef.current = mode;
    const handleSetModeRef = React.useRef<any>(null);

    // Clear chunk-retry flag on successful navigation (chunk loaded)
    useEffect(() => {
        try { sessionStorage.removeItem('chunk-retry'); } catch {}
    }, [mode]);

    // ── Global window-level drag-and-drop file upload ──
    const [isGlobalDragOver, setIsGlobalDragOver] = useState(false);
    const [globalDragLabel, setGlobalDragLabel] = useState('');

    useEffect(() => {
        let dragCounter = 0;
        let isInternalDrag = false;

        const handleDragStart = () => {
            isInternalDrag = true;
        };

        const handleDragEnd = () => {
            isInternalDrag = false;
        };

        // Always prevent default for file drags so the browser never navigates away
        const preventFileNav = (e: DragEvent) => {
            if (isInternalDrag) return;
            if (e.dataTransfer?.types?.includes('Files')) {
                e.preventDefault();
            }
        };

        const handleDragEnter = (e: DragEvent) => {
            if (isInternalDrag) return;
            if (!e.dataTransfer?.types?.includes('Files')) return;
            const activeUpload = (window as any).__activeUpload;
            const currentMode = modeRef.current;

            // Show overlay for .leap file drops on the landing page
            if (!activeUpload && currentMode !== 'home') return;

            // If on landing page, check if any file is a .leap file
            if (!activeUpload && currentMode === 'home') {
                const files = e.dataTransfer?.files;
                const hasLeapFile = files && Array.from(files).some(f => f.name.endsWith('.leap') || f.name.endsWith('.lbp'));
                if (!hasLeapFile) return;
            }

            e.preventDefault();
            dragCounter++;
            if (dragCounter === 1) {
                setIsGlobalDragOver(true);
                setGlobalDragLabel(activeUpload?.label || '.leap Project');
            }
        };

        const handleDragLeave = (e: DragEvent) => {
            if (isInternalDrag) return;
            if (!e.dataTransfer?.types?.includes('Files')) return;
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                setIsGlobalDragOver(false);
            }
        };

        const handleDrop = (e: DragEvent) => {
            if (isInternalDrag) return;
            if (!e.dataTransfer?.types?.includes('Files')) return;
            e.preventDefault();
            dragCounter = 0;
            setIsGlobalDragOver(false);

            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;

            const activeUpload = (window as any).__activeUpload;
            if (activeUpload) {
                activeUpload.handler(files);
                return;
            }

            // Handle .leap file drops on the landing page
            const file = files[0];
            if (file && (file.name.endsWith('.leap') || file.name.endsWith('.lbp'))) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const data = JSON.parse(ev.target?.result as string);
                        const detectedMode: AppMode =
                            data.mode === 'junior' ? 'junior' :
                                data.mode === 'python' ? 'python' :
                                    data.mode === 'creova' ? 'creova' :
                                        data.mode === 'electra' ? 'electra' :
                                            data.mode === 'neura' ? 'neura' :
                                                'intermediate';

                        useCloudProjectStore.getState().setPendingProject({
                            mode: detectedMode,
                            data,
                            projectName: data.projectName || file.name.replace(/\.(leap|lbp)$/i, ''),
                        });

                        if (handleSetModeRef.current) {
                            handleSetModeRef.current(detectedMode);
                        }
                    } catch (err) {
                        console.error('Failed to parse .leap file:', err);
                        alert('Invalid .leap project file.');
                    }
                };
                reader.readAsText(file);
            }
        };

        window.addEventListener('dragstart', handleDragStart);
        window.addEventListener('dragend', handleDragEnd);
        window.addEventListener('dragover', preventFileNav);
        window.addEventListener('drop', preventFileNav);
        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);

        return () => {
            window.removeEventListener('dragstart', handleDragStart);
            window.removeEventListener('dragend', handleDragEnd);
            window.removeEventListener('dragover', preventFileNav);
            window.removeEventListener('drop', preventFileNav);
            window.removeEventListener('dragenter', handleDragEnter);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', handleDrop);
        };
    }, []);

    // When projectUrl is present, fetch JSON to detect mode before routing
    React.useEffect(() => {
        if (!projectUrl) {
            setProjectUrlReady(true);
            return;
        }

        (async () => {
            try {
                const resp = await fetch(projectUrl);
                if (!resp.ok) throw new Error(`Failed to fetch project: ${resp.status}`);
                const data = await resp.json();

                // Electra payloads are identified by an explicit mode field, or by the raw circuit
                // payload they were saved as before the wrapper existed. We check both the flat
                // shape (nodes/edges/board) and the nested circuit shape for maximum coverage of
                // already-uploaded trainer projects. Only the two supported Electra boards count.
                const ELECTRA_BOARDS = ['arduino-uno', 'esp32-c3'] as const;
                const hasElectraBoard = ELECTRA_BOARDS.includes(data.board);
                const hasElectraCircuit =
                    (Array.isArray(data.nodes) && Array.isArray(data.edges)) ||
                    (Array.isArray(data.circuit?.nodes) && Array.isArray(data.circuit?.edges));
                const isElectraPayload = data.mode === 'electra' ||
                    (hasElectraCircuit && hasElectraBoard);

                const normalizeMode = (m?: string | null): AppMode | null => {
                    if (!m) return null;
                    if (m === 'blocks' || m === 'intermediate') return 'intermediate';
                    if (m === 'ignite' || m === 'junior') return 'junior';
                    if (m === 'logix' || m === 'python') return 'python';
                    if (m === 'appforge' || m === 'app_game_dev' || m === 'electra') return 'electra';
                    if (m === 'creova') return 'creova';
                    if (m === 'neura') return 'neura';
                    if (m === 'vision3d') return 'vision3d';
                    if (m === 'pulse') return 'pulse';
                    if (m === 'notebook') return 'notebook';
                    return null;
                };

                const detectedMode: AppMode =
                    normalizeMode(urlMode) ||
                    normalizeMode(data.mode) ||
                    (isElectraPayload ? 'electra' : 'intermediate');

                useCloudProjectStore.getState().setPendingProject({
                    mode: detectedMode,
                    data,
                    projectName: data.projectName || data.name || 'Untitled Project',
                });

                setMode(detectedMode);
            } catch (err) {
                console.error('Failed to detect project mode:', err);
                // Default to intermediate on error
                setMode('intermediate');
            } finally {
                setProjectUrlReady(true);
            }
        })();
    }, [projectUrl, urlMode]);

    // When ?share=<shareId> is present, fetch the shared project and route to the correct module
    React.useEffect(() => {
        if (!shareId) return;

        let cancelled = false;
        (async () => {
            try {
                const project = await getSharedProject(shareId);
                if (!project.fileUrl) throw new Error('Shared project file URL is missing');

                const { LMS_API_BASE } = await import('./config/api');
                const fileUrl = project.fileUrl.startsWith('http')
                    ? project.fileUrl
                    : `${LMS_API_BASE}${project.fileUrl}`;

                const content = await fetchCloudProjectContent(fileUrl);

                if (cancelled) return;

                useCloudProjectStore.getState().setPendingProject({
                    mode: project.mode,
                    data: content,
                    projectName: project.name,
                });

                if (project.sharePermission) {
                    useCloudProjectStore.getState().setSharedProjectInfo({
                        shareId,
                        permission: project.sharePermission,
                    });
                } else {
                    useCloudProjectStore.getState().clearSharedProjectInfo();
                }

                const detectedMode: AppMode =
                    project.mode === 'junior' ? 'junior' :
                        project.mode === 'python' ? 'python' :
                            project.mode === 'creova' ? 'creova' :
                                project.mode === 'electra' ? 'electra' :
                                    project.mode === 'neura' ? 'neura' :
                                        'intermediate';

                setMode(detectedMode);
            } catch (err: any) {
                console.error('Failed to load shared project:', err);
                const msg = err?.message || 'Failed to load shared project.';
                alert(msg.includes('Authentication') ? msg : 'Failed to load shared project. The link may be invalid or expired.');
            }
        })();

        return () => { cancelled = true; };
    }, [shareId]);

    const cleanBlocklyStyles = useCallback(() => {
        // Only remove floating Blockly DOM elements that are appended to document.body
        // and persist after the component unmounts. Do NOT remove <style> tags —
        // Blockly caches CSS injection state and will skip re-injecting on the next
        // mount if the styles are missing, which breaks the UI.
        document.querySelectorAll('.blocklyToolboxDiv, .blocklyWidgetDiv, .blocklyDropDownDiv, .blocklyContextMenu').forEach(el => {
            el.remove();
        });
    }, []);

    const handleSetMode = useCallback((newMode: AppMode) => {
        cleanBlocklyStyles();
        if (newMode === 'junior') {
            setJuniorKey(k => k + 1);
        }
        if (typeof window !== 'undefined' && typeof (window as any).define === 'function' && (window as any).define.amd) {
            (window as any).define = undefined;
        }
        setMode(newMode);
    }, [cleanBlocklyStyles]);

    // Keep ref in sync for drag-drop handler
    handleSetModeRef.current = handleSetMode;

    const [intermediateOpenTab, setIntermediateOpenTab] = useState<'blocks' | 'python' | 'costumes' | 'sounds'>('blocks');
    const [switchPrompt, setSwitchPrompt] = useState<null | { from: AppMode; to: AppMode; tab?: 'blocks' | 'python' | 'costumes' | 'sounds' }>(null);

    const [redirectProjectData, setRedirectProjectData] = useState<{
        type: 'electra' | 'creova';
        data: unknown;
        projectName?: string | null;
        projectPath?: string | null;
    } | null>(null);

    const handleRedirectToElectra = useCallback((data: unknown, projectName?: string | null, projectPath?: string | null) => {
        setRedirectProjectData({ type: 'electra', data, projectName, projectPath });
        handleSetMode('electra');
    }, [handleSetMode]);

    const handleRedirectToCreova = useCallback((data: unknown, projectName?: string | null, projectPath?: string | null) => {
        setRedirectProjectData({ type: 'creova', data, projectName, projectPath });
        handleSetMode('creova');
    }, [handleSetMode]);

    const clearRedirectProjectData = useCallback(() => {
        setRedirectProjectData(null);
    }, []);

    const requestSwitch = (from: AppMode, to: AppMode, tab?: 'blocks' | 'python' | 'costumes' | 'sounds') => {
        setSwitchPrompt({ from, to, tab });
    };

    const confirmSwitch = () => {
        if (!switchPrompt) return;
        if (switchPrompt.to === 'intermediate' && switchPrompt.tab) {
            setIntermediateOpenTab(switchPrompt.tab);
        }
        handleSetMode(switchPrompt.to);
        setSwitchPrompt(null);
    };

    const cancelSwitch = () => setSwitchPrompt(null);

    const modeDisplayNames: Record<string, string> = {
        intermediate: 'Embed',
        python: 'Logix',
        junior: 'Ignite',
        electra: 'Electra',
        neura: 'Neura',
        vision3d: 'Vision 3D',
        creova: 'Creova',
        notebook: 'Notebook',
        pulse: 'Pulse',
    };

    const getModeDisplayName = (mode: string) => modeDisplayNames[mode] || mode;

    const [exitPrompt, setExitPrompt] = useState<boolean>(false);

    const requestExit = (hasChanges?: boolean) => {
        if (hasChanges === false) {
            confirmExit();
        } else {
            setExitPrompt(true);
        }
    };

    const confirmExit = () => {
        // Clear shared-link URL parameters and cloud state when returning home
        if (window.location.search) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        useCloudProjectStore.getState().clearPendingProject();
        useCloudProjectStore.getState().clearActiveProjectId();
        useCloudProjectStore.getState().clearSharedProjectInfo();
        setResolvedProjectUrl(null);
        setProjectUrlReady(true);
        handleSetMode('home');
        setExitPrompt(false);
    };

    const cancelExit = () => setExitPrompt(false);

    return (
        <ErrorBoundary key={mode}>
            <ToastProvider>
                <Suspense fallback={<Loader />}>
                    {!projectUrlReady && projectUrl && <Loader />}
                    {projectUrlReady && mode === 'intermediate' && <IntermediateApp
                        onBack={requestExit}
                        onOpenPython={() => requestSwitch('intermediate', 'python')}
                        openTab={intermediateOpenTab}
                        projectUrl={resolvedProjectUrl}
                    />}
                    {projectUrlReady && mode === 'junior' && <JuniorApp key={juniorKey} onBack={requestExit} projectUrl={resolvedProjectUrl} />}
                    {projectUrlReady && mode === 'python' && <PythonApp
                        onBack={requestExit}
                        onSwitchToNotebook={() => requestSwitch('python', 'notebook')}
                        onSwitchToBlocks={() => requestSwitch('python', 'intermediate', 'blocks')}
                        onSwitchToCostumes={() => requestSwitch('python', 'intermediate', 'costumes')}
                    />}
                    {projectUrlReady && mode === 'notebook' && <PythonNotebook onBack={requestExit} onSwitchToIDE={() => handleSetMode('python')} />}
                    {projectUrlReady && mode === 'creova' && <AppInventor
                        onBack={requestExit}
                        onRedirectToElectra={handleRedirectToElectra}
                        redirectProjectData={redirectProjectData?.type === 'creova' ? redirectProjectData : null}
                        clearRedirectProjectData={clearRedirectProjectData}
                    />}
                    {projectUrlReady && mode === 'appforge' && <ElectraWorkspace
                        onBack={requestExit}
                        onHome={() => handleSetMode('home')}
                        onRedirectToCreova={handleRedirectToCreova}
                        redirectProjectData={redirectProjectData?.type === 'electra' ? redirectProjectData : null}
                        clearRedirectProjectData={clearRedirectProjectData}
                    />}
                    {projectUrlReady && mode === 'electra' && <ElectraWorkspace
                        onBack={requestExit}
                        onHome={() => handleSetMode('home')}
                        onRedirectToCreova={handleRedirectToCreova}
                        redirectProjectData={redirectProjectData?.type === 'electra' ? redirectProjectData : null}
                        clearRedirectProjectData={clearRedirectProjectData}
                    />}
                    {projectUrlReady && mode === 'neura' && <NeuraApp onBack={requestExit} />}
                    {projectUrlReady && mode === 'vision3d' && <Leap3DApp onBack={requestExit} />}
                    {projectUrlReady && mode === 'pulse' && <PulseApp onBack={requestExit} />}
                    {projectUrlReady && mode === 'home' && <LandingPage onSelect={handleSetMode} />}
                </Suspense>


                {switchPrompt && (
                    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
                        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 flex flex-col">
                            <h2 className="m-0 mb-2.5 text-lg font-bold text-slate-900">Switching Coding Environment</h2>
                            <p className="m-0 mb-5 text-sm text-slate-600 leading-relaxed font-medium">
                                You are switching from <strong className="text-slate-900 font-semibold">{getModeDisplayName(switchPrompt.from)}</strong> into <strong className="text-slate-900 font-semibold">{getModeDisplayName(switchPrompt.to)}</strong>.
                                {switchPrompt.tab ? ` (target tab: ${switchPrompt.tab})` : ''}
                                The existing code in the current editor will stop running.
                            </p>
                            <div className="flex justify-end gap-2.5">
                                <button type="button" onClick={cancelSwitch} className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold cursor-pointer transition-all hover:bg-slate-50">
                                    Cancel
                                </button>
                                <button type="button" onClick={confirmSwitch} className="px-4 py-2 rounded-xl border-0 bg-purple-700 text-white text-xs font-semibold cursor-pointer transition-all hover:bg-purple-800 shadow-md shadow-purple-700/20">
                                    Go Ahead
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {(window as any).electronAPI?.isElectron && <UpdateBanner />}

                {/* Global drag-and-drop overlay */}
                {isGlobalDragOver && (
                    <div className="fixed inset-0 bg-purple-950/20 backdrop-blur-md z-[99999] flex flex-col items-center justify-center p-4 pointer-events-auto">
                        <div className="bg-white/95 border-3 border-dashed border-purple-600 rounded-3xl p-10 px-14 flex flex-col items-center gap-3 shadow-2xl shadow-purple-600/20">
                            <span className="text-5xl mb-1">📥</span>
                            <h3 className="m-0 text-slate-900 text-xl font-extrabold tracking-tight">
                                {globalDragLabel === '.leap Project' ? 'Drop to Open Project' : 'Drop to Upload'}
                            </h3>
                            <p className="m-0 text-slate-500 text-sm font-medium">
                                {globalDragLabel === '.leap Project'
                                    ? 'Release to open in the matching module'
                                    : <>Release to upload to <span className="text-purple-600 font-bold">{globalDragLabel}</span></>
                                }
                            </p>
                        </div>
                    </div>
                )}

                {exitPrompt && (
                    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
                        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 flex flex-col">
                            <h2 className="m-0 mb-2.5 text-lg font-bold text-slate-900">Exit to Home?</h2>
                            <p className="m-0 mb-5 text-sm text-slate-600 leading-relaxed font-medium">
                                Are you sure you want to exit? The code in the current editor will stop running.
                            </p>
                            <div className="flex justify-end gap-2.5">
                                <button type="button" onClick={cancelExit} className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold cursor-pointer transition-all hover:bg-slate-50">
                                    No
                                </button>
                                <button type="button" onClick={confirmExit} className="px-4 py-2 rounded-xl border-0 bg-purple-700 text-white text-xs font-semibold cursor-pointer transition-all hover:bg-purple-800 shadow-md shadow-purple-700/20">
                                    Yes
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </ToastProvider>
        </ErrorBoundary>
    );
}
