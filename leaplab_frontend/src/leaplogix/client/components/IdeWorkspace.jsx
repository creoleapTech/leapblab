/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from "react";
import { useLogix } from "../context/LogixContext";
import SidePanel from "../../../python/panels/SidePanel";
import MonacoEditor from "../../../python/editor/MonacoEditor";
import StatusBar from "../../../python/editor/StatusBar";
import TerminalPanel from "../../../python/terminal/TerminalPanel";
import { FileCode2, Plus } from "lucide-react";
import { BACKDROP_LIBRARY } from "../data/backdrops";

export default function IdeWorkspace() {
    const ctx = useLogix();

    return (
        <div className="flex-1 flex overflow-hidden min-h-0 bg-gradient-to-br from-slate-900 via-[#0a0a1f] to-[#1e1b4b]">
            {/* Left Sidebar — fixed wrapper, SidePanel fills it — premium light */}
            <div className="w-60 shrink-0 flex flex-col overflow-hidden border-r border-violet-200/30 bg-gradient-to-b from-white via-[#fdfcff] to-[#f5f3ff] shadow-[2px_0_12px_rgba(0,0,0,0.08)]">
                <SidePanel
                    className="w-full h-full bg-white flex flex-col overflow-hidden"
                    hideModules={true}
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

            {/* Center: Code Editor — premium */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-violet-900/20 bg-gradient-to-b from-white via-slate-50/30 to-violet-50/20 shadow-inner">
                {Object.keys(ctx.projectFiles).length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4 font-mono">
                        <FileCode2 size={48} strokeWidth={1.2} className="opacity-40" />
                        <div className="text-base font-medium text-slate-300">No files yet</div>
                        <div className="text-xs text-slate-500">Create a new file from the sidebar to get started</div>
                        <button onClick={ctx.handleCreateNewFile} className="mt-2 py-2 px-5 bg-violet-600 text-white border-0 rounded-md text-xs font-semibold cursor-pointer flex items-center gap-1.5 hover:bg-violet-700 transition-colors">
                            <Plus size={14} /> New File
                        </button>
                    </div>
                ) : (
                    <>
                        <MonacoEditor
                            projectFiles={ctx.projectFiles} activeFile={ctx.activeFile}
                            setProjectFiles={ctx.setProjectFiles} editorRef={ctx.editorRef}
                            monacoRef={ctx.monacoRef} editorCursor={ctx.editorCursor}
                            isRunning={ctx.isRunning} onRun={ctx.handleRun}
                            onCursorChange={ctx.setEditorCursor}
                            editorOptions={{ theme: "vs-dark" }}
                        />
                        <StatusBar editorCursor={ctx.editorCursor} isRunning={ctx.isRunning} activeFile={ctx.activeFile} />
                    </>
                )}
            </div>

            {/* Right: Terminal / REPL — premium dark */}
            <div className="w-96 flex flex-col overflow-hidden shrink-0 bg-gradient-to-b from-slate-900 via-[#0f0a1f] to-[#1a1033] border-l border-violet-900/20 shadow-[-4px_0_16px_rgba(0,0,0,0.12)]">
                <style>{`.ide-terminal-full > div:first-child { height: 100% !important; flex: 1 !important; }`}</style>
                <div className="ide-terminal-full flex-1 flex flex-col overflow-hidden">
                    <TerminalPanel
                        activePanel={ctx.activePanel} setActivePanel={ctx.setActivePanel}
                        terminalOutput={ctx.terminalOutput}
                        replInput={ctx.replInput || ""} setReplInput={ctx.setReplInput || (() => { })}
                        handleReplSubmit={ctx.handleReplSubmit || (() => { })} handleReplKey={ctx.handleReplKey || (() => { })}
                        terminalEndRef={ctx.terminalEndRef} replInputRef={ctx.replInputRef || { current: null }}
                        isRunning={ctx.isRunning} onRun={ctx.handleRun} onStop={ctx.handleStop} onClear={ctx.handleClear}
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
            </div>
        </div>
    );
}
