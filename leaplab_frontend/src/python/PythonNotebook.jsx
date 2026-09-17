/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import {
    Play, Square, Plus, Trash2, ChevronUp, ChevronDown,
    ArrowLeft, Save, Download, Upload, HelpCircle, Settings,
    Bell, User, FileText, Terminal, BookOpen, Zap, RotateCcw,
    Copy, Clipboard, MoreVertical, GripVertical
} from "lucide-react";
import { SkulptEngine } from "../leapignite/server/engine/SkulptEngine";
import Logo, { CreoleapLogo } from "../components/Logo";
import LeapLabAuthButton from "../auth/LeapLabAuthButton";
import { fileService } from "../Electra/Client/Src/services/FileService";
import { showToast } from "../leapignite/client/components/Toast";
import { useLeapLabAuthStore } from "../auth/leaplabAuthStore";


// ─── Default Notebook Cells ───────────────────────────────────────────────────
const DEFAULT_CELLS = [
    {
        id: "cell-1",
        type: "code",
        code: `# Welcome to LeapBlocks Python Notebook!
# Execute code cells one at a time

print("Hello, World! 🌍")`,
        output: null,
        executionCount: null,
        isRunning: false,
    },
    {
        id: "cell-2",
        type: "code",
        code: `# Create and control a sprite
sprite = Sprite('Robot')
sprite.say("I'm in a notebook!")
sprite.move(50)`,
        output: null,
        executionCount: null,
        isRunning: false,
    },
    {
        id: "cell-3",
        type: "code",
        code: `# Variables persist across cells
name = "LeapBlocks"
version = 2.0
print(f"Welcome to {name} v{version}")`,
        output: null,
        executionCount: null,
        isRunning: false,
    },
    {
        id: "cell-4",
        type: "code",
        code: `# Use variables from previous cells
for i in range(int(version)):
    print(f"Iteration {i + 1}: Learning Python is fun!")`,
        output: null,
        executionCount: null,
        isRunning: false,
    },
    {
        id: "cell-5",
        type: "markdown",
        code: `## Next Steps
Try adding more cells and experimenting with:
- **Loops** and **conditionals**
- **Functions** and **classes**
- **Sprite** animations`,
        output: null,
        executionCount: null,
        isRunning: false,
    },
];

