/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * LogixApp.jsx — Slim entry point for the Logix (Python) IDE
 *
 * This component orchestrates all hooks and delegates rendering to
 * dedicated sub-components: TopBar, IdeWorkspace, StageWorkspace,
 * UploadWorkspace, and modal dialogs.
 * ═══════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { StageProvider, useStage } from "../../context/StageContext";
import { LogixProvider } from "./context/LogixContext";
import { ThemeProvider } from "./context/ThemeContext";

// ─── Hooks ─────────────────────────────────────────────────────────────────
import { useTerminal } from "./hooks/useTerminal";
import { useFileManager } from "./hooks/useFileManager";
import { usePythonExecution } from "./hooks/usePythonExecution";
import { useUploadMode } from "./hooks/useUploadMode";
import { usePipManager } from "./hooks/usePipManager";
import { useSpriteManager } from "./hooks/useSpriteManager";

// ─── Data / Utils ──────────────────────────────────────────────────────────
import { EXTENSIONS } from "./data/extensions";
import { BACKDROP_LIBRARY } from "./data/backdrops";
import { getDefaultSpritePresets, createIntermediateBlocksBridge } from "../../python/SpriteBridge";

// ─── Sub-Components ────────────────────────────────────────────────────────
import TopBar from "./components/TopBar";
import IdeWorkspace from "./components/IdeWorkspace";
import StageWorkspace from "./components/StageWorkspace";
import UploadWorkspace from "./components/UploadWorkspace";
import SpriteLibraryModal from "./components/SpriteLibraryModal";
import PromptModal from "./components/PromptModal";
import BoardSelectionModal from "../../leapignite/client/components/BoardSelectionModal";

