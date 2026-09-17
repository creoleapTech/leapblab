/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited. 
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { StageProvider, useStage } from "../context/StageContext";
import { isWebSerialSupported, listPorts as webListPorts, requestPort as webRequestPort, uploadToBoard } from "../webflash";
import Logo, { CreoleapLogo } from "../components/Logo";
import {
    Home,
    Play,
    Square,
    Undo,
    Redo,
    Save,
    Download,
    Settings,
    Trash2,
    Maximize,
    Upload,
    Clock,
    Cpu,
    RefreshCw,
    Plus,
    FileText,
    Terminal,
    TerminalSquare,
    ClipboardList,
    Loader,
    LoaderCircle,
    CheckCircle,
    CheckCircle2,
    Library,
    LibraryBig,
    FileUp,
    Zap,
    Plug,
    FileCode2,
    AlertCircle,
    ChevronDown,
    FolderOpen,
    File,
    Share,
    Menu as MenuIcon,
} from "lucide-react";
import { fileService } from "../Electra/Client/Src/services/FileService";
import TopbarShareButton from "../components/common/TopbarShareButton";
import { useWindowWidth } from "../hooks/useWindowWidth";
import MobileDrawer from "../components/common/MobileDrawer";
import ProjectNameInput from "../components/common/ProjectNameInput";
import ModeSwitcher from "../components/common/ModeSwitcher";
import ActionButton from "../components/common/ActionButton";
import { showToast } from "../leapignite/client/components/Toast";
import { useLeapLabAuthStore } from "../auth/leaplabAuthStore";
import { SkulptEngine } from "../leapignite/server/engine/SkulptEngine";
import { FULL_CATALOG } from "../components/SpriteLibrary";
import SerialMonitor from "../components/SerialMonitor";
import { createIntermediateBlocksBridge, useSpriteBridge, getDefaultSpritePresets } from "./SpriteBridge";
import BoardSelectionModal, { getBoards } from "../leapignite/client/components/BoardSelectionModal";

// ─── Import Modular Components ─────────────────────────────────────────────────
import SidePanel from "./panels/SidePanel";
import EditorPanel from "./panels/EditorPanel";
import StagePanel from "./panels/StagePanel";
import MonacoEditor from "./editor/MonacoEditor";
import StatusBar from "./editor/StatusBar";
import TerminalPanel from "./terminal/TerminalPanel";

// ─── Dropdown Menu (Glassmorphism) ────────────────────────────────────────────
function DropdownMenu({ label, icon: Icon, items, isOpen, onToggle, onClose }) {
    const menuRef = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onCloseRef.current();
            }
        };
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside, true);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside, true);
        };
    }, [isOpen]);

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={onToggle}
                className={`flex items-center gap-1.5 px-4 py-2 border-0 text-white text-sm font-semibold rounded-full transition-all tracking-wide cursor-pointer ${isOpen ? 'bg-white/20 backdrop-blur-xs' : 'bg-transparent hover:bg-white/10'
                    }`}
            >
                {Icon && <Icon size={16} strokeWidth={2.2} className="opacity-90" />}
                {label}
                <ChevronDown
                    size={14}
                    strokeWidth={2.5}
                    className={`opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'
                        }`}
                />
            </button>

            {isOpen && (
                <div className="absolute top-full mt-1.5 left-0 bg-white/90 backdrop-blur-xl rounded-xl shadow-2xl border border-white/60 min-w-[200px] overflow-hidden z-50 py-1.5 animate-[pyMenuSlideIn_0.18s_ease-out]">
                    <style>{`
                        @keyframes pyMenuSlideIn {
                            from { opacity: 0; transform: translateY(-6px) scale(0.98); }
                            to { opacity: 1; transform: translateY(0) scale(1); }
                        }
                    `}</style>
                    {items.map((item, idx) => (
                        item.divider ? (
                            <div key={idx} className="h-px bg-gradient-to-r from-transparent via-black/10 to-transparent my-1.5 mx-3" />
                        ) : (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => { item.onClick?.(); onClose(); }}
                                disabled={item.disabled}
                                className={`flex items-center gap-2.5 w-full px-3.5 py-2 border-0 text-sm font-medium text-left transition-all tracking-normal ${item.disabled
                                        ? 'cursor-not-allowed text-gray-300 bg-transparent'
                                        : 'cursor-pointer text-gray-700 bg-transparent hover:bg-purple-100/60 hover:text-purple-700'
                                    }`}
                            >
                                {item.icon && <item.icon size={16} strokeWidth={2} className="text-purple-600 opacity-85 shrink-0" />}
                                <span className="flex-1">{item.label}</span>
                                {item.shortcut && (
                                    <span className="text-xs text-gray-400 font-medium bg-black/5 px-1.5 py-0.5 rounded font-mono">
                                        {item.shortcut}
                                    </span>
                                )}
                            </button>
                        )
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── CSS Animations ───────────────────────────────────────────────────────────
function injectPythonIDEAnimations() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('python-ide-animations')) return;
    const style = document.createElement('style');
    style.id = 'python-ide-animations';
    style.textContent = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .run-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(16, 185, 129, 0.4) !important;
        }
        .run-button:active {
            transform: translateY(0);
        }
        .stop-button:hover {
            background: #EF4444 !important;
            color: #fff !important;
        }
        .terminal-line {
            animation: fadeIn 0.2s ease-out;
        }
    `;
    document.head.appendChild(style);
}
injectPythonIDEAnimations();

// ─── Theme (Leapblocks Colors) ─────────────────────────────────────────────────
const C = {
    PURPLE: "#8B5CF6",
    DARK_PURPLE: "#7C3AED",
    LIGHT_PURPLE: "#EDE9FE",
    PURPLE_BG: "#F5F3FF",
    BORDER: "#E5E7EB",
    BG: "#F9FAFB",
    BG2: "#F3F4F6",
    TEXT: "#1F2937",
    MUTED: "#6B7280",
    GREEN: "#10B981",
    RED: "#EF4444",
    BLUE: "#3B82F6",
    ORANGE: "#F59E0B",
    ACCENT: "#8B5CF6",
    HEADER_BG: "#8B5CF6",
};

// Map board IDs to names for template generation
// Lazy init to avoid TDZ when BOARDS is not yet initialized after scope hoisting
let _BOARD_NAME_BY_ID;
function getBoardNameById() {
    if (!_BOARD_NAME_BY_ID) {
        _BOARD_NAME_BY_ID = getBoards().reduce((acc, b) => {
            acc[b.id] = b.name;
            return acc;
        }, {});
    }
    return _BOARD_NAME_BY_ID;
}


// ─── Default Files ─────────────────────────────────────────────────────────────
const DEFAULT_ACTIVE_FILE = "main.py";
const DEFAULT_FILES = {
    [DEFAULT_ACTIVE_FILE]: "print(\"Hello from LeapBlocks Python!\")\n",
};

const getFallbackActiveFile = (files, preferred = DEFAULT_ACTIVE_FILE) => {
    const safeFiles = files || {};
    if (preferred && Object.prototype.hasOwnProperty.call(safeFiles, preferred)) return preferred;
    return Object.keys(safeFiles)[0] || DEFAULT_ACTIVE_FILE;
};


const BOARD_UPLOAD_CONFIG = {
    arduino_uno: {
        fileName: "arduino_uno.ino",
        fqbn: "arduino:avr:uno",
        runtimeLabel: "Arduino Uno",
    },
    arduino_mega: {
        fileName: "arduino_mega.ino",
        fqbn: "arduino:avr:mega",
        runtimeLabel: "Arduino Mega",
    },
    arduino_nano: {
        fileName: "arduino_nano.ino",
        fqbn: "arduino:avr:nano",
        runtimeLabel: "Arduino Nano",
    },
    esp32: {
        fileName: "esp32.cpp",
        fqbn: "esp32:esp32:esp32c3",
        runtimeLabel: "ESP32-C3",
    },
};

const getBoardConfig = (boardId) => BOARD_UPLOAD_CONFIG[boardId] || BOARD_UPLOAD_CONFIG.arduino_uno;

const getFileExtension = (fileName = "") => {
    const dotIndex = fileName.lastIndexOf(".");
    return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
};

const BOARD_HEADER_EXTENSIONS = new Set([".h", ".hpp"]);
const BOARD_SOURCE_EXTENSIONS = new Set([".ino", ".cpp", ".cc", ".c"]);

const isBoardUploadFile = (fileName, boardEntryFile) => {
    if (fileName === boardEntryFile) return true;
    const extension = getFileExtension(fileName);
    return BOARD_HEADER_EXTENSIONS.has(extension) || BOARD_SOURCE_EXTENSIONS.has(extension);
};

const sortUploadFiles = (fileNames, preferredFile) => [...fileNames].sort((left, right) => {
    if (left === preferredFile) return -1;
    if (right === preferredFile) return 1;
    return left.localeCompare(right);
});

const getLibraryBaseName = (rawName = "") => {
    const stripped = rawName.replace(/\.(h|hpp|cpp|cc|c)$/i, "").trim();
    const normalized = stripped.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    return normalized || "MyLibrary";
};

const getLibraryClassName = (baseName) => {
    const words = baseName.replace(/_/g, " ").split(/\s+/).filter(Boolean);
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("") || "MyLibrary";
};

const getUniqueLibraryBaseName = (rawName, existingFiles) => {
    const baseName = getLibraryBaseName(rawName);
    let candidate = baseName;
    let suffix = 2;

    while (
        existingFiles?.[`${candidate}.h`] ||
        existingFiles?.[`${candidate}.hpp`] ||
        existingFiles?.[`${candidate}.cpp`] ||
        existingFiles?.[`${candidate}.cc`] ||
        existingFiles?.[`${candidate}.c`]
    ) {
        candidate = `${baseName}_${suffix}`;
        suffix += 1;
    }

    return candidate;
};

const buildMicroPythonTemplate = (boardName) => `# LeapBlocks Python Upload Mode
# Project logic in MicroPython for ${boardName}.
# Keep board-specific firmware in the C++ file.

from machine import Pin
import time

status_led = Pin(2, Pin.OUT)

print("Booting ${boardName} project...")

for cycle in range(3):
    status_led.value(1)
    print("Cycle", cycle + 1, "- LED on")
    time.sleep(0.3)
    status_led.value(0)
    print("Cycle", cycle + 1, "- LED off")
    time.sleep(0.3)

print("Project ready.")
`;

const buildBoardTemplate = (boardId) => {
    if (boardId === "esp32") {
        return `// This C++ code is generated by LeapBlocks

#include <Arduino.h>

void setup() {
    // put your setup code here, to run once:

}

void loop() {
    // put your main code here, to run repeatedly:

}
`;
    }

    return `// This C++ code is generated by LeapBlocks

void setup() {
    // put your setup code here, to run once:

}

void loop() {
    // put your main code here, to run repeatedly:

}
`;
};

const buildLibraryHeaderTemplate = (rawName) => {
    const baseName = getLibraryBaseName(rawName);
    const className = getLibraryClassName(baseName);
    const includeGuard = `${baseName.toUpperCase()}_H`;

    return {
        fileName: `${baseName}.h`,
        content: `#ifndef ${includeGuard}
#define ${includeGuard}

class ${className} {
public:
    ${className}();
    void begin();
};

#endif
`,
    };
};

const buildLibraryCppTemplate = (rawName) => {
    const baseName = getLibraryBaseName(rawName);
    const className = getLibraryClassName(baseName);

    return {
        fileName: `${baseName}.cpp`,
        content: `#include "${baseName}.h"

${className}::${className}() {
}

void ${className}::begin() {
}
`,
    };
};

const normalizeCppInclude = (rawValue = "") => {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) return "";

    if (trimmedValue.startsWith("#include")) {
        return trimmedValue.replace(/\s+/g, " ").trim();
    }

    if (trimmedValue.startsWith("<") || trimmedValue.startsWith("\"")) {
        return `#include ${trimmedValue}`;
    }

    const headerName = /\.[a-z0-9]+$/i.test(trimmedValue) ? trimmedValue : `${trimmedValue}.h`;
    return `#include <${headerName}>`;
};

const insertIncludeLineIntoSource = (sourceCode = "", includeLine) => {
    if (!includeLine) return sourceCode;
    const existingLines = sourceCode.split("\n");
    if (existingLines.some((line) => line.trim() === includeLine)) {
        return sourceCode;
    }

    let insertIndex = 0;
    while (insertIndex < existingLines.length) {
        const trimmedLine = existingLines[insertIndex].trim();

        if (
            !trimmedLine ||
            trimmedLine.startsWith("//") ||
            trimmedLine.startsWith("/*") ||
            trimmedLine.startsWith("*") ||
            trimmedLine.startsWith("*/")
        ) {
            insertIndex += 1;
            continue;
        }

        if (trimmedLine.startsWith("#include")) {
            while (insertIndex < existingLines.length && existingLines[insertIndex].trim().startsWith("#include")) {
                insertIndex += 1;
            }
        }
        break;
    }

    const nextLines = [...existingLines];
    nextLines.splice(insertIndex, 0, includeLine);
    return nextLines.join("\n");
};

const createUploadFiles = (boardId) => {
    const boardConfig = getBoardConfig(boardId);
    const boardName = getBoardNameById()[boardId] || boardConfig.runtimeLabel;

    return {
        "main.py": buildMicroPythonTemplate(boardName),
        [boardConfig.fileName]: buildBoardTemplate(boardId),
    };
};

const formatPortLabel = (port) => {
    if (!port) return "";
    if (port.path === "BRIDGE_DETECTED") {
        return `Driver issue: ${port.manufacturer || "Unknown bridge"}`;
    }
    return `${port.path}${port.manufacturer ? ` (${port.manufacturer})` : ""}`;
};


// ─── Sprite Library (from shared component) ─────────────────────────────────
// Lazy init to avoid TDZ when FULL_CATALOG is not yet initialized after scope hoisting
let _SPRITE_LIBRARY;
function getSpriteLibrary() {
    if (!_SPRITE_LIBRARY) {
        _SPRITE_LIBRARY = FULL_CATALOG.map(sprite => ({
            name: sprite.name,
            img: sprite.image || sprite.emoji,
            type: sprite.id,
            costumes: sprite.costumes || [],
            category: sprite.category
        }));
    }
    return _SPRITE_LIBRARY;
}

// ─── Backdrop Library (from shared component) ───────────────────────────────
const BACKDROP_LIBRARY = [
    { name: 'Blank', img: null, id: 'blank' },
    // Preset backdrops
    { name: 'Maze', img: 'assets/backdrops/maze.svg', id: 'maze' },
    { name: 'Park', img: 'assets/backdrops/park.svg', id: 'park' },
    { name: 'Underwater', img: 'assets/backdrops/underwater.svg', id: 'underwater' },
    { name: 'Space', img: 'assets/backdrops/space_bg.svg', id: 'space' },
    { name: 'City', img: 'assets/backdrops/city.svg', id: 'city' },
    { name: 'Arctic', img: 'assets/backdrops/Artic.png', id: 'arctic' },
    { name: 'Beach', img: 'assets/backdrops/Beach.png', id: 'beach' },
    { name: 'Castle', img: 'assets/backdrops/Castle.png', id: 'castle' },
    { name: 'Galaxy', img: 'assets/backdrops/Space.png', id: 'galaxy' },
    { name: 'School', img: 'assets/backdrops/school.png', id: 'school' },
];

const getUniqueFileName = (desiredName, existingFiles) => {
    const files = existingFiles || {};
    const hasExtension = /\.[^./\\]+$/.test(desiredName);
    const fallbackName = hasExtension ? desiredName : `${desiredName}.py`;
    const dotIndex = fallbackName.lastIndexOf(".");
    const base = dotIndex > 0 ? fallbackName.slice(0, dotIndex) : fallbackName;
    const extension = dotIndex > 0 ? fallbackName.slice(dotIndex) : "";

    let candidate = fallbackName;
    let suffix = 2;

    while (files[candidate]) {
        candidate = `${base}_${suffix}${extension}`;
        suffix += 1;
    }

    return candidate;
};

const buildAssetPlaceholder = (file, kind) => [
    `# Imported ${kind} asset`,
    `name = "${file.name}"`,
    `mime_type = "${file.type || "unknown"}"`,
    `size_bytes = ${file.size}`,
    "",
    "# Added from the Python file explorer.",
    "# Replace this placeholder with your own loading or processing code.",
].join("\n");
const EXTENSIONS = [
    { id: 'music', name: 'Music', icon: '🎵', desc: 'Play notes and instruments', code: '# Music\nfrom music import play_note' },
    { id: 'pen', name: 'Pen', icon: '✏', desc: 'Draw lines on stage canvas', code: '# Pen\nfrom pen import pen_down, pen_up' },
    { id: 'ml', name: 'Machine Learning', icon: '🧠', desc: 'KNN classifier, image AI', code: '# ML\nfrom ml import KNNClassifier' },
    { id: 'face', name: 'Face Detection', icon: '👁', desc: 'Detect faces via camera', code: '# Face\nfrom face import FaceDetection' },
    { id: 'speech', name: 'Speech', icon: '🗣', desc: 'TTS and speech recognition', code: '# Speech\nfrom speech import say, listen' },
    { id: 'iot', name: 'IoT / Quarky', icon: '⚡', desc: 'Control LEDs, sensors', code: '# Quarky\nfrom quarky import Quarky' },
    { id: 'arduino', name: 'Arduino', icon: '🔌', desc: 'Digital and analog pins', code: '# Arduino\nfrom arduino import Arduino' },
];

