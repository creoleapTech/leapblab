/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from "react";
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

    return (
        <div className="flex-1 flex overflow-auto min-h-0">
            <SidePanel
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

            <StagePanel
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
    );
}
