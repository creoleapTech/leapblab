/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useCallback, useRef } from "react";
import { useLogix } from "../context/LogixContext";
import MonacoEditor from "../../../python/editor/MonacoEditor";
import SerialMonitor from "../../../components/SerialMonitor";
import { FileText, FileCode2, FileUp, Trash2, Plus, Plug, Cpu, RefreshCw, Upload, Undo, Redo, Loader, CheckCircle, AlertCircle, ClipboardList, TerminalSquare } from "lucide-react";
import { C } from "../utils/theme";
import { getFileExtension, BOARD_HEADER_EXTENSIONS, BOARD_SOURCE_EXTENSIONS, isBoardUploadFile, formatPortLabel } from "../utils/boardConfig";
import { buildBoardTemplate, buildLibraryHeaderTemplate, buildLibraryCppTemplate, getUniqueLibraryBaseName, getLibraryBaseName, normalizeCppInclude, insertIncludeLineIntoSource } from "../utils/boardConfig";
import { getUniqueFileName } from "../utils/fileUtils";

export default function UploadWorkspace() {
    const ctx = useLogix();

    // ── Adjustable layout ────────────────────────────────────────────────
    const [sidebarWidth, setSidebarWidth] = useState(278);
    const [terminalHeight, setTerminalHeight] = useState(260);
    const isDraggingSidebarRef = useRef(false);
    const isDraggingTerminalRef = useRef(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);

    const handleSidebarResizeStart = useCallback((e) => {
        e.preventDefault();
        isDraggingSidebarRef.current = true;
        startXRef.current = e.clientX;
        startWidthRef.current = sidebarWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const handleMove = (ev) => {
            if (!isDraggingSidebarRef.current) return;
            const delta = ev.clientX - startXRef.current;
            const newWidth = Math.min(Math.max(startWidthRef.current + delta, 180), 520);
            setSidebarWidth(newWidth);
        };
        const handleUp = () => {
            isDraggingSidebarRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    }, [sidebarWidth]);

    const handleTerminalResizeStart = useCallback((e) => {
        e.preventDefault();
        isDraggingTerminalRef.current = true;
        startYRef.current = e.clientY;
        startHeightRef.current = terminalHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        const handleMove = (ev) => {
            if (!isDraggingTerminalRef.current) return;
            const delta = startYRef.current - ev.clientY;
            const maxAllowed = Math.min(600, window.innerHeight - 220);
            const newHeight = Math.min(Math.max(startHeightRef.current + delta, 140), maxAllowed);
            setTerminalHeight(newHeight);
            // trigger monaco resize if needed
            if (ctx.editorRef.current) {
                // Monaco auto-resizes via flex, no explicit call needed
            }
        };
        const handleUp = () => {
            isDraggingTerminalRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    }, [terminalHeight, ctx.editorRef]);

    const handleCreateUploadPythonFile = () => {
        ctx.openTextPrompt("New MicroPython File", "Enter a file name for the new MicroPython file.", "module.py", (requestedName) => {
            let createdFileName = "";
            ctx.setUploadProjectFiles((prev) => {
                createdFileName = getUniqueFileName(requestedName, prev);
                return { ...prev, [createdFileName]: `# ${createdFileName}\n\n` };
            });
            if (createdFileName) {
                ctx.setUploadView("project");
                ctx.setUploadActiveFile(createdFileName);
                ctx.addUploadMessage(`Created ${createdFileName}`, "success");
            }
        });
    };

    const handleReplaceBoardFirmware = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".ino,.cpp,.c,.h,.hpp";
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = String(event.target?.result || "");
                ctx.setUploadProjectFiles((prev) => ({ ...prev, [ctx.activeBoardFile]: content }));
                ctx.setUploadView("board");
                ctx.setUploadActiveFile(ctx.activeBoardFile);
                ctx.addUploadMessage(`Imported board firmware into ${ctx.activeBoardFile}`, "success");
            };
            reader.readAsText(file);
        };
        input.click();
    };

    const boardCppActions = [
        { label: "Upload a header file", description: "Import .h or .hpp files into the board workspace.", icon: FileText, onClick: () => { } },
        { label: "Upload a new cpp file", description: "Add .cpp, .cc, .c, or .ino source files.", icon: FileUp, onClick: () => { } },
        { label: "Import C++ library", description: "Insert a #include statement into the main board file.", icon: FileCode2, onClick: () => { } },
    ];

    const renderUploadOutput = () => {
        if (ctx.uploadPanelTab === "serial") {
            return <SerialMonitor baudRate={ctx.baudRate} setBaudRate={ctx.setBaudRate} lineEnding={ctx.lineEnding} setLineEnding={ctx.setLineEnding}
                messages={ctx.serialMessages} setMessages={ctx.setSerialMessages} onSendMessage={ctx.handleSendSerial} isConnected={ctx.isConnected} />;
        }
        const lines = ctx.uploadPanelTab === "log"
            ? ctx.uploadLogMessages.map((text) => ({ text, type: "info" }))
            : ctx.uploadTerminalOutput;

        return (
            <div className="flex-1 overflow-y-auto bg-white p-3 px-3.5 font-mono text-xs leading-relaxed">
                {lines.map((entry, index) => {
                    const type = entry.type || "info";
                    const colorClass = type === "error" ? "text-red-600" : type === "success" ? "text-green-700" : type === "warning" ? "text-amber-700" : "text-gray-600";
                    return <div key={`${entry.text}-${index}`} className={`${colorClass} mb-1.5`}>{entry.text}</div>;
                })}
            </div>
        );
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-gradient-to-br from-white via-slate-50/20 to-violet-50/10">
            {/* Upload Toolbar — premium gradient */}
            <div className="h-12 bg-gradient-to-r from-white via-white to-violet-50/40 backdrop-blur-sm flex items-center px-3 justify-between border-b border-violet-100/60 shadow-[0_2px_12px_rgba(139,92,246,0.06)] gap-4 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="flex rounded-lg overflow-hidden bg-gradient-to-r from-[#ede9fe] via-[#f5f3ff] to-[#ede9fe] border border-violet-200/60 shadow-sm">
                        {["project", "board"].map(view => (
                            <button
                                key={view}
                                onClick={() => ctx.setUploadView(view)}
                                className={`flex items-center gap-1.5 px-3.5 py-1.75 border-none text-xs font-bold cursor-pointer transition-all ${
                                    ctx.uploadView === view ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md" : "bg-transparent text-slate-700 hover:text-violet-700"
                                }`}
                            >
                                {view === "project" ? <><FileText size={14} /> MicroPython</> : <><FileCode2 size={14} /> Board C++</>}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => ctx.setIsBoardModalOpen(true)}
                        className="flex items-center gap-1.5 border border-violet-200/60 bg-gradient-to-r from-white to-violet-50/30 rounded-lg px-3 py-1.75 text-xs font-semibold text-slate-700 cursor-pointer hover:from-violet-50 hover:to-indigo-50 hover:border-violet-300 hover:text-violet-700 shadow-sm transition-all"
                    >
                        <Cpu size={14} className="text-violet-600" /> {ctx.selectedBoardName}
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={ctx.selectedPort}
                        onChange={(e) => ctx.setSelectedPort(e.target.value)}
                        className="border border-violet-200/60 rounded-lg px-2.5 py-1.75 text-xs text-slate-700 min-w-[180px] outline-none bg-gradient-to-r from-white to-violet-50/20 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 shadow-sm"
                    >
                        <option value="">{ctx.ports.length ? "Select Port" : "No Ports Found"}</option>
                        {ctx.ports.map((port) => <option key={port.path} value={port.path}>{formatPortLabel(port)}</option>)}
                    </select>
                    <button
                        onClick={ctx.refreshPorts}
                        title="Refresh Ports"
                        className="w-8.5 h-8.5 rounded-lg border border-violet-200/60 bg-gradient-to-br from-white to-violet-50/30 text-slate-700 flex items-center justify-center cursor-pointer hover:from-violet-50 hover:to-indigo-50 hover:border-violet-300 hover:text-violet-700 shadow-sm transition-all"
                    >
                        <RefreshCw size={15} />
                    </button>
                    <button
                        onClick={ctx.handleConnectToBoard}
                        className={`flex items-center gap-1.5 border-none rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer transition-all shadow-sm ${
                            ctx.isConnected ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-emerald-500/20" : "bg-gradient-to-r from-indigo-50 to-violet-50 text-slate-700 hover:from-indigo-100 hover:to-violet-100 border border-violet-200/50"
                        }`}
                    >
                        <Plug size={14} /> {ctx.isConnected ? "Disconnect" : "Connect"}
                    </button>
                    <div className="w-px h-5.5 bg-gradient-to-b from-transparent via-violet-200/60 to-transparent" />
                    <button
                        onClick={() => ctx.editorRef.current?.trigger('keyboard', 'undo', null)}
                        className="border border-violet-200/50 bg-gradient-to-br from-white to-slate-50 rounded-lg w-8.5 h-8.5 flex items-center justify-center cursor-pointer text-slate-600 hover:from-violet-50 hover:to-indigo-50 hover:border-violet-300 hover:text-violet-700 shadow-sm transition-all"
                    >
                        <Undo size={15} />
                    </button>
                    <button
                        onClick={() => ctx.editorRef.current?.trigger('keyboard', 'redo', null)}
                        className="border border-violet-200/50 bg-gradient-to-br from-white to-slate-50 rounded-lg w-8.5 h-8.5 flex items-center justify-center cursor-pointer text-slate-600 hover:from-violet-50 hover:to-indigo-50 hover:border-violet-300 hover:text-violet-700 shadow-sm transition-all"
                    >
                        <Redo size={15} />
                    </button>
                    <div className="w-px h-5.5 bg-gradient-to-b from-transparent via-violet-200/60 to-transparent hidden sm:block" />
                    <button
                        onClick={ctx.handleUploadFirmware}
                        disabled={ctx.isUploadingFirmware}
                        className={`flex items-center gap-2 border-none rounded-lg px-4 py-2 text-xs font-bold text-white transition-all shadow-md ${
                            ctx.isUploadingFirmware ? "bg-gradient-to-r from-violet-300 to-indigo-300 cursor-not-allowed shadow-none" : "bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-700 hover:from-violet-700 hover:via-indigo-700 hover:to-violet-800 cursor-pointer shadow-violet-500/25 hover:shadow-violet-500/30 hover:scale-[1.02]"
                        }`}
                        title={ctx.isUploadingFirmware ? "Uploading..." : "Upload Code to Board"}
                    >
                        {ctx.isUploadingFirmware ? <Loader size={15} className="animate-spin" /> : <Upload size={15} />}
                        {ctx.isUploadingFirmware ? "Uploading..." : "Upload Code"}
                    </button>
                </div>
            </div>

            <div className="flex-1 flex min-h-0">
                {/* Left sidebar - file list — adjustable width — premium */}
                <aside style={{ width: sidebarWidth }} className="border-r border-violet-100/60 bg-gradient-to-b from-[#fdfcff] via-[#f8f7ff] to-[#f5f3ff] flex flex-col min-w-0 relative shrink-0 overflow-hidden shadow-[2px_0_12px_rgba(139,92,246,0.04)]">
                    <div className="p-3 border-b border-violet-100/60 bg-gradient-to-r from-white via-white to-violet-50/30 flex items-center justify-between gap-2">
                        <div>
                            <div className="text-xs font-bold bg-gradient-to-r from-violet-700 to-indigo-700 bg-clip-text text-transparent">Project Files</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                                {ctx.uploadView === "board" ? "Main sketch, library headers, and C++ source files." : "Click a file, then type in the center editor."}
                            </div>
                        </div>
                    </div>
                    <div className={`flex-1 overflow-y-auto ${ctx.uploadView === "board" ? "py-2 pb-33" : "py-2"}`}>
                        {ctx.visibleUploadFiles.map((file) => {
                            const isBoardSource = file === ctx.activeBoardFile;
                            const isSelected = ctx.uploadActiveFile === file;
                            const fileExtension = getFileExtension(file);
                            const fileCategoryLabel = isBoardSource ? ctx.selectedBoardName : BOARD_HEADER_EXTENSIONS.has(fileExtension) ? "Header library" : BOARD_SOURCE_EXTENSIONS.has(fileExtension) ? "C++ source" : "MicroPython project";
                            return (
                                <div
                                    key={file}
                                    onClick={() => ctx.setUploadActiveFile(file)}
                                    className={`px-3 py-2.5 cursor-pointer flex items-center justify-between gap-2 border-l-[3px] transition-all ${
                                        isSelected ? "border-violet-600 bg-gradient-to-r from-violet-500/10 via-indigo-500/10 to-violet-500/10 shadow-sm" : "border-transparent hover:bg-gradient-to-r hover:from-violet-50/60 hover:to-indigo-50/40"
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 shadow-sm ${
                                            isBoardSource ? "bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-white" : "bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600 text-white"
                                        }`}>
                                            {isBoardSource ? <FileCode2 size={13} /> : <FileText size={13} />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold text-gray-800 truncate">{file}</div>
                                            <div className="text-[10px] text-gray-400">{fileCategoryLabel}</div>
                                        </div>
                                    </div>
                                    {!ctx.protectedUploadFiles.has(file) && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const doDelete = () => {
                                                    ctx.setUploadProjectFiles(prev => { const n = { ...prev }; delete n[file]; return n; });
                                                    ctx.setUploadActiveFile("main.py");
                                                    ctx.addUploadMessage(`Deleted ${file}`, "warning");
                                                };
                                                if (ctx.openConfirm) {
                                                    ctx.openConfirm({
                                                        title: "Delete file?",
                                                        message: `Delete ${file}?`,
                                                        variant: "danger",
                                                        confirmText: "Delete",
                                                        cancelText: "Cancel",
                                                        onConfirm: doDelete,
                                                    });
                                                } else if (window.confirm(`Delete ${file}?`)) {
                                                    doDelete();
                                                }
                                            }}
                                            className="border-none bg-transparent text-gray-400 cursor-pointer p-0.5 hover:text-red-500 transition-colors"
                                            title="Delete file"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* Vertical resizer — between sidebar & editor — premium */}
                <div
                    onMouseDown={handleSidebarResizeStart}
                    className="w-1.5 cursor-col-resize shrink-0 flex items-center justify-center bg-gradient-to-b from-[#f8f7ff] to-[#f5f3ff] hover:from-violet-100 hover:to-indigo-100 border-r border-violet-100/60 transition-colors group"
                    title="Drag left or right to resize file list"
                >
                    <div className="w-0.5 h-8 rounded-full bg-gradient-to-b from-gray-300 to-gray-400 group-hover:from-violet-400 group-hover:to-indigo-500 transition-colors shadow-sm" />
                </div>

                {/* Center: Editor + Output — premium */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gradient-to-b from-white via-white to-slate-50/30">
                    <div className="flex-1 flex flex-col min-h-0">
                        <div className={`h-8.5 border-b border-violet-100/50 flex items-center justify-between px-3 text-xs text-slate-700 gap-3 bg-gradient-to-r ${
                            ctx.uploadView === "board" ? "from-white via-white to-violet-50/20" : "from-slate-50 via-white to-violet-50/10"
                        }`}>
                            <div className="flex items-center gap-2 min-w-0">
                                {ctx.uploadActiveFile === ctx.activeBoardFile ? <FileCode2 size={14} /> : <FileText size={14} />}
                                <span className="font-semibold truncate">{ctx.uploadActiveFile}</span>
                            </div>
                            <div className="text-[11px] text-gray-400">
                                {ctx.uploadActiveFile === ctx.activeBoardFile ? `${ctx.selectedBoardName} firmware` : "MicroPython project file"}
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 flex overflow-hidden">
                            <MonacoEditor projectFiles={ctx.uploadProjectFiles} activeFile={ctx.uploadActiveFile}
                                setProjectFiles={ctx.setUploadProjectFiles} editorRef={ctx.editorRef} monacoRef={ctx.monacoRef}
                                editorCursor={ctx.editorCursor} isRunning={ctx.isUploadingFirmware}
                                onRun={ctx.handleUploadFirmware} onCursorChange={ctx.setEditorCursor}
                                editorOptions={ctx.uploadView === "board" ? { fontSize: 16, fontFamily: "Consolas, 'Courier New', monospace", lineHeight: 30, glyphMargin: false, minimap: { enabled: false } } : { minimap: { enabled: false } }} />
                        </div>
                    </div>

                    {/* Horizontal resizer — between editor & terminal — premium */}
                    <div
                        onMouseDown={handleTerminalResizeStart}
                        className="h-2 cursor-row-resize shrink-0 flex items-center justify-center bg-gradient-to-r from-[#fdfcff] via-[#f8f7ff] to-[#f5f3ff] hover:from-violet-50 hover:via-indigo-50 hover:to-violet-50 border-t border-b border-violet-100/60 transition-colors group"
                        title="Drag up or down to resize terminal"
                    >
                        <div className="w-8 h-1 rounded-full bg-gradient-to-r from-gray-300 via-gray-400 to-gray-300 group-hover:from-violet-400 group-hover:via-indigo-500 group-hover:to-violet-400 transition-colors shadow-sm" />
                    </div>

                    <div style={{ height: terminalHeight }} className="border-t-0 bg-gradient-to-b from-[#fdfcff] via-[#f8f7ff] to-[#f5f3ff]/60 flex flex-col shrink-0 overflow-hidden border-violet-100/40 shadow-[0_-2px_12px_rgba(139,92,246,0.04)]">
                        <div className="flex items-center justify-between pt-2.5 px-3 gap-2.5">
                            <div className="flex gap-2">
                                {[{ id: "terminal", label: "Terminal", icon: TerminalSquare }, { id: "log", label: "Log", icon: ClipboardList }, { id: "serial", label: "Serial Monitor", icon: Plug }].map((tab) => {
                                    const Icon = tab.icon;
                                    const active = ctx.uploadPanelTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => ctx.setUploadPanelTab(tab.id)}
                                            className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.75 text-xs font-semibold cursor-pointer transition-all shadow-sm ${
                                                active ? "border-violet-500 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-violet-500/20" : "border-violet-200/50 bg-gradient-to-r from-white to-violet-50/20 text-slate-700 hover:from-violet-50 hover:to-indigo-50 hover:border-violet-300 hover:text-violet-700"
                                            }`}
                                        >
                                            <Icon size={14} />{tab.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className={`flex items-center gap-2 text-xs font-medium ${ctx.uploadProgressMessage ? (ctx.isUploadingFirmware ? "text-purple-700" : "text-gray-600") : "text-gray-400"}`}>
                                {ctx.uploadProgressMessage ? (
                                    ctx.isUploadingFirmware ? <Loader size={15} className="animate-spin text-purple-600" /> : <CheckCircle size={15} className="text-green-600" />
                                ) : <AlertCircle size={15} className="text-gray-400" />}
                                <span className="truncate max-w-[260px]">{ctx.uploadProgressMessage || "Board ready"}</span>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 p-3 pt-2.5">
                            <div className="h-full border border-gray-200 rounded-xl overflow-hidden bg-white">
                                {renderUploadOutput()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