// ─── Pip Package Registry (Skulpt-compatible stdlib modules + Advanced Libraries) ──
let _PIP_PACKAGES = null;
const getPipPackages = () => {
    if (!_PIP_PACKAGES) {
        _PIP_PACKAGES = [
            // ── Built-in Standard Library Modules ──
            { name: "math", desc: "Mathematical functions", installed: true, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "random", desc: "Random number generation", installed: true, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "time", desc: "Time access & conversions", installed: true, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "json", desc: "JSON encoder/decoder", installed: true, builtin: true, category: "core", version: "3.10", tags: ["data"] },
            { name: "re", desc: "Regular expressions", installed: true, builtin: true, category: "core", version: "3.10", tags: ["text"] },
            { name: "sys", desc: "System-specific parameters", installed: true, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "os", desc: "Operating system interface", installed: false, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "datetime", desc: "Date and time classes", installed: false, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "collections", desc: "Container data types (deque, Counter, etc.)", installed: false, builtin: true, category: "core", version: "3.10", tags: ["data"] },
            { name: "itertools", desc: "Iterator building blocks", installed: false, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "functools", desc: "Higher-order functions and operations", installed: false, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "string", desc: "String constants and classes", installed: false, builtin: true, category: "core", version: "3.10", tags: ["text"] },
            { name: "operator", desc: "Standard operators as functions", installed: false, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "copy", desc: "Shallow and deep copy operations", installed: false, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "typing", desc: "Type hints support", installed: false, builtin: true, category: "core", version: "3.10", tags: ["core"] },
            { name: "unittest", desc: "Unit testing framework", installed: false, builtin: true, category: "core", version: "3.10", tags: ["testing"] },
            { name: "csv", desc: "CSV file reading and writing", installed: false, builtin: true, category: "core", version: "3.10", tags: ["data"] },
            { name: "base64", desc: "Base64 encoding and decoding", installed: false, builtin: true, category: "core", version: "3.10", tags: ["encoding"] },
            { name: "hashlib", desc: "Secure hash and message digest", installed: false, builtin: true, category: "core", version: "3.10", tags: ["security"] },
            { name: "logging", desc: "Flexible logging facility", installed: false, builtin: true, category: "core", version: "3.10", tags: ["debug"] },
            { name: "argparse", desc: "Command-line argument parsing", installed: false, builtin: true, category: "core", version: "3.10", tags: ["cli"] },
            { name: "pathlib", desc: "Object-oriented filesystem paths", installed: false, builtin: true, category: "core", version: "3.10", tags: ["files"] },

            // ── Computer Vision & Image Processing ──
            { name: "opencv-python", desc: "OpenCV - Computer vision and image processing", installed: false, builtin: false, category: "computer-vision", version: "4.8.0", tags: ["vision", "image", "video"] },
            { name: "mediapipe", desc: "MediaPipe - ML solutions for vision, audio, and text", installed: false, builtin: false, category: "computer-vision", version: "0.10.8", tags: ["vision", "pose", "hands", "face", "gesture"] },
            { name: "pillow", desc: "PIL Fork - Image processing library", installed: false, builtin: false, category: "computer-vision", version: "10.1.0", tags: ["image", "processing"] },
            { name: "scikit-image", desc: "Image processing algorithms", installed: false, builtin: false, category: "computer-vision", version: "0.22.0", tags: ["vision", "processing"] },
            { name: "imageio", desc: "Image reading and writing library", installed: false, builtin: false, category: "computer-vision", version: "2.31.0", tags: ["image", "video"] },

            // ── Machine Learning & AI ──
            { name: "tensorflow", desc: "TensorFlow - Deep learning framework", installed: false, builtin: false, category: "machine-learning", version: "2.15.0", tags: ["ml", "deep-learning", "neural-networks"] },
            { name: "torch", desc: "PyTorch - Deep learning framework", installed: false, builtin: false, category: "machine-learning", version: "2.1.0", tags: ["ml", "deep-learning", "neural-networks"] },
            { name: "scikit-learn", desc: "Scikit-learn - Machine learning library", installed: false, builtin: false, category: "machine-learning", version: "1.3.2", tags: ["ml", "classification", "regression"] },
            { name: "numpy", desc: "NumPy - Numerical computing library", installed: false, builtin: false, category: "machine-learning", version: "1.26.2", tags: ["math", "arrays", "numerical"] },
            { name: "pandas", desc: "Pandas - Data analysis and manipulation", installed: false, builtin: false, category: "machine-learning", version: "2.1.4", tags: ["data", "analysis", "dataframe"] },
            { name: "matplotlib", desc: "Matplotlib - Plotting library", installed: false, builtin: false, category: "machine-learning", version: "3.8.2", tags: ["visualization", "plotting", "graphs"] },
            { name: "opencv-contrib-python", desc: "OpenCV with extra modules (SIFT, SURF, etc.)", installed: false, builtin: false, category: "computer-vision", version: "4.8.0", tags: ["vision", "advanced"] },

            // ── Speech & Audio ──
            { name: "speechrecognition", desc: "Speech Recognition - Convert speech to text", installed: false, builtin: false, category: "speech", version: "3.10.1", tags: ["speech", "audio", "stt"] },
            { name: "pyttsx3", desc: "pyttsx3 - Text-to-speech (offline)", installed: false, builtin: false, category: "speech", version: "2.90", tags: ["speech", "tts", "voice"] },
            { name: "gTTS", desc: "Google Text-to-Speech", installed: false, builtin: false, category: "speech", version: "2.5.0", tags: ["speech", "tts", "google"] },
            { name: "pyaudio", desc: "PyAudio - Audio I/O library", installed: false, builtin: false, category: "speech", version: "0.2.13", tags: ["audio", "microphone"] },
            { name: "librosa", desc: "Librosa - Audio analysis library", installed: false, builtin: false, category: "speech", version: "0.10.1", tags: ["audio", "music", "analysis"] },
            { name: "sounddevice", desc: "SoundDevice - Audio playback and recording", installed: false, builtin: false, category: "speech", version: "0.4.6", tags: ["audio", "playback"] },
            { name: "whisper", desc: "OpenAI Whisper - Speech recognition model", installed: false, builtin: false, category: "speech", version: "1.1.10", tags: ["speech", "ai", "transcription"] },

            // ── IoT & Hardware ──
            { name: "pyserial", desc: "PySerial - Serial port communication", installed: false, builtin: false, category: "iot", version: "3.5", tags: ["serial", "arduino", "hardware"] },
            { name: "pyfirmata", desc: "PyFirmata - Arduino communication protocol", installed: false, builtin: false, category: "iot", version: "2.3.8", tags: ["arduino", "firmata"] },
            { name: "rpi.gpio", desc: "RPi.GPIO - Raspberry Pi GPIO control", installed: false, builtin: false, category: "iot", version: "0.7.1", tags: ["raspberry-pi", "gpio"] },
            { name: "adafruit-circuitpython", desc: "Adafruit CircuitPython libraries", installed: false, builtin: false, category: "iot", version: "8.0.0", tags: ["adafruit", "circuitpython", "sensors"] },
            { name: "pymata4", desc: "PyMata4 - Arduino Firmata interface", installed: false, builtin: false, category: "iot", version: "3.04", tags: ["arduino", "iot"] },
            { name: "esptool", desc: "ESP Tool - ESP8266/ESP32 flash utility", installed: false, builtin: false, category: "iot", version: "4.7.0", tags: ["esp32", "esp8266", "flash"] },
            { name: "mpy-cross", desc: "MicroPython cross-compiler", installed: false, builtin: false, category: "iot", version: "1.21.0", tags: ["micropython", "embedded"] },
            { name: "smbus2", desc: "SMBus2 - I2C communication library", installed: false, builtin: false, category: "iot", version: "0.4.3", tags: ["i2c", "sensors", "hardware"] },

            // ── Robotics & Control ──
            { name: "roboticstoolbox-python", desc: "Robotics Toolbox - Robot modeling and control", installed: false, builtin: false, category: "hardware", version: "1.0.3", tags: ["robotics", "kinematics", "control"] },
            { name: "pynput", desc: "PyNput - Keyboard and mouse control", installed: false, builtin: false, category: "hardware", version: "1.7.6", tags: ["input", "automation", "control"] },
            { name: "pyvjoy", desc: "PyVJoy - Virtual joystick control", installed: false, builtin: false, category: "hardware", version: "1.0.5", tags: ["joystick", "gamepad", "control"] },
            { name: "gpiozero", desc: "GPIO Zero - GPIO device interface", installed: false, builtin: false, category: "hardware", version: "2.0", tags: ["gpio", "raspberry-pi", "sensors"] },

            // ── Networking & Communication ──
            { name: "requests", desc: "HTTP library for humans", installed: false, builtin: false, category: "utility", version: "2.31.0", tags: ["http", "api", "web"] },
            { name: "flask", desc: "Flask - Lightweight web framework", installed: false, builtin: false, category: "utility", version: "3.0.0", tags: ["web", "server", "api"] },
            { name: "websocket-client", desc: "WebSocket client library", installed: false, builtin: false, category: "utility", version: "1.7.0", tags: ["websocket", "real-time"] },
            { name: "paho-mqtt", desc: "Paho MQTT - IoT messaging protocol", installed: false, builtin: false, category: "iot", version: "1.6.1", tags: ["mqtt", "iot", "messaging"] },
            { name: "paramiko", desc: "Paramiko - SSH2 protocol library", installed: false, builtin: false, category: "utility", version: "3.4.0", tags: ["ssh", "remote", "networking"] },

            // ── Data Processing ──
            { name: "openpyxl", desc: "OpenPyXL - Excel file manipulation", installed: false, builtin: false, category: "utility", version: "3.1.2", tags: ["excel", "spreadsheet"] },
            { name: "pyyaml", desc: "PyYAML - YAML parser and emitter", installed: false, builtin: false, category: "utility", version: "6.0.1", tags: ["yaml", "config"] },
            { name: "lxml", desc: "lxml - XML and HTML processing", installed: false, builtin: false, category: "utility", version: "4.9.4", tags: ["xml", "html", "parsing"] },
            { name: "beautifulsoup4", desc: "Beautiful Soup - Web scraping library", installed: false, builtin: false, category: "utility", version: "4.12.2", tags: ["scraping", "html", "parsing"] },

            // ── GUI & Visualization ──
            { name: "tkinter", desc: "Tkinter - Standard GUI library", installed: false, builtin: true, category: "utility", version: "3.10", tags: ["gui", "desktop"] },
            { name: "pygame", desc: "Pygame - Game development library", installed: false, builtin: false, category: "utility", version: "2.5.2", tags: ["game", "graphics", "multimedia"] },
            { name: "plotly", desc: "Plotly - Interactive visualization", installed: false, builtin: false, category: "utility", version: "5.18.0", tags: ["visualization", "interactive", "graphs"] },
            { name: "seaborn", desc: "Seaborn - Statistical visualization", installed: false, builtin: false, category: "utility", version: "0.13.0", tags: ["visualization", "statistics"] },

            // ── Utilities ──
            { name: "python-dotenv", desc: "Environment variable management", installed: false, builtin: false, category: "utility", version: "1.0.0", tags: ["config", "env"] },
            { name: "schedule", desc: "Job scheduling library", installed: false, builtin: false, category: "utility", version: "1.2.1", tags: ["scheduling", "automation"] },
            { name: "watchdog", desc: "Filesystem events monitoring", installed: false, builtin: false, category: "utility", version: "3.0.0", tags: ["files", "monitoring"] },
            { name: "pillow-simd", desc: "Pillow with SIMD optimizations", installed: false, builtin: false, category: "computer-vision", version: "10.2.0", tags: ["image", "fast"] },
        ];
    }
    return _PIP_PACKAGES;
};