// ─── Main Notebook Component ──────────────────────────────────────────────────
export default function PythonNotebook({ onBack, onSwitchToIDE }) {
    // Notebook state
    const [cells, setCells] = useState(DEFAULT_CELLS);
    const [activeCellId, setActiveCellId] = useState("cell-1");
    const [executionCount, setExecutionCount] = useState(0);
    const [kernelStatus, setKernelStatus] = useState("idle"); // "idle" | "busy"
    const [notebookName, setNotebookName] = useState("Untitled.ipynb");
    const [showGuide, setShowGuide] = useState(false);

    // Sprite state for notebook
    const [sprites, setSprites] = useState([{
        id: 'robot-1', name: 'Robot', type: 'robot',
        x: 0, y: 0, angle: 90, size: 100, visible: true,
        speech: '', currentCostume: 'default',
        costumes: {
            default: "assets/sprites/robot/robot_idle.svg",
        },
    }]);
    const [stageSize] = useState({ w: 300, h: 240 });

    // Engine ref - shared across cells for variable persistence
    const skulptRef = useRef(null);
    const executionGlobals = useRef({});
    const cellRefs = useRef({});

    // ── Initialize Skulpt Engine (web mode only) ─────────────────────────────────
    useEffect(() => {
        if (window.electronAPI?.isElectron) return; // Electron uses native Python
        skulptRef.current = new SkulptEngine({
            onOut: (text) => {
                // Output will be captured per-cell during execution
            },
            onErr: (text) => {
                // Error will be captured per-cell during execution
            },
            actions: {
                moveRelative: (name, dir, steps) => {
                    setSprites(prev => prev.map(s => {
                        if (s.name.toLowerCase() !== name.toLowerCase()) return s;
                        const d = steps || 20;
                        let dx = 0, dy = 0;
                        if (dir === "RIGHT") dx = d;
                        if (dir === "LEFT") dx = -d;
                        if (dir === "UP") dy = -d;
                        if (dir === "DOWN") dy = d;
                        return { ...s, x: s.x + dx, y: s.y + dy };
                    }));
                },
                moveSteps: (name, steps) => {
                    setSprites(prev => prev.map(s => {
                        if (s.name.toLowerCase() !== name.toLowerCase()) return s;
                        const rad = (s.angle * Math.PI) / 180;
                        return { ...s, x: s.x + Math.cos(rad) * steps, y: s.y - Math.sin(rad) * steps };
                    }));
                },
                update: (name, props) => {
                    setSprites(prev => prev.map(s => {
                        if (s.name.toLowerCase() !== name.toLowerCase()) return s;
                        return { ...s, ...props };
                    }));
                },
                softResetAll: () => setSprites(prev => prev.map(s => ({
                    ...s, x: 0, y: 0, speech: '', angle: 90, size: 100, visible: true
                }))),
            }
        });
    }, []);

    // ── Execute Cell ─────────────────────────────────────────────────────────
    const executeCell = useCallback(async (cellId) => {
        const cell = cells.find(c => c.id === cellId);
        if (!cell || cell.type === "markdown") return;

        const newExecCount = executionCount + 1;
        setExecutionCount(newExecCount);
        setKernelStatus("busy");

        // Update cell to running state
        setCells(prev => prev.map(c =>
            c.id === cellId ? { ...c, isRunning: true, output: null } : c
        ));

        let outputLines = [];
        let errorOccurred = false;

        // In Electron mode, use native Python; otherwise use Skulpt
        if (window.electronAPI?.isElectron) {
            if (window.electronAPI.pythonCheck) {
                const check = await window.electronAPI.pythonCheck();
                if (!check.available) {
                    outputLines.push({ type: "stderr", text: `Python not available: ${check.error}` });
                    errorOccurred = true;
                }
            }
            if (!errorOccurred) {
                try {
                    await window.electronAPI.pythonRun(cell.code, {});
                } catch (e) {
                    outputLines.push({ type: "stderr", text: e.message });
                    errorOccurred = true;
                }
            }
            setCells(prev => prev.map(c =>
                c.id === cellId ? {
                    ...c,
                    isRunning: false,
                    output: outputLines.length > 0 ? outputLines : [{ type: "stdout", text: "" }],
                    executionCount: newExecCount,
                } : c
            ));
        } else {
            // Create a temporary engine with cell-specific output capture
            const cellEngine = new SkulptEngine({
                onOut: (text) => {
                    outputLines.push({ type: "stdout", text: text.replace(/\n$/, "") });
                },
                onErr: (text) => {
                    outputLines.push({ type: "stderr", text });
                    errorOccurred = true;
                },
                actions: skulptRef.current?.callbacks?.actions || {},
            });

            try {
                await cellEngine.runPython(cell.code);

                setCells(prev => prev.map(c =>
                    c.id === cellId ? {
                        ...c,
                        isRunning: false,
                        output: outputLines.length > 0 ? outputLines : [{ type: "stdout", text: "" }],
                        executionCount: newExecCount,
                    } : c
                ));
            } catch (e) {
                const errorMsg = typeof e === 'string' ? e : e?.message || "Unknown error";
                setCells(prev => prev.map(c =>
                    c.id === cellId ? {
                        ...c,
                        isRunning: false,
                        output: [...outputLines, { type: "error", text: errorMsg }],
                        executionCount: newExecCount,
                    } : c
                ));
            }
        }
        setKernelStatus("idle");
    }, [cells, executionCount]);

    // ── Execute All Cells ────────────────────────────────────────────────────
    const executeAllCells = async () => {
        for (const cell of cells) {
            if (cell.type === "code") {
                await executeCell(cell.id);
            }
        }
    };

    // ── Cell Management ──────────────────────────────────────────────────────
    const addCell = (afterId, type = "code") => {
        const newCell = {
            id: `cell-${Date.now()}`,
            type,
            code: type === "code" ? "# New cell\n" : "## New Section\n",
            output: null,
            executionCount: null,
            isRunning: false,
        };

        setCells(prev => {
            const idx = prev.findIndex(c => c.id === afterId);
            const newCells = [...prev];
            newCells.splice(idx + 1, 0, newCell);
            return newCells;
        });
        setActiveCellId(newCell.id);
    };

    const deleteCell = (cellId) => {
        if (cells.length <= 1) return;
        setCells(prev => prev.filter(c => c.id !== cellId));
        if (activeCellId === cellId) {
            const idx = cells.findIndex(c => c.id === cellId);
            setActiveCellId(cells[Math.max(0, idx - 1)].id);
        }
    };

    const moveCell = (cellId, direction) => {
        setCells(prev => {
            const idx = prev.findIndex(c => c.id === cellId);
            if (direction === "up" && idx === 0) return prev;
            if (direction === "down" && idx === prev.length - 1) return prev;

            const newCells = [...prev];
            const swapIdx = direction === "up" ? idx - 1 : idx + 1;
            [newCells[idx], newCells[swapIdx]] = [newCells[swapIdx], newCells[idx]];
            return newCells;
        });
    };

    const duplicateCell = (cellId) => {
        const cell = cells.find(c => c.id === cellId);
        if (!cell) return;

        const newCell = {
            ...cell,
            id: `cell-${Date.now()}`,
            output: null,
            executionCount: null,
        };

        setCells(prev => {
            const idx = prev.findIndex(c => c.id === cellId);
            const newCells = [...prev];
            newCells.splice(idx + 1, 0, newCell);
            return newCells;
        });
    };

    const updateCellCode = (cellId, newCode) => {
        setCells(prev => prev.map(c =>
            c.id === cellId ? { ...c, code: newCode } : c
        ));
    };

    const clearCellOutput = (cellId) => {
        setCells(prev => prev.map(c =>
            c.id === cellId ? { ...c, output: null, executionCount: null } : c
        ));
    };

    const clearAllOutputs = () => {
        setCells(prev => prev.map(c => ({
            ...c,
            output: null,
            executionCount: null,
        })));
    };

    // ── Keyboard Shortcuts ───────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Shift+Enter: Execute cell and move to next
            if (e.shiftKey && e.key === "Enter") {
                e.preventDefault();
                executeCell(activeCellId);
                const idx = cells.findIndex(c => c.id === activeCellId);
                if (idx < cells.length - 1) {
                    setActiveCellId(cells[idx + 1].id);
                }
            }
            // Ctrl+Enter: Execute cell
            if (e.ctrlKey && e.key === "Enter") {
                e.preventDefault();
                executeCell(activeCellId);
            }
            // Alt+Enter: Execute cell and add new cell below
            if (e.altKey && e.key === "Enter") {
                e.preventDefault();
                executeCell(activeCellId);
                addCell(activeCellId);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeCellId, cells, executeCell]);

    // ── Render Cell ──────────────────────────────────────────────────────────
    const renderCell = (cell, index) => {
        const isActive = cell.id === activeCellId;
        const isMarkdown = cell.type === "markdown";

        return (
            <div
                key={cell.id}
                className={`group relative mb-4 rounded-lg border-2 transition-all ${isActive
                        ? "border-purple-600 shadow-lg shadow-purple-100"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                onClick={() => setActiveCellId(cell.id)}
            >
                {/* Cell Toolbar */}
                <div className={`absolute -left-12 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? "!opacity-100" : ""}`}>
                    <button
                        onClick={(e) => { e.stopPropagation(); moveCell(cell.id, "up"); }}
                        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        title="Move Up"
                    >
                        <ChevronUp size={14} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); moveCell(cell.id, "down"); }}
                        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        title="Move Down"
                    >
                        <ChevronDown size={14} />
                    </button>
                </div>

                {/* Cell Header */}
                <div className={`flex items-center justify-between px-3 py-1.5 border-b ${isMarkdown ? "bg-purple-50" : "bg-gray-50"}`}>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono px-2 py-0.5 rounded ${isMarkdown ? "bg-purple-100 text-purple-600" : "bg-blue-100 text-blue-600"}`}>
                            {isMarkdown ? "MD" : `In [${cell.executionCount || " "}]`}
                        </span>
                        {cell.isRunning && (
                            <span className="text-xs text-green-600 flex items-center gap-1">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                Running...
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!isMarkdown && (
                            <button
                                onClick={(e) => { e.stopPropagation(); executeCell(cell.id); }}
                                className="p-1 rounded hover:bg-green-100 text-gray-400 hover:text-green-600"
                                title="Run Cell (Ctrl+Enter)"
                            >
                                <Play size={14} />
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); duplicateCell(cell.id); }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                            title="Duplicate Cell"
                        >
                            <Copy size={14} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); addCell(cell.id, "code"); }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                            title="Add Code Cell Below"
                        >
                            <Plus size={14} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); clearCellOutput(cell.id); }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                            title="Clear Output"
                        >
                            <RotateCcw size={14} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); deleteCell(cell.id); }}
                            className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                            title="Delete Cell"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>

                {/* Cell Content */}
                <div className="min-h-[80px]">
                    <Editor
                        height={isMarkdown ? "60px" : "120px"}
                        defaultLanguage={isMarkdown ? "markdown" : "python"}
                        value={cell.code}
                        onChange={(value) => updateCellCode(cell.id, value || "")}
                        theme="vs-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            lineNumbers: "off",
                            folding: false,
                            scrollBeyondLastLine: false,
                            wordWrap: "on",
                            automaticLayout: true,
                            padding: { top: 8, bottom: 8 },
                            renderLineHighlight: "none",
                            overviewRulerLanes: 0,
                            hideCursorInOverviewRuler: true,
                            overviewRulerBorder: false,
                            scrollbar: {
                                vertical: "hidden",
                                horizontal: "hidden",
                            },
                        }}
                    />
                </div>

                {/* Cell Output */}
                {!isMarkdown && cell.output && (
                    <div className="border-t border-gray-200 bg-white">
                        <div className="px-3 py-2">
                            <div className="text-xs text-gray-400 mb-1">Out [{cell.executionCount}]:</div>
                            <div className="font-mono text-sm">
                                {cell.output.map((line, i) => (
                                    <div
                                        key={i}
                                        className={`${line.type === "error"
                                                ? "text-red-600 bg-red-50 px-2 py-1 rounded"
                                                : line.type === "stderr"
                                                    ? "text-orange-600"
                                                    : "text-gray-800"
                                            }`}
                                    >
                                        {line.text || "\u00A0"}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ── Main Render ──────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {/* ══ TOPBAR ══════════════════════════════════════════════════════ */}
            <header className="h-12 flex items-center px-4 justify-between text-white z-10 shadow-md shrink-0 bg-purple-900">
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex items-center gap-2 hover:opacity-80 transition bg-transparent border-0 text-white cursor-pointer"
                    >
                        <ArrowLeft size={18} />
                        <Logo height={48} />
                    </button>
                    <div className="w-px h-5 bg-white/30" />
                    <span className="text-sm opacity-85 font-extrabold tracking-widest text-amber-400">NOTEBOOK</span>
                </div>
                <div className="flex items-center gap-3">
                    {/* Notebook name */}
                    <div className="bg-black/25 px-3 py-1 rounded flex items-center gap-2">
                        <input
                            value={notebookName}
                            onChange={(e) => setNotebookName(e.target.value)}
                            className="bg-transparent border-0 text-white w-32 outline-none text-sm font-sans placeholder-white/50"
                        />
                        <Save size={14} className="opacity-80 cursor-pointer" />
                        <Download
                            size={14}
                            className="opacity-80 cursor-pointer hover:opacity-100"
                            title="Download .leap file"
                            onClick={() => {
                                const payload = { cells, sprites, notebookName };
                                fileService.saveProjectLocally(notebookName.replace(/\.ipynb$/i, '') || 'notebook', 'python', payload);
                            }}
                        />
                    </div>
                    {/* Switch to IDE button */}
                    <button
                        type="button"
                        onClick={onSwitchToIDE}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded text-sm font-semibold transition border-0 text-white cursor-pointer"
                    >
                        <Terminal size={14} />
                        Switch to IDE
                    </button>
                    <div className="w-px h-5 bg-white/30" />
                    <button
                        type="button"
                        onClick={() => setShowGuide(g => !g)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold border border-white/25 transition cursor-pointer text-white ${showGuide ? "bg-white/30" : "bg-white/10"
                            }`}
                    >
                        <HelpCircle size={14} /> Guide
                    </button>
                    <Bell size={18} className="cursor-pointer opacity-80 hover:opacity-100" />
                    <Settings size={18} className="cursor-pointer opacity-80 hover:opacity-100" />

                    <LeapLabAuthButton variant="dark" size="sm" style={{ height: 32, borderRadius: '4px', boxSizing: 'border-box' }} />

                    {/* CREOLEAP Right Logo */}
                    <div className="hidden min-[1200px]:flex ml-3 items-center shrink-0 h-[34px] overflow-hidden drop-shadow-md">
                        <img
                            src="assets/logo-creoleap.png"
                            alt="CREOLEAP"
                            className="w-[145px] h-auto object-contain block shrink-0 brightness-125 contrast-110"
                        />
                    </div>
                </div>
            </header>

            {/* ══ TOOLBAR ═════════════════════════════════════════════════════ */}
            <div className="h-10 bg-white flex items-center px-4 justify-between border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-2">
                    {/* Kernel Status */}
                    <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded">
                        <span className={`w-2 h-2 rounded-full ${kernelStatus === "busy" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`}></span>
                        <span className="text-xs font-medium text-gray-600">
                            {kernelStatus === "busy" ? "Kernel Busy" : "Kernel Idle"}
                        </span>
                    </div>
                    <div className="w-px h-5 bg-gray-200" />
                    {/* Cell type selector */}
                    <button
                        type="button"
                        onClick={() => addCell(activeCellId, "code")}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition border-0 bg-transparent cursor-pointer"
                    >
                        <Plus size={12} /> Code
                    </button>
                    <button
                        type="button"
                        onClick={() => addCell(activeCellId, "markdown")}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded transition border-0 bg-transparent cursor-pointer"
                    >
                        <Plus size={12} /> Markdown
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {/* Run controls */}
                    <button
                        type="button"
                        onClick={() => executeCell(activeCellId)}
                        className="flex items-center gap-1 px-3 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 rounded transition border-0 bg-transparent cursor-pointer"
                    >
                        <Play size={12} /> Run Cell
                    </button>
                    <button
                        type="button"
                        onClick={executeAllCells}
                        className="flex items-center gap-1 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 rounded transition border-0 bg-transparent cursor-pointer"
                    >
                        <Zap size={12} /> Run All
                    </button>
                    <button
                        type="button"
                        onClick={clearAllOutputs}
                        className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition border-0 bg-transparent cursor-pointer"
                    >
                        <RotateCcw size={12} /> Clear Outputs
                    </button>
                </div>
            </div>

            {/* ══ MAIN CONTENT ════════════════════════════════════════════════ */}
            <div className="flex-1 flex overflow-hidden">
                {/* Notebook Cells */}
                <div className="flex-1 overflow-auto p-6 pl-16">
                    <div className="max-w-4xl mx-auto">
                        {/* Notebook Title */}
                        <div className="mb-6">
                            <h1 className="text-2xl font-bold text-gray-800">Python Notebook</h1>
                            <p className="text-sm text-gray-500 mt-1">
                                Execute code cells independently. Variables persist across cells.
                            </p>
                        </div>

                        {/* Cells */}
                        {cells.map((cell, index) => renderCell(cell, index))}

                        {/* Add Cell Button */}
                        <button
                            type="button"
                            onClick={() => addCell(cells[cells.length - 1].id, "code")}
                            className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-purple-600 hover:text-purple-600 transition flex items-center justify-center gap-2 bg-transparent cursor-pointer"
                        >
                            <Plus size={16} /> Add Cell
                        </button>

                        {/* Keyboard Shortcuts Help */}
                        <div className="mt-6 p-4 bg-gray-100 rounded-lg text-xs text-gray-500">
                            <div className="font-semibold mb-2">Keyboard Shortcuts:</div>
                            <div className="grid grid-cols-2 gap-2">
                                <span><kbd className="px-1.5 py-0.5 bg-white rounded border text-gray-700">Shift+Enter</kbd> Run & Next</span>
                                <span><kbd className="px-1.5 py-0.5 bg-white rounded border text-gray-700">Ctrl+Enter</kbd> Run Cell</span>
                                <span><kbd className="px-1.5 py-0.5 bg-white rounded border text-gray-700">Alt+Enter</kbd> Run & New Cell</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Sidebar - Stage Preview */}
                <div className="w-80 bg-white border-l border-gray-200 flex flex-col flex-shrink-0">
                    <div className="p-3 border-b border-gray-200">
                        <h3 className="text-sm font-semibold text-gray-700">Stage Preview</h3>
                    </div>
                    <div className="flex-1 p-3">
                        <div className="bg-gray-100 rounded-lg aspect-video relative overflow-hidden">
                            {/* Stage canvas placeholder */}
                            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                                <div className="text-center">
                                    <div className="text-4xl mb-2">🤖</div>
                                    <div className="text-xs">Robot</div>
                                    <div className="text-xs text-gray-400 mt-1">
                                        x: {sprites[0]?.x?.toFixed(0) || 0}, y: {sprites[0]?.y?.toFixed(0) || 0}
                                    </div>
                                </div>
                            </div>
                            {/* Speech bubble */}
                            {sprites[0]?.speech && (
                                <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-white px-3 py-1 rounded-lg shadow text-xs max-w-[80%]">
                                    {sprites[0].speech}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Variables Panel */}
                    <div className="border-t border-gray-200">
                        <div className="p-3">
                            <h3 className="text-sm font-semibold text-gray-700 mb-2">Variables</h3>
                            <div className="text-xs text-gray-400 italic">
                                Run cells to see variables
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="border-t border-gray-200 p-3">
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">Quick Actions</h3>
                        <div className="grid grid-cols-2 gap-2">
                            <button className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">
                                📊 Upload CSV
                            </button>
                            <button className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">
                                🐍 Import .py
                            </button>
                            <button className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">
                                💾 Save
                            </button>
                            <button className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition">
                                📥 Export
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}