// ═══════════════════════════════════════════════════════════════════════════
// Inner App (must be inside StageProvider)
// ═══════════════════════════════════════════════════════════════════════════
function LogixAppInner({ onBack, onSwitchToNotebook, onSwitchToBlocks, onSwitchToCostumes }) {
    const stage = useStage();
    const { sprites, setSprites, selectedSpriteId, setSelectedSpriteId, backdrop, setBackdrop: setBackdropImg, stageSize, stageRef, addSprite, deleteSprite, updateSprite, updateSpriteProperty, resetStage } = stage;

    // ── Terminal ────────────────────────────────────────────────────────────
    const {
        terminalOutput, setTerminalOutput, terminalEndRef, addLog, clearTerminal,
        shellInput, setShellInput, shellHistory, shellHistoryIndex, shellInputRef,
        handleShellSubmit, handleShellKey,
    } = useTerminal();

    // ── UI State ────────────────────────────────────────────────────────────
    const [workflowMode, setWorkflowMode] = useState("ide");
    const [activePanel, setActivePanel] = useState("terminal");
    const [sidePanel, setSidePanel] = useState("files");
    const [spriteFilter, setSpriteFilter] = useState("");
    const [installedExtensions, setInstalledExtensions] = useState([]);
    const [editorCursor, setEditorCursor] = useState({ line: 1, col: 1 });

    // ── File Manager ────────────────────────────────────────────────────────
    const {
        projectName, setProjectName, activeFile, setActiveFile,
        projectFiles, setProjectFiles,
        handleNewProject, handleSaveProject, handleDownloadProject, handleOpenProject, handleShareProject,
        handleDeleteFile, handleCreateNewFile, handleCreateNewTextFile,
        handleRenameFile, handleOpenPythonFile,
        handleAddPythonFiles, handleAddImageFiles, handleAddTextFiles, handleAddCsvFiles,
    } = useFileManager({
        addLog, sprites, backdrop, setSprites, setSelectedSpriteId, setBackdropImg, resetStage,
        workflowMode, setWorkflowMode
    });

    // ── Python Execution ────────────────────────────────────────────────────
    const {
        isRunning, isWaitingForInput, inputPromptText,
        terminalInputValue, setTerminalInputValue,
        inputResolverRef, terminalInputRef, skulptRef, runStopRequestedRef,
        initSkulpt, handleRun, handleStop, handleTerminalInputSubmit, handleTerminalInputKey,
    } = usePythonExecution({ projectFiles, setProjectFiles, addLog });

    // ── Upload Mode ─────────────────────────────────────────────────────────
    const upload = useUploadMode({ addLog });
    const monacoRef = useRef(null);
    const editorRef = useRef(null);

    // ── Pip Manager ─────────────────────────────────────────────────────────
    const { packages, pipFilter, setPipFilter, handleInstall } = usePipManager({ addLog, setActivePanel });

    // ── Sprite Manager ──────────────────────────────────────────────────────
    const sprite = useSpriteManager({ sprites, setSprites, setSelectedSpriteId, addLog });

    const [modalState, setModalState] = useState({
        isOpen: false, title: "", message: "", defaultValue: "", onSubmit: null,
    });
    const [modalInput, setModalInput] = useState("");
    const [replInput, setReplInput] = useState("");
    const replInputRef = useRef(null);

    const isPythonBannerText = useCallback((text) => {
        const t = text.trim();
        if (!t) return true;
        if (/^Python\s+\d+\.\d+/.test(t)) return true;
        if (t.startsWith('Type "help"')) return true;
        if (t === ">>>" || t.startsWith(">>> ")) return true;
        if (t === "..." || t.startsWith("... ")) return true;
        if (/^help\s*,\s*copyright/.test(t)) return true;
        return false;
    }, []);

    // ── Skulpt Init ───────────────────────────────────────────────────────
    useEffect(() => {
        window.updateSprite = (spriteIdOrName, updates) => {
            setSprites(prev => prev.map(s => {
                if (s.id !== spriteIdOrName && s.name.toLowerCase() !== String(spriteIdOrName).toLowerCase()) return s;
                const newProps = { ...s };
                if (updates.x !== undefined || updates.y !== undefined) {
                    newProps.position = { ...(s.position || { x: s.x || 0, y: s.y || 0 }) };
                    const scaleX = stageSize.w / 480;
                    const scaleY = stageSize.h / 360;
                    const centerX = stageSize.w / 2;
                    const centerY = stageSize.h / 2;
                    const offset = 40;
                    if (updates.x !== undefined) {
                        newProps.position.x = (updates.x - centerX + offset) / scaleX;
                        newProps.x = newProps.position.x;
                    }
                    if (updates.y !== undefined) {
                        newProps.position.y = (centerY - updates.y - offset) / scaleY;
                        newProps.y = newProps.position.y;
                    }
                }
                Object.keys(updates).forEach(key => {
                    if (key === 'x' || key === 'y') return;
                    if (typeof updates[key] === 'function') {
                        newProps[key] = updates[key](s[key]);
                    } else {
                        newProps[key] = updates[key];
                    }
                });
                return newProps;
            }));
        };

        window.pixelToleap = (pixelX, pixelY) => {
            const leapX = (pixelX - stageSize.w / 2 + 40) / (stageSize.w / 480);
            const leapY = (stageSize.h / 2 - pixelY - 40) / (stageSize.h / 360);
            return { x: leapX, y: leapY };
        };

        window.leapToPixel = (leapX, leapY) => {
            const pixelX = (stageSize.w / 2) + (leapX * (stageSize.w / 480)) - 40;
            const pixelY = (stageSize.h / 2) - (leapY * (stageSize.h / 360)) - 40;
            return { x: pixelX, y: pixelY };
        };

        const skulpt = initSkulpt({
            initSprite: (name) => {
                setSprites(prev => {
                    if (prev.find(s => s.name.toLowerCase() === name.toLowerCase())) return prev;
                    const preset = getDefaultSpritePresets()[name.toLowerCase()] || {
                        name, type: 'robot', costumes: { default: "assets/sprites/robot/robot_idle.svg" }
                    };
                    const id = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
                    const newSprite = {
                        id, name: preset.name || name, type: preset.type || 'robot',
                        position: { x: (Math.random() - 0.5) * 40, y: (Math.random() - 0.5) * 40 },
                        direction: 0, size: 100, visible: true, speech: '',
                        currentCostume: 'default', costumes: preset.costumes || { default: "assets/sprites/robot/robot_idle.svg" },
                        mirrored: false
                    };
                    addLog('Initialized sprite: ' + name, 'success');
                    return [...prev, newSprite];
                });
            },
            moveRelative: (name, dir, steps) => {
                setSprites(prev => prev.map(s => {
                    if (s.name.toLowerCase() !== name.toLowerCase()) return s;
                    const d = steps || 20;
                    let dx = 0, dy = 0;
                    if (dir === "RIGHT") dx = d;
                    if (dir === "LEFT") dx = -d;
                    if (dir === "UP") dy = d;
                    if (dir === "DOWN") dy = -d;
                    const pos = s.position || { x: s.x || 0, y: s.y || 0 };
                    addLog(`➡️ ${name}: Move ${dir} ${d} steps`, 'info');
                    return { ...s, x: pos.x + dx, y: pos.y + dy, position: { x: pos.x + dx, y: pos.y + dy } };
                }));
            },
            moveSteps: (name, steps) => {
                setSprites(prev => prev.map(s => {
                    if (s.name.toLowerCase() !== name.toLowerCase()) return s;
                    const angle = s.direction ?? s.angle ?? 0;
                    const rad = (angle * Math.PI) / 180;
                    const pos = s.position || { x: s.x || 0, y: s.y || 0 };
                    const newX = pos.x + Math.cos(rad) * steps;
                    const newY = pos.y + Math.sin(rad) * steps;
                    addLog(`🏃 ${name}: Move ${steps} steps (direction: ${angle}°)`, 'info');
                    return { ...s, x: newX, y: newY, position: { x: newX, y: newY } };
                }));
            },
            update: (name, props) => {
                setSprites(prev => prev.map(s => {
                    if (s.name.toLowerCase() !== name.toLowerCase()) return s;
                    const newProps = { ...s };
                    const pos = s.position || { x: s.x || 0, y: s.y || 0 };
                    newProps.position = { ...pos };
                    const actionType = Object.keys(props).join(', ');
                    addLog(`🤖 ${name}: ${actionType}`, 'info');
                    Object.keys(props).forEach(key => {
                        if (typeof props[key] === 'function') {
                            const oldVal = key === 'direction' ? (s.direction ?? s.angle ?? 0) : key === 'angle' ? (s.angle ?? s.direction ?? 0) : s[key];
                            const newVal = props[key](oldVal);
                            newProps[key] = newVal;
                            if (key === 'direction') newProps.angle = newVal;
                            if (key === 'angle') newProps.direction = newVal;
                        } else if (key === 'nextCostume' && props[key]) {
                            const costumeKeys = Object.keys(s.costumes || {});
                            const currentIdx = costumeKeys.indexOf(s.currentCostume);
                            const nextIdx = (currentIdx + 1) % costumeKeys.length;
                            newProps.currentCostume = costumeKeys[nextIdx] || 'default';
                            addLog(`🎭 ${name}: Changed costume to ${newProps.currentCostume}`, 'info');
                        } else if (key === 'position') {
                            newProps.position = { ...newProps.position, ...props[key] };
                            newProps.x = newProps.position.x;
                            newProps.y = newProps.position.y;
                        } else if (key === 'x') {
                            newProps.x = props[key];
                            newProps.position.x = props[key];
                        } else if (key === 'y') {
                            newProps.y = props[key];
                            newProps.position.y = props[key];
                        } else {
                            newProps[key] = props[key];
                            if (key === 'direction') newProps.angle = props[key];
                            if (key === 'angle') newProps.direction = props[key];
                        }
                    });
                    return newProps;
                }));
            },
            softResetAll: () => setSprites(prev => prev.map(s => ({
                ...s, x: 0, y: 0, position: { x: 0, y: 0 }, speech: '', angle: 0,
                direction: 0, size: 100, visible: true
            }))),
        });

        const spriteBridge = createIntermediateBlocksBridge(sprites, setSprites, selectedSpriteId, addLog);
        window.spriteBridge = spriteBridge;
        window.spritePanelFunctions = {
            move: spriteBridge.move, moveRelative: spriteBridge.moveRelative,
            turn: spriteBridge.turn, goTo: spriteBridge.goTo, say: spriteBridge.say,
            think: spriteBridge.think, show: spriteBridge.show, hide: spriteBridge.hide,
            setSize: spriteBridge.setSize, changeSize: spriteBridge.changeSize,
            nextCostume: spriteBridge.nextCostume, switchCostume: spriteBridge.switchCostume,
            pointInDirection: spriteBridge.pointInDirection, getPosition: spriteBridge.getPosition,
            getDirection: spriteBridge.getDirection, getSize: spriteBridge.getSize,
            isVisible: spriteBridge.isVisible
        };

        return () => { delete window.spriteBridge; delete window.spritePanelFunctions; };
    }, [addLog, updateSprite, sprites, setSprites, selectedSpriteId, stageSize, initSkulpt]);

    // ── Keyboard Shortcuts ────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F5') {
                e.preventDefault();
                if (!isRunning) handleRun(activeFile, () => skulptRef.current?.callbacks?.actions?.softResetAll?.());
            }
            if (e.key === 'Escape' && isRunning) { e.preventDefault(); handleStop(); }
            if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); clearTerminal(); }
            if (e.ctrlKey && e.key === '`') {
                e.preventDefault();
                setActivePanel(prev => prev === 'repl' ? 'terminal' : 'repl');
                if (activePanel !== 'repl') setTimeout(() => editorRef.current?.focus?.(), 100);
            }
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); addLog("💾 Project auto-saved", "success"); }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isRunning, activePanel, activeFile, handleRun, handleStop, clearTerminal, addLog, skulptRef]);

    // ── Native Python IPC ─────────────────────────────────────────────────
    useEffect(() => {
        if (!window.electronAPI?.isElectron) return;
        const cleanups = [
            window.electronAPI.onPythonOutput((data) => addLog(data.replace(/\n$/, ""), "log")),
            window.electronAPI.onPythonError((data) => {
                const cleaned = data.replace(/\n$/, "");
                if (isPythonBannerText(cleaned)) return;
                addLog(cleaned, "error");
            }),
            window.electronAPI.onPythonExit((code) => {
                if (code === null) { addLog(`✗ Failed to start Python.`, "error"); }
                else if (code === 0) { addLog(`✓ Program finished successfully`, "success"); }
                else { addLog(`✗ Program exited with code ${code}`, "warning"); }
                isRunning && handleStop();
            }),
            window.electronAPI.onPythonReplOutput((data) => addLog(data.replace(/\n$/, ""), "log")),
            window.electronAPI.onPythonReplError((data) => addLog(data.replace(/\n$/, ""), "error")),
            window.electronAPI.onPythonPipOutput((data) => addLog(data.replace(/\n$/, ""), "log")),
            window.electronAPI.onPythonPipError((data) => addLog(data, "error")),
            ...(window.electronAPI.onPythonShellOutput ? [window.electronAPI.onPythonShellOutput((data) => addLog(data.replace(/\n$/, ""), "log"))] : []),
            ...(window.electronAPI.onPythonShellError ? [window.electronAPI.onPythonShellError((data) => addLog(data.replace(/\n$/, ""), "error"))] : []),
            ...(window.electronAPI.onPythonShellExit ? [window.electronAPI.onPythonShellExit((code) => {
                if (code === null) { addLog(`✗ Shell command failed.`, "error"); }
                else if (code === 0) { addLog(`✓ Command completed`, "success"); }
                else { addLog(`✗ Command exited with code ${code}`, "warning"); }
            })] : []),
            window.electronAPI.onPythonFilesUpdated((files) => {
                setProjectFiles(prev => ({ ...prev, ...files }));
                addLog(`📁 Files updated: ${Object.keys(files).join(', ')}`, "info");
            }),
            window.electronAPI.onPythonDownloadProgress?.((data) => {
                if (data.status === 'checking') addLog(`🔍 ${data.message}`, "info");
                else if (data.status === 'downloading') addLog(`⬇ ${data.message}`, "info");
                else if (data.status === 'ready') addLog(`✓ ${data.message}`, "success");
                else if (data.status === 'error') addLog(`✗ ${data.message}`, "error");
                else addLog(`[Python] ${data.message}`, "log");
            }),
        ];
        return () => cleanups.forEach(fn => fn?.());
    }, [addLog, isPythonBannerText, isRunning, handleStop, setProjectFiles]);

    // ── Modal handlers ────────────────────────────────────────────────────
    const openTextPrompt = useCallback((title, message, defaultValue, onSubmit) => {
        setModalInput(defaultValue || "");
        setModalState({ isOpen: true, title, message, defaultValue: defaultValue || "", onSubmit });
    }, []);

    const handleModalCancel = useCallback(() => {
        setModalState({ isOpen: false, title: "", message: "", defaultValue: "", onSubmit: null });
        setModalInput("");
    }, []);

    const handleModalSubmit = useCallback(() => {
        const nextValue = modalInput.trim();
        if (!nextValue) return;
        modalState.onSubmit?.(nextValue);
        handleModalCancel();
    }, [handleModalCancel, modalInput, modalState]);

    // ── REPL handlers ──────────────────────────────────────────────────────
    const handleReplSubmit = useCallback(() => {
        const line = replInput.trim();
        if (!line) return;
        addLog(`>>> ${line}`, "input");
        if (window.electronAPI?.isElectron) {
            window.electronAPI.pythonReplSend(line);
        }
        setReplInput("");
    }, [replInput, addLog]);

    const handleReplKey = useCallback((e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleReplSubmit();
        }
    }, [handleReplSubmit]);

    // ── Workflow mode change ──────────────────────────────────────────────
    const handleWorkflowModeChange = useCallback((nextMode) => {
        if (nextMode === workflowMode) return;
        setWorkflowMode(nextMode);
        const modeLabels = { stage: "Stage", upload: "Upload", ide: "IDE" };
        upload.addUploadMessage(`Switched to ${modeLabels[nextMode] || nextMode} mode.`, "info");
    }, [workflowMode, upload]);

    const handleRunWithReset = useCallback(() => {
        handleRun(activeFile, () => skulptRef.current?.callbacks?.actions?.softResetAll?.());
    }, [handleRun, activeFile, skulptRef]);

    // ── Render ─────────────────────────────────────────────────────────────
    const contextValue = {
        workflowMode, setWorkflowMode: handleWorkflowModeChange,
        activePanel, setActivePanel, sidePanel, setSidePanel,
        projectFiles, setProjectFiles, activeFile, setActiveFile,
        projectName, setProjectName, isRunning, editorCursor, setEditorCursor,
        monacoRef, editorRef, spriteFilter, setSpriteFilter,
        installedExtensions, setInstalledExtensions,
        packages, pipFilter, setPipFilter, handleInstall,
        terminalOutput, setTerminalOutput, terminalEndRef, addLog, clearTerminal,
        handleRun: handleRunWithReset, handleStop, handleClear: clearTerminal,
        handleNewProject, handleSaveProject, handleDownloadProject, handleOpenProject, handleShareProject,
        handleDeleteFile, handleCreateNewFile, handleCreateNewTextFile,
        handleRenameFile, handleOpenPythonFile,
        handleAddPythonFiles, handleAddImageFiles, handleAddTextFiles, handleAddCsvFiles,
        sprites, setSprites, selectedSpriteId, setSelectedSpriteId,
        backdrop, setBackdropImg, stageSize, stageRef,
        deleteSprite, updateSprite, updateSpriteProperty, resetStage,
        isWaitingForInput, inputPromptText,
        terminalInputValue, setTerminalInputValue,
        handleTerminalInputSubmit, handleTerminalInputKey,
        terminalInputRef, inputResolverRef,
        replInput, setReplInput, handleReplSubmit, handleReplKey, replInputRef,
        shellInput, setShellInput, handleShellSubmit, handleShellKey, shellInputRef, shellHistoryIndex,
        isElectron: window.electronAPI?.isElectron || false,
        ...upload, ...sprite,
        BACKDROP_LIBRARY, EXTENSIONS,
        openTextPrompt, modalState, modalInput, setModalInput,
        handleModalCancel, handleModalSubmit,
        onBack, onSwitchToNotebook, onSwitchToBlocks, onSwitchToCostumes,
    };

    return (
        <LogixProvider value={contextValue}>
            <div className="flex flex-col h-screen w-screen bg-slate-50 text-slate-800 overflow-hidden font-sans">
                <TopBar />

                {workflowMode === "stage" ? (
                    <StageWorkspace />
                ) : workflowMode === "upload" ? (
                    <UploadWorkspace />
                ) : (
                    <IdeWorkspace />
                )}

                <PromptModal />
                <SpriteLibraryModal />

                <BoardSelectionModal
                    isOpen={upload.isBoardModalOpen}
                    onClose={() => upload.setIsBoardModalOpen(false)}
                    onSelect={(boardId, boardName) => {
                        upload.setSelectedBoard(boardId);
                        upload.setIsBoardModalOpen(false);
                        upload.setUploadView("board");
                        upload.setUploadActiveFile(upload.selectedBoardConfig.fileName);
                        upload.addUploadMessage(`Selected board: ${boardName}`, "success");
                    }}
                    currentBoard={upload.selectedBoard}
                />
            </div>
        </LogixProvider>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported wrapper with StageProvider
// ═══════════════════════════════════════════════════════════════════════════
export default function LogixApp(props) {
    return (
        <StageProvider>
            <LogixAppInner {...props} />
        </StageProvider>
    );
}