// ─── Main Component ────────────────────────────────────────────────────────────
function PythonApp({ onBack, onSwitchToNotebook, onSwitchToBlocks, onSwitchToCostumes }) {
    const {
        sprites,
        setSprites,
        selectedSpriteId,
        setSelectedSpriteId,
        selectedSprite,
        backdrop,
        setBackdrop: setBackdropImg,
        stageSize,
        stageRef,
        backdropLibrary,
        addSprite,
        deleteSprite,
        updateSprite,
        updateSpriteProperty,
        resetStage
    } = useStage();

    // Editor state
    const [projectName, setProjectName] = useState("My Project");
    const [workflowMode, setWorkflowMode] = useState("ide");
    const [activeFile, setActiveFile] = useState(DEFAULT_ACTIVE_FILE);
    const [projectFiles, setProjectFiles] = useState(DEFAULT_FILES);
    const [editorCursor, setEditorCursor] = useState({ line: 1, col: 1 });
    const monacoRef = useRef(null);
    const editorRef = useRef(null);
    const [uploadView, setUploadView] = useState("project");
    const [selectedBoard, setSelectedBoard] = useState("arduino_uno");
    const [isBoardModalOpen, setIsBoardModalOpen] = useState(false);
    const [uploadProjectFiles, setUploadProjectFiles] = useState(() => createUploadFiles("arduino_uno"));
    const [uploadActiveFile, setUploadActiveFile] = useState("main.py");
    const [uploadPanelTab, setUploadPanelTab] = useState("terminal");
    const [ports, setPorts] = useState([]);
    const [selectedPort, setSelectedPort] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const [isUploadingFirmware, setIsUploadingFirmware] = useState(false);
    const [showBoardCppMenu, setShowBoardCppMenu] = useState(false);
    const [uploadProgressMessage, setUploadProgressMessage] = useState("");
    const [baudRate, setBaudRate] = useState(115200);
    const [lineEnding, setLineEnding] = useState("");
    const [serialMessages, setSerialMessages] = useState([]);
    const [uploadTerminalOutput, setUploadTerminalOutput] = useState([
        { text: "Python upload mode ready. Switch between MicroPython and board firmware files.", type: "info", ts: new Date() },
    ]);
    const [uploadLogMessages, setUploadLogMessages] = useState([
        "Upload mode initialized",
    ]);

    // ─── Project File Handlers ─────────────────────────────────────────────────────
    const fileInputRef = useRef(null);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const mobileMenuRef = useRef(null);
    const windowWidth = useWindowWidth();
    const showDesktopMenus = windowWidth >= 1400;

    const handleNewProject = () => {
        if (!window.confirm("Create a new project? All unsaved work will be lost.")) return;
        setProjectName("My Project");
        setProjectFiles(DEFAULT_FILES);
        setActiveFile(DEFAULT_ACTIVE_FILE);
        resetStage();
    };

    const handleSaveProject = async () => {
        const authState = useLeapLabAuthStore.getState();
        if (!authState.isAuthenticated || !authState.token) {
            showToast("Please sign in to save projects. Use Download to save locally.", "info");
            return;
        }
        if (authState.role === 'trainer') {
            showToast("Trainers cannot save to cloud. Use Download to save locally.", "info");
            return;
        }
        const payload = {
            projectFiles,
            activeFile,
            sprites,
            backdrop,
        };
        try {
            await fileService.saveProject(projectName, "python", payload);
            showToast("Project saved successfully!", "success");
        } catch (err) {
            console.error('[PythonApp] Failed to save project:', err);
            alert(err?.message || 'Failed to save project. Please make sure you are signed in.');
        }
    };

    const handleSaveAsProject = async () => {
        const authState = useLeapLabAuthStore.getState();
        if (!authState.isAuthenticated || !authState.token) {
            showToast("Please sign in to save projects. Use Download to save locally.", "info");
            return;
        }
        if (authState.role === 'trainer') {
            showToast("Trainers cannot save to cloud. Use Download to save locally.", "info");
            return;
        }
        const payload = {
            projectFiles,
            activeFile,
            sprites,
            backdrop,
        };
        try {
            await fileService.saveProject(projectName, "python", payload);
            showToast("Project saved successfully!", "success");
        } catch (err) {
            console.error('[PythonApp] Failed to save project (Save As):', err);
            alert(err?.message || 'Failed to save project. Please make sure you are signed in.');
        }
    };

    const handleDownloadProject = () => {
        const payload = {
            projectFiles,
            activeFile,
            sprites,
            backdrop,
        };
        fileService.saveProjectLocally(projectName, "python", payload);
    };

    const handleOpenProject = () => {
        if (fileInputRef.current) {
            fileInputRef.current.accept = '.leap,.lbproject,application/json';
            fileInputRef.current.click();
        }
    };

    const handleFileLoad = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await fileService.loadProject(file);
            const validation = fileService.validateProject(data, "python");
            if (!validation.isValid) {
                alert(validation.error);
                return;
            }

            const nextProjectFiles = data.projectFiles && Object.keys(data.projectFiles).length ? data.projectFiles : DEFAULT_FILES;
            setProjectName(data.projectName || "My Project");
            setProjectFiles(nextProjectFiles);
            setActiveFile(getFallbackActiveFile(nextProjectFiles, data.activeFile));

            if (data.sprites && Array.isArray(data.sprites) && data.sprites.length > 0) {
                setSprites(data.sprites);
                setSelectedSpriteId(data.sprites[0].id);
            } else {
                resetStage();
            }
            if (data.backdrop) setBackdropImg(data.backdrop);

        } catch (err) {
            alert('Failed to load project: ' + err.message);
        } finally {
            e.target.value = "";
        }
    };

    const handleOpenPythonFile = () => {
        openFilePicker(".py", async (file) => {
            try {
                const content = await readTextFile(file);
                const fileName = getUniqueFileName(file.name, projectFiles);
                setProjectFiles((prev) => ({ ...prev, [fileName]: content }));
                setActiveFile(fileName);
                setSidePanel("files");
                addLog(`Loaded Python file: ${fileName}`, "success");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to open Python file.";
                addLog(message, "error");
            }
        });
    };

    const handleShareProject = () => {
        const payload = {
            projectFiles,
            activeFile,
            sprites,
            backdrop,
        };
        fileService.shareProject(projectName, "python", payload);
    };

    useEffect(() => {
        if (!mobileMenuOpen) return;
        const handleClickOutside = (e) => {
            if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
                setMobileMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside, true);
        return () => document.removeEventListener('mousedown', handleClickOutside, true);
    }, [mobileMenuOpen]);

    // Terminal / REPL
    const [activePanel, setActivePanel] = useState("terminal"); // "terminal" | "repl" | "debugger" | "pip"
    const _isWebMode = !window.electronAPI?.isElectron;
    const [terminalOutput, setTerminalOutput] = useState([
        { text: "╔══════════════════════════════════════════════════════════════╗", type: "info", ts: new Date() },
        { text: "║  Leaplab Logix.v1.0                                          ║", type: "info", ts: new Date() },
        { text: "║  ─────────────────────────────────────────────────────────── ║", type: "info", ts: new Date() },
        { text: "║  ▶ Press Ctrl+Enter or F5 to run code                       ║", type: "info", ts: new Date() },
        { text: "║  ▶ Press Escape to stop execution                           ║", type: "info", ts: new Date() },
        { text: "║  ▶ Press Ctrl+` to toggle REPL mode                         ║", type: "info", ts: new Date() },
        { text: "║  ▶ Press Ctrl+S to save project                             ║", type: "info", ts: new Date() },
        { text: "╚══════════════════════════════════════════════════════════════╝", type: "info", ts: new Date() },
        { text: "", type: "info", ts: new Date() },
        {
            text: _isWebMode
                ? "🌐 Web Mode — Python runs in-browser via Skulpt. No install needed!"
                : "🖥 Desktop Mode — Native Python connected. Ready!",
            type: "success", ts: new Date()
        },
    ]);
    const [replInput, setReplInput] = useState("");
    const [shellInput, setShellInput] = useState("");
    const [shellHistory, setShellHistory] = useState([]);
    const [shellHistoryIndex, setShellHistoryIndex] = useState(-1);
    const shellInputRef = useRef(null);
    const [replHistory, setReplHistory] = useState([]);
    const [replHistIdx, setReplHistIdx] = useState(-1);
    const terminalEndRef = useRef(null);
    const replInputRef = useRef(null);
    const replGlobals = useRef({});

    // Run state
    const [isRunning, setIsRunning] = useState(false);

    // Input state for Skulpt interactive prompts
    const [isWaitingForInput, setIsWaitingForInput] = useState(false);
    const [inputPromptText, setInputPromptText] = useState("");
    const [terminalInputValue, setTerminalInputValue] = useState("");
    const inputResolverRef = useRef(null);
    const terminalInputRef = useRef(null);

    // Debugger state
    const [debugBreakpoints, setDebugBreakpoints] = useState(new Set());
    const [debugVars, setDebugVars] = useState([]);
    const [debugLine, setDebugLine] = useState(null);

    // PIP
    const [packages, setPackages] = useState(() => getPipPackages());
    const [pipFilter, setPipFilter] = useState("");

    const [sidePanel, setSidePanel] = useState("files");
    const [spriteFilter, setSpriteFilter] = useState("");
    const [installedExtensions, setInstalledExtensions] = useState([]);

    const [modalState, setModalState] = useState({
        isOpen: false,
        title: "",
        message: "",
        defaultValue: "",
        onSubmit: null,
    });
    const [modalInput, setModalInput] = useState("");

    // Sprite Library Modal state
    const [showSpriteLibrary, setShowSpriteLibrary] = useState(false);
    const [libraryMode, setLibraryMode] = useState("sprite"); // "sprite" or "costume"

    // Engine ref
    const skulptRef = useRef(null);
    const boardCppMenuRef = useRef(null);
    const replStartedRef = useRef(false);
    const replErrorBufferRef = useRef("");
    const replOutputBufferRef = useRef("");
    const runStopRequestedRef = useRef(false);

    // ── Helpers ──────────────────────────────────────────────────────────────
    const addLog = useCallback((text, type = "log") => {
        setTerminalOutput(prev => [...prev, { text, type, ts: new Date() }]);
    }, []);

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

    const flushReplBuffer = useCallback((bufferRef, type) => {
        const buf = bufferRef.current;
        if (!buf) return;
        const lines = buf.split("\n");
        lines.forEach((line, i) => {
            if (i === lines.length - 1 && !buf.endsWith("\n")) {
                bufferRef.current = line;
                return;
            }
            const trimmed = line.trim();
            if (trimmed || i < lines.length - 2) {
                addLog(line.replace(/\r$/, ""), type);
            }
        });
        if (buf.endsWith("\n")) bufferRef.current = "";
    }, [addLog]);

    const selectedBoardConfig = getBoardConfig(selectedBoard);
    const selectedBoardName = getBoardNameById()[selectedBoard] || selectedBoardConfig.runtimeLabel;
    const activeBoardFile = selectedBoardConfig.fileName;
    const protectedUploadFiles = new Set(["main.py", activeBoardFile]);
    const visibleUploadFiles = uploadView === "board"
        ? sortUploadFiles(
            Object.keys(uploadProjectFiles).filter((file) => isBoardUploadFile(file, activeBoardFile)),
            activeBoardFile
        )
        : sortUploadFiles(
            Object.keys(uploadProjectFiles).filter((file) => !isBoardUploadFile(file, activeBoardFile)),
            "main.py"
        );

    const addUploadMessage = useCallback((text, type = "info") => {
        setUploadTerminalOutput((prev) => [...prev, { text, type, ts: new Date() }]);
        setUploadLogMessages((prev) => [...prev, text]);
    }, []);

    const openTextPrompt = useCallback((title, message, defaultValue, onSubmit) => {
        setModalInput(defaultValue || "");
        setModalState({
            isOpen: true,
            title,
            message,
            defaultValue: defaultValue || "",
            onSubmit,
        });
    }, []);

    const onOpenAssetLibrary = useCallback((mode) => {
        setLibraryMode(mode || "sprite");
        setShowSpriteLibrary(true);
    }, []);

    const activeMode = activeFile === "stage.py" ? "stage" : (sprites.some(s => s.name.toLowerCase().replace(/\s+/g, '_') + '.py' === activeFile || s.id === activeFile) ? "sprite" : "mixed");

    const handleModalCancel = useCallback(() => {
        setModalState({
            isOpen: false,
            title: "",
            message: "",
            defaultValue: "",
            onSubmit: null,
        });
        setModalInput("");
    }, []);

    const handleModalSubmit = useCallback(() => {
        const nextValue = modalInput.trim();
        if (!nextValue) return;

        modalState.onSubmit?.(nextValue);
        handleModalCancel();
    }, [handleModalCancel, modalInput, modalState]);

    // ── Skulpt Init ───────────────────────────────────────────────────────────
    useEffect(() => {
        // Expose updateSprite globally for Teddy component drag support
        // Accepts either sprite ID or sprite name
        window.updateSprite = (spriteIdOrName, updates) => {
            setSprites(prev => prev.map(s => {
                // Match by ID or by name (case-insensitive)
                if (s.id !== spriteIdOrName && s.name.toLowerCase() !== String(spriteIdOrName).toLowerCase()) return s;

                const newProps = { ...s };

                // Handle position updates from drag (pixel coordinates)
                if (updates.x !== undefined || updates.y !== undefined) {
                    newProps.position = { ...(s.position || { x: s.x || 0, y: s.y || 0 }) };

                    // Convert pixel coordinates to leap coordinates
                    const scaleX = stageSize.w / 480;
                    const scaleY = stageSize.h / 360;
                    const centerX = stageSize.w / 2;
                    const centerY = stageSize.h / 2;
                    const offset = 40; // sprite half-size

                    if (updates.x !== undefined) {
                        // leapX = (pixelX - centerX + offset) / scaleX
                        newProps.position.x = (updates.x - centerX + offset) / scaleX;
                        newProps.x = newProps.position.x; // Also set legacy property
                    }
                    if (updates.y !== undefined) {
                        // Y is inverted: leapY = (centerY - pixelY - offset) / scaleY
                        newProps.position.y = (centerY - updates.y - offset) / scaleY;
                        newProps.y = newProps.position.y; // Also set legacy property
                    }
                }

                // Handle other updates
                Object.keys(updates).forEach(key => {
                    if (key === 'x' || key === 'y') return; // Already handled above
                    if (typeof updates[key] === 'function') {
                        newProps[key] = updates[key](s[key]);
                    } else {
                        newProps[key] = updates[key];
                    }
                });

                return newProps;
            }));
        };

        // Helper to convert pixel coordinates to leap coordinates
        window.pixelToleap = (pixelX, pixelY) => {
            const leapX = (pixelX - stageSize.w / 2 + 40) / (stageSize.w / 480);
            const leapY = (stageSize.h / 2 - pixelY - 40) / (stageSize.h / 360);
            return { x: leapX, y: leapY };
        };

        // Helper to convert leap coordinates to pixel coordinates
        window.leapToPixel = (leapX, leapY) => {
            const pixelX = (stageSize.w / 2) + (leapX * (stageSize.w / 480)) - 40;
            const pixelY = (stageSize.h / 2) - (leapY * (stageSize.h / 360)) - 40;
            return { x: pixelX, y: pixelY };
        };

        // Only load Skulpt in web mode; Electron uses native Python
        if (!window.electronAPI?.isElectron && !skulptRef.current) {
            skulptRef.current = new SkulptEngine({
                onOut: (text) => addLog(text.replace(/\n$/, ""), "log"),
                onErr: (text) => addLog(text, "error"),
                onInputRequested: (promptText, resolve) => {
                    inputResolverRef.current = resolve;
                    setInputPromptText(promptText || "");
                    setIsWaitingForInput(true);
                    setTerminalInputValue("");
                    // Auto-focus the terminal input after a brief delay
                    setTimeout(() => terminalInputRef.current?.focus(), 80);
                },
                actions: {
                    initSprite: (name) => {
                        setSprites(prev => {
                            if (prev.find(s => s.name.toLowerCase() === name.toLowerCase())) return prev;

                            // Add default sprite from library if found, else generic
                            const preset = getDefaultSpritePresets()[name.toLowerCase()] || {
                                name,
                                type: 'robot', // Default to robot type for initialization
                                costumes: { default: "assets/sprites/robot/robot_idle.svg" }
                            };

                            const id = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
                            const newSprite = {
                                id,
                                name: preset.name || name,
                                type: preset.type || 'robot',
                                position: { x: (Math.random() - 0.5) * 40, y: (Math.random() - 0.5) * 40 },
                                direction: 0,
                                size: 100,
                                visible: true,
                                speech: '',
                                currentCostume: 'default',
                                costumes: preset.costumes || { default: "assets/sprites/robot/robot_idle.svg" },
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
                            if (dir === "UP") dy = d;  // In leap, UP increases Y
                            if (dir === "DOWN") dy = -d; // In leap, DOWN decreases Y
                            const pos = s.position || { x: s.x || 0, y: s.y || 0 };
                            addLog(`➡️ ${name}: Move ${dir} ${d} steps`, 'info');
                            return {
                                ...s,
                                x: pos.x + dx,
                                y: pos.y + dy,
                                position: { x: pos.x + dx, y: pos.y + dy }
                            };
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
                            return {
                                ...s,
                                x: newX,
                                y: newY,
                                position: { x: newX, y: newY }
                            };
                        }));
                    },
                    update: (name, props) => {
                        setSprites(prev => prev.map(s => {
                            if (s.name.toLowerCase() !== name.toLowerCase()) return s;
                            const newProps = { ...s };
                            const pos = s.position || { x: s.x || 0, y: s.y || 0 };
                            newProps.position = { ...pos };

                            // Log sprite action to terminal
                            const actionType = Object.keys(props).join(', ');
                            addLog(`🤖 ${name}: ${actionType}`, 'info');

                            Object.keys(props).forEach(key => {
                                if (typeof props[key] === 'function') {
                                    const oldVal = key === 'direction' ? (s.direction ?? s.angle ?? 0) :
                                        key === 'angle' ? (s.angle ?? s.direction ?? 0) :
                                            s[key];
                                    const newVal = props[key](oldVal);
                                    newProps[key] = newVal;
                                    // Sync direction/angle
                                    if (key === 'direction') newProps.angle = newVal;
                                    if (key === 'angle') newProps.direction = newVal;
                                } else if (key === 'nextCostume' && props[key]) {
                                    // Handle next costume
                                    const costumeKeys = Object.keys(s.costumes || {});
                                    const currentIdx = costumeKeys.indexOf(s.currentCostume);
                                    const nextIdx = (currentIdx + 1) % costumeKeys.length;
                                    newProps.currentCostume = costumeKeys[nextIdx] || 'default';
                                    addLog(`🎭 ${name}: Changed costume to ${newProps.currentCostume}`, 'info');
                                } else if (key === 'position') {
                                    // Merge position updates
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
                                    // Sync direction/angle
                                    if (key === 'direction') newProps.angle = props[key];
                                    if (key === 'angle') newProps.direction = props[key];
                                }
                            });
                            return newProps;
                        }));
                    },
                    softResetAll: () => setSprites(prev => prev.map(s => ({
                        ...s,
                        x: 0,
                        y: 0,
                        position: { x: 0, y: 0 },
                        speech: '',
                        angle: 0,
                        direction: 0,
                        size: 100,
                        visible: true
                    }))),
                }
            });
        }

        // Create intermediate blocks bridge for sprite panel functions
        const spriteBridge = createIntermediateBlocksBridge(sprites, setSprites, selectedSpriteId, addLog);
        window.spriteBridge = spriteBridge;

        // Expose sprite panel functions globally for intermediate blocks
        window.spritePanelFunctions = {
            move: spriteBridge.move,
            moveRelative: spriteBridge.moveRelative,
            turn: spriteBridge.turn,
            goTo: spriteBridge.goTo,
            say: spriteBridge.say,
            think: spriteBridge.think,
            show: spriteBridge.show,
            hide: spriteBridge.hide,
            setSize: spriteBridge.setSize,
            changeSize: spriteBridge.changeSize,
            nextCostume: spriteBridge.nextCostume,
            switchCostume: spriteBridge.switchCostume,
            pointInDirection: spriteBridge.pointInDirection,
            getPosition: spriteBridge.getPosition,
            getDirection: spriteBridge.getDirection,
            getSize: spriteBridge.getSize,
            isVisible: spriteBridge.isVisible
        };

        return () => {
            delete window.spriteBridge;
            delete window.spritePanelFunctions;
        };
    }, [addLog, updateSprite, sprites, setSprites, selectedSpriteId]);

    // Auto-scroll terminal
    useEffect(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [terminalOutput]);

    // ── Keyboard Shortcuts ────────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ctrl+Enter or F5: Run code
            if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F5') {
                e.preventDefault();
                if (!isRunning) handleRun();
            }
            // Escape: Stop execution
            if (e.key === 'Escape' && isRunning) {
                e.preventDefault();
                handleStop();
            }
            // Ctrl+Shift+C: Clear terminal
            if (e.ctrlKey && e.shiftKey && e.key === 'C') {
                e.preventDefault();
                handleClear();
            }
            // Ctrl+`: Toggle REPL
            if (e.ctrlKey && e.key === '`') {
                e.preventDefault();
                setActivePanel(prev => prev === 'repl' ? 'terminal' : 'repl');
                if (activePanel !== 'repl') {
                    setTimeout(() => replInputRef.current?.focus(), 100);
                }
            }
            // Ctrl+S: Save (prevent browser save)
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                addLog("💾 Project auto-saved", "success");
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isRunning, activePanel, handleRun, handleStop, handleClear, addLog]);

    // ── NATIVE PYTHON IPC LISTENERS ──────────────────────────────────────────
    useEffect(() => {
        if (!window.electronAPI?.isElectron) return;

        const cleanups = [
            window.electronAPI.onPythonOutput((data) => {
                addLog(data.replace(/\n$/, ""), "log");
            }),
            window.electronAPI.onPythonError((data) => {
                const cleaned = data.replace(/\n$/, "");
                if (isPythonBannerText(cleaned)) return;
                addLog(cleaned, "error");
            }),
            window.electronAPI.onPythonExit((code) => {
                if (code === null) {
                    addLog(`✗ Failed to start Python. Is Python installed and in your PATH?`, "error");
                    addLog(`💡 Tip: Install Python from python.org and ensure it's in your system PATH.`, "info");
                } else if (code === 0) {
                    addLog(`✓ Program finished successfully`, "success");
                } else {
                    addLog(`✗ Program exited with code ${code}`, "warning");
                }
                setIsRunning(false);
                setIsWaitingForInput(false);
                setInputPromptText("");
                setTerminalInputValue("");
            }),
            window.electronAPI.onPythonReplOutput((data) => {
                replOutputBufferRef.current += data;
                const lines = replOutputBufferRef.current.split("\n");
                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i].replace(/\r$/, "");
                    if (line.trim() || i < lines.length - 2) {
                        addLog(line, "log");
                    }
                }
                replOutputBufferRef.current = lines[lines.length - 1];
            }),
            window.electronAPI.onPythonReplError((data) => {
                replErrorBufferRef.current += data;
                const lines = replErrorBufferRef.current.split("\n");
                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i].replace(/\r$/, "");
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    if (isPythonBannerText(line)) continue;
                    addLog(line, "error");
                }
                replErrorBufferRef.current = lines[lines.length - 1];
            }),
            window.electronAPI.onPythonPipOutput((data) => {
                addLog(data.replace(/\n$/, ""), "log");
            }),
            window.electronAPI.onPythonPipError((data) => {
                addLog(data, "error");
            }),
            window.electronAPI.onPythonShellOutput ? window.electronAPI.onPythonShellOutput((data) => {
                addLog(data.replace(/\n$/, ""), "log");
            }) : null,
            window.electronAPI.onPythonShellError ? window.electronAPI.onPythonShellError((data) => {
                addLog(data.replace(/\n$/, ""), "error");
            }) : null,
            window.electronAPI.onPythonShellExit ? window.electronAPI.onPythonShellExit((code) => {
                if (code === null) { addLog(`✗ Shell command failed.`, "error"); }
                else if (code === 0) { addLog(`✓ Command completed`, "success"); }
                else { addLog(`✗ Command exited with code ${code}`, "warning"); }
            }) : null,
            window.electronAPI.onPythonFilesUpdated((files) => {
                setProjectFiles(prev => ({ ...prev, ...files }));
                const fileNames = Object.keys(files).join(', ');
                addLog(`📁 Files updated: ${fileNames}`, "info");
            }),
        ];

        return () => {
            cleanups.forEach(fn => fn());
        };
    }, [addLog, isPythonBannerText]);

    useEffect(() => {
        if (activePanel === "repl") {
            if (window.electronAPI?.isElectron) {
                if (!replStartedRef.current) {
                    replStartedRef.current = true;
                    window.electronAPI.pythonReplStart();
                    addLog(`>>> Native Python REPL Connected.`, "success");
                }
            } else {
                addLog(`>>> Python REPL Ready (in-browser Skulpt engine).`, "success");
            }
        } else {
            replStartedRef.current = false;
            replOutputBufferRef.current = "";
            replErrorBufferRef.current = "";
        }
    }, [activePanel, addLog]);

    // ── Run ───────────────────────────────────────────────────────────────────
    // NOTE: function declarations (not const arrows) so they hoist above the
    // keyboard-shortcuts useEffect that references them in its deps array.
    async function handleRun() {
        if (isRunning) return;
        const runFile = Object.prototype.hasOwnProperty.call(projectFiles, activeFile)
            ? activeFile
            : getFallbackActiveFile(projectFiles, activeFile);
        const code = projectFiles[runFile] || "";
        if (runFile !== activeFile) {
            setActiveFile(runFile);
        }
        runStopRequestedRef.current = false;
        setIsRunning(true);
        setTerminalOutput([]);

        const startTime = performance.now();
        addLog(`▶ Running ${runFile}...`, "info");
        addLog(`────────────────────────────────────────`, "info");

        // Reset stage
        if (skulptRef.current?.callbacks?.actions?.softResetAll) {
            skulptRef.current.callbacks.actions.softResetAll();
        }
        setDebugVars([]);
        setDebugLine(null);

        try {
            // Validate code before execution
            if (!code || code.trim() === '') {
                addLog("⚠ No code to execute. Write some Python code first!", "warning");
                setIsRunning(false);
                return;
            }

            // Check for common syntax issues
            const syntaxWarnings = checkSyntaxWarnings(code);
            if (syntaxWarnings.length > 0) {
                syntaxWarnings.forEach(w => addLog(`⚠ ${w}`, "warning"));
            }

            // Execute the code
            if (window.electronAPI?.isElectron) {
                // Check if Python is available (if the API exists)
                if (window.electronAPI.pythonCheck) {
                    const pythonCheck = await window.electronAPI.pythonCheck();
                    if (!pythonCheck.available) {
                        addLog(`✗ Python is not available: ${pythonCheck.error}`, "error");
                        addLog(`💡 Tip: Install Python from python.org and ensure it's in your system PATH.`, "info");
                        setIsRunning(false);
                        return;
                    }
                }

                setIsWaitingForInput(true);
                setInputPromptText("");
                setTerminalInputValue("");
                setTimeout(() => terminalInputRef.current?.focus(), 80);
                await window.electronAPI.pythonRun(code, projectFiles);
            } else {
                if (!skulptRef.current) {
                    throw new Error("Python engine (Skulpt) not initialized. Try refreshing the page.");
                }
                skulptRef.current.loadProjectFiles(projectFiles);
                await skulptRef.current.runPython(code);
                if (runStopRequestedRef.current) {
                    return;
                }

                const modifiedFiles = skulptRef.current.getModifiedFiles();
                if (Object.keys(modifiedFiles).length > 0) {
                    setProjectFiles(prev => ({ ...prev, ...modifiedFiles }));
                    const fileNames = Object.keys(modifiedFiles).join(', ');
                    addLog(`📁 Files updated: ${fileNames}`, "info");
                }

                const endTime = performance.now();
                const duration = ((endTime - startTime) / 1000).toFixed(3);
                addLog(`────────────────────────────────────────`, "info");
                addLog(`✓ Program finished successfully in ${duration}s`, "success");
            }

        } catch (e) {
            if (runStopRequestedRef.current) {
                return;
            }
            const errorMsg = typeof e === 'string' ? e : e?.message || e?.toString?.() || JSON.stringify(e) || "Unknown error";
            addLog(`────────────────────────────────────────`, "error");
            addLog(`✗ Execution Error:`, "error");
            addLog(formatErrorMessage(errorMsg), "error");

            // Provide helpful suggestions
            const suggestion = getErrorSuggestion(errorMsg);
            if (suggestion) {
                addLog(`💡 Tip: ${suggestion}`, "info");
            }

            // If the IPC call itself failed (process never started), reset state
            if (window.electronAPI?.isElectron) {
                setIsRunning(false);
                try { window.electronAPI.pythonStop(); } catch (_) { /* noop */ }
            }
        } finally {
            if (!window.electronAPI?.isElectron) {
                setIsRunning(false);
                // Clean up any pending input state when execution finishes
                setIsWaitingForInput(false);
                setInputPromptText("");
                setTerminalInputValue("");
                inputResolverRef.current = null;
            }
            runStopRequestedRef.current = false;
        }
    }

    function handleStop() {
        const wasRunning = isRunning || Boolean(inputResolverRef.current);
        if (!wasRunning) return;
        runStopRequestedRef.current = true;
        if (window.electronAPI?.isElectron) {
            window.electronAPI.pythonStop();
        } else {
            skulptRef.current?.stop?.();
        }
        // Cancel any pending input promise to prevent hanging
        if (inputResolverRef.current) {
            inputResolverRef.current("");
            inputResolverRef.current = null;
        }
        setIsWaitingForInput(false);
        setInputPromptText("");
        setTerminalInputValue("");
        setIsRunning(false);
        addLog("⏹ Execution stopped by user.", "warning");
    }

    function handleClear() { setTerminalOutput([]); }

    // ── Terminal Input Submit (for interactive input() prompts) ────────────────
    function handleTerminalInputSubmit() {
        const val = terminalInputValue;
        if (inputResolverRef.current) {
            addLog(val, "input");
            inputResolverRef.current(val);
            inputResolverRef.current = null;
            setIsWaitingForInput(false);
            setInputPromptText("");
            setTerminalInputValue("");
        } else if (window.electronAPI?.isElectron) {
            addLog(val, "input");
            window.electronAPI.pythonSendInput(val);
            setTerminalInputValue("");
        }
    }

    function handleTerminalInputKey(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleTerminalInputSubmit();
        }
    }

    // ── Syntax Warning Checker ────────────────────────────────────────────────
    const checkSyntaxWarnings = (code) => {
        const warnings = [];
        const lines = code.split('\n');

        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();

            // Check for common issues
            if (trimmed.includes('print ') && !trimmed.includes('print(') && !trimmed.startsWith('#')) {
                // Python 2 style print - Skulpt might handle this but warn
            }

            // Check for unmatched parentheses
            const openParens = (line.match(/\(/g) || []).length;
            const closeParens = (line.match(/\)/g) || []).length;
            if (openParens !== closeParens && !trimmed.endsWith(':') && !trimmed.startsWith('#')) {
                // Could be multi-line, so just note it
            }

            // Check for assignment in condition
            if (trimmed.match(/if\s+\w+\s*=\s*[^=]/)) {
                warnings.push(`Line ${lineNum}: Did you mean '==' instead of '=' in condition?`);
            }
        });

        return warnings;
    };

    // ── Error Message Formatter ───────────────────────────────────────────────
    const formatErrorMessage = (msg) => {
        // Clean up Skulpt error messages
        let formatted = msg
            .replace(/ParseError/g, 'Syntax Error')
            .replace(/NameError/g, 'Name Error')
            .replace(/TypeError/g, 'Type Error')
            .replace(/ValueError/g, 'Value Error')
            .replace(/AttributeError/g, 'Attribute Error')
            .replace(/ImportError/g, 'Import Error')
            .replace(/IndentationError/g, 'Indentation Error');

        // Add line number highlighting
        formatted = formatted.replace(/line (\d+)/gi, 'Line $1');

        return formatted;
    };

    // ── Error Suggestion Helper ───────────────────────────────────────────────
    const getErrorSuggestion = (errorMsg) => {
        const msg = errorMsg.toLowerCase();

        if (msg.includes('nameerror') || msg.includes('not defined')) {
            return "Check if the variable or function name is spelled correctly and defined before use.";
        }
        if (msg.includes('syntaxerror') || msg.includes('parseerror')) {
            return "Check for missing colons (:), parentheses, or quotes in your code.";
        }
        if (msg.includes('typeerror')) {
            return "Check if you're using the correct data types in your operation.";
        }
        if (msg.includes('indentationerror')) {
            return "Make sure your code indentation is consistent (use 4 spaces).";
        }
        if (msg.includes('attributeerror')) {
            return "Check if the object has the method or attribute you're trying to use.";
        }
        if (msg.includes('importerror') || msg.includes('module not found')) {
            if (msg.includes('numpy') || msg.includes('pandas') || msg.includes('matplotlib') || msg.includes('tensorflow') || msg.includes('torch') || msg.includes('opencv') || msg.includes('mediapipe') || msg.includes('sklearn') || msg.includes('pillow') || msg.includes('pygame')) {
                return "This package is not available in web Skulpt mode because it depends on native Python extensions. Use desktop Python mode or replace it with a supported built-in module.";
            }
            return "The module might not be available in Skulpt. Try using built-in modules like math, random, or time.";
        }
        if (msg.includes('timeout') || msg.includes('too long')) {
            return "Your code might have an infinite loop. Check your while/for loops.";
        }

        return null;
    };

    // ── REPL ──────────────────────────────────────────────────────────────────
    const handleReplSubmit = async () => {
        const line = replInput.trim();
        if (!line) return;

        // If waiting for input from a running program, route REPL text as the input response
        if (isWaitingForInput) {
            setReplInput("");
            addLog(line, "input");
            if (window.electronAPI?.isElectron) {
                window.electronAPI.pythonSendInput(line);
            } else if (inputResolverRef.current) {
                inputResolverRef.current(line);
                inputResolverRef.current = null;
                setIsWaitingForInput(false);
                setInputPromptText("");
                setTerminalInputValue("");
            }
            setActivePanel("terminal");
            return;
        }

        const newHist = [line, ...replHistory].slice(0, 50);
        setReplHistory(newHist);
        setReplHistIdx(-1);
        setReplInput("");

        addLog(`>>> ${line}`, "repl-in");

        try {
            if (window.electronAPI?.isElectron) {
                await window.electronAPI.pythonReplSend(line);
            } else {
                const startTime = performance.now();
                await skulptRef.current.runRepl(line);
                const endTime = performance.now();
                const duration = ((endTime - startTime) / 1000).toFixed(3);

                // Show execution time for REPL if > 100ms
                if (endTime - startTime > 100) {
                    addLog(`⏱ Executed in ${duration}s`, "info");
                }
            }
        } catch (e) {
            // Error already output via onErr
            const suggestion = getErrorSuggestion(e?.message || e);
            if (suggestion) {
                addLog(`💡 ${suggestion}`, "info");
            }
        }
        setActivePanel("terminal"); // Show output
    };

    const handleReplKey = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleReplSubmit();
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            const idx = Math.min(replHistIdx + 1, replHistory.length - 1);
            setReplHistIdx(idx);
            setReplInput(replHistory[idx] || "");
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const idx = Math.max(replHistIdx - 1, -1);
            setReplHistIdx(idx);
            setReplInput(idx === -1 ? "" : replHistory[idx]);
        }
        // Tab for autocomplete hint
        if (e.key === "Tab") {
            e.preventDefault();
            // Simple autocomplete for common commands
            const input = replInput.trim();
            const suggestions = {
                'pr': 'print()',
                'sp': 'sprite = Sprite("")',
                'im': 'import ',
                'fo': 'for i in range():',
                'wh': 'while :',
                'de': 'def ():',
                'cl': 'class :',
                'if': 'if :',
                'el': 'else:',
                'ei': 'elif :',
            };
            for (const [prefix, completion] of Object.entries(suggestions)) {
                if (input.startsWith(prefix)) {
                    setReplInput(completion);
                    break;
                }
            }
        }
    };

    // ── Shell Handlers ──────────────────────────────────────────────────────
    const handleShellSubmit = () => {
        const cmd = shellInput.trim();
        if (!cmd) return;
        addLog(`$ ${cmd}`, "repl-in");
        setShellHistory(prev => [...prev, cmd]);
        setShellHistoryIndex(-1);
        if (window.electronAPI?.isElectron) {
            window.electronAPI.pythonShellRun(cmd);
        }
        setShellInput("");
    };

    const handleShellKey = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleShellSubmit();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (shellHistory.length > 0) {
                const newIndex = shellHistoryIndex < shellHistory.length - 1 ? shellHistoryIndex + 1 : shellHistoryIndex;
                setShellHistoryIndex(newIndex);
                setShellInput(shellHistory[shellHistory.length - 1 - newIndex] || "");
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (shellHistory.length > 0) {
                const newIndex = shellHistoryIndex > 0 ? shellHistoryIndex - 1 : -1;
                setShellHistoryIndex(newIndex);
                setShellInput(newIndex >= 0 ? shellHistory[shellHistory.length - 1 - newIndex] : "");
            }
        }
    };

    // ── Modal Handlers ────────────────────────────────────────────────────────

    // ── File Management ────────────────────────────────────────────────────────
    const handleDeleteFile = (file) => {
        if (Object.keys(projectFiles).length <= 1) return;
        if (!confirm(`Delete ${file}?`)) return;
        setProjectFiles(prev => {
            const next = { ...prev };
            delete next[file];
            return next;
        });
        if (activeFile === file) setActiveFile(Object.keys(projectFiles).find(f => f !== file));
    };

    const openFilePicker = (accept, onSelect, options = {}) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.multiple = Boolean(options.multiple);
        if (options.capture) {
            input.setAttribute("capture", options.capture);
        }
        input.onchange = (event) => {
            const files = Array.from(event.target.files || []);
            if (!files.length) return;
            onSelect(options.multiple ? files : files[0]);
        };
        input.click();
    };

    const readTextFile = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(String(event.target?.result || ""));
            reader.onerror = () => reject(reader.error || new Error(`Unable to read ${file.name}`));
            reader.readAsText(file);
        });

    const addPreparedFilesToProject = (preparedFiles, successLabel) => {
        if (!preparedFiles.length) return;

        const importedNames = [];
        setProjectFiles((prev) => {
            const next = { ...prev };
            preparedFiles.forEach(({ name, content }) => {
                const nextFileName = getUniqueFileName(name, next);
                next[nextFileName] = content;
                importedNames.push(nextFileName);
            });
            return next;
        });

        const lastImported = importedNames[importedNames.length - 1];
        if (lastImported) {
            setActiveFile(lastImported);
        }
        setSidePanel("files");
        addLog(
            `${successLabel}: ${importedNames.join(", ")}`,
            "success"
        );
    };

    const importTextFiles = (accept, successLabel) => {
        openFilePicker(accept, async (files) => {
            try {
                const preparedFiles = await Promise.all(
                    files.map(async (file) => ({
                        name: file.name,
                        content: await readTextFile(file),
                    }))
                );

                addPreparedFilesToProject(preparedFiles, successLabel);
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to import selected files.";
                addLog(message, "error");
            }
        }, { multiple: true });
    };

    const importAssetFiles = (accept, kind, successLabel) => {
        openFilePicker(accept, (files) => {
            const preparedFiles = files.map((file) => ({
                name: file.name,
                content: buildAssetPlaceholder(file, kind),
            }));

            addPreparedFilesToProject(preparedFiles, successLabel);
        }, { multiple: true });
    };

    const handleCreateNewFile = () => {
        let baseName = "new_file";
        let ext = ".py";
        let fileName = `${baseName}${ext}`;
        let counter = 1;
        while (projectFiles[fileName]) {
            fileName = `${baseName}${counter}${ext}`;
            counter++;
        }
        setProjectFiles((prev) => ({
            ...prev,
            [fileName]: "",
        }));
        setActiveFile(fileName);
        addLog(`Created new file: ${fileName}`, "success");
    };

    const handleCreateNewTextFile = () => {
        let baseName = "new_file";
        let ext = ".txt";
        let fileName = `${baseName}${ext}`;
        let counter = 1;
        while (projectFiles[fileName]) {
            fileName = `${baseName}${counter}${ext}`;
            counter++;
        }
        setProjectFiles((prev) => ({
            ...prev,
            [fileName]: "",
        }));
        setActiveFile(fileName);
        addLog(`Created new text file: ${fileName}`, "success");
    };

    const handleRenameFile = (oldName, newName) => {
        if (!newName || newName === oldName) return;
        if (projectFiles[newName]) {
            alert(`A file named "${newName}" already exists.`);
            return;
        }
        setProjectFiles((prev) => {
            const entries = Object.entries(prev);
            const next = {};
            entries.forEach(([name, content]) => {
                if (name === oldName) {
                    next[newName] = content;
                } else {
                    next[name] = content;
                }
            });
            return next;
        });
        if (activeFile === oldName) {
            setActiveFile(newName);
        }
        addLog(`Renamed ${oldName} to ${newName}`, "success");
    };

    const handleAddPythonFiles = () => {
        importTextFiles(".py", "Added python file");
    };

    const handleAddImageFiles = () => {
        importAssetFiles("image/*", "image", "Added image file");
    };

    const handleAddTextFiles = () => {
        importTextFiles(".txt,text/plain,.md,.json", "Added text file");
    };

    const handleAddCsvFiles = () => {
        importTextFiles(".csv,text/csv", "Added CSV file");
    };

    const addPreparedFilesToUploadProject = (preparedFiles, successLabel, nextView = "project") => {
        if (!preparedFiles.length) return;

        const importedNames = [];
        setUploadProjectFiles((prev) => {
            const next = { ...prev };
            preparedFiles.forEach(({ name, content }) => {
                const nextFileName = getUniqueFileName(name, next);
                next[nextFileName] = content;
                importedNames.push(nextFileName);
            });
            return next;
        });

        const lastImported = importedNames[importedNames.length - 1];
        if (lastImported) {
            setUploadView(nextView);
            setUploadActiveFile(lastImported);
        }

        addUploadMessage(`${successLabel}: ${importedNames.join(", ")}`, "success");
    };

    const handleCreateUploadPythonFile = () => {
        openTextPrompt(
            "New MicroPython File",
            "Enter a file name for the new MicroPython file.",
            "module.py",
            (requestedName) => {
                let createdFileName = "";

                setUploadProjectFiles((prev) => {
                    createdFileName = getUniqueFileName(requestedName, prev);
                    return {
                        ...prev,
                        [createdFileName]: `# ${createdFileName}\n\n`,
                    };
                });

                if (createdFileName) {
                    setUploadView("project");
                    setUploadActiveFile(createdFileName);
                    addUploadMessage(`Created ${createdFileName}`, "success");
                }
            }
        );
    };

    const handleAddUploadPythonFile = () => {
        openFilePicker(".py,.mpy", async (files) => {
            try {
                const selectedFiles = Array.isArray(files) ? files : [files];
                const preparedFiles = await Promise.all(
                    selectedFiles.map(async (file) => ({
                        name: file.name,
                        content: await readTextFile(file),
                    }))
                );

                addPreparedFilesToUploadProject(preparedFiles, "Imported MicroPython file", "project");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to import MicroPython files.";
                addUploadMessage(message, "error");
            }
        }, { multiple: true });
    };

    const handleCreateUploadLibrary = () => {
        openTextPrompt(
            "Add New Library",
            "Enter the library name. LeapBlocks will create matching .h and .cpp files.",
            "my_library",
            (requestedName) => {
                let headerFileName = "";

                setUploadProjectFiles((prev) => {
                    const uniqueBaseName = getUniqueLibraryBaseName(requestedName, prev);
                    const headerFile = buildLibraryHeaderTemplate(uniqueBaseName);
                    const cppFile = buildLibraryCppTemplate(uniqueBaseName);
                    headerFileName = headerFile.fileName;

                    return {
                        ...prev,
                        [headerFile.fileName]: headerFile.content,
                        [cppFile.fileName]: cppFile.content,
                    };
                });

                setUploadView("board");
                setUploadActiveFile(headerFileName || `${getLibraryBaseName(requestedName)}.h`);
                addUploadMessage("Created library files", "success");
            }
        );
    };

    const handleUploadHeaderFile = () => {
        openFilePicker(".h,.hpp", async (files) => {
            try {
                const selectedFiles = Array.isArray(files) ? files : [files];
                const preparedFiles = await Promise.all(
                    selectedFiles.map(async (file) => ({
                        name: file.name,
                        content: await readTextFile(file),
                    }))
                );
                addPreparedFilesToUploadProject(preparedFiles, "Imported header file", "board");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to import header files.";
                addUploadMessage(message, "error");
            }
        }, { multiple: true });
    };

    const handleUploadCppFile = () => {
        openFilePicker(".cpp,.cc,.c,.ino", async (files) => {
            try {
                const selectedFiles = Array.isArray(files) ? files : [files];
                const preparedFiles = await Promise.all(
                    selectedFiles.map(async (file) => ({
                        name: file.name,
                        content: await readTextFile(file),
                    }))
                );
                addPreparedFilesToUploadProject(preparedFiles, "Imported C++ file", "board");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to import C++ files.";
                addUploadMessage(message, "error");
            }
        }, { multiple: true });
    };

    const handleImportCppLibrary = () => {
        openTextPrompt(
            "Import C++ Library",
            'Enter a library header like Wire.h, <Servo.h>, or "MyLibrary.h".',
            "Wire.h",
            (requestedLibrary) => {
                const includeLine = normalizeCppInclude(requestedLibrary);
                const currentSource = uploadProjectFiles[activeBoardFile] || buildBoardTemplate(selectedBoard);
                const nextSource = insertIncludeLineIntoSource(currentSource, includeLine);

                setUploadProjectFiles((prev) => {
                    const previousSource = prev[activeBoardFile] || buildBoardTemplate(selectedBoard);
                    const updatedSource = insertIncludeLineIntoSource(previousSource, includeLine);

                    if (updatedSource === previousSource) {
                        return prev;
                    }

                    return {
                        ...prev,
                        [activeBoardFile]: updatedSource,
                    };
                });
                setUploadView("board");
                setUploadActiveFile(activeBoardFile);

                if (nextSource === currentSource) {
                    addUploadMessage(`${includeLine} is already included in ${activeBoardFile}.`, "info");
                    return;
                }

                addUploadMessage(`Imported C++ library into ${activeBoardFile}: ${includeLine}`, "success");
            }
        );
    };

    const handleReplaceBoardFirmware = () => {
        openFilePicker(".ino,.cpp,.c,.h,.hpp", async (file) => {
            try {
                const content = await readTextFile(file);
                setUploadProjectFiles((prev) => ({
                    ...prev,
                    [activeBoardFile]: content,
                }));
                setUploadView("board");
                setUploadActiveFile(activeBoardFile);
                addUploadMessage(`Imported board firmware into ${activeBoardFile}`, "success");
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unable to import board firmware.";
                addUploadMessage(message, "error");
            }
        });
    };

    const handleDeleteUploadFile = (file) => {
        if (protectedUploadFiles.has(file)) {
            addUploadMessage(`${file} is required in upload mode and cannot be deleted.`, "warning");
            return;
        }

        if (!window.confirm(`Delete ${file}?`)) return;

        setUploadProjectFiles((prev) => {
            const next = { ...prev };
            delete next[file];
            return next;
        });
        setUploadActiveFile("main.py");
        addUploadMessage(`Deleted ${file}`, "warning");
    };

    const boardCppActions = [
        {
            label: "Upload a header file",
            description: "Import .h or .hpp files into the board workspace.",
            icon: FileText,
            onClick: handleUploadHeaderFile,
        },
        {
            label: "Upload a new cpp file",
            description: "Add .cpp, .cc, .c, or .ino source files.",
            icon: FileUp,
            onClick: handleUploadCppFile,
        },
        {
            label: "Import C++ library",
            description: "Insert a #include statement into the main board file.",
            icon: LibraryBig,
            onClick: handleImportCppLibrary,
        },
    ];

    const handleUndoEditor = () => {
        editorRef.current?.trigger("python-upload-mode", "undo", null);
    };

    const handleRedoEditor = () => {
        editorRef.current?.trigger("python-upload-mode", "redo", null);
    };

    // ── PIP ───────────────────────────────────────────────────────────────────
    // ── PIP Package Installation ──────────────────────────────────────────────
    const handleInstall = (pkgName) => {
        const pkg = getPipPackages().find(p => p.name === pkgName);
        if (!pkg) return;

        // Mark package as installed
        setPackages(prev => prev.map(p => p.name === pkgName ? { ...p, installed: true } : p));

        // Provide appropriate feedback based on package type
        if (pkg.builtin) {
            addLog(`✓ ${pkgName} enabled (built-in module)`, "success");
            addLog(`  → Ready to import in your Python scripts`, "info");
        } else {
            addLog(`⏳ Installing ${pkgName} via pip...`, "info");
            setActivePanel("terminal");
            if (window.electronAPI?.isElectron) {
                window.electronAPI.pythonPipInstall(pkgName);
            } else {
                // Web mode: simulate install with feedback
                setTimeout(() => {
                    addLog(`✓ ${pkgName} registered (web mode)`, "success");
                    addLog(`  ⚠ Browser mode uses Skulpt — only built-in modules run natively.`, "warning");
                    addLog(`  → For full library support, use the LeapLab desktop app.`, "info");
                }, 600);
            }

            // Add helpful import examples for popular libraries
            const importExamples = {
                "opencv-python": "import cv2  # OpenCV",
                "mediapipe": "import mediapipe as mp  # MediaPipe",
                "numpy": "import numpy as np  # NumPy",
                "pandas": "import pandas as pd  # Pandas",
                "pillow": "from PIL import Image  # Pillow",
                "tensorflow": "import tensorflow as tf  # TensorFlow",
                "torch": "import torch  # PyTorch",
                "scikit-learn": "from sklearn import *  # Scikit-learn",
                "matplotlib": "import matplotlib.pyplot as plt  # Matplotlib",
                "speechrecognition": "import speech_recognition as sr  # Speech Recognition",
                "pyttsx3": "import pyttsx3  # Text-to-Speech",
                "requests": "import requests  # HTTP requests",
                "flask": "from flask import Flask  # Flask web framework",
                "pyserial": "import serial  # Serial communication",
                "pygame": "import pygame  # Pygame",
            };

            if (importExamples[pkgName]) {
                addLog(`  → Use: ${importExamples[pkgName]}`, "info");
            }

            addLog(`  ⚠ Browser mode uses Skulpt — only built-in modules run natively.`, "warning");
            if (!pkg.builtin) {
                addLog(`  ❗ ${pkgName} cannot actually be imported in browser mode due to missing native Python extension support. Use desktop Python mode for full support.`, "warning");
            }

            // Add category-specific tips
            if (pkg.category === "computer-vision") {
                addLog(`  → Tip: Requires camera access for real-time processing`, "info");
            } else if (pkg.category === "speech") {
                addLog(`  → Tip: Requires microphone access for audio input`, "info");
            } else if (pkg.category === "iot") {
                addLog(`  → Tip: Connect your hardware device before use`, "info");
            }
        }
    };


    // Sprite Library - add from library
    const addSpriteFromLibrary = (sp) => {
        const id = sp.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
        // Handle both formats: sp.img (old) or sp.image/sp.costumes (new from shared catalog)
        const spriteImage = sp.img || sp.image || sp.emoji || 'assets/sprites/robot/robot_idle.svg';
        const spriteCostumes = sp.costumes && sp.costumes.length > 0
            ? sp.costumes.reduce((acc, c, i) => ({ ...acc, [`costume_${i}`]: c }), { default: spriteImage })
            : { default: spriteImage };
        const newSprite = {
            id,
            name: sp.name,
            type: sp.type || 'sprite',
            position: { x: (Math.random() - 0.5) * 80, y: (Math.random() - 0.5) * 80 },
            direction: 0,
            size: 100,
            visible: true,
            speech: '',
            currentCostume: 'default',
            costumes: spriteCostumes,
            mirrored: false
        };
        setSprites(prev => [...prev, newSprite]);
        setSelectedSpriteId(id);
        const fname = sp.name.replace(/\s+/g, '_') + '.py';
        setProjectFiles(prev => prev[fname] ? prev : { ...prev, [fname]: `# ${sp.name} sprite\n${sp.name.toLowerCase().replace(/\s+/g, '_')} = Sprite('${sp.name}')\n${sp.name.toLowerCase().replace(/\s+/g, '_')}.say('Hi! I am ${sp.name}')\n${sp.name.toLowerCase().replace(/\s+/g, '_')}.move(50)\n` });
        setActiveFile(fname);
        addLog('Added sprite: ' + sp.name, 'success');
        setSidePanel('files');
    };
    // Backdrop
    const handleSetBackdrop = (bd) => {
        setBackdropImg(bd.img || null);
        addLog('Backdrop: ' + bd.name, 'success');
        setSidePanel('files');
    };

    // Extension install
    const installExtension = (ext) => {
        if (installedExtensions.find(e => e.id === ext.id)) { addLog(ext.name + ' already installed', 'info'); return; }
        setInstalledExtensions(prev => [...prev, ext]);
        const snippet = "\n" + ext.code + "\n";
        setProjectFiles(prev => ({ ...prev, [activeFile]: (prev[activeFile] || '') + snippet }));
        addLog('Extension added: ' + ext.name, 'success');
    };

    useEffect(() => {
        setUploadProjectFiles((prev) => {
            if (prev[activeBoardFile]) return prev;
            return {
                ...prev,
                [activeBoardFile]: buildBoardTemplate(selectedBoard),
            };
        });
    }, [activeBoardFile, selectedBoard]);

    useEffect(() => {
        if (uploadView === "board") {
            if (!uploadProjectFiles[uploadActiveFile] || !isBoardUploadFile(uploadActiveFile, activeBoardFile)) {
                setUploadActiveFile(activeBoardFile);
            }
            return;
        }

        setShowBoardCppMenu(false);

        if (
            uploadActiveFile === activeBoardFile ||
            !uploadProjectFiles[uploadActiveFile] ||
            isBoardUploadFile(uploadActiveFile, activeBoardFile)
        ) {
            setUploadActiveFile("main.py");
        }
    }, [uploadView, activeBoardFile, uploadActiveFile, uploadProjectFiles]);

    useEffect(() => {
        if (workflowMode !== "upload" || uploadView !== "board" || !showBoardCppMenu) {
            return undefined;
        }

        const handlePointerDown = (event) => {
            if (!boardCppMenuRef.current?.contains(event.target)) {
                setShowBoardCppMenu(false);
            }
        };

        window.addEventListener("mousedown", handlePointerDown);
        return () => window.removeEventListener("mousedown", handlePointerDown);
    }, [showBoardCppMenu, uploadView, workflowMode]);

    useEffect(() => {
        if (workflowMode !== "upload" && showBoardCppMenu) {
            setShowBoardCppMenu(false);
        }
    }, [showBoardCppMenu, workflowMode]);

    useEffect(() => {
        if (!window.electronAPI) return undefined;

        window.electronAPI.onSerialData((data) => {
            setSerialMessages((prev) => [...prev, data]);
        });

        window.electronAPI.onConnectionChange((connected) => {
            setIsConnected(connected);
            addUploadMessage(connected ? "Board connection opened." : "Board connection closed.", connected ? "success" : "warning");
        });

        window.electronAPI.onUploadProgress((progress, message) => {
            const nextMessage = `${progress}%: ${message}`;
            setUploadProgressMessage(nextMessage);
            setUploadTerminalOutput((prev) => {
                if (prev[prev.length - 1]?.text === nextMessage) {
                    return prev;
                }
                return [...prev, { text: nextMessage, type: "info", ts: new Date() }];
            });
        });

        return () => {
            window.electronAPI?.removeAllListeners?.();
        };
    }, [addUploadMessage]);

    const refreshPorts = useCallback(async () => {
        if (!window.electronAPI?.getPorts) {
            if (isWebSerialSupported()) {
                try {
                    const nextPorts = await webListPorts();
                    setPorts(nextPorts.map((p, i) => ({ path: p.path, manufacturer: p.manufacturer || `Web Serial port ${i + 1}` })));
                    return;
                } catch {
                    addUploadMessage("Unable to scan Web Serial ports.", "error");
                    return;
                }
            }
            addUploadMessage("Serial support is unavailable in this renderer.", "warning");
            return;
        }

        try {
            const nextPorts = await window.electronAPI.getPorts();
            setPorts(nextPorts || []);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to scan serial ports.";
            addUploadMessage(message, "error");
        }
    }, [addUploadMessage]);

    useEffect(() => {
        if (workflowMode !== "upload") return undefined;

        refreshPorts();

        const timer = window.setInterval(() => {
            if (!selectedPort && !isConnected) {
                refreshPorts();
            }
        }, 5000);

        return () => window.clearInterval(timer);
    }, [workflowMode, selectedPort, isConnected, refreshPorts]);

    const handleConnectToBoard = useCallback(async () => {
        if (!window.electronAPI) {
            if (!isWebSerialSupported()) {
                addUploadMessage("Serial support is unavailable in this renderer.", "warning");
                return;
            }

            if (isConnected) {
                setIsConnected(false);
                addUploadMessage("Board disconnected from Web Serial.", "warning");
                return;
            }

            try {
                const picked = await webRequestPort();
                if (picked?.port) {
                    setSelectedPort(picked.path);
                    setPorts((prev) => {
                        const next = prev.filter((p) => p.path !== picked.path);
                        return [{ path: picked.path, manufacturer: picked.manufacturer || "Web Serial device" }, ...next];
                    });
                    setIsConnected(true);
                    addUploadMessage("Board connected via Web Serial. Ready to upload.", "success");
                    refreshPorts();
                } else {
                    addUploadMessage("No board selected.", "warning");
                }
            } catch {
                addUploadMessage("Unable to connect via Web Serial.", "error");
            }
            return;
        }

        if (isConnected) {
            const disconnectResult = await window.electronAPI.disconnectPort();
            if (disconnectResult?.success) {
                setIsConnected(false);
                addUploadMessage(`Disconnected from ${selectedPort || "board"}.`, "warning");
            } else {
                addUploadMessage(disconnectResult?.error || "Unable to disconnect from the current board.", "error");
            }
            return;
        }

        if (!selectedPort) {
            addUploadMessage("Select a COM port before connecting.", "warning");
            return;
        }

        if (selectedPort === "BRIDGE_DETECTED") {
            addUploadMessage("A USB bridge was detected without a usable COM port. Install the required driver first.", "error");
            return;
        }

        const connectResult = await window.electronAPI.connectPort(selectedPort, baudRate, selectedBoard);
        if (connectResult?.success) {
            setIsConnected(true);
            addUploadMessage(`Connected to ${selectedPort}.`, "success");
        } else {
            addUploadMessage(connectResult?.error || "Unable to connect to the selected port.", "error");
        }
    }, [addUploadMessage, baudRate, isConnected, refreshPorts, selectedBoard, selectedPort]);

    const handleSendSerial = useCallback(async (message) => {
        if (!window.electronAPI?.sendSerial) {
            addUploadMessage("Serial support is unavailable in this renderer.", "warning");
            return;
        }

        try {
            await window.electronAPI.sendSerial(message);
            setSerialMessages((prev) => [...prev, `> ${message}`]);
        } catch (error) {
            const nextMessage = error instanceof Error ? error.message : "Unable to send serial data.";
            addUploadMessage(nextMessage, "error");
        }
    }, [addUploadMessage]);

    const handleUploadFirmware = useCallback(async () => {
        if (!window.electronAPI?.uploadCode) {
            // ── Web Serial upload path (no Electron) ──
            if (!isWebSerialSupported()) {
                addUploadMessage("Upload requires LeapBlocks Desktop, or Chrome/Edge with Web Serial.", "warning");
                return;
            }

            const boardCode = uploadProjectFiles[activeBoardFile] || "";
            if (!boardCode.trim()) {
                addUploadMessage(`No board firmware found in ${activeBoardFile}.`, "warning");
                return;
            }

            setUploadPanelTab("terminal");
            setIsUploadingFirmware(true);
            setUploadProgressMessage(`Preparing ${activeBoardFile}...`);
            addUploadMessage(`Uploading ${activeBoardFile} to ${selectedBoardName} via Web Serial.`, "info");

            try {
                const result = await uploadToBoard({
                    code: boardCode,
                    fqbn: selectedBoardConfig.fqbn,
                    onProgress: (progress, message) => {
                        const nextMessage = `${progress}%: ${message}`;
                        setUploadProgressMessage(nextMessage);
                        addUploadMessage(nextMessage, "info");
                    },
                    onLog: (message) => addUploadMessage(message, "info"),
                });

                if (result?.success) {
                    setUploadProgressMessage("Upload complete.");
                    addUploadMessage(`Upload complete for ${selectedBoardName}.`, "success");
                } else {
                    const message = result?.error || "Upload failed.";
                    setUploadProgressMessage(message);
                    addUploadMessage(message, "error");
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unexpected upload failure.";
                setUploadProgressMessage(message);
                addUploadMessage(message, "error");
            } finally {
                setIsUploadingFirmware(false);
            }
            return;
        }

        if (!selectedPort) {
            addUploadMessage("Select a COM port before uploading.", "warning");
            return;
        }

        const boardCode = uploadProjectFiles[activeBoardFile] || "";
        if (!boardCode.trim()) {
            addUploadMessage(`No board firmware found in ${activeBoardFile}.`, "warning");
            return;
        }

        setUploadPanelTab("terminal");
        setIsUploadingFirmware(true);
        setUploadProgressMessage(`Preparing ${activeBoardFile}...`);
        addUploadMessage(`Uploading ${activeBoardFile} to ${selectedBoardName} on ${selectedPort}.`, "info");

        const shouldReconnect = isConnected;

        try {
            if (shouldReconnect) {
                await window.electronAPI.disconnectPort();
                setIsConnected(false);
            }

            const result = await window.electronAPI.uploadCode(
                boardCode,
                selectedPort,
                selectedBoardConfig.fqbn
            );

            if (result?.success) {
                setUploadProgressMessage("Upload complete.");
                addUploadMessage(`Upload complete for ${selectedBoardName}.`, "success");
            } else {
                const message = result?.error || "Upload failed.";
                setUploadProgressMessage(message);
                addUploadMessage(message, "error");
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unexpected upload failure.";
            setUploadProgressMessage(message);
            addUploadMessage(message, "error");
        } finally {
            if (shouldReconnect && selectedPort) {
                const reconnectResult = await window.electronAPI.connectPort(selectedPort, baudRate, selectedBoard);
                if (reconnectResult?.success) {
                    setIsConnected(true);
                    addUploadMessage(`Reconnected to ${selectedPort}.`, "success");
                }
            }
            setIsUploadingFirmware(false);
        }
    }, [activeBoardFile, addUploadMessage, baudRate, isConnected, selectedBoard, selectedBoardConfig.fqbn, selectedBoardName, selectedPort, uploadProjectFiles]);

    const handleWorkflowModeChange = (nextMode) => {
        if (nextMode === workflowMode) return;
        setWorkflowMode(nextMode);
        const modeLabels = { stage: "Stage", upload: "Upload", ide: "IDE" };
        addUploadMessage(`Switched to ${modeLabels[nextMode] || nextMode} mode.`, "info");
    };

    const handleUploadViewChange = (nextView) => {
        setUploadView(nextView);
        if (nextView === "board") {
            setUploadActiveFile(activeBoardFile);
        } else if (!visibleUploadFiles.includes(uploadActiveFile)) {
            setUploadActiveFile("main.py");
        }
    };

    const renderUploadOutput = () => {
        if (uploadPanelTab === "serial") {
            return (
                <SerialMonitor
                    baudRate={baudRate}
                    setBaudRate={setBaudRate}
                    lineEnding={lineEnding}
                    setLineEnding={setLineEnding}
                    messages={serialMessages}
                    setMessages={setSerialMessages}
                    onSendMessage={handleSendSerial}
                    isConnected={isConnected}
                />
            );
        }

        const lines = uploadPanelTab === "log"
            ? uploadLogMessages.map((text) => ({ text, type: "info" }))
            : uploadTerminalOutput;

        return (
            <div className="flex-1 overflow-y-auto bg-white px-3.5 py-3 text-xs leading-[1.55]" style={{ fontFamily: "'Cascadia Code', Consolas, monospace" }}>
                {lines.map((entry, index) => {
                    const type = entry.type || "info";
                    const color = type === "error"
                        ? "#D14343"
                        : type === "success"
                            ? "#2E7D32"
                            : type === "warning"
                                ? "#A56A00"
                                : "#4B5563";

                    return (
                        <div key={`${entry.text}-${index}`} style={{ color, marginBottom: 6 }}>
                            {entry.text}
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderUploadWorkspace = () => (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 flex min-h-0">
                <aside className="w-[278px] border-r border-gray-200 bg-[#F7F7FB] flex flex-col min-w-0 relative">
                    <div className="p-3 border-b border-gray-200 flex items-center justify-between gap-2">
                        <div>
                            <div className="text-xs font-bold text-gray-800 tracking-wide">
                                Project Files
                            </div>
                            <div className="text-[10px] text-gray-500 mt-0.5">
                                {uploadView === "board"
                                    ? "Main sketch, library headers, and C++ source files."
                                    : "Click a file, then type in the center editor."}
                            </div>
                        </div>
                        <div className="flex gap-1.5">
                            <button
                                onClick={uploadView === "board" ? handleCreateUploadLibrary : handleCreateUploadPythonFile}
                                className="border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors"
                            >
                                {uploadView === "board" ? "New Library" : "New .py"}
                            </button>
                            <button
                                onClick={uploadView === "board" ? handleReplaceBoardFirmware : handleAddUploadPythonFile}
                                className="border-none bg-[#8B5CF6] hover:bg-purple-700 text-white rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors"
                            >
                                {uploadView === "board" ? "Import Main" : "Import .py"}
                            </button>
                        </div>
                    </div>

                    <div className={`flex-1 overflow-y-auto ${uploadView === "board" ? "py-2 pb-[132px]" : "py-2"}`}>
                        {visibleUploadFiles.map((file) => {
                            const isBoardSource = file === activeBoardFile;
                            const isSelected = uploadActiveFile === file;
                            const fileExtension = getFileExtension(file);
                            const fileCategoryLabel = isBoardSource
                                ? selectedBoardName
                                : BOARD_HEADER_EXTENSIONS.has(fileExtension)
                                    ? "Header library"
                                    : BOARD_SOURCE_EXTENSIONS.has(fileExtension)
                                        ? "C++ source"
                                        : "MicroPython project";
                            return (
                                <div
                                    key={file}
                                    onClick={() => setUploadActiveFile(file)}
                                    className={`p-2.5 cursor-pointer flex items-center justify-between gap-2 transition-colors ${isSelected ? 'border-l-[3px] border-[#8B5CF6] bg-[#EFE8FF]' : 'border-l-[3px] border-transparent hover:bg-gray-100'
                                        }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${isBoardSource ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                                            }`}>
                                            {isBoardSource ? <FileCode2 size={13} /> : <FileText size={13} />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold text-gray-800 truncate">
                                                {file}
                                            </div>
                                            <div className="text-[10px] text-gray-500">
                                                {fileCategoryLabel}
                                            </div>
                                        </div>
                                    </div>
                                    {!protectedUploadFiles.has(file) && (
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleDeleteUploadFile(file);
                                            }}
                                            className="border-none bg-transparent text-gray-500 hover:text-red-600 cursor-pointer p-0.5 transition-colors"
                                            title="Delete file"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="border-t border-gray-200 p-3 bg-[#FAFAFC] grid gap-2.5">
                        <div className="border border-gray-200 rounded-lg bg-white p-2.5">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Cpu size={14} color={C.PURPLE} />
                                <span className="text-[11px] font-bold text-gray-800">Board</span>
                            </div>
                            <div className="text-xs font-semibold text-gray-800">{selectedBoardName}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">{activeBoardFile}</div>
                        </div>
                        <div className="border border-gray-200 rounded-lg bg-white p-2.5">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Plug size={14} color={isConnected ? C.GREEN : C.MUTED} />
                                <span className="text-[11px] font-bold text-gray-800">Connection</span>
                            </div>
                            <div className="text-xs font-semibold text-gray-800">
                                {selectedPort ? formatPortLabel(ports.find((port) => port.path === selectedPort) || { path: selectedPort }) : "No port selected"}
                            </div>
                            <div className={`text-[11px] mt-0.5 ${isConnected ? 'text-emerald-600' : 'text-gray-500'}`}>
                                {isConnected ? "Connected" : "Disconnected"}
                            </div>
                        </div>
                    </div>

                    {uploadView === "board" && (
                        <div className="absolute left-3 bottom-3 z-10" ref={boardCppMenuRef}>
                            {showBoardCppMenu && (
                                <div className="absolute left-0 bottom-[72px] w-[236px] grid gap-2 p-2.5 rounded-2xl border border-purple-600/16 bg-white/98 shadow-2xl backdrop-blur-md z-10">
                                    {boardCppActions.map((action) => {
                                        const Icon = action.icon;
                                        return (
                                            <button
                                                key={action.label}
                                                onClick={() => {
                                                    setShowBoardCppMenu(false);
                                                    action.onClick();
                                                }}
                                                title={action.label}
                                                className="w-full border-none rounded-xl p-2.5 bg-[#F8F5FF] hover:bg-[#ECE3FF] text-gray-800 flex items-center gap-2.5 cursor-pointer text-left transition-colors"
                                            >
                                                <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-b from-[#7B4FC4] to-[#5A2D82] text-white flex items-center justify-center shrink-0">
                                                    <Icon size={16} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-xs font-bold text-gray-800">
                                                        {action.label}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                                                        {action.description}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <button
                                onClick={() => setShowBoardCppMenu((prev) => !prev)}
                                title={showBoardCppMenu ? "Hide C++ tools" : "Show C++ tools"}
                                className={`w-[58px] h-[58px] rounded-full border-4 border-purple-100 text-white flex items-center justify-center shadow-lg cursor-pointer transition-all duration-200 ${showBoardCppMenu
                                        ? 'bg-gradient-to-b from-[#7B4FC4] to-[#5A2D82] shadow-purple-900/30'
                                        : 'bg-[#E91E63] shadow-pink-600/30'
                                    }`}
                            >
                                <div className="flex items-center gap-0.5 text-[11px] font-extrabold">
                                    <Plus size={16} />
                                    <span>C++</span>
                                </div>
                            </button>
                        </div>
                    )}
                </aside>

                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    <div className="flex-1 flex flex-col min-h-0">
                        <div className={`h-[34px] border-b border-gray-200 flex items-center justify-between px-3 text-xs text-gray-800 gap-3 ${uploadView === "board" ? 'bg-white' : 'bg-gray-100'
                            }`}>
                            <div className="flex items-center gap-2 min-w-0">
                                {uploadActiveFile === activeBoardFile ? <FileCode2 size={14} /> : <FileText size={14} />}
                                <span className="font-semibold truncate">
                                    {uploadActiveFile}
                                </span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                                {uploadActiveFile === activeBoardFile ? `${selectedBoardName} firmware` : "MicroPython project file"}
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 flex overflow-hidden">
                            <MonacoEditor
                                projectFiles={uploadProjectFiles}
                                activeFile={uploadActiveFile}
                                setProjectFiles={setUploadProjectFiles}
                                editorRef={editorRef}
                                monacoRef={monacoRef}
                                editorCursor={editorCursor}
                                isRunning={isUploadingFirmware}
                                onRun={handleUploadFirmware}
                                onCursorChange={setEditorCursor}
                                editorOptions={uploadView === "board" ? {
                                    fontSize: 16,
                                    fontFamily: "Consolas, 'Courier New', monospace",
                                    lineHeight: 30,
                                    glyphMargin: false,
                                    minimap: { enabled: false },
                                    lineNumbersMinChars: 3,
                                    overviewRulerLanes: 0,
                                    hideCursorInOverviewRuler: true,
                                    scrollbar: {
                                        verticalScrollbarSize: 10,
                                        horizontalScrollbarSize: 10,
                                    },
                                } : {
                                    minimap: { enabled: false },
                                }}
                            />
                        </div>

                        <div className="h-[26px] bg-gray-100 border-t border-gray-200 flex items-center gap-3.5 px-3 text-[11px] text-gray-500 shrink-0">
                            <span>{uploadActiveFile === activeBoardFile ? "Board C++" : "MicroPython"}</span>
                            <span>Ln {editorCursor.line}, Col {editorCursor.col}</span>
                            <span className="ml-auto">
                                {uploadProgressMessage || "Ready to edit"}
                            </span>
                        </div>
                    </div>

                    <div className="flex-1 min-h-[200px] border-t border-gray-200 bg-[#F8F9FB] flex flex-col">
                        <div className="flex items-center justify-between p-3 pb-0 gap-2.5">
                            <div className="flex gap-2">
                                {[
                                    { id: "terminal", label: "Terminal", icon: TerminalSquare },
                                    { id: "log", label: "Log", icon: ClipboardList },
                                    { id: "serial", label: "Serial Monitor", icon: Plug },
                                ].map((tab) => {
                                    const Icon = tab.icon;
                                    const active = uploadPanelTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setUploadPanelTab(tab.id)}
                                            className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.75 text-xs font-semibold cursor-pointer transition-colors ${active ? 'border-[#8B5CF6] bg-[#F3EEFF] text-[#8B5CF6]' : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                                                }`}
                                        >
                                            <Icon size={14} />
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <button
                                onClick={handleUploadFirmware}
                                disabled={isUploadingFirmware}
                                className={`flex items-center gap-2 border-none rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${isUploadingFirmware ? 'bg-purple-300 cursor-not-allowed text-white' : 'bg-[#8B5CF6] hover:bg-purple-700 cursor-pointer text-white'
                                    }`}
                            >
                                {isUploadingFirmware ? <Loader size={15} className="animate-spin" /> : <Upload size={15} />}
                                {isUploadingFirmware ? "Uploading..." : "Upload Code"}
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 p-3 pt-2.5">
                            <div className="h-full border border-gray-200 rounded-lg overflow-hidden bg-white">
                                {renderUploadOutput()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
    // ── Utility ───────────────────────────────────────────────────────────────
    // Note: updateSpriteProperty and resetStage are now provided by StageContext

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-screen w-screen bg-gray-50 text-gray-800 overflow-hidden font-sans">

            {/* ══ TOPBAR (Junior/Intermediate style) ══════════════════════════════════════ */}
            <header className="sticky top-0 h-[60px] bg-[#0a015a] flex items-center px-2 justify-between text-white z-[1000] shrink-0 overflow-visible">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="flex items-center justify-center w-10 h-10 bg-white/10 hover:bg-white/20 hover:scale-105 border border-white/10 rounded-xl text-white cursor-pointer transition-all duration-200 shrink-0"
                        title="Back to Home"
                    >
                        <Home size={19} strokeWidth={2.2} />
                    </button>
                    <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => {
                        sessionStorage.setItem('landingActiveTab', 'modules');
                        sessionStorage.removeItem('myProjectsSelectedMode');
                        onBack();
                    }}>
                        <Logo height={50} />
                        <span className="text-white text-[22px] font-black tracking-[0.08em] font-sans">Logix</span>
                    </div>
                    {showDesktopMenus && (
                        <>
                            <div className="w-px h-5 bg-white/70" />

                            <TopbarShareButton size={18} onSave={handleSaveProject} projectName={projectName}>
                                {({ onClick: handleShareClick }) => (
                                    <DropdownMenu
                                        label="File"
                                        isOpen={openMenuId === 'file'}
                                        onToggle={() => setOpenMenuId(openMenuId === 'file' ? null : 'file')}
                                        onClose={() => setOpenMenuId(null)}
                                        items={[
                                            { label: 'New Project', icon: File, onClick: handleNewProject, shortcut: 'Ctrl+N' },
                                            { label: 'Open from your computer', icon: FolderOpen, onClick: handleOpenProject, shortcut: 'Ctrl+O' },
                                            { label: 'Open Python File', icon: FileCode2, onClick: handleOpenPythonFile },
                                            { divider: true },
                                            { label: 'Save to your computer', icon: Save, onClick: handleSaveProject, shortcut: 'Ctrl+S' },
                                            { label: 'Download .leap file', icon: Download, onClick: handleDownloadProject },
                                            { divider: true },
                                            { label: 'Share', icon: Share, onClick: () => { handleShareClick(); handleShareProject?.(); } },
                                            { divider: true },
                                            {
                                                label: 'My Projects',
                                                icon: FolderOpen,
                                                onClick: () => {
                                                    sessionStorage.setItem('landingActiveTab', 'my-projects');
                                                    sessionStorage.setItem('myProjectsSelectedMode', 'python');
                                                    onBack();
                                                }
                                            }
                                        ]}
                                    />
                                )}
                            </TopbarShareButton>

                            <DropdownMenu
                                label="Edit"
                                isOpen={openMenuId === 'edit'}
                                onToggle={() => setOpenMenuId(openMenuId === 'edit' ? null : 'edit')}
                                onClose={() => setOpenMenuId(null)}
                                items={[
                                    { label: 'Undo', icon: Undo, shortcut: 'Ctrl+Z', onClick: () => editorRef.current?.trigger('keyboard', 'undo', null) },
                                    { label: 'Redo', icon: Redo, shortcut: 'Ctrl+Y', onClick: () => editorRef.current?.trigger('keyboard', 'redo', null) },
                                ]}
                            />

                            {["Tutorials", "Board", "Connect"].map((menuLabel) => (
                                <span
                                    key={menuLabel}
                                    className="text-[15px] cursor-pointer opacity-90 hover:opacity-100 hover:bg-white/15 px-2 py-1 rounded transition-colors"
                                    onClick={() => {
                                        if (menuLabel === "Board") {
                                            setIsBoardModalOpen(true);
                                        }
                                        if (menuLabel === "Connect" && workflowMode === "upload") {
                                            handleConnectToBoard();
                                        }
                                    }}
                                >
                                    {menuLabel}
                                </span>
                            ))}
                        </>
                    )}
                </div>
                <div className="flex items-end gap-2">
                    {showDesktopMenus ? (
                        <>
                            <ProjectNameInput
                                value={projectName}
                                onChange={setProjectName}
                                onSave={handleSaveProject}
                            />
                            <ModeSwitcher
                                modes={[
                                    { id: 'ide', label: 'IDE' },
                                    { id: 'stage', label: 'Stage' },
                                    { id: 'upload', label: 'Upload' },
                                ]}
                                activeMode={workflowMode}
                                onChange={handleWorkflowModeChange}
                            />
                            <div className="w-px h-[18px] bg-white/30" />
                            <ActionButton
                                variant="subtle"
                                icon={<Upload size={15} />}
                                label={workflowMode === "upload" ? "Upload Code" : "Open Upload"}
                                onClick={() => {
                                    if (workflowMode !== "upload") {
                                        handleWorkflowModeChange("upload");
                                        return;
                                    }
                                    handleUploadFirmware();
                                }}
                            />
                            <div className="flex gap-1">
                                <div className="w-[38px] h-[30px] rounded bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer text-white transition-colors">
                                    <Maximize size={15} />
                                </div>
                                <div className="w-[38px] h-[30px] rounded bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer text-white transition-colors">
                                    <Settings size={15} />
                                </div>
                            </div>
                        </>
                    ) : (
                        <button
                            onClick={() => setMobileMenuOpen(true)}
                            className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white cursor-pointer shrink-0 transition-colors"
                        >
                            <MenuIcon size={20} strokeWidth={2.2} />
                        </button>
                    )}
                </div>

                {showDesktopMenus && (
                    <>
                        <TopbarShareButton
                            className="bg-transparent border-none text-white/70 hover:text-white cursor-pointer px-2 py-1.5 rounded flex items-center transition-colors"
                            size={18}
                            onSave={handleSaveProject}
                            projectName={projectName}
                        />

                        {/* CREOLEAP Right Logo */}
                        <div className="ml-3 flex items-center shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)] pointer-events-none">
                            <CreoleapLogo height={200} className="pointer-events-none" />
                        </div>
                    </>
                )}
            </header>

            <MobileDrawer
                isOpen={mobileMenuOpen}
                onClose={() => setMobileMenuOpen(false)}
                theme="dark"
            >
                <div className="text-[11px] font-bold uppercase tracking-wider opacity-50">File Operations</div>
                {[
                    { label: 'New Project', icon: File, onClick: handleNewProject },
                    { label: 'Open from your computer', icon: FolderOpen, onClick: handleOpenProject },
                    { label: 'Open Python File', icon: FileCode2, onClick: handleOpenPythonFile },
                    { label: 'Save to your computer', icon: Save, onClick: handleSaveProject },
                    { label: 'Download .leap file', icon: Download, onClick: handleDownloadProject },
                    { label: 'Share', icon: Share, onClick: handleShareProject },
                    {
                        label: 'My Projects', icon: FolderOpen,
                        onClick: () => {
                            sessionStorage.setItem('landingActiveTab', 'my-projects');
                            sessionStorage.setItem('myProjectsSelectedMode', 'python');
                            onBack();
                        }
                    },
                ].map((item, i) => (
                    <button key={i} onClick={() => { item.onClick?.(); setMobileMenuOpen(false); }}
                        className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-[#e0e0e0] hover:bg-purple-600/25 hover:text-white text-xs font-medium cursor-pointer text-left transition-all duration-150"
                    >
                        {item.icon && <item.icon size={15} color="#a78bfa" strokeWidth={2} />}
                        {item.label}
                    </button>
                ))}

                <div className="h-px bg-white/10 my-1" />

                <div className="text-[11px] font-bold uppercase tracking-wider opacity-50">Edit Operations</div>
                {[
                    { label: 'Undo', icon: Undo, onClick: () => editorRef.current?.trigger('keyboard', 'undo', null) },
                    { label: 'Redo', icon: Redo, onClick: () => editorRef.current?.trigger('keyboard', 'redo', null) },
                ].map((item, i) => (
                    <button key={i} onClick={() => { item.onClick?.(); setMobileMenuOpen(false); }}
                        className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-[#e0e0e0] hover:bg-purple-600/25 hover:text-white text-xs font-medium cursor-pointer text-left transition-all duration-150"
                    >
                        {item.icon && <item.icon size={15} color="#a78bfa" strokeWidth={2} />}
                        {item.label}
                    </button>
                ))}

                <div className="h-px bg-white/10 my-1" />

                <div className="text-[11px] font-bold uppercase tracking-wider opacity-50">Controls</div>
                {["Tutorials", "Board", "Connect"].map((label) => (
                    <button key={label} onClick={() => {
                        if (label === "Board") setIsBoardModalOpen(true);
                        if (label === "Connect" && workflowMode === "upload") handleConnectToBoard();
                        setMobileMenuOpen(false);
                    }}
                        className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-[#e0e0e0] hover:bg-purple-600/25 hover:text-white text-xs font-medium cursor-pointer text-left transition-all duration-150"
                    >
                        {label}
                    </button>
                ))}

                <div className="h-px bg-white/10 my-1" />

                <div className="text-[11px] font-bold uppercase tracking-wider opacity-50">Mode & Actions</div>
                {[
                    { id: 'ide', label: 'IDE' },
                    { id: 'stage', label: 'Stage' },
                    { id: 'upload', label: 'Upload' },
                ].map(({ id, label }) => (
                    <button key={id} onClick={() => { handleWorkflowModeChange(id); setMobileMenuOpen(false); }}
                        className={`flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg text-white text-xs font-semibold cursor-pointer text-left transition-all duration-150 ${workflowMode === id ? 'bg-purple-600/20' : 'bg-transparent hover:bg-purple-600/15'
                            }`}
                    >
                        {label}
                        {workflowMode === id && <span className="ml-auto text-[11px] opacity-60">Active</span>}
                    </button>
                ))}
                <button onClick={() => { handleWorkflowModeChange('upload'); handleUploadFirmware?.(); setMobileMenuOpen(false); }}
                    className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-[#e0e0e0] hover:bg-purple-600/25 hover:text-white text-xs font-medium cursor-pointer text-left transition-all duration-150"
                >
                    <Upload size={15} color="#a78bfa" strokeWidth={2} />
                    {workflowMode === "upload" ? "Upload Code" : "Open Upload"}
                </button>

                <div className="h-px bg-white/10 my-1" />

                <TopbarShareButton size={20} onSave={handleSaveProject} projectName={projectName}>
                    {({ onClick, loading }) => (
                        <button onClick={() => { onClick?.(); setMobileMenuOpen(false); }} disabled={loading}
                            className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-[#e0e0e0] hover:bg-purple-600/25 hover:text-white text-xs font-medium cursor-pointer text-left transition-all duration-150"
                        >
                            <Share size={15} color="#a78bfa" strokeWidth={2} />
                            Share
                        </button>
                    )}
                </TopbarShareButton>
            </MobileDrawer>

            {/* ══ SECOND TOOLBAR (LeapBlox Style) ══════════════════════════════ */}
            {workflowMode === "stage" ? (
                <div className="sticky top-[44px] h-[42px] bg-white flex items-center px-3 justify-between border-b border-gray-200 z-[90] shrink-0">
                    <div className="flex items-center gap-1.5">
                        {/* Blocks/Python tabs */}
                        <div className="flex bg-gray-200 rounded overflow-hidden">
                            <div
                                onClick={() => {
                                    if (onSwitchToBlocks) {
                                        onSwitchToBlocks();
                                    }
                                }}
                                className="px-3.5 py-1.5 bg-gray-200 text-gray-600 hover:text-gray-900 text-xs font-semibold cursor-pointer border-r border-gray-300 transition-colors"
                            >Blocks</div>
                            <div className="px-3.5 py-1.5 bg-purple-700 text-white text-xs font-semibold cursor-pointer">Python</div>
                        </div>
                        <div className="w-px h-5 bg-gray-200" />
                        <div className="flex bg-gray-200 rounded overflow-hidden">
                            <div
                                onClick={() => {
                                    if (onSwitchToCostumes) {
                                        onSwitchToCostumes();
                                    }
                                }}
                                className="px-3.5 py-1.5 bg-gray-200 text-gray-600 hover:text-gray-900 text-xs font-semibold cursor-pointer border-r border-gray-300 transition-colors"
                            >Costumes</div>
                            <div className="px-3.5 py-1.5 bg-gray-200 text-gray-600 hover:text-gray-900 text-xs font-semibold cursor-pointer transition-colors">Sounds</div>
                        </div>
                        <div className="w-px h-5 bg-gray-200" />
                    </div>
                    <div className="flex items-center gap-1.5">
                        {/* Editing tools */}
                        <div className="flex gap-0.5">
                            <div title="Undo (Ctrl+Z)" onClick={() => editorRef.current?.trigger('keyboard', 'undo', null)} className="cursor-pointer p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors">
                                <Undo size={16} />
                            </div>
                            <div title="Redo (Ctrl+Y)" onClick={() => editorRef.current?.trigger('keyboard', 'redo', null)} className="cursor-pointer p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors">
                                <Redo size={16} />
                            </div>
                            <div title="Copy (Ctrl+C)" onClick={() => { try { const ed = editorRef.current; if (ed) { const sel = ed.getModel()?.getValueInRange(ed.getSelection()); if (sel && navigator.clipboard) navigator.clipboard.writeText(sel).catch(() => { /* noop */ }); } } catch (_) { /* noop */ } }} className="cursor-pointer p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors">
                                <span className="text-sm">📋</span>
                            </div>
                            <div title="Paste (Ctrl+V)" onClick={() => { try { if (navigator.clipboard) { navigator.clipboard.readText().then(text => { const ed = editorRef.current; if (ed && text) { const sel = ed.getSelection(); ed.executeEdits('', [{ range: sel, text, forceMoveMarkers: true }]); } }).catch(() => { /* noop */ }); } } catch (_) { /* noop */ } }} className="cursor-pointer p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors">
                                <span className="text-sm">📄</span>
                            </div>
                            <div title="Delete" onClick={() => { if (window.confirm('Clear active file?')) { const ed = editorRef.current; if (ed) { ed.setValue(''); } } }} className="cursor-pointer p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors">
                                <Trash2 size={16} />
                            </div>
                        </div>
                        <div className="w-px h-5 bg-gray-200" />
                        {/* Quick Run Button (LeapBlox Green) */}
                        <div onClick={handleRun} title="Run Code (Ctrl+Enter or F5)"
                            className={`run-button cursor-pointer px-3.5 py-1.5 ${isRunning ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#4CAF50] hover:bg-[#43a047]'} text-white rounded flex items-center gap-1 text-xs font-semibold transition-all duration-200`}>
                            {isRunning ? (
                                <>
                                    <span className="animate-spin">⚙</span>
                                    <span>Running...</span>
                                </>
                            ) : (
                                <>
                                    <Play size={12} fill="#fff" />
                                    <span>Run</span>
                                </>
                            )}
                        </div>
                        {/* Run All Button */}
                        <div onClick={handleRun} title="Run All"
                            className="cursor-pointer px-2.5 py-1.5 bg-[#E8F5E9] hover:bg-emerald-100 text-[#4CAF50] border border-[#C8E6C9] rounded flex items-center gap-1 text-[11px] font-semibold transition-colors">
                            <Play size={10} fill="#4CAF50" />
                            <span>Run All</span>
                        </div>
                        {/* Stop Button (LeapBlox Red) */}
                        <div onClick={handleStop} title="Stop (Escape)"
                            className="stop-button cursor-pointer px-3 py-1.5 bg-[#FFEBEE] hover:bg-[#EF4444] text-[#F44336] hover:text-white border border-[#FFCDD2] rounded flex items-center gap-1 text-xs font-semibold transition-all duration-200">
                            <Square size={10} fill="#F44336" />
                            <span>Stop</span>
                        </div>
                        <div className="w-px h-5 bg-gray-200" />
                        {/* REPL Mode Toggle */}
                        <div className="px-2.5 py-1.25 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded text-[11px] font-medium cursor-pointer border border-gray-300 transition-colors">
                            REPL Mode
                        </div>
                        <div title="Stop" className="cursor-pointer p-1 text-[#F44336] rounded hover:bg-red-50 transition-colors">
                            <Square size={14} fill="#F44336" />
                        </div>
                        <div title="Clear" className="cursor-pointer p-1 text-gray-600 rounded hover:bg-gray-100 transition-colors">
                            <Trash2 size={14} />
                        </div>
                    </div>
                </div>
            ) : workflowMode === "upload" ? (
                <div className="sticky top-[44px] h-[48px] bg-white flex items-center px-3 justify-between border-b border-gray-200 z-[90] shrink-0 gap-4">
                    <div className="flex items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden bg-[#ECE7F8] border border-gray-200">
                            <button
                                onClick={() => handleUploadViewChange("project")}
                                className={`flex items-center gap-1.5 px-3.5 py-1.75 border-none text-xs font-bold cursor-pointer transition-colors ${uploadView === "project" ? 'bg-[#8B5CF6] text-white' : 'bg-transparent text-gray-800 hover:bg-purple-100'
                                    }`}
                            >
                                <FileText size={14} />
                                MicroPython
                            </button>
                            <button
                                onClick={() => handleUploadViewChange("board")}
                                className={`flex items-center gap-1.5 px-3.5 py-1.75 border-none text-xs font-bold cursor-pointer transition-colors ${uploadView === "board" ? 'bg-[#8B5CF6] text-white' : 'bg-transparent text-gray-800 hover:bg-purple-100'
                                    }`}
                            >
                                <FileCode2 size={14} />
                                Board C++
                            </button>
                        </div>
                        <div className="w-px h-[22px] bg-gray-200" />
                        <button
                            onClick={() => setIsBoardModalOpen(true)}
                            className="flex items-center gap-1.5 border border-gray-200 bg-white hover:bg-gray-50 rounded-lg px-3 py-1.75 text-xs font-semibold text-gray-800 cursor-pointer transition-colors"
                        >
                            <Cpu size={14} color={C.PURPLE} />
                            {selectedBoardName}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={selectedPort}
                            onChange={(e) => setSelectedPort(e.target.value)}
                            className="border border-gray-200 rounded-lg px-2.5 py-1.75 text-xs text-gray-800 min-w-[180px] outline-none bg-white focus:border-purple-500 transition-colors"
                        >
                            <option value="">{ports.length ? "Select Port" : "No Ports Found"}</option>
                            {ports.map((port) => (
                                <option key={port.path} value={port.path}>
                                    {formatPortLabel(port)}
                                </option>
                            ))}
                        </select>
                        <button
                            onClick={refreshPorts}
                            title="Refresh Ports"
                            className="w-[34px] h-[34px] rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 flex items-center justify-center cursor-pointer transition-colors"
                        >
                            <RefreshCw size={15} />
                        </button>
                        <button
                            onClick={handleConnectToBoard}
                            className={`flex items-center gap-1.5 border-none rounded-lg px-3 py-2 text-xs font-bold cursor-pointer transition-colors ${isConnected ? 'bg-[#10B981] hover:bg-emerald-600 text-white' : 'bg-[#EEF2FF] hover:bg-indigo-100 text-gray-800'
                                }`}
                        >
                            <Plug size={14} />
                            {isConnected ? "Disconnect" : "Connect"}
                        </button>
                        <div className="w-px h-[22px] bg-gray-200" />
                        <button onClick={handleUndoEditor} title="Undo" className="border border-gray-200 bg-white hover:bg-gray-50 rounded-lg w-[34px] h-[34px] flex items-center justify-center cursor-pointer text-gray-800 transition-colors">
                            <Undo size={15} />
                        </button>
                        <button onClick={handleRedoEditor} title="Redo" className="border border-gray-200 bg-white hover:bg-gray-50 rounded-lg w-[34px] h-[34px] flex items-center justify-center cursor-pointer text-gray-800 transition-colors">
                            <Redo size={15} />
                        </button>
                        <div className="w-px h-[22px] bg-gray-200" />
                        <div className={`flex items-center gap-2 text-xs ${uploadProgressMessage ? 'text-gray-800' : 'text-gray-500'}`}>
                            {uploadProgressMessage ? (
                                isUploadingFirmware ? <Loader size={15} className="animate-spin" /> : <CheckCircle size={15} color={C.GREEN} />
                            ) : (
                                <AlertCircle size={15} color={C.MUTED} />
                            )}
                            <span>{uploadProgressMessage || "Board ready"}</span>
                        </div>
                    </div>
                </div>
            ) : (
                /* IDE Mode Toolbar — VS Code inspired dark theme */
                <div className="relative h-[42px] bg-[#1e1e2e] flex items-center px-3 justify-between border-b border-[#313244] z-[90] shrink-0">
                    {/* Left: File tabs */}
                    <div className="flex items-center gap-0 overflow-hidden">
                        {Object.keys(projectFiles).map((fname) => (
                            <div
                                key={fname}
                                onClick={() => setActiveFile(fname)}
                                className={`px-3.5 py-[6px] text-xs transition-all whitespace-nowrap font-mono cursor-pointer border-r border-[#313244] ${activeFile === fname
                                        ? 'bg-[#2d2d3f] text-[#cdd6f4] font-semibold border-b-2 border-[#7C3AED]'
                                        : 'bg-transparent text-[#6c7086] hover:text-gray-300 font-normal border-b-2 border-transparent'
                                    }`}
                            >
                                {fname}
                            </div>
                        ))}
                    </div>
                    {/* Right: Editing tools + Run/Stop */}
                    <div className="flex items-center gap-1.5">
                        <div className="flex gap-0.5">
                            <button title="Undo" onClick={() => { if (editorRef.current) editorRef.current.trigger('keyboard', 'undo', null); }} className="cursor-pointer px-1.5 py-1 text-[#6c7086] hover:text-gray-200 hover:bg-[#313244] rounded bg-transparent border-none flex items-center transition-colors">
                                <Undo size={15} />
                            </button>
                            <button title="Redo" onClick={() => { if (editorRef.current) editorRef.current.trigger('keyboard', 'redo', null); }} className="cursor-pointer px-1.5 py-1 text-[#6c7086] hover:text-gray-200 hover:bg-[#313244] rounded bg-transparent border-none flex items-center transition-colors">
                                <Redo size={15} />
                            </button>
                        </div>
                        <div className="w-px h-5 bg-[#313244]" />
                        <button onClick={() => handleRun()} title="Run (Ctrl+Enter)" disabled={isRunning}
                            className={`cursor-pointer px-3 py-[5px] text-xs font-semibold rounded flex items-center gap-1 transition-all border-none text-white ${isRunning ? 'bg-[#45475a] cursor-not-allowed' : 'bg-[#4CAF50] hover:bg-[#43a047]'
                                }`}>
                            {isRunning ? (
                                <><span className="animate-spin">&#x2699;</span> Running...</>
                            ) : (
                                <><Play size={12} fill="#fff" /> Run</>
                            )}
                        </button>
                        <button onClick={() => handleStop()} title="Stop (Escape)"
                            className="cursor-pointer px-2.5 py-[5px] bg-[#45475a] hover:bg-[#EF4444] text-[#f38ba8] hover:text-white border-none rounded flex items-center gap-1 text-xs font-semibold transition-all">
                            <Square size={10} fill="#f38ba8" /> Stop
                        </button>
                    </div>
                </div>
            )}

            {/* ══ MAIN WORKSPACE ═══════════════════════════════════════════════ */}
            {workflowMode === "stage" ? (
                <div className="flex-1 flex overflow-auto min-h-0">


                    {/* ── LEFT SIDEBAR (LeapBlox Style) ── */}
                    <SidePanel
                        sidePanel={sidePanel}
                        setSidePanel={setSidePanel}
                        projectFiles={projectFiles}
                        activeFile={activeFile}
                        setActiveFile={setActiveFile}
                        handleAddPythonFiles={handleAddPythonFiles}
                        handleAddImageFiles={handleAddImageFiles}
                        handleAddTextFiles={handleAddTextFiles}
                        handleAddCsvFiles={handleAddCsvFiles}
                        handleDeleteFile={handleDeleteFile}
                        onAddNewFile={handleCreateNewFile}
                        onAddNewTextFile={handleCreateNewTextFile}
                        onRenameFile={handleRenameFile}
                        spriteFilter={spriteFilter}
                        setSpriteFilter={setSpriteFilter}
                        addSpriteFromLibrary={addSpriteFromLibrary}
                        SPRITE_LIBRARY={getSpriteLibrary()}
                        BACKDROP_LIBRARY={BACKDROP_LIBRARY}
                        backdrop={backdrop}
                        handleSetBackdrop={handleSetBackdrop}
                        EXTENSIONS={EXTENSIONS}
                        installedExtensions={installedExtensions}
                        installExtension={installExtension}
                        packages={packages}
                        pipFilter={pipFilter}
                        setPipFilter={setPipFilter}
                        handleInstall={handleInstall}
                    />

                    {/* ── EDITOR + TERMINAL ── */}
                    <EditorPanel
                        projectFiles={projectFiles}
                        activeFile={activeFile}
                        setActiveFile={setActiveFile}
                        editorCursor={editorCursor}
                        isRunning={isRunning}
                        onRun={handleRun}
                        onStop={handleStop}
                        onClear={handleClear}
                        activePanel={activePanel}
                        setActivePanel={setActivePanel}
                        terminalOutput={terminalOutput}
                        replInput={replInput}
                        setReplInput={setReplInput}
                        handleReplSubmit={handleReplSubmit}
                        handleReplKey={handleReplKey}
                        terminalEndRef={terminalEndRef}
                        replInputRef={replInputRef}
                        editorRef={editorRef}
                        monacoRef={monacoRef}
                        setProjectFiles={setProjectFiles}
                        onCursorChange={setEditorCursor}
                        packages={packages}
                        pipFilter={pipFilter}
                        setPipFilter={setPipFilter}
                        handleInstall={handleInstall}
                        isWaitingForInput={isWaitingForInput}
                        inputPromptText={inputPromptText}
                        terminalInputValue={terminalInputValue}
                        setTerminalInputValue={setTerminalInputValue}
                        handleTerminalInputSubmit={handleTerminalInputSubmit}
                        handleTerminalInputKey={handleTerminalInputKey}
                        terminalInputRef={terminalInputRef}
                        isElectron={window.electronAPI?.isElectron || false}
                        shellInput={shellInput}
                        setShellInput={setShellInput}
                        handleShellSubmit={handleShellSubmit}
                        handleShellKey={handleShellKey}
                        shellInputRef={shellInputRef}
                    />

                    {/* ── STAGE PANEL ── */}
                    <StagePanel
                        sprites={sprites}
                        selectedSpriteId={selectedSpriteId}
                        setSelectedSpriteId={setSelectedSpriteId}
                        backdrop={backdrop}
                        stageRef={stageRef}
                        stageSize={stageSize}
                        setShowSpriteLibrary={setShowSpriteLibrary}
                        updateSpriteProperty={updateSpriteProperty}
                        BACKDROP_LIBRARY={BACKDROP_LIBRARY}
                        handleSetBackdrop={handleSetBackdrop}
                        deleteSprite={deleteSprite}
                        activeMode={activeMode}
                        onOpenAssetLibrary={onOpenAssetLibrary}
                    />
                </div>
            ) : workflowMode === "upload" ? (
                renderUploadWorkspace()
            ) : (
                /* IDE Mode Workspace — SidePanel + Editor (left) + Terminal (right) */
                <div className="flex-1 flex overflow-hidden min-h-0 bg-[#1e1e2e]">

                    {/* ── LEFT SIDEBAR (File Explorer) ── */}
                    <SidePanel
                        sidePanel={sidePanel}
                        setSidePanel={setSidePanel}
                        projectFiles={projectFiles}
                        activeFile={activeFile}
                        setActiveFile={setActiveFile}
                        handleAddPythonFiles={handleAddPythonFiles}
                        handleAddImageFiles={handleAddImageFiles}
                        handleAddTextFiles={handleAddTextFiles}
                        handleAddCsvFiles={handleAddCsvFiles}
                        handleDeleteFile={handleDeleteFile}
                        onAddNewFile={handleCreateNewFile}
                        onAddNewTextFile={handleCreateNewTextFile}
                        onRenameFile={handleRenameFile}
                        spriteFilter={spriteFilter}
                        setSpriteFilter={setSpriteFilter}
                        addSpriteFromLibrary={addSpriteFromLibrary}
                        SPRITE_LIBRARY={getSpriteLibrary()}
                        BACKDROP_LIBRARY={BACKDROP_LIBRARY}
                        backdrop={backdrop}
                        handleSetBackdrop={handleSetBackdrop}
                        EXTENSIONS={EXTENSIONS}
                        installedExtensions={installedExtensions}
                        installExtension={installExtension}
                        packages={packages}
                        pipFilter={pipFilter}
                        setPipFilter={setPipFilter}
                        handleInstall={handleInstall}
                    />

                    {/* ── CENTER: Code Editor ── */}
                    <div className="flex-1 flex flex-col overflow-hidden border-r border-[#313244]">
                        {Object.keys(projectFiles).length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-[#6c7086] gap-4 font-mono">
                                <FileCode2 size={48} strokeWidth={1.2} className="opacity-40" />
                                <div className="text-base font-medium text-[#8b8fa3]">No files yet</div>
                                <div className="text-xs text-[#585b70]">Create a new file from the sidebar to get started</div>
                                <button
                                    onClick={() => handleCreateNewFile()}
                                    className="mt-2 px-5 py-2 bg-[#7C3AED] hover:bg-[#6D28D9] text-white border-none rounded-md text-xs font-semibold cursor-pointer flex items-center gap-1.5 transition-colors"
                                >
                                    <Plus size={14} /> New File
                                </button>
                            </div>
                        ) : (
                            <>
                                <MonacoEditor
                                    projectFiles={projectFiles}
                                    activeFile={activeFile}
                                    setProjectFiles={setProjectFiles}
                                    editorRef={editorRef}
                                    monacoRef={monacoRef}
                                    editorCursor={editorCursor}
                                    isRunning={isRunning}
                                    onRun={handleRun}
                                    onCursorChange={setEditorCursor}
                                    editorOptions={{ theme: "vs-dark" }}
                                />
                                <StatusBar
                                    editorCursor={editorCursor}
                                    isRunning={isRunning}
                                    activeFile={activeFile}
                                />
                            </>
                        )}
                    </div>

                    {/* ── RIGHT: Terminal / REPL (full height) ── */}
                    <div className="w-[380px] flex flex-col overflow-hidden shrink-0">
                        <style>{`.ide-terminal-full > div:first-child { height: 100% !important; flex: 1 !important; }`}</style>
                        <div className="ide-terminal-full flex-1 flex flex-col overflow-hidden">
                            <TerminalPanel
                                activePanel={activePanel}
                                setActivePanel={setActivePanel}
                                terminalOutput={terminalOutput}
                                replInput={replInput}
                                setReplInput={setReplInput}
                                handleReplSubmit={handleReplSubmit}
                                handleReplKey={handleReplKey}
                                terminalEndRef={terminalEndRef}
                                replInputRef={replInputRef}
                                isRunning={isRunning}
                                onRun={handleRun}
                                onStop={handleStop}
                                onClear={handleClear}
                                packages={packages}
                                pipFilter={pipFilter}
                                setPipFilter={setPipFilter}
                                handleInstall={handleInstall}
                                isWaitingForInput={isWaitingForInput}
                                inputPromptText={inputPromptText}
                                terminalInputValue={terminalInputValue}
                                setTerminalInputValue={setTerminalInputValue}
                                handleTerminalInputSubmit={handleTerminalInputSubmit}
                                handleTerminalInputKey={handleTerminalInputKey}
                                terminalInputRef={terminalInputRef}
                                isElectron={window.electronAPI?.isElectron || false}
                                shellInput={shellInput}
                                setShellInput={setShellInput}
                                handleShellSubmit={handleShellSubmit}
                                handleShellKey={handleShellKey}
                                shellInputRef={shellInputRef}
                            />
                        </div>
                    </div>
                </div>
            )}

            {showSpriteLibrary && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
                    <div className="bg-white rounded-xl w-[600px] max-h-[80vh] shadow-[0_8px_32px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col">
                        <div className="bg-[#8B5CF6] text-white p-3 px-4 text-base font-bold flex justify-between items-center">
                            {libraryMode === "costume" ? "Choose a Costume" : "Choose a Sprite"}
                            <div
                                onClick={() => setShowSpriteLibrary(false)}
                                className="cursor-pointer text-xl font-bold"
                            >×</div>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto">
                            <div className="grid grid-cols-5 gap-3">
                                {getSpriteLibrary().map(sp => (
                                    <div
                                        key={sp.name}
                                        onClick={() => {
                                            if (libraryMode === "costume" && selectedSpriteId) {
                                                const costumeId = `costume_${Date.now()}`;
                                                const img = sp.img || sp.image || sp.emoji;
                                                updateSpriteProperty(selectedSpriteId, 'costumes', {
                                                    ...sprites.find(s => s.id === selectedSpriteId).costumes,
                                                    [costumeId]: img
                                                });
                                                updateSpriteProperty(selectedSpriteId, 'currentCostume', costumeId);
                                                addLog(`Added costume to ${sprites.find(s => s.id === selectedSpriteId).name}`, 'success');
                                            } else {
                                                addSpriteFromLibrary(sp);
                                            }
                                            setShowSpriteLibrary(false);
                                        }}
                                        className="bg-[#F5F0FF] border-2 border-transparent hover:border-[#8B5CF6] hover:bg-[#EDE9FE] rounded-xl p-3 cursor-pointer text-center transition-all duration-200"
                                    >
                                        <img
                                            src={sp.img}
                                            alt={sp.name}
                                            className="w-12 h-12 object-contain mx-auto"
                                            onError={e => { e.currentTarget.style.display = 'none'; }}
                                        />
                                        <div className="text-[11px] font-semibold text-[#1F2937] mt-1.5">
                                            {sp.name}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileLoad} accept=".leap,.lbproject,application/json" />
        </div>
    );
}

// Wrap with StageProvider for shared state
export default function PythonAppWithProvider(props) {
    return (
        <StageProvider>
            <PythonApp {...props} />
        </StageProvider>
    );
}


