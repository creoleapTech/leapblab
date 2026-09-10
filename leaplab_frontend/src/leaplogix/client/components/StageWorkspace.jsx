/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useCallback, useRef } from "react";
import { useLogix } from "../context/LogixContext";
import SidePanel from "../../../python/panels/SidePanel";
import EditorPanel from "../../../python/panels/EditorPanel";
import StagePanel from "../../../python/panels/StagePanel";
import TerminalPanel from "../../../python/terminal/TerminalPanel";
import MonacoEditor from "../../../python/editor/MonacoEditor";
import StatusBar from "../../../python/editor/StatusBar";
import { BACKDROP_LIBRARY } from "../data/backdrops";

export default function StageWorkspace() {
    const ctx = useLogix();

    // ── Adjustable workspace — left file list & right stage ────────────────
    const [leftWidth, setLeftWidth] = useState(240);
    const [rightWidth, setRightWidth] = useState(380);
    const isDraggingLeftRef = useRef(false);
    const isDraggingRightRef = useRef(false);
    const startXLeftRef = useRef(0);
    const startLeftWidthRef = useRef(0);
    const startXRightRef = useRef(0);
    const startRightWidthRef = useRef(0);

    const handleLeftResizeStart = useCallback((e) => {
        e.preventDefault();
        isDraggingLeftRef.current = true;
        startXLeftRef.current = e.clientX;
        startLeftWidthRef.current = leftWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const handleMove = (ev) => {
            if (!isDraggingLeftRef.current) return;
            const delta = ev.clientX - startXLeftRef.current;
            const newWidth = Math.min(Math.max(startLeftWidthRef.current + delta, 180), 420);
            setLeftWidth(newWidth);
        };
        const handleUp = () => {
            isDraggingLeftRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    }, [leftWidth]);

    const handleRightResizeStart = useCallback((e) => {
        e.preventDefault();
        isDraggingRightRef.current = true;
        startXRightRef.current = e.clientX;
        startRightWidthRef.current = rightWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const handleMove = (ev) => {
            if (!isDraggingRightRef.current) return;
            const delta = startXRightRef.current - ev.clientX;
            const newWidth = Math.min(Math.max(startRightWidthRef.current + delta, 240), 560);
            setRightWidth(newWidth);
        };
        const handleUp = () => {
            isDraggingRightRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    }, [rightWidth]);

    return (
        <div className="flex-1 flex overflow-hidden min-h-0 bg-gradient-to-br from-white via-slate-50/20 to-violet-50/10">
            {/* Left — adjustable file list — premium */}
            <div style={{ width: leftWidth }} className="shrink-0 flex flex-col overflow-hidden border-r border-violet-100/60 bg-gradient-to-b from-white via-[#fdfcff] to-[#f5f3ff] shadow-[2px_0_12px_rgba(139,92,246,0.04)]">
                <SidePanel
                    className="w-full h-full bg-white flex flex-col overflow-hidden"
                    sidePanel={ctx.sidePanel} setSidePanel={ctx.setSidePanel}
                    projectFiles={ctx.projectFiles} activeFile={ctx.activeFile} setActiveFile={ctx.setActiveFile}
                    handleAddPythonFiles={ctx.handleAddPythonFiles} handleAddImageFiles={ctx.handleAddImageFiles} handleAddTextFiles={ctx.handleAddTextFiles} handleAddCsvFiles={ctx.handleAddCsvFiles}
                    handleDeleteFile={ctx.handleDeleteFile}
                    onAddNewFile={ctx.handleCreateNewFile} onAddNewTextFile={ctx.handleCreateNewTextFile} onRenameFile={ctx.handleRenameFile}
                    spriteFilter={ctx.spriteFilter} setSpriteFilter={ctx.setSpriteFilter}
                    addSpriteFromLibrary={ctx.addSpriteFromLibrary}
                    SPRITE_LIBRARY={ctx.getSpriteLibrary()} BACKDROP_LIBRARY={BACKDROP_LIBRARY}
                    backdrop={ctx.backdrop} handleSetBackdrop={(bd) => { ctx.setBackdropImg(bd.img || null); ctx.addLog('Backdrop: ' + bd.name, 'success'); }}
                    EXTENSIONS={ctx.EXTENSIONS} installedExtensions={ctx.installedExtensions}
                    installExtension={(ext) => {
                        if (ctx.installedExtensions.find(e => e.id === ext.id)) { ctx.addLog(ext.name + ' already installed', 'info'); return; }
                        ctx.setInstalledExtensions(prev => [...prev, ext]);
                        ctx.setProjectFiles(prev => ({ ...prev, [ctx.activeFile]: (prev[ctx.activeFile] || '') + "\n" + ext.code + "\n" }));
                        ctx.addLog('Extension added: ' + ext.name, 'success');
                    }}
                    packages={ctx.packages} pipFilter={ctx.pipFilter} setPipFilter={ctx.setPipFilter} handleInstall={ctx.handleInstall}
                />
            </div>

            {/* Vertical resizer — left — premium */}
            <div
                onMouseDown={handleLeftResizeStart}
                className="w-1.5 cursor-col-resize shrink-0 flex items-center justify-center bg-gradient-to-b from-slate-50 to-violet-50/30 hover:from-violet-100 hover:to-indigo-100 border-r border-violet-100/60 transition-colors group"
                title="Drag left or right to resize file list"
            >
                <div className="w-0.5 h-8 rounded-full bg-gradient-to-b from-gray-300 to-gray-400 group-hover:from-violet-400 group-hover:to-indigo-500 transition-colors shadow-sm" />
            </div>

            {/* Center — editor + terminal (terminal height adjustable inside EditorPanel/TerminalPanel) */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <EditorPanel
                    projectFiles={ctx.projectFiles} activeFile={ctx.activeFile} setActiveFile={ctx.setActiveFile}
                    editorCursor={ctx.editorCursor} isRunning={ctx.isRunning}
                    onRun={ctx.handleRun} onStop={ctx.handleStop} onClear={ctx.handleClear}
                    activePanel={ctx.activePanel} setActivePanel={ctx.setActivePanel}
                    terminalOutput={ctx.terminalOutput}
                    replInput={ctx.replInput || ""} setReplInput={ctx.setReplInput || (() => { })}
                    handleReplSubmit={ctx.handleReplSubmit || (() => { })} handleReplKey={ctx.handleReplKey || (() => { })}
                    terminalEndRef={ctx.terminalEndRef} replInputRef={ctx.replInputRef || { current: null }}
                    editorRef={ctx.editorRef} monacoRef={ctx.monacoRef} setProjectFiles={ctx.setProjectFiles}
                    onCursorChange={ctx.setCursorEditor || ctx.setEditorCursor}
                    packages={ctx.packages} pipFilter={ctx.pipFilter} setPipFilter={ctx.setPipFilter} handleInstall={ctx.handleInstall}
                    isWaitingForInput={ctx.isWaitingForInput} inputPromptText={ctx.inputPromptText}
                    terminalInputValue={ctx.terminalInputValue} setTerminalInputValue={ctx.setTerminalInputValue}
                    handleTerminalInputSubmit={ctx.handleTerminalInputSubmit} handleTerminalInputKey={ctx.handleTerminalInputKey}
                    terminalInputRef={ctx.terminalInputRef}
                    isElectron={ctx.isElectron}
                    shellInput={ctx.shellInput || ""} setShellInput={ctx.setShellInput}
                    handleShellSubmit={ctx.handleShellSubmit} handleShellKey={ctx.handleShellKey}
                    shellInputRef={ctx.shellInputRef || { current: null }}
                />
            </div>

            {/* Vertical resizer — right — premium */}
            <div
                onMouseDown={handleRightResizeStart}
                className="w-1.5 cursor-col-resize shrink-0 flex items-center justify-center bg-gradient-to-b from-white via-violet-50/20 to-indigo-50/20 hover:from-violet-100 hover:to-indigo-100 border-l border-r border-violet-100/60 transition-colors group"
                title="Drag left or right to resize stage"
            >
                <div className="w-0.5 h-8 rounded-full bg-gradient-to-b from-gray-300 to-gray-400 group-hover:from-violet-400 group-hover:to-indigo-500 transition-colors shadow-sm" />
            </div>

            {/* Right — adjustable stage — premium */}
            <div style={{ width: rightWidth }} className="shrink-0 flex flex-col overflow-hidden border-l border-violet-100/60 bg-gradient-to-b from-white via-[#fdfcff] to-[#f5f3ff] shadow-[-2px_0_12px_rgba(139,92,246,0.04)]">
                <StagePanel
                    className="w-full h-full bg-white flex flex-col min-h-0 overflow-y-auto"
                    sprites={ctx.sprites} selectedSpriteId={ctx.selectedSpriteId}
                    setSelectedSpriteId={ctx.setSelectedSpriteId} backdrop={ctx.backdrop}
                    stageRef={ctx.stageRef} stageSize={ctx.stageSize}
                    setShowSpriteLibrary={ctx.setShowSpriteLibrary}
                    updateSpriteProperty={ctx.updateSpriteProperty}
                    BACKDROP_LIBRARY={BACKDROP_LIBRARY}
                    handleSetBackdrop={(bd) => { ctx.setBackdropImg(bd.img || null); ctx.addLog('Backdrop: ' + bd.name, 'success'); }}
                    deleteSprite={ctx.deleteSprite}
                    activeMode={ctx.activeMode || "mixed"}
                    onOpenAssetLibrary={ctx.onOpenAssetLibrary}
                />
            </div>
        </div>
    );
}
