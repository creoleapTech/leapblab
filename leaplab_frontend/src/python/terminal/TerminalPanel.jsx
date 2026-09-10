/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, Trash2, Package, CornerDownLeft, Search, Copy, Check, X } from "lucide-react";
import PipPanel from "../panels/PipPanel";

const getLogTextColor = (type, text) => {
    if (type === "error") return "text-red-400";
    if (type === "success") return "text-emerald-400";
    if (type === "info") return (text.includes("🤖") || text.includes("➡️") || text.includes("🏃") || text.includes("🎭")) ? "text-sky-300" : "text-sky-400";
    if (type === "warning") return "text-amber-300";
    if (type === "repl-in") return "text-purple-300";
    return "text-slate-300";
};

export default function TerminalPanel({
    activePanel,
    setActivePanel,
    terminalOutput,
    replInput,
    setReplInput,
    handleReplSubmit,
    handleReplKey,
    terminalEndRef,
    replInputRef,
    isRunning,
    onRun,
    onStop,
    onClear,
    packages,
    pipFilter,
    setPipFilter,
    handleInstall,
    isWaitingForInput,
    inputPromptText,
    terminalInputValue,
    setTerminalInputValue,
    handleTerminalInputSubmit,
    handleTerminalInputKey,
    terminalInputRef,
    isElectron,
    shellInput,
    setShellInput,
    handleShellSubmit,
    handleShellKey,
    shellInputRef,
}) {
    const [terminalHeight, setTerminalHeight] = useState(
        typeof window !== 'undefined' && window.innerWidth < 768 ? 160 : 220
    );
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedLine, setCopiedLine] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const searchInputRef = useRef(null);
    const terminalScrollRef = useRef(null);
    const isDraggingRef = useRef(false);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);

    const handleTerminalResizeStart = useCallback((e) => {
        e.preventDefault();
        isDraggingRef.current = true;
        startYRef.current = e.clientY;
        startHeightRef.current = terminalHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        const handleMove = (ev) => {
            if (!isDraggingRef.current) return;
            const delta = startYRef.current - ev.clientY;
            const maxAllowed = Math.min(520, window.innerHeight - 200);
            const newHeight = Math.min(Math.max(startHeightRef.current + delta, 120), maxAllowed);
            setTerminalHeight(newHeight);
        };
        const handleUp = () => {
            isDraggingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    }, [terminalHeight]);

    const filteredOutput = searchQuery
        ? terminalOutput.filter((log) => log.text.toLowerCase().includes(searchQuery.toLowerCase()))
        : terminalOutput;

    const handleCopyAll = async () => {
        const text = terminalOutput.map((l) => l.text).join("\n");
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const handleCopyLine = async (text, idx) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
        setCopiedLine(idx);
        setTimeout(() => setCopiedLine(null), 1500);
    };

    const handleClear = () => {
        onClear?.();
        setContextMenu(null);
    };

    useEffect(() => {
        const handleResize = () => {
            setTerminalHeight(window.innerWidth < 768 ? 160 : 220);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const close = () => setContextMenu(null);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, []);

    useEffect(() => {
        if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
    }, [showSearch]);

    const tabs = [
        { id: "terminal", label: "Terminal", icon: <span className="text-xs">▶</span> },
        { id: "repl", label: "REPL", icon: <span className="text-xs font-mono">{">>>"}</span> },
        { id: "shell", label: "Shell", icon: <span className="text-xs font-mono">$_</span> },
    ];

    return (
        <div className="flex flex-col border-t border-violet-100/60 bg-gradient-to-b from-white to-slate-50/40 shrink-0 shadow-[0_-2px_12px_rgba(139,92,246,0.04)]" style={{ height: terminalHeight }}>
            {/* Horizontal resizer — between editor & terminal — premium */}
            <div
                onMouseDown={handleTerminalResizeStart}
                className="h-1.5 cursor-row-resize shrink-0 flex items-center justify-center bg-gradient-to-r from-slate-50 via-white to-violet-50/20 hover:from-violet-50 hover:via-indigo-50 hover:to-violet-50 border-b border-violet-100/50 transition-colors group"
                title="Drag up or down to resize terminal"
            >
                <div className="w-8 h-1 rounded-full bg-gradient-to-r from-gray-300 via-gray-400 to-gray-300 group-hover:from-violet-400 group-hover:via-indigo-500 group-hover:to-violet-400 transition-colors shadow-sm" />
            </div>
            <div className="flex bg-gradient-to-r from-slate-50 via-white to-violet-50/20 border-b border-violet-100/50 h-8 items-center">
                {tabs.map(({ id, label, icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => {
                            setActivePanel(id);
                            if (id === "repl") {
                                setTimeout(() => replInputRef.current?.focus(), 80);
                            }
                        }}
                        className={`px-3.5 h-full flex items-center gap-1.5 cursor-pointer text-xs font-semibold border-b-2 transition-colors ${
                            activePanel === id
                                ? "text-purple-600 border-purple-600 bg-white"
                                : "text-slate-500 border-transparent bg-transparent"
                        }`}
                    >
                        {icon} {label}
                    </button>
                ))}
            </div>

            {activePanel === "terminal" && (
                <div
                    onClick={() => {
                        if (isWaitingForInput) {
                            terminalInputRef.current?.focus();
                        }
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY });
                    }}
                    className={`flex-1 flex flex-col overflow-hidden bg-zinc-900 relative ${isWaitingForInput ? "cursor-text" : "cursor-default"}`}
                >
                    {/* Toolbar: search / copy / clear */}
                    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-800 border-b border-zinc-700 shrink-0">
                        {!showSearch ? (
                            <button
                                type="button"
                                onClick={() => setShowSearch(true)}
                                title="Search logs (Ctrl+F)"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-slate-200 border border-zinc-600 transition-colors"
                            >
                                <Search size={12} /> Search
                            </button>
                        ) : (
                            <div className="flex items-center gap-1 flex-1">
                                <div className="relative flex-1 flex items-center">
                                    <Search size={12} className="absolute left-2 text-slate-400" />
                                    <input
                                        ref={searchInputRef}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') { setSearchQuery(""); setShowSearch(false); }
                                        }}
                                        placeholder="Search logs..."
                                        className="w-full pl-7 pr-7 py-1 rounded-md bg-zinc-900 border border-zinc-600 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                                    />
                                    {searchQuery && (
                                        <button onClick={() => setSearchQuery("")} className="absolute right-1 p-0.5 hover:bg-zinc-700 rounded">
                                            <X size={12} className="text-slate-400" />
                                        </button>
                                    )}
                                </div>
                                <span className="text-xs text-slate-400 whitespace-nowrap">
                                    {searchQuery ? `${filteredOutput.length}/${terminalOutput.length}` : `${terminalOutput.length} lines`}
                                </span>
                                <button onClick={() => { setSearchQuery(""); setShowSearch(false); }} className="p-1 hover:bg-zinc-700 rounded">
                                    <X size={14} className="text-slate-400" />
                                </button>
                            </div>
                        )}
                        <div className="flex items-center gap-1 ml-auto">
                            <button
                                type="button"
                                onClick={handleCopyAll}
                                disabled={terminalOutput.length === 0}
                                title="Copy all logs"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-zinc-600 transition-colors"
                            >
                                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
                            </button>
                            <button
                                type="button"
                                onClick={handleClear}
                                disabled={terminalOutput.length === 0}
                                title="Clear Terminal"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-zinc-700 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-zinc-600 transition-colors"
                            >
                                <Trash2 size={12} /> Clear
                            </button>
                        </div>
                    </div>
                    {contextMenu && (
                        <div
                            className="fixed z-50 min-w-[180px] py-1 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button onClick={() => { handleCopyAll(); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-zinc-700 flex items-center gap-2"><Copy size={12} /> Copy All</button>
                            <button onClick={handleClear} className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-zinc-700 flex items-center gap-2"><Trash2 size={12} /> Clear Output</button>
                            <div className="h-px bg-zinc-700 my-1" />
                            <button onClick={() => { setShowSearch(true); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-zinc-700 flex items-center gap-2"><Search size={12} /> Search Logs</button>
                        </div>
                    )}
                    <div ref={terminalScrollRef} className="flex-1 overflow-y-auto py-2 px-3.5 font-mono text-xs leading-relaxed">
                        {terminalOutput.length === 0 ? (
                            <div className="text-emerald-500 italic">
                                <div>// LeapLab Python Terminal</div>
                                <div>// Click Run or Run All to execute</div>
                                <div>// Open the REPL tab for interactive commands</div>
                            </div>
                        ) : filteredOutput.length === 0 && searchQuery ? (
                            <div className="text-slate-500 italic py-4 text-center">No logs match “{searchQuery}”</div>
                        ) : filteredOutput.map((log, i) => {
                            const originalIdx = terminalOutput.indexOf(log);
                            const isSpecialInfo = log.text.includes("🤖") || log.text.includes("➡️") || log.text.includes("🏃") || log.text.includes("🎭");
                            return (
                                <div
                                    key={originalIdx}
                                    className={`group flex items-start gap-1 mb-0.5 whitespace-pre-wrap break-words ${getLogTextColor(log.type, log.text)} ${
                                        isSpecialInfo
                                            ? "border-l-2 border-sky-300 pl-2"
                                            : log.type === "repl-in"
                                                ? "pl-0"
                                                : "pl-1"
                                    }`}
                                >
                                    <span className="flex-1 min-w-0">
                                        {log.type === "repl-in" ? <span className="select-none text-emerald-500">{">>> "}</span> : null}
                                        {log.type === "error" && !log.text.startsWith("✗") ? <span className="text-red-400">✗ </span> : null}
                                        {searchQuery ? (() => {
                                            const idx = log.text.toLowerCase().indexOf(searchQuery.toLowerCase());
                                            if (idx === -1) return log.text;
                                            const before = log.text.slice(0, idx);
                                            const match = log.text.slice(idx, idx + searchQuery.length);
                                            const after = log.text.slice(idx + searchQuery.length);
                                            return <>{before}<mark className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">{match}</mark>{after}</>;
                                        })() : log.text}
                                    </span>
                                    <button
                                        onClick={() => handleCopyLine(log.text, originalIdx)}
                                        title="Copy line"
                                        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-zinc-700 transition-all"
                                    >
                                        {copiedLine === originalIdx ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} className="text-slate-400" />}
                                    </button>
                                </div>
                            );
                        })}
                        {isWaitingForInput && (
                            <div className="flex items-center gap-1.5 mt-1 font-mono text-xs">
                                {inputPromptText ? (
                                    <span className="text-amber-400">{inputPromptText}</span>
                                ) : (
                                    <span className="text-purple-500 font-bold">❯ </span>
                                )}
                                <input
                                    ref={terminalInputRef}
                                    value={terminalInputValue}
                                    onChange={(e) => setTerminalInputValue(e.target.value)}
                                    onKeyDown={handleTerminalInputKey}
                                    className="flex-1 border-0 outline-none font-mono text-xs bg-transparent text-slate-300 caret-slate-300"
                                    autoFocus
                                />
                            </div>
                        )}
                        {isRunning && !isWaitingForInput && (
                            <div className="text-sky-400 mt-1">
                                <span className="animate-pulse">▋</span> Running...
                            </div>
                        )}
                        <div ref={terminalEndRef} />
                    </div>
                </div>
            )}

            {activePanel === "repl" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className={`py-1.5 px-3.5 text-xs border-b border-slate-200 ${isWaitingForInput ? "text-amber-500 font-medium" : "text-slate-500"}`}>
                        {isWaitingForInput
                            ? "⌨ Program needs input — type your response and press Enter"
                            : "Interactive Python REPL - type commands and press Enter"}
                    </div>
                    <div className="flex-1 overflow-y-auto py-2 px-3.5 font-mono text-xs leading-relaxed">
                        {isWaitingForInput ? (
                            <div className="text-amber-500 mb-2">
                                <span className="font-semibold">⏸ Program paused for input</span>
                                <div className="mt-1 italic">"{inputPromptText}"</div>
                                <div className="mt-2 text-slate-500">Type your response below and press Enter to continue.</div>
                            </div>
                        ) : (
                            <>
                                <div className="text-slate-500">Python 3 — LeapLab Interactive Shell</div>
                                <div className="text-slate-500 mb-2">Type Python code and press Enter. Use up/down arrows for history.</div>
                            </>
                        )}
                    </div>
                    <div className="flex border-t border-slate-200 py-1.5 px-2.5 items-center gap-2 bg-slate-50">
                        <span className={`font-mono font-bold text-sm ${isWaitingForInput ? "text-amber-500" : "text-purple-600"}`}>
                            {isWaitingForInput ? "⌨" : ">>>"}
                        </span>
                        <input
                            ref={replInputRef}
                            value={replInput}
                            onChange={(e) => setReplInput(e.target.value)}
                            onKeyDown={handleReplKey}
                            placeholder={isWaitingForInput ? "Provide response to program input..." : "Enter Python expression or statement..."}
                            className="flex-1 border-0 outline-none font-mono text-xs bg-transparent text-slate-800"
                        />
                        <button
                            type="button"
                            onClick={handleReplSubmit}
                            className="py-1 px-3 bg-purple-600 hover:bg-purple-700 text-white border-0 rounded-md cursor-pointer text-xs font-bold transition-colors"
                        >
                            {isWaitingForInput ? "Send" : "Run"}
                        </button>
                    </div>
                </div>
            )}

            {activePanel === "pip" && (
                <div className="flex-1 min-h-0">
                    <PipPanel
                        packages={packages}
                        pipFilter={pipFilter}
                        setPipFilter={setPipFilter}
                        handleInstall={handleInstall}
                    />
                </div>
            )}

            {activePanel === "shell" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                    {!isElectron ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-900">
                            <div className="text-2xl mb-3 opacity-50">⚠</div>
                            <div className="text-amber-300 text-sm font-semibold mb-2">
                                Shell is only available in desktop mode
                            </div>
                            <div className="text-slate-400 text-xs text-center leading-relaxed">
                                Install the LeapLab desktop app (.exe) for full terminal support.<br />
                                You can then run commands like <span className="text-sky-300 font-mono">pip install numpy</span> directly.
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="py-1.5 px-3.5 text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                                System shell — type commands like <span className="font-mono text-purple-600 font-semibold">pip install numpy</span> and press Enter
                            </div>
                            <div className="flex-1 overflow-y-auto py-2 px-3.5 font-mono text-xs leading-relaxed bg-zinc-900">
                                {terminalOutput.length === 0 ? (
                                    <>
                                        <div className="text-emerald-500 italic mb-2">
                                            $ pip install &lt;package&gt;  — install Python packages
                                        </div>
                                        <div className="text-emerald-500 italic mb-2">
                                            $ python -c "import &lt;module&gt;"  — verify installation
                                        </div>
                                        <div className="text-emerald-500 italic mb-3">
                                            $ python -m pip list  — list installed packages
                                        </div>
                                        <div className="text-sky-400 mb-1 text-xs">────────────────────────────────────────</div>
                                    </>
                                ) : terminalOutput.map((log, i) => (
                                    <div
                                        key={i}
                                        className={`mb-0.5 whitespace-pre-wrap break-words ${getLogTextColor(log.type, log.text)} ${
                                            log.type === "repl-in" ? "pl-0" : "pl-1"
                                        }`}
                                    >
                                        {log.type === "repl-in" ? <span className="select-none text-emerald-500">$ </span> : null}
                                        {log.type === "error" && !log.text.startsWith("✗") ? <span className="text-red-400">✗ </span> : null}
                                        {log.text}
                                    </div>
                                ))}
                                <div ref={terminalEndRef} />
                            </div>
                            <div className="flex border-t border-slate-700 py-1.5 px-2.5 items-center gap-2 bg-zinc-900">
                                <span className="text-emerald-500 font-mono font-bold text-sm">$</span>
                                <input
                                    ref={shellInputRef}
                                    value={shellInput}
                                    onChange={(e) => setShellInput(e.target.value)}
                                    onKeyDown={handleShellKey}
                                    placeholder="Type a command and press Enter..."
                                    className="flex-1 border-0 outline-none font-mono text-xs bg-transparent text-slate-300 caret-slate-300"
                                    autoFocus={activePanel === "shell"}
                                />
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
