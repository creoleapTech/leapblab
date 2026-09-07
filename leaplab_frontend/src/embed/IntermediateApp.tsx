/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useIsEmbedded } from '../hooks/useIsEmbedded';
import { STAGE_CONFIG } from '../engine/StageConfig';

import Blockly, { LEAP_CUSTOM_BLOCK_CONTEXT_MENU_FLAG } from '@blockly-runtime';

import leaplabBlocksCss from '../styles/Leaplab-blocks.css?inline'; // Import leap-style blocks CSS (inlined for dynamic injection)

import { COLORS } from '../blocks/blockDefinitions';



import { AnimationCompiler } from '../generators/animation-generator';



import { migrateWorkspaceBlocks, migrateSingleBlock } from '../utils/blocklyMigration';

import { animationVM } from '../vm/AnimationVM';
import type { CompiledScript } from '../vm/AnimationVM';
import { soundManager } from '../engine/SoundManager';

import { Sprite } from '../stage/Sprite';
import type { SpriteType } from '../stage/Sprite';

import Stage from '../stage/Stage';
import AskBar from '../components/AskBar';

import SpritePanel from '../stage/SpritePanel';

import MenuBar from '../leapignite/client/components/MenuBar';
import Logo from '../components/Logo';

import BoardSelectionModal from '../leapignite/client/components/BoardSelectionModal';
import DialogRenderer from './components/DialogRenderer';

import { PythonEditorTab } from '../components/PythonEditorTab';

import { lazyWithRetry } from '../utils/lazyWithRetry';
// Lazy load large components for better performance
const BackdropLibrary = lazyWithRetry(() => import('../components/BackdropLibrary'), 'BackdropLibrary');
const SpriteLibrary = lazyWithRetry(() => import('../components/SpriteLibrary').then(m => ({ default: m.SpriteLibrary } as any)) as any, 'SpriteLibrary');
const JuniorExtensionLibrary = lazyWithRetry(() => import('../leapignite/client/components/JuniorExtensionLibrary'), 'JuniorExtensionLibrary');

// Lazy load heavy tabs that import fabric.js and wav-encoder - prevents 60s startup delay
const CostumesTab = lazyWithRetry(() => import('../stage/CostumesTab').then(m => ({ default: m.CostumesTab } as any)) as any, 'CostumesTab');
const SoundsTab = lazyWithRetry(() => import('../stage/SoundsTab').then(m => ({ default: m.SoundsTab } as any)) as any, 'SoundsTab');

import { TabErrorBoundary, SuspenseTab } from './components/TabErrorBoundary';
import { log } from './utils/log';
import { normalizeAssetPath, resolveAssetPath } from './utils/assetPaths';
import {
    MORE_BLOCKS_CATEGORY_NAME,
    MORE_BLOCKS_CATEGORY_COLOUR,
    createFlyoutCategoryLabel,
    createFlyoutSectionLabel,
    createMonitorReporterPlaceholder,
    createMoreBlocksCategory,
} from './utils/toolboxHelpers';
import { useMonitors } from './hooks/useMonitors';
import { useDialogHandlers } from './hooks/useDialogHandlers';
import { useEditorUI } from './hooks/useEditorUI';
import { usePromptUtils } from './hooks/usePromptUtils';
import { useToolbox } from './hooks/useToolbox';
import { useWorkspaceChange } from './hooks/useWorkspaceChange';
import { useWorkspaceManagement } from './hooks/useWorkspaceManagement';
import { useSpriteManagement } from './hooks/useSpriteManagement';
import { useSpriteOperations } from './hooks/useSpriteOperations';
import { useProjectOperations } from './hooks/useProjectOperations';
import { useAnimationControl } from './hooks/useAnimationControl';
import { useHardwareControls } from './hooks/useHardwareControls';
import { initBlocklyOnce, extractBroadcastValues, fixCostumeDropdownValues, resetBlocklyInitialized, BLOCKLY_MEDIA_PATH } from './utils/blocklyInit';
import { useBlockClickListener } from './hooks/useBlockClickListener';

import { stageManager } from '../engine/StageManager';
import { spriteManager } from '../engine/SpriteManager';
import { leapRuntime } from '../runtime/leapRuntime';
import { initRuntime, setActiveSpriteId, setFaceVideoElement } from '../runtime/RuntimeBridge';
import { hardwareAdapter } from '../serial/HardwareAdapter';

import SerialMonitor from '../components/SerialMonitor';

import UploadModal from '../components/UploadModal';

import type { SpriteEntry } from '../components/SpriteLibrary';

import WorkspaceControls from '../components/WorkspaceControls';

import WorkspaceTrash from '../components/WorkspaceTrash';

import UnsavedWarningModal from '../leapignite/client/components/UnsavedWarningModal';
import GoalPopup from '../leapignite/client/components/GoalPopup';
import { getLessonConfig } from '../leapignite/server/engine/LessonConfig';



import { fileService } from '../Electra/Client/Src/services/FileService';
import { useCloudProjectStore } from '../store/cloudProjectStore';
import { showToast } from '../leapignite/client/components/Toast';


import { Flag, Square, Upload, Camera, CameraOff, Grid3X3, Maximize, Minimize, LayoutTemplate, LayoutPanelLeft, Library, Pen, Volume2, Undo2, Redo2, Terminal, Puzzle, Plus, RotateCw } from 'lucide-react';


import { styles } from '../styles/intermediateStyles';
import { showAlert } from '../utils/dialogStore';
import type { AppMode, EditorMode, VariableMonitorState, ListMonitorState, TableMonitorState } from '../types/intermediateTypes';
import { normalizeVariableMonitor } from '../types/intermediateTypes';

import Loader from '../components/Loader';

// Import dialog components
import MakeVariableDialog from '../components/MakeVariableDialog';
import MakeListDialog from '../components/MakeListDialog';
import MakeTableDialog from '../components/MakeTableDialog';
import MakeBlockDialog from '../components/MakeBlockDialog';
import type { BlockArgument } from '../components/MakeBlockDialog';

// Import monitor components
import VariableMonitor from '../components/VariableMonitor';
import ListMonitor from '../components/ListMonitor';
import TableMonitor from '../components/TableMonitor';



// Global initialization guards to prevent duplicate block registration and recursive prototype patching
let blocksInitialized = false;
let originalCheckboxSetValue: any = null;

// Initialize Extension Runtime mapping — delegates to RuntimeBridge
// which wires pen → PenManager and face → FaceRuntime (browser FaceDetector API)
// and extension runtimes → ObjectDetection, Music, etc.
if (typeof window !== 'undefined') {
    initRuntime();
    // Extensions are initialized lazily when added via the Extension Library
}


// ═══════════════════════════════════════════════════════════════════════════






// Blockly init extracted to src/embed/utils/blocklyInit.ts





// ═══════════════════════════════════════════════════════════════════════════

// MAIN APP COMPONENT

// ═══════════════════════════════════════════════════════════════════════════

// Types extracted to src/types/intermediateTypes.ts



// Workspace utils extracted to src/embed/utils/blocklyInit.ts

const IntermediateApp: React.FC<{ onBack: () => void; onOpenPython?: () => void; openTab?: 'blocks' | 'python' | 'costumes' | 'sounds'; projectUrl?: string | null }> = ({ onBack, onOpenPython, openTab = 'blocks', projectUrl }) => {

    // Detect embed mode (iframe)
    const isEmbedMode = useIsEmbedded();

    // Initialize Blockly patches on first render (deferred from module scope to avoid TDZ)
    initBlocklyOnce();

    // Dynamically inject Leaplab-blocks CSS only while Intermediate is mounted.
    // This prevents the global unscoped rules from leaking into Junior mode.
    useEffect(() => {
        const styleEl = document.createElement('style');
        styleEl.textContent = leaplabBlocksCss;
        styleEl.setAttribute('data-leaplab-blocks', 'true');
        document.head.appendChild(styleEl);
        return () => {
            styleEl.remove();
        };
    }, []);

    // ═══════════════════════════════════════════════════════════════════════

    // STATE

    // ═══════════════════════════════════════════════════════════════════════

    const blocklyDiv = useRef<HTMLDivElement>(null);

    const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);



    const [appMode, setAppMode] = useState<AppMode>('blocks');

    const [editorMode, setEditorMode] = useState<EditorMode>('stage');

    const [projectName, setProjectName] = useState('My Project');

    const [generatedCode, setGeneratedCode] = useState<string>('// Select blocks to generate code');

    const [activeTab, setActiveTab] = useState<'log' | 'serial'>('log');

    const [logAreaHeight, setLogAreaHeight] = useState(300);
    const isResizingLogRef = useRef(false);
    const logAreaRef = useRef<HTMLDivElement>(null);

    const [rightPanelWidth, setRightPanelWidth] = useState<number>(496);
    const isResizingRightPanelRef = useRef(false);

    const handleRightPanelResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRightPanelRef.current = true;
        const startX = e.clientX;
        const startWidth = rightPanelWidth;

        const handleMouseMove = (me: MouseEvent) => {
            if (!isResizingRightPanelRef.current) return;
            const delta = startX - me.clientX;
            const maxAllowed = Math.min(850, window.innerWidth - 300);
            const minAllowed = 260;
            const newWidth = Math.min(Math.max(startWidth + delta, minAllowed), maxAllowed);
            setRightPanelWidth(newWidth);
            if (workspaceRef.current) {
                Blockly.svgResize(workspaceRef.current);
            }
        };

        const handleMouseUp = () => {
            isResizingRightPanelRef.current = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (workspaceRef.current) {
                Blockly.svgResize(workspaceRef.current);
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [rightPanelWidth]);

    const handleLogResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingLogRef.current = true;
        const startY = e.clientY;
        const startHeight = logAreaHeight;

        const handleMouseMove = (me: MouseEvent) => {
            if (!isResizingLogRef.current) return;
            const delta = startY - me.clientY;
            const maxAllowed = Math.max(150, window.innerHeight - 160);
            const newHeight = Math.min(Math.max(startHeight + delta, 60), maxAllowed);
            setLogAreaHeight(newHeight);
        };

        const handleMouseUp = () => {
            isResizingLogRef.current = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    }, [logAreaHeight]);

    const [workspaceTab, setWorkspaceTab] = useState<'blocks' | 'python' | 'costumes' | 'sounds'>(openTab);

    const [logMessages, setLogMessages] = useState<string[]>(['Ready']);

    // Auto-scroll log area when new log messages arrive
    useEffect(() => {
        if (activeTab === 'log' && logAreaRef.current) {
            logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
        }
    }, [logMessages, activeTab]);

    const [isRunning, setIsRunning] = useState(false);

    // Keep ref in sync with isRunning state (for use in intervals/callbacks with stale closures)
    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    useEffect(() => {

        if (openTab && openTab !== workspaceTab) {

            setWorkspaceTab(openTab);

        }

    }, [openTab]);



    // Sprites

    const [sprites, setSprites] = useState<Sprite[]>(spriteManager.getAllSprites());

    // Runtime Sprite Sync (Clones, Deletions, etc.)
    useEffect(() => {
        const handleUpdate = () => setSprites([...spriteManager.getAllSprites()]);
        spriteManager.setUpdateCallback(handleUpdate);
        handleUpdate();
        return () => spriteManager.setUpdateCallback(() => { });
    }, []);

    const [selectedSpriteId, setSelectedSpriteId] = useState<string | null>(null);

    const [compiledScripts, setCompiledScripts] = useState<CompiledScript[]>([]);



    // Per-sprite workspace storage: maps spriteId -> Blockly serialized JSON

    const spriteWorkspacesRef = useRef<Map<string, object>>(new Map());

    const activeSpriteIdRef = useRef<string | null>(null); // Tracks true owner of current blocks

    const isLoadingWorkspaceRef = useRef(false);
    const loadedProjectUrlRef = useRef<string | null>(null); // Prevents URL project from reloading in a loop

    const syncAllWorkspacesRef = useRef<(() => CompiledScript[]) | null>(null);

    // Ref to track isRunning for sensing sync (avoids stale closure in setInterval)
    const isRunningRef = useRef(false);

    // Drag-tracking refs for block-to-sprite copying
    const draggedBlockStateRef = useRef<any>(null);

    // Upload sprite file input ref
    const uploadSpriteFileRef = useRef<HTMLInputElement>(null);
    const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    // Hardware

    const [ports, setPorts] = useState<{ path: string; manufacturer?: string }[]>([]);

    const [selectedPort, setSelectedPort] = useState<string>('');

    const [selectedBoard, setSelectedBoard] = useState<string>('arduino_uno');

    const [selectedBoardName, setSelectedBoardName] = useState<string>('Arduino Uno');

    const [isBoardModalOpen, setIsBoardModalOpen] = useState(false);

    const [isConnected, setIsConnected] = useState(false);

    const [serialMessages, setSerialMessages] = useState<string[]>([]);

    // Arduino sketches default to Serial.begin(9600) (see arduino-generator);
    // ESP32 examples default to 115200. The monitor auto-switches to the
    // sketch baud after each web upload (see useHardwareControls).
    const [baudRate, setBaudRate] = useState<number>(9600);

    const [lineEnding, setLineEnding] = useState<string>('\r\n');

    const [isUploading, setIsUploading] = useState(false);

    const [uploadProgress, setUploadProgress] = useState<string>('');



    // Stage enhancements state

    const [isCameraOn, setIsCameraOn] = useState(false);

    const [showGrid, setShowGrid] = useState(false);

    // Tracks which extension categories have been installed (pen, face_detection, etc.)
    // Used by getCurrentToolbox() to inject them after "My Blocks"
    const [installedExtensions, setInstalledExtensions] = useState<Set<string>>(new Set());
    const installedExtensionsRef = useRef<Set<string>>(new Set());

    const [isDraggingSprite, setIsDraggingSprite] = useState(false);

    const [stageLayout, setStageLayout] = useState<'normal' | 'small' | 'large'>('normal');

    const [isFullscreen, setIsFullscreen] = useState(false);

    const [fullscreenScale, setFullscreenScale] = useState(1);

    const stageContainerRef = useRef<HTMLDivElement>(null);







    // Backdrop state

    const [showBackdropLibrary, setShowBackdropLibrary] = useState(false);

    const [showBackdropEditor, setShowBackdropEditor] = useState(false);

    const [backdropRefresh, setBackdropRefresh] = useState(0); // Force re-render on backdrop change



    // Sprite Library state


    const [showSpriteLibrary, setShowSpriteLibrary] = useState(false);

    // Extension Library state
    const [showExtensionLibrary, setShowExtensionLibrary] = useState(false);


    const lastToolboxJsonRef = useRef<string>('');
    const isRebuildingToolboxRef = useRef(false);
    const [toolboxUpdateKey, setToolboxUpdateKey] = useState(0);



    // Force re-render for sprite updates

    const [, forceUpdate] = useState({});

    const triggerUpdate = useCallback(() => forceUpdate({}), []);



    // ═══════════════════════════════════════════════════════════════════════

    // HELPERS

    // ═══════════════════════════════════════════════════════════════════════





    const [promptState, setPromptState] = useState<{

        isOpen: boolean;

        message: string;

        defaultValue: string;

        callback: ((value: string | null) => void) | null;

        type: 'standard' | 'variable' | 'list' | 'table';

    }>({

        isOpen: false,

        message: '',

        defaultValue: '',

        callback: null,

        type: 'standard',

    });

    const [promptInput, setPromptInput] = useState('');

    const [variableType, setVariableType] = useState('Number'); // Number | String

    const [variableScope, setVariableScope] = useState('global'); // global | local

    const selectedSpriteIdRef = useRef(selectedSpriteId);
    useEffect(() => { selectedSpriteIdRef.current = selectedSpriteId; }, [selectedSpriteId]);



    // Dialog states
    const [isMakeVariableOpen, setIsMakeVariableOpen] = useState(false);
    const [isMakeListOpen, setIsMakeListOpen] = useState(false);
    const [isMakeTableOpen, setIsMakeTableOpen] = useState(false);
    const [isMakeBlockOpen, setIsMakeBlockOpen] = useState(false);

    // Ask-and-wait state
    const [askState, setAskState] = useState<{
        isAsking: boolean;
        question: string;
        resolve: ((answer: string) => void) | null;
    }>({ isAsking: false, question: '', resolve: null });



    const {
        variableMonitors, setVariableMonitors,
        listMonitors, setListMonitors,
        tableMonitors, setTableMonitors,
        sensingMonitors, setSensingMonitors,
        variableMonitorsRef, listMonitorsRef, tableMonitorsRef, sensingMonitorsRef,
        handleMonitorPositionChange,
        handleMonitorResize,
        handleMonitorBringToFront,
        handleVariableModeChange,
        handleVariableValueChange,
        handleVariableSliderRangeChange,
        handleListAddItem,
        handleListEditItem,
        handleListDeleteItem,
    } = useMonitors(workspaceRef, isLoadingWorkspaceRef, setToolboxUpdateKey, setAskState);

    const {
        handleAddExtension,
        handleFullscreen,
        handleBackdropSelect,
    } = useEditorUI(
        workspaceRef, installedExtensionsRef, setInstalledExtensions,
        isFullscreen, setIsFullscreen, setFullscreenScale,
        setShowBackdropLibrary, setBackdropRefresh,
    );

    const { handleWorkspaceChange } = useWorkspaceChange(
        editorMode, appMode,
        workspaceRef, isLoadingWorkspaceRef,
        setVariableMonitors, setListMonitors, setTableMonitors,
        setGeneratedCode, setCompiledScripts, setToolboxUpdateKey,
        activeSpriteIdRef, spriteWorkspacesRef,
    );

    const { getCurrentToolbox } = useToolbox(
        editorMode, selectedBoard, selectedSpriteId,
        installedExtensions, installedExtensionsRef,
    );

    const { handleAskSubmit, handlePromptSubmit, handlePromptCancel } = usePromptUtils(
        askState, setAskState,
        promptState, setPromptState,
        workspaceRef, variableType, variableScope, promptInput,
    );

    // Listen for extension iframe messages
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data && event.data.type === 'ADD_EXTENSION') {
                const extId = event.data.extension || event.data.extensionId || event.data.ext;
                if (extId) {
                    handleAddExtension(extId);
                    setShowExtensionLibrary(false);
                }
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [handleAddExtension]);

    // Unsaved Changes Modal State

    const [showUnsavedModal, setShowUnsavedModal] = useState(false);

    const [pendingAction, setPendingAction] = useState<string | null>(null);

    // Goal Popup State
    const [showGoalPopup, setShowGoalPopup] = useState(false);
    const [goalPopupText, setGoalPopupText] = useState('');

    // Show goal popup when lesson has a goal description
    useEffect(() => {
        const config = getLessonConfig() as ReturnType<typeof getLessonConfig> & { goal?: { type: string; target: { x: number; y: number; tolerance: number }; description: string } | null };
        if (config.goal && config.goal.description) {
            setGoalPopupText(config.goal.description);
            setShowGoalPopup(true);
        }
    }, []);



    useEffect(() => {

        Blockly.dialog.setPrompt((message, defaultValue, callback) => {

            setPromptState({

                isOpen: true,

                message,

                defaultValue,

                callback,

                type: 'standard',

            });

            setPromptInput(defaultValue);

        });



        // Global click listener to force blur on Blockly input fields

        const handleGlobalClick = (e: MouseEvent) => {

            const activeElement = document.activeElement;

            if (activeElement && activeElement.classList.contains('blocklyHtmlInput')) {

                // Check if the click was *outside* the input field itself

                if (!activeElement.contains(e.target as Node)) {

                    (activeElement as HTMLElement).blur();

                    // Force Blockly's widget div (which holds the input) to hide

                    if (Blockly.WidgetDiv) {

                        Blockly.WidgetDiv.hide();

                    }

                }

            }

        };

        window.addEventListener('mousedown', handleGlobalClick);



        return () => window.removeEventListener('mousedown', handleGlobalClick);

    }, []);







    const addLog = useCallback((message: string) => {

        setLogMessages(prev => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] ${message}`]);

    }, []);

    const {
        handleCreateVariable,
        handleCreateList,
        handleCreateTable,
        handleCreateBlock,
        handleShowVariable,
        handleHideVariable,
        handleShowList,
        handleHideList,
        handleShowTable,
        handleHideTable,
    } = useDialogHandlers(
        setVariableMonitors, setListMonitors, setTableMonitors,
        addLog, selectedSpriteId, workspaceRef
    );







    /**

     * Preview a block's action on the selected sprite with 2-second auto-revert.

     * Stored as a ref so the flyout listener (attached once) always accesses latest state.

     */

    const previewRevertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const previewBlockActionRef = useRef<(block: Blockly.Block) => void>(() => { });

    previewBlockActionRef.current = (block: Blockly.Block) => {

        const activeSprite = selectedSpriteId ? sprites.find(s => s.id === selectedSpriteId) : null;

        if (!activeSprite) return;



        // Cancel any previous revert timer

        if (previewRevertTimerRef.current) {

            clearTimeout(previewRevertTimerRef.current);

            previewRevertTimerRef.current = null;

        }



        // Save current sprite state before preview

        const saved = {

            x: activeSprite.x, y: activeSprite.y,

            direction: activeSprite.direction, size: activeSprite.size,

            visible: activeSprite.visible, sayText: activeSprite.sayText,

            effects: { ...activeSprite.effects }, rotationStyle: activeSprite.rotationStyle,

        };



        let previewed = true;

        switch (block.type) {

            case 'motion_move_steps': {

                const steps = Number(block.getFieldValue('STEPS')) || 10;

                const rad = (activeSprite.direction - 90) * Math.PI / 180;

                activeSprite.setX(activeSprite.x + Math.cos(rad) * steps);

                activeSprite.setY(activeSprite.y - Math.sin(rad) * steps);

                break;

            }

            case 'motion_move_left': {

                const steps = Math.abs(Number(block.getFieldValue('STEPS')) || 10);

                activeSprite.setX(activeSprite.x - steps);

                break;

            }

            case 'motion_move_up': {

                const steps = Math.abs(Number(block.getFieldValue('STEPS')) || 10);

                activeSprite.setY(activeSprite.y + steps);

                break;

            }

            case 'motion_move_down': {

                const steps = Math.abs(Number(block.getFieldValue('STEPS')) || 10);

                activeSprite.setY(activeSprite.y - steps);

                break;

            }

            case 'motion_turn_right': {

                const deg = Number(block.getFieldValue('DEGREES')) || 15;

                activeSprite.pointInDirection(activeSprite.direction + deg);

                break;

            }

            case 'motion_turn_left': {

                const deg = Number(block.getFieldValue('DEGREES')) || 15;

                activeSprite.pointInDirection(activeSprite.direction - deg);

                break;

            }

            case 'motion_go_to_xy': {

                activeSprite.setX(Number(block.getFieldValue('X')) || 0);

                activeSprite.setY(Number(block.getFieldValue('Y')) || 0);

                break;

            }

            case 'motion_glide_to_xy': {

                activeSprite.startGlide(

                    Number(block.getFieldValue('X')) || 0,

                    Number(block.getFieldValue('Y')) || 0,

                    Number(block.getFieldValue('SECS')) || 1);

                break;

            }

            case 'motion_point_direction':

                activeSprite.pointInDirection(Number(block.getFieldValue('DIRECTION')) || 90);

                break;

            case 'motion_change_x':

                activeSprite.setX(activeSprite.x + (Number(block.getFieldValue('DX')) || 10));

                break;

            case 'motion_change_y':

                activeSprite.setY(activeSprite.y + (Number(block.getFieldValue('DY')) || 10));

                break;

            case 'motion_set_x':

                activeSprite.setX(Number(block.getFieldValue('X')) || 0);

                break;

            case 'motion_set_y':

                activeSprite.setY(Number(block.getFieldValue('Y')) || 0);

                break;

            case 'motion_if_on_edge_bounce':

                activeSprite.ifOnEdgeBounce();

                break;

            case 'motion_set_rotation_style':

                activeSprite.setRotationStyle(block.getFieldValue('STYLE') as any);

                break;

            case 'looks_say':

                activeSprite.say(String(block.getFieldValue('MESSAGE') || 'Hello!'));

                break;

            case 'looks_say_for_secs': {
                const message = String(block.getFieldValue('MESSAGE') || 'Hello!');
                const secs = Number(block.getFieldValue('SECS')) || 2;
                addLog(`Preview: Say "${message}" for ${secs} seconds`);
                activeSprite.say(message, secs);
                break;
            }

            case 'looks_think':

                activeSprite.think(String(block.getFieldValue('MESSAGE') || 'Hmm...'));

                break;

            case 'looks_think_for_secs':

                activeSprite.think(String(block.getFieldValue('MESSAGE') || 'Hmm...'), Number(block.getFieldValue('SECS')) || 2);

                break;

            case 'looks_show': activeSprite.show(); break;

            case 'looks_hide': activeSprite.hide(); break;

            case 'looks_next_costume': activeSprite.nextCostume(); break;

            case 'looks_switch_costume': { const c = block.getFieldValue('COSTUME'); if (c) activeSprite.switchCostume(c); break; }

            case 'looks_set_size': activeSprite.setSize(Number(block.getFieldValue('SIZE')) || 100); break;

            case 'looks_change_size': activeSprite.changeSize(Number(block.getFieldValue('CHANGE')) || 10); break;

            case 'looks_set_effect':

                activeSprite.setEffect(block.getFieldValue('EFFECT') as any, Number(block.getFieldValue('VALUE')) || 0);

                break;

            case 'looks_clear_effects': activeSprite.clearEffects(); break;

            case 'looks_switch_backdrop': { const b = block.getFieldValue('BACKDROP'); if (b) stageManager.setBackdrop(b); break; }

            case 'looks_next_backdrop': stageManager.nextBackdrop(); break;

            default: previewed = false; break;

        }



        if (previewed) {

            activeSprite.jiggle();

            console.log(`[APP] Block preview: ${block.type} on sprite ${activeSprite.name}`);

            // Revert to original state after 2 seconds

            previewRevertTimerRef.current = setTimeout(() => {

                activeSprite.setX(saved.x);

                activeSprite.setY(saved.y);

                activeSprite.pointInDirection(saved.direction);

                activeSprite.setSize(saved.size);

                if (saved.visible) activeSprite.show(); else activeSprite.hide();

                activeSprite.setRotationStyle(saved.rotationStyle);

                activeSprite.clearEffects();

                if (saved.effects) {

                    Object.entries(saved.effects).forEach(([eff, val]) => {

                        if (val !== 0) activeSprite.setEffect(eff as any, val as number);

                    });

                }

                if (saved.sayText) activeSprite.say(saved.sayText); else activeSprite.clearSay();

                previewRevertTimerRef.current = null;

                console.log(`[APP] Preview reverted for sprite ${activeSprite.name}`);

            }, 2000);

        }

    };

    /**

     * Handle real-time block interaction: preview animation blocks + hardware control

     */

    const {
        saveCurrentSpriteWorkspace,
        handleCopyBlocksToSprite,
        handleCopyCodeToSprite,
        handleBlockDrag,
    } = useWorkspaceManagement(workspaceRef, activeSpriteIdRef, spriteWorkspacesRef, draggedBlockStateRef, lastPointerPosRef);

    const handleBlockInteraction = useCallback(async (event: Blockly.Events.Abstract) => {

        if (!workspaceRef.current) return;

        // Block clicks are now handled by useBlockClickListener (DOM event delegation).
        // This listener only handles BLOCK_CHANGE for real-time field edits.
        if (event.type !== Blockly.Events.BLOCK_CHANGE) return;



        const blockId = (event as any).blockId;

        if (!blockId) return;

        const block = workspaceRef.current.getBlockById(blockId);

        if (!block) return;

        if (editorMode !== 'stage' || !isConnected) return;

        if (!block.type.startsWith('arduino_')) return;

        if (activeTab !== 'serial') setActiveTab('serial');

        log.app('Real-time field change', { type: block.type, event: event.type });

    }, [editorMode, isConnected, activeTab, setActiveTab]);



    // ═══════════════════════════════════════════════════════════════════════

    // SPRITE MANAGEMENT HELPERS

    // ═══════════════════════════════════════════════════════════════════════

    // Save current workspace blocks to the per-sprite map



    // Load workspace blocks from the per-sprite map

    const {
        loadSpriteWorkspace,
        switchEditorMode,
        handleSoundChange,
        handleWorkspaceTabChange,
        handleSpriteSelect,
        handleSpriteClick,
        getDefaultSoundForSprite,
    } = useSpriteManagement(
        workspaceRef, activeSpriteIdRef, spriteWorkspacesRef, isLoadingWorkspaceRef,
        handleWorkspaceChange, saveCurrentSpriteWorkspace, addLog,
        selectedSpriteId, setSelectedSpriteId,
        editorMode, setEditorMode,
        workspaceTab, setWorkspaceTab,
        compiledScripts, sprites, syncAllWorkspacesRef,
        variableMonitorsRef, listMonitorsRef, tableMonitorsRef
    );

    const {
        addSprite,
        handleUploadSprite,
        handleUploadSpriteFile,
        handleRemoveBackground,
        deleteSprite,
    } = useSpriteOperations(
        sprites, setSprites, selectedSpriteId, setSelectedSpriteId,
        addLog, triggerUpdate,
        spriteWorkspacesRef, workspaceRef, isLoadingWorkspaceRef, activeSpriteIdRef,
        uploadSpriteFileRef,
        saveCurrentSpriteWorkspace, loadSpriteWorkspace, getDefaultSoundForSprite
    );



    const {
        executeNewProject,
        buildProjectPayload,
        handleSaveProject,
        handleDownloadProject,
        loadProjectFromData,
        executeOpenProject,
    } = useProjectOperations(
        sprites, setSprites, selectedSpriteId, setSelectedSpriteId,
        projectName, setProjectName,
        addLog, triggerUpdate,
        spriteWorkspacesRef, workspaceRef, isLoadingWorkspaceRef, activeSpriteIdRef,
        installedExtensionsRef, setInstalledExtensions,
        variableMonitors, setVariableMonitors,
        listMonitors, setListMonitors,
        tableMonitors, setTableMonitors,
        sensingMonitors, setSensingMonitors,
        setCompiledScripts, setIsRunning,
        loadSpriteWorkspace,
        editorMode, setEditorMode
    );

    const handleNewProject = useCallback(() => {
        setPendingAction('new');
        setShowUnsavedModal(true);
    }, []);

    const handleOpenProject = useCallback(() => {
        setPendingAction('open');
        setShowUnsavedModal(true);
    }, []);

    const confirmUnsavedAction = useCallback(async (saveFirst: boolean) => {
        setShowUnsavedModal(false);
        if (saveFirst) {
            await handleSaveProject(true);
            if (pendingAction === 'new') executeNewProject();
            if (pendingAction === 'open') executeOpenProject();
            setPendingAction(null);
        } else {
            if (pendingAction === 'new') executeNewProject();
            if (pendingAction === 'open') executeOpenProject();
            setPendingAction(null);
        }
    }, [pendingAction, handleSaveProject, executeNewProject, executeOpenProject]);



    const {
        syncAllWorkspaces,
        handleRunClick,
        handleStopClick,
        handleUndo,
        handleRedo,
    } = useAnimationControl(
        selectedSpriteId, setSelectedSpriteId,
        sprites, setSprites, setIsCameraOn, setIsRunning, setCompiledScripts,
        setAskState, addLog,
        spriteWorkspacesRef, workspaceRef
    );

    syncAllWorkspacesRef.current = syncAllWorkspaces;



    const {
        refreshPorts,
        handleConnect,
        handleSendSerial,
        handleUpload,
    } = useHardwareControls(
        editorMode, selectedPort, isConnected, baudRate, selectedBoard,
        generatedCode, isUploading,
        setPorts, setIsConnected, setSerialMessages, setIsUploading,
        setUploadProgress, setActiveTab, addLog, setBaudRate
    );

    // Full-block click listener — captures clicks on the ENTIRE block area
    // (blocklyPath, inputs, icons, connections) via DOM event delegation
    useBlockClickListener({
        workspaceRef,
        selectedSpriteId,
        sprites,
        editorMode,
        isConnected,
        activeTab,
        setActiveTab,
        setIsRunning,
        addLog,
        previewBlockActionRef,
        syncAllWorkspacesRef,
    });


    // ═══════════════════════════════════════════════════════════════════════

    // INITIALIZATION

    // ═══════════════════════════════════════════════════════════════════════



    // Create default sprites (Stage + Robot) on mount

    useEffect(() => {

        if (editorMode === 'stage' && sprites.length === 0 && !projectUrl) {

            console.log('[APP] Initializing sprites (Stage + Default Robot)...');



            // 1. Create Stage Sprite (for backdrop management and stage scripts)

            const stageSprite = new Sprite('stage', 'Stage', triggerUpdate, 'cat'); // cat is dummy type

            stageSprite.hide(); // Stage sprite is only for scripting/backdrops and should not be visible on canvas

            spriteWorkspacesRef.current.set('stage', {}); // Initialize empty workspace for stage



            // 2. Create Default Robot Sprite

            const defaultSprite = new Sprite('sprite_default', 'Robot', triggerUpdate, 'robot');

            // leap coords: (0,0) is center of stage

            defaultSprite.setX(0);

            defaultSprite.setY(0);

            spriteWorkspacesRef.current.set('sprite_default', {}); // Initialize empty workspace for robot



            // Add robot costumes

            const loadAssets = async () => {

                console.log('[APP] Loading assets for robot...');

                await defaultSprite.addCostume('idle', 'assets/sprites/robot/robot_idle.svg');

                await defaultSprite.addCostume('wave 1', 'assets/sprites/robot/image-removebg-preview (1).png');

                await defaultSprite.addCostume('wave 2', 'assets/sprites/robot/image-Photoroom.png');

                await defaultSprite.addCostume('talk', 'assets/sprites/robot/image-removebg-preview.png');



                // Add default sound

                await defaultSprite.addSound('Meow', 'assets/sounds/83c36d806dc92327b9e7049a565c6bff.wav');

                console.log('[APP] Assets loaded:', defaultSprite.costumes.length, 'costumes', defaultSprite.sounds.length, 'sounds');

                triggerUpdate();

                // Manually nudge the stage to repaint in case it didn't catch the update

                window.dispatchEvent(new Event('leap-stage-update'));

            };

            loadAssets().catch(err => console.error('[APP] Failed to initialize assets:', err));



            // Register both with VM

            animationVM.registerSprite(stageSprite);

            animationVM.registerSprite(defaultSprite);



            setSprites([stageSprite, defaultSprite]);

            setSelectedSpriteId('sprite_default');

            activeSpriteIdRef.current = 'sprite_default';

        }

    }, [editorMode, projectUrl]);

    // Handle cloud store pendingProject or direct projectUrl loading into IntermediateApp
    useEffect(() => {
        const { pendingProject, clearPendingProject } = useCloudProjectStore.getState();
        if (pendingProject && (pendingProject.mode === 'intermediate' || pendingProject.mode === 'blocks')) {
            const data = pendingProject.data;
            clearPendingProject();
            loadProjectFromData(data, 'Cloud Project');
            return;
        }

        if (projectUrl && loadedProjectUrlRef.current !== projectUrl) {
            loadedProjectUrlRef.current = projectUrl;
            (async () => {
                try {
                    addLog('Fetching project from URL...');
                    const resp = await fetch(projectUrl);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = await resp.json();
                    loadProjectFromData(data, 'URL Project');
                } catch (err: any) {
                    console.error('[IntermediateApp] Failed to load projectUrl:', err);
                    addLog(`Failed to load project: ${err.message}`);
                }
            })();
        }
    }, [projectUrl, loadProjectFromData, addLog]);



    // Define sound, costume, and backdrop helpers for Blockly

    useEffect(() => {

        (window as any).getActiveSpriteSounds = () => {

            const activeId = activeSpriteIdRef.current;

            if (!activeId) return [];

            if (activeId === 'stage') {
                return stageManager.getAllSounds().map((s: any) => s.name);
            }

            const sprite = animationVM.getSprite(activeId);

            if (sprite && sprite.sounds) {

                return sprite.sounds.map((s: any) => s.name);

            }

            return [];

        };

        (window as any).getActiveSpriteCostumes = () => {

            const activeId = activeSpriteIdRef.current;

            if (!activeId) return [];

            const sprite = animationVM.getSprite(activeId);

            if (sprite && sprite.costumes) {

                return sprite.costumes.map((c: any) => c.name);

            }

            return [];

        };

        (window as any).getActiveStageBackdrops = () => {

            if (stageManager) {

                return stageManager.getAllBackdrops().map(b => b.name);

            }

            return [];

        };

        (window as any).getBroadcastMessages = () => {
            return animationVM.getBroadcastMessages();
        };

        // ── Pen tip calibration helpers (accessible from browser console) ──
        // Usage: window.setPenTip(nx, ny)  e.g. window.setPenTip(-0.3, 0.45)
        // Usage: window.autoDetectPenTip()
        (window as any).setPenTip = (nx: number, ny: number) => {
            const id = activeSpriteIdRef.current;
            if (!id) { console.warn('[PenTip] No active sprite'); return; }
            const sprite = spriteManager.getSprite(id);
            if (!sprite) { console.warn('[PenTip] Sprite not found:', id); return; }
            sprite.setPenTipOffset(nx, ny);
            console.log(`[PenTip] Set tip offset for "${sprite.name}" to (${nx}, ${ny})`);
        };
        (window as any).autoDetectPenTip = () => {
            const id = activeSpriteIdRef.current;
            if (!id) { console.warn('[PenTip] No active sprite'); return; }
            const sprite = spriteManager.getSprite(id);
            if (!sprite) { console.warn('[PenTip] Sprite not found:', id); return; }
            sprite.autoDetectPenTip();
        };
        // Expose spriteManager for fd_count/fd_guess_emotion generators
        (window as any).spriteManager = spriteManager;

        (window as any).createNewBroadcast = (callback: (name: string | null) => void) => {
            const existing = document.querySelector('body>div[data-broadcast-prompt]');
            if (existing) return;

            const overlay = document.createElement('div');
            overlay.setAttribute('data-broadcast-prompt', '');
            overlay.setAttribute('style', 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);');

            const box = document.createElement('div');
            box.setAttribute('style', 'background:#fff;border-radius:12px;padding:24px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.25);font-family:sans-serif;');

            const label = document.createElement('div');
            label.textContent = 'New message name:';
            label.setAttribute('style', 'font-size:14px;font-weight:600;margin-bottom:12px;color:#333;');

            const input = document.createElement('input');
            input.type = 'text';
            input.autofocus = true;
            input.setAttribute('style', 'width:100%;padding:10px 12px;font-size:14px;border:2px solid #ddd;border-radius:8px;outline:none;box-sizing:border-box;');
            input.addEventListener('focus', () => input.style.borderColor = '#FFBF00');
            input.addEventListener('blur', () => input.style.borderColor = '#ddd');

            const btnRow = document.createElement('div');
            btnRow.setAttribute('style', 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;');

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.setAttribute('style', 'padding:8px 16px;font-size:14px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;');

            const okBtn = document.createElement('button');
            okBtn.textContent = 'OK';
            okBtn.setAttribute('style', 'padding:8px 16px;font-size:14px;border:none;border-radius:8px;background:#FFBF00;color:#fff;cursor:pointer;font-weight:600;');

            const cleanup = (result: string | null) => {
                document.body.removeChild(overlay);
                if (result) {
                    animationVM.registerBroadcast(result);
                }
                callback(result);
            };

            cancelBtn.addEventListener('click', () => cleanup(null));
            okBtn.addEventListener('click', () => cleanup(input.value || null));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') okBtn.click();
                if (e.key === 'Escape') cancelBtn.click();
            });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            box.appendChild(label);
            box.appendChild(input);
            box.appendChild(btnRow);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            setTimeout(() => input.focus(), 50);
        };

        // Expose all sprite names for sensing_touching dropdown
        (window as any).getAllSpriteNames = () => {
            const allSprites = spriteManager.getAllSprites();
            const activeId = activeSpriteIdRef.current;
            // Return names of all non-clone sprites, excluding the active one
            const names: string[] = [];
            const seen = new Set<string>();
            for (const sprite of allSprites) {
                // Skip clones (they have '_clone_' in their ID) and the active sprite
                if (!sprite.id.includes('_clone_') && sprite.id !== activeId && !seen.has(sprite.name)) {
                    names.push(sprite.name);
                    seen.add(sprite.name);
                }
            }
            return names;
        };

        return () => {
            delete (window as any).getActiveSpriteSounds;

            delete (window as any).getActiveSpriteCostumes;

            delete (window as any).getActiveStageBackdrops;

            delete (window as any).getAllSpriteNames;

            delete (window as any).onToggleVisibility;

        };

    }, []);



    // Initialize Blockly workspace AFTER sprite state is set

    useEffect(() => {

        log.app('Initializing Blockly workspace');



        log.app('Initializing Blockly workspace on first mount avoided. Will be handled by mode change effect.');



        // Set up serial data listener (only if electronAPI is available)

        if (window.electronAPI?.onSerialData) {

            window.electronAPI.onSerialData((data) => {

                setSerialMessages(prev => [...prev.slice(-100), data]);

            });

        }



        if (window.electronAPI?.onConnectionChange) {

            window.electronAPI.onConnectionChange((connected) => {

                setIsConnected(connected);

            });

        }



        if (window.electronAPI?.onUploadProgress) {

            window.electronAPI.onUploadProgress((progress, message) => {

                setUploadProgress(`${progress}%: ${message}`);

            });

        }



        // Initial port scan

        if (window.electronAPI?.getPorts) {

            window.electronAPI.getPorts().then(portList => {

                setPorts(portList);

            });

        }



        // --- VM CALLBACKS ---

        animationVM.onRunningChange = (running) => {

            setIsRunning(running);

        };



        // Monitor callbacks (unified for both VMs)
        const commonCallbacks = {
            onShowVariable: handleShowVariable,
            onHideVariable: handleHideVariable,
            onShowList: handleShowList,
            onHideList: handleHideList,
            onShowTable: handleShowTable,
            onHideTable: handleHideTable,
            onLog: addLog
        };

        Object.assign(animationVM, commonCallbacks);
        Object.assign(leapRuntime, commonCallbacks);

        // --- VM CHANGE CALLBACKS (Real-time Sync) ---
        animationVM.onVariableChange = (name, value) => {
            setVariableMonitors(prev => prev.map(m => m.name === name ? { ...m, value } : m));
        };
        animationVM.onListChange = (name, items) => {
            setListMonitors(prev => prev.map(m => m.name === name ? { ...m, items, value: items } : m));
        };
        animationVM.onTableChange = (name, data) => {
            setTableMonitors(prev => prev.map(m => m.name === name ? { ...m, data, value: data } : m));
        };

        // --- SENSING SYNC ---
        const sensingSyncInterval = setInterval(() => {
            if (isRunningRef.current) {
                setSensingMonitors(prev => prev.map(m => {
                    if (m.name === 'timer') return { ...m, value: Math.round(animationVM.getTimer() * 10) / 10 };
                    if (m.name === 'answer') return { ...m, value: animationVM.getAnswer() };
                    if (m.name === 'loudness') return { ...m, value: animationVM.getLoudness() || 0 };
                    return m;
                }));
            }
        }, 100);

        // --- BLOCKLY VISIBILITY CALLBACKS ---
        // We use refs here to avoid stale closures in the window functions
        // since this useEffect only runs once for VM/Runtime setup.
        const monitorsRef = {
            variable: variableMonitors,
            list: listMonitors,
            table: tableMonitors
        };

        (window as any).getVariableVisibility = (name: string, type: string) => {
            const currentMonitors = (window as any)._monitors_for_sync?.[type] || [];
            const monitor = currentMonitors.find((m: any) => m.name === name);
            return monitor ? monitor.visible : false;
        };

        (window as any).onToggleVisibility = (name: string, type: string, forceVisible?: boolean) => {
            const setFn = type === 'variable' ? setVariableMonitors : (type === 'list' ? setListMonitors : (type === 'table' ? setTableMonitors : setSensingMonitors));

            setFn((prev: any[]) => {
                const existing = prev.find(m => m.name === name);
                const newVisible = forceVisible !== undefined ? forceVisible : (existing ? !existing.visible : true);

                if (existing) {
                    return prev.map(m => m.name === name ? { ...m, visible: newVisible } : m);
                } else if (type !== 'sensing') {
                    // Create new with defaults
                    const newY = 10 + (prev.length * 30);
                    if (type === 'variable') {
                        return [...prev, normalizeVariableMonitor({
                            id: `var_${Date.now()}`,
                            name,
                            type: 'Number',
                            scope: 'all_sprites',
                            visible: true,
                            x: 10, y: newY,
                            value: animationVM.hasVariable(name) ? animationVM.getVariable(name) : 0
                        }, prev.length)];
                    } else if (type === 'list') {
                        return [...prev, {
                            id: `list_${Date.now()}`,
                            name,
                            scope: 'all_sprites',
                            visible: true,
                            x: 10, y: newY,
                            items: [...animationVM.getList(name)],
                            value: [...animationVM.getList(name)],
                            width: 100,
                            height: 200
                        }];
                    } else if (type === 'table') {
                        return [...prev, {
                            id: `table_${Date.now()}`,
                            name,
                            scope: 'all_sprites',
                            visible: true,
                            x: 10, y: newY,
                            rows: animationVM.getTableCount(name, 'row'),
                            cols: animationVM.getTableCount(name, 'column'),
                            data: [...animationVM.getTable(name)],
                            value: [...animationVM.getTable(name)],
                            width: 250,
                            height: 200
                        }];
                    }
                }
                return prev;
            });
        };



        return () => {

            console.log('[IntermediateApp] Cleaning up workspace...');

            // Reset block initialization guard so blocks are re-registered on next mount.
            // Without this, Junior mode's block definitions (e.g. looks_say with dropdown)
            // persist and clobber Intermediate's definitions (looks_say with MESSAGE input).
            resetBlocklyInitialized();

            clearInterval(sensingSyncInterval);
            animationVM.resetState();
            stageManager.reset();
            spriteManager.clear();
            hardwareAdapter.stopAllPolling();

            if (window.electronAPI?.removeAllListeners) {

                window.electronAPI.removeAllListeners();

            }

            try {
                if ((Blockly as any).WidgetDiv) {
                    (Blockly as any).WidgetDiv.hide();
                }
            } catch (_) { }

            try {
                if ((Blockly as any).DropDownDiv) {
                    (Blockly as any).DropDownDiv.hideWithoutAnimation();
                }
            } catch (_) { }

            const wsToDispose = workspaceRef.current;

            if (wsToDispose) {

                wsToDispose.dispose();

                workspaceRef.current = null;

            }

            try {
                const allWorkspaces: any[] = (Blockly as any).Workspace?.getAllWorkspaces?.();
                if (allWorkspaces && allWorkspaces.length > 0) {
                    allWorkspaces.forEach((ws: any) => {
                        if (ws && ws !== wsToDispose && ws !== workspaceRef.current && typeof ws.dispose === 'function') {
                            try { ws.dispose(); } catch (_) { }
                        }
                    });
                }
            } catch (_) { }

        };

        // eslint-disable-next-line react-hooks/exhaustive-deps

    }, []);





    // Update toolbox and selected category contents when sprite or category structure changes
    // NOTE: variableMonitors/listMonitors/tableMonitors intentionally excluded from deps — 
    // checkbox toggles update internally via Blockly's FieldCheckbox; a full rebuild on 
    // every visibility toggle would cause a cascade through the patched setValue → 
    // onToggleVisibility → setVariableMonitors → rebuild loop.
    // Toolbox is rebuilt only when sprite changes, editor mode switches, or 
    // VAR_CREATE/VAR_DELETE events trigger toolboxUpdateKey.

    useEffect(() => {
        if (!workspaceRef.current || appMode !== 'blocks') {
            return;
        }
        if (isRebuildingToolboxRef.current) return;
        isRebuildingToolboxRef.current = true;

        const nextToolboxConfig = getCurrentToolbox();
        const nextToolboxJson = JSON.stringify(nextToolboxConfig);
        const currentToolbox = workspaceRef.current.getToolbox() as any;
        const selectedCategoryName = typeof currentToolbox?.getSelectedItem?.()?.getName === 'function'
            ? currentToolbox.getSelectedItem().getName()
            : null;

        if (nextToolboxJson !== lastToolboxJsonRef.current) {
            console.log('[APP] Updating toolbox dynamically (Sprite:', selectedSpriteId, ')');

            workspaceRef.current.updateToolbox(nextToolboxConfig);
            lastToolboxJsonRef.current = nextToolboxJson;

            const refreshedToolbox = workspaceRef.current.getToolbox() as any;
            const toolboxItems = typeof refreshedToolbox?.getToolboxItems === 'function'
                ? refreshedToolbox.getToolboxItems().filter((item: any) => typeof item?.getName === 'function')
                : [];

            if (selectedCategoryName) {
                const matchingItem = toolboxItems.find((item: any) => item.getName() === selectedCategoryName);
                if (matchingItem && typeof refreshedToolbox?.setSelectedItem === 'function') {
                    refreshedToolbox.setSelectedItem(matchingItem);
                }
            }

            if (!refreshedToolbox?.getSelectedItem?.() && typeof refreshedToolbox?.selectItemByPosition === 'function') {
                refreshedToolbox.selectItemByPosition(0);
            } else {
                workspaceRef.current.refreshToolboxSelection();
            }

            const flyout = workspaceRef.current.getFlyout() as any;
            if (flyout?.reflowInternal_) flyout.reflowInternal_();
        }

        setTimeout(() => { isRebuildingToolboxRef.current = false; }, 0);
    }, [selectedSpriteId, editorMode, appMode, getCurrentToolbox, toolboxUpdateKey]);



    // Reinitialize workspace when appMode or editorMode changes

    useEffect(() => {

        if (appMode === 'blocks' && blocklyDiv.current) {

            console.log('[APP] Mode changed (App:', appMode, 'Editor:', editorMode, ') - reinitializing workspace');



            // Dispose existing workspace

            if (workspaceRef.current) {

                workspaceRef.current.dispose();

                workspaceRef.current = null;

            }



            // Short timeout to ensure DOM is ready and ref is updated

            const timer = setTimeout(() => {

                if (blocklyDiv.current) {

                    // Configure Blockly connection snap behavior for multi-directional insertion
                    (Blockly as any).config.snapRadius = 40;
                    (Blockly as any).config.connectingSnapRadius = 60;
                    (Blockly as any).config.currentConnectionPreference = 0;

                    // Disable bumpNeighbours: during render it shoves any block within
                    // snapRadius away from newly created blocks, so the target block is
                    // displaced before the user drags onto it — breaking the insertion
                    // marker preview from every direction but the first.
                    (Blockly.BlockSvg.prototype as any).bumpNeighbours = () => { };

                    // Inject Blockly

                    const blocksWorkspace = Blockly.inject(blocklyDiv.current, {
                        renderer: 'leap',
                        toolbox: getCurrentToolbox(),
                        media: BLOCKLY_MEDIA_PATH,
                        comments: true,
                        move: { scrollbars: true, drag: true, wheel: true },

                        grid: { spacing: 20, length: 3, colour: '#e8e8e8', snap: true },

                        zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 3, minScale: 0.3, scaleSpeed: 1.2 },

                        trashcan: true,

                        sounds: false,

                        theme: Blockly.Theme.defineTheme('leapblocks', {

                            name: 'leapblocks',

                            base: Blockly.Themes.Classic,

                            componentStyles: {

                                workspaceBackgroundColour: '#f9f9f9',

                                toolboxBackgroundColour: '#ffffff',

                                toolboxForegroundColour: '#575E75',

                                flyoutBackgroundColour: '#f9f9f9',

                                flyoutForegroundColour: '#575E75',

                                flyoutOpacity: 1,

                                scrollbarColour: '#ccc',

                                insertionMarkerColour: '#4C97FF',

                                insertionMarkerOpacity: 0.3,

                                scrollbarOpacity: 0.4,

                                cursorColour: '#d0d0d0',

                            },

                        }),

                    });



                    workspaceRef.current = blocksWorkspace;
                    (blocksWorkspace as any)[LEAP_CUSTOM_BLOCK_CONTEXT_MENU_FLAG] = true;

                    // Ensure workspace SVG is sized correctly even if inject ran before layout settled
                    Blockly.svgResize(blocksWorkspace);

                    // 1. BLOCK REPLACEMENT LISTENER
                    // Auto-replace checkbox-reporters from flyout with standard reporters in workspace
                    blocksWorkspace.addChangeListener((event: any) => {
                        if ((event.type === Blockly.Events.BLOCK_CREATE || event.type === Blockly.Events.BLOCK_MOVE) && !isLoadingWorkspaceRef.current) {
                            const blockId = event.type === Blockly.Events.BLOCK_CREATE ? event.blockId : event.id;
                            const block = blocksWorkspace.getBlockById(blockId);

                            if (block && (block.type === 'variable_reporter_checkbox' || block.type === 'list_reporter_checkbox' || block.type === 'sensing_reporter_checkbox')) {
                                // IMPORTANT: Do not replace while dragging or it breaks the gesture
                                if (typeof (blocksWorkspace as any).isDragging === 'function' && (blocksWorkspace as any).isDragging()) return;

                                const isVariable = block.type === 'variable_reporter_checkbox';
                                const isSensing = block.type === 'sensing_reporter_checkbox';
                                const nameField = isVariable ? 'VARIABLE' : (isSensing ? 'VARIABLE' : 'LIST');
                                const name = block.getFieldValue(nameField);

                                // Determine type (Variable, List, Table, or Sensing)
                                let newType = isVariable ? 'data_variable' : (isSensing ? `sensing_${name}` : 'data_listcontents');
                                let varType: string = isVariable ? '' : (isSensing ? 'sensing' : 'list');

                                if (block.type === 'list_reporter_checkbox') {
                                    // Check if this is actually a table (they share the same checkbox block type)
                                    const variable = blocksWorkspace.getVariable(name, 'table');
                                    if (variable) {
                                        newType = 'data_tablecontents';
                                        varType = 'table';
                                    }
                                }

                                // Record position and parent connection before disposal
                                const xy = block.getRelativeToSurfaceXY();
                                // Save the parent input connection so we can reconnect the replacement block
                                const parentConnection = block.outputConnection?.targetConnection || null;

                                // New block logic - resolve the real variable ID
                                // We use setTimeout to ensure we don't interfere with the current event loop/gesture
                                setTimeout(() => {
                                    if (!blocksWorkspace.getBlockById(blockId)) return; // Already gone

                                    Blockly.Events.disable();
                                    try {
                                        block.dispose(false);
                                        const newBlock = blocksWorkspace.newBlock(newType);

                                        if (!isSensing) {
                                            // Find real variable ID for the name
                                            // Try all variable types since variables may be created with 'Number', 'String', or ''
                                            const variable = blocksWorkspace.getVariable(name, varType)
                                                || blocksWorkspace.getVariable(name, 'Number')
                                                || blocksWorkspace.getVariable(name, 'String')
                                                || blocksWorkspace.getVariable(name, '');
                                            const valueToSet = variable ? variable.getId() : name;
                                            newBlock.setFieldValue(valueToSet, nameField);
                                        }

                                        newBlock.initSvg();
                                        newBlock.render();

                                        // Reconnect to parent input if the old block was connected
                                        if (parentConnection && newBlock.outputConnection) {
                                            try {
                                                parentConnection.connect(newBlock.outputConnection);
                                            } catch (connectErr) {
                                                // If reconnection fails, fall back to positioning
                                                console.warn('[BlockReplace] Could not reconnect to parent:', connectErr);
                                                newBlock.moveBy(xy.x, xy.y);
                                            }
                                        } else {
                                            newBlock.moveBy(xy.x, xy.y);
                                        }
                                        newBlock.select();
                                    } finally {
                                        Blockly.Events.enable();
                                    }
                                }, 0);
                            }
                        }
                    });

                    lastToolboxJsonRef.current = JSON.stringify(getCurrentToolbox());

                    // Initialize custom blocks and field overrides only once globally
                    if (!blocksInitialized) {
                        // 1. Define custom blocks for reporter checkboxes
                        Blockly.common.defineBlocksWithJsonArray([
                            {
                                "type": "variable_reporter_checkbox",
                                "message0": "%1 %2",
                                "args0": [
                                    { "type": "field_checkbox", "name": "CHECK", "checked": false },
                                    { "type": "field_input", "name": "VARIABLE", "text": "variable", "enabled": false }
                                ],
                                "output": "Number",
                                "colour": "#FF8C1A",
                                "tooltip": "Toggle variable visibility",
                                "web-class": "variable-checkbox-container"
                            },
                            {
                                "type": "list_reporter_checkbox",
                                "message0": "%1 %2",
                                "args0": [
                                    { "type": "field_checkbox", "name": "CHECK", "checked": false },
                                    { "type": "field_input", "name": "LIST", "text": "list", "enabled": false }
                                ],
                                "output": "String",
                                "colour": "#FF8C1A",
                                "tooltip": "Toggle list visibility",
                                "web-class": "list-checkbox-container"
                            },
                            {
                                "type": "sensing_reporter_checkbox",
                                "message0": "%1 %2",
                                "args0": [
                                    { "type": "field_checkbox", "name": "CHECK", "checked": false },
                                    { "type": "field_input", "name": "VARIABLE", "text": "variable", "enabled": false }
                                ],
                                "output": "String",
                                "colour": "#5CB1D6",
                                "tooltip": "Toggle sensing monitor visibility",
                                "web-class": "sensing-checkbox-container"
                            }
                        ]);

                        // 2. Define custom generators for the reporter blocks
                        const javascriptGenerator = (Blockly as any).javascriptGenerator || (Blockly as any).JavaScript;
                        if (javascriptGenerator) {
                            javascriptGenerator['variable_reporter_checkbox'] = (block: any) => {
                                const varName = block.getFieldValue('VARIABLE');
                                return [varName, (Blockly as any).javascriptGenerator.ORDER_ATOMIC];
                            };
                            javascriptGenerator['list_reporter_checkbox'] = (block: any) => {
                                const listName = block.getFieldValue('LIST');
                                return [listName, (Blockly as any).javascriptGenerator.ORDER_ATOMIC];
                            };
                            javascriptGenerator['sensing_reporter_checkbox'] = (block: any) => {
                                const varName = block.getFieldValue('VARIABLE');
                                return [varName, (Blockly as any).javascriptGenerator.ORDER_ATOMIC];
                            };
                        }

                        // 4. Hook FieldCheckbox to toggle visibility
                        // We capture the original setValue only once to avoid recursive wrapping
                        if (!originalCheckboxSetValue) {
                            originalCheckboxSetValue = Blockly.FieldCheckbox.prototype.setValue;
                            Blockly.FieldCheckbox.prototype.setValue = function (this: any, newValue: any) {
                                // Call original logic first to ensure the value is updated
                                if (originalCheckboxSetValue) {
                                    originalCheckboxSetValue.call(this, newValue);
                                }

                                const block = this.getSourceBlock();
                                // Performance: Only run logic if we are on a reporter checkbox block and not during disposal
                                if (block && !block.isDisposed() && (block.type === 'variable_reporter_checkbox' || block.type === 'list_reporter_checkbox' || block.type === 'sensing_reporter_checkbox')) {
                                    // GUARD: Only trigger on actual user-initiated events to prevent flickering/loops during toolbox rebuilds
                                    if (isRebuildingToolboxRef.current || !Blockly.Events.isEnabled()) return;

                                    const isSensing = block.type === 'sensing_reporter_checkbox';
                                    const type = isSensing ? 'sensing' : (block.type === 'variable_reporter_checkbox' ? 'variable' : 'list');
                                    const nameField = isSensing ? 'VARIABLE' : (type === 'variable' ? 'VARIABLE' : 'LIST');
                                    const name = block.getFieldValue(nameField);

                                    // Robust check for boolean vs string 'TRUE'
                                    const checked = this.getValue() === 'TRUE' || this.getValue() === true;

                                    if (name) {
                                        // Check if current visibility matches checkbox to avoid loops/stale updates
                                        // Use direct sync monitor check if window helper isn't available
                                        const currentVisible = (window as any).getVariableVisibility ?
                                            (window as any).getVariableVisibility(name, type) :
                                            !!(window as any)._monitors_for_sync?.[type]?.find((m: any) => m.name === name)?.visible;

                                        if (checked !== currentVisible) {
                                            console.log(`[BLOCKLY] Checkbox toggle for ${type} '${name}': ${checked}`);
                                            (window as any).onToggleVisibility?.(name, type, checked);
                                        }
                                    }
                                }
                                return null;
                            };
                        }

                        blocksInitialized = true;
                    }



                    // Keep the flyout pinned open and at a fixed scale so it
                    // does not zoom with the workspace viewport.
                    if (blocksWorkspace) {

                        const flyout = blocksWorkspace.getFlyout() as any;

                        if (flyout) {

                            flyout.autoClose = false;

                            // Keep the flyout scale pinned at 0.8 so blocks don't change size.
                            const FIXED_FLYOUT_SCALE = 0.8;
                            let isDragging = false;
                            let isMouseOverFlyout = false;

                            flyout.getFlyoutScale = () => FIXED_FLYOUT_SCALE;
                            if (flyout.getWorkspace()) {
                                flyout.getWorkspace().setScale(FIXED_FLYOUT_SCALE);
                            }

                            // ── FLYOUT OVERFLOW ────────────────────────────────────────────────
                            // The flyout background panel keeps a compact 240px width.
                            // When the cursor enters the flyout (or while dragging), wide blocks
                            // that are clipped at 240px show in full length by overflowing into
                            // the workspace area. Short blocks inside do not change size.
                            const FIXED_FLYOUT_WIDTH = 240;
                            const FLYOUT_RADIUS = flyout.CORNER_RADIUS ?? 8;

                            flyout.getWidth = () => FIXED_FLYOUT_WIDTH;

                            const origSetBackgroundPath = flyout.setBackgroundPath?.bind(flyout);
                            if (origSetBackgroundPath) {
                                flyout.setBackgroundPath = (w: number, h: number) => {
                                    origSetBackgroundPath(FIXED_FLYOUT_WIDTH - 2 * FLYOUT_RADIUS, h);
                                };
                            }

                            const origPositionAt = flyout.positionAt_.bind(flyout);
                            flyout.positionAt_ = (w: number, h: number, x: number, y: number) => {
                                origPositionAt(FIXED_FLYOUT_WIDTH, h, x, y);
                            };

                            const origReflow = flyout.reflowInternal_.bind(flyout);
                            flyout.reflowInternal_ = () => {
                                origReflow();
                                flyout.width_ = FIXED_FLYOUT_WIDTH;
                                flyout.position();
                            };
                            const origPos = flyout.position.bind(flyout);
                            flyout.position = () => {
                                origPos();
                                flyout.width_ = FIXED_FLYOUT_WIDTH;
                            };

                            // Allow blocks to overflow visually past the flyout edge ONLY on hover.
                            // The flyout is a SIBLING <svg class="blocklyFlyout blocklyToolboxFlyout">
                            // next to .blocklySvg — it is NOT inside the main workspace svg. So the
                            // overflow class must be toggled directly on flyout.svgGroup_.
                            const flyoutSvg = flyout.svgGroup_ as HTMLElement | null;
                            const mainSvg = document.querySelector('.blocklySvg') as HTMLElement | null;

                            const unclipFlyout = () => {
                                const els: (SVGElement | Element | null)[] = [
                                    flyoutSvg,
                                    flyoutSvg?.querySelector?.('.blocklyWorkspace') ?? null,
                                    flyoutSvg?.querySelector?.('.blocklyBlockCanvas') ?? null,
                                    ...(Array.from(flyoutSvg?.querySelectorAll?.('.blocklyBlockCanvas *') ?? [])),
                                ];
                                for (const el of els) {
                                    if (!el) continue;
                                    (el as SVGElement).style.clipPath = 'none';
                                    (el as any).style.webkitClipPath = 'none';
                                    el.removeAttribute?.('clip-path');
                                }
                                for (const root of [flyoutSvg, mainSvg]) {
                                    if (!root) continue;
                                    for (const rect of root.querySelectorAll('clipPath rect')) {
                                        if (!rect.hasAttribute('data-leap-w')) {
                                            rect.setAttribute('data-leap-w', rect.getAttribute('width') || '240');
                                        }
                                        rect.setAttribute('width', '9999');
                                    }
                                }
                            };

                            const reclipFlyout = () => {
                                for (const root of [flyoutSvg, mainSvg]) {
                                    if (!root) continue;
                                    for (const rect of root.querySelectorAll('clipPath rect')) {
                                        const w = rect.getAttribute('data-leap-w');
                                        if (w) rect.setAttribute('width', w);
                                    }
                                }
                            };

                            const showOverflow = () => {
                                if (!isMouseOverFlyout) {
                                    isMouseOverFlyout = true;
                                    flyoutSvg?.classList.add('show-flyout-overflow');
                                    mainSvg?.classList.add('show-flyout-overflow');
                                    // Bring the flyout group above the main block canvas so the
                                    // overflowing blocks draw on top of the workspace.
                                    if (flyoutSvg && flyoutSvg.parentNode) {
                                        flyoutSvg.parentNode.appendChild(flyoutSvg);
                                    }
                                    unclipFlyout();
                                    console.log('[FLYOUT] block overflow ON');
                                }
                            };
                            const forceHideOverflow = () => {
                                isMouseOverFlyout = false;
                                flyoutSvg?.classList.remove('show-flyout-overflow');
                                mainSvg?.classList.remove('show-flyout-overflow');
                                reclipFlyout();
                                console.log('[FLYOUT] block overflow OFF (retracted)');
                            };

                            const hideOverflow = () => {
                                if (isMouseOverFlyout && !isDragging) {
                                    forceHideOverflow();
                                }
                            };

                            const containerEl = blocklyDiv.current;
                            const flyoutEl = flyout.svgGroup_ as HTMLElement | null;
                            const insideFlyout = (node: Node | null) => !!node && !!flyoutEl && (flyoutEl.contains(node) || flyoutSvg?.contains(node));

                            const handlePointerMove = (e: PointerEvent) => {
                                if (isDragging) return;
                                const target = e.target as Node | null;
                                const isTargetInside = insideFlyout(target);
                                let isRectInside = false;
                                if (flyoutEl) {
                                    const rect = flyoutEl.getBoundingClientRect();
                                    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                                        isRectInside = true;
                                    }
                                }
                                if (isTargetInside || isRectInside) {
                                    showOverflow();
                                } else {
                                    hideOverflow();
                                }
                            };

                            if (flyoutEl) {
                                flyoutEl.addEventListener('pointerover', showOverflow);
                                flyoutEl.addEventListener('pointerout', (e: PointerEvent) => {
                                    if (!insideFlyout(e.relatedTarget as Node)) {
                                        hideOverflow();
                                    }
                                });
                            }
                            if (containerEl) {
                                containerEl.addEventListener('pointermove', handlePointerMove);
                                containerEl.addEventListener('pointerleave', hideOverflow);
                            }

                            // Retract flyout overflow immediately when a block is being dragged
                            // from the flyout into the workspace.
                            blocksWorkspace.addChangeListener((event: any) => {
                                if (event.type === Blockly.Events.BLOCK_DRAG) {
                                    if (event.isStart) {
                                        isDragging = true;
                                        forceHideOverflow();
                                    } else {
                                        isDragging = false;
                                        forceHideOverflow();
                                    }
                                }
                            });

                            // Reset flyout scale after any viewport change (wheel zoom, pinch, etc.)
                            blocksWorkspace.addChangeListener((event: any) => {
                                if (event.type === Blockly.Events.VIEWPORT_CHANGE) {
                                    const flyoutWs = flyout.getWorkspace();
                                    if (flyoutWs && flyoutWs.getScale() !== FIXED_FLYOUT_SCALE) {
                                        flyoutWs.setScale(FIXED_FLYOUT_SCALE);
                                    }
                                }
                            });
                        }

                        // 3.6. CONTINUOUS FLYOUT (all categories in one scrollable list)
                        // Renders every category's blocks in a single continuous flyout so that
                        // scrolling past the end of one category flows directly into the next
                        // one. Selecting a category jumps the flyout to that section instead of
                        // replacing the contents.
                        let suppressScrollSpyUntil = 0;
                        try {
                            const toolboxAny = blocksWorkspace.getToolbox() as any;
                            const flyoutAny = flyout as any;
                            if (!toolboxAny || !flyoutAny || typeof flyoutAny.show !== 'function' || typeof flyoutAny.scrollToStart !== 'function') {
                                throw new Error('flyout not ready');
                            }
                            const getCategories = () => {
                                const items: any[] = toolboxAny.getToolboxItems?.() ?? [];
                                return items.filter((it: any) => it instanceof Blockly.ToolboxCategory);
                            };
                            const origShow = flyoutAny.show.bind(flyoutAny);
                            const getCategoryContents = (cat: any): any[] => {
                                const raw: any = cat.getContents?.();
                                if (typeof raw === 'string' && raw.length > 0) {
                                    // Custom (dynamic) category — fetch its contents via the
                                    // registered toolbox category callback.
                                    try {
                                        const dyn: any = flyoutAny.getDynamicCategoryContents?.(raw);
                                        return Array.isArray(dyn) ? dyn : [];
                                    } catch {
                                        return [];
                                    }
                                }
                                return Array.isArray(raw) ? raw : [];
                            };
                            const jumpToSelectedSection = () => {
                                const list = getCategories();
                                const selIdx = list.indexOf(toolboxAny.getSelectedItem?.() ?? null);
                                if (selIdx < 0) return;
                                // Jump to the selected category's first item (its header label),
                                // so the label is at the top of the flyout with blocks below.
                                const sectionStartItems: number[] = [];
                                let total = 0;
                                for (const cat of list) {
                                    sectionStartItems.push(total);
                                    // JSON 'sep' items render as flyout separators, which are
                                    // skipped when counting positions — exclude them here too.
                                    total += getCategoryContents(cat).filter((c: any) => !(c && typeof c === 'object' && c.kind === 'sep')).length;
                                }
                                const target = sectionStartItems[selIdx];
                                const contents: any[] = flyoutAny.getContents?.() ?? [];
                                let items = 0;
                                let y = 0;
                                for (const item of contents) {
                                    if (items >= target) break;
                                    if (item.getType() !== 'sep') items++;
                                    y += item.getElement?.()?.getBoundingRectangle?.()?.getHeight?.() ?? 0;
                                }
                                const px = (y + (flyoutAny.MARGIN ?? 8)) * (flyoutAny.getWorkspace().getScale() ?? 1);
                                flyoutAny.getWorkspace().scrollbar?.setY(px);
                            };
                            // Flyout label widths are measured with canvas text metrics at
                            // construction time, which ignores CSS text-transform/letter-spacing
                            // (e.g. the uppercase category-header style). The rendered text is
                            // therefore wider than the measured width and, being centered
                            // (text-anchor: middle), overflows the flyout's left edge — hiding
                            // the first letters (visible with long extension category names).
                            // Re-measure the rendered text and re-center it so it stays inside.
                            const fixFlyoutLabelWidths = () => {
                                const contents: any[] = flyoutAny.getContents?.() ?? [];
                                for (const item of contents) {
                                    const lab = item.getElement?.();
                                    if (!lab?.svgText || item.getType() !== 'label') continue;
                                    let w = 0;
                                    try {
                                        w = lab.svgText.getBBox().width;
                                    } catch {
                                        w = 0;
                                    }
                                    if (w > 0 && Math.abs(w - (lab.width ?? 0)) > 0.5) {
                                        lab.svgText.setAttribute('x', String(w / 2));
                                        lab.width = w;
                                        lab.svgGroup?.querySelector('.blocklyFlyoutLabelBackground')?.setAttribute('width', String(w));
                                    }
                                }
                            };
                            // Scroll-spy: as the user scrolls the continuous flyout,
                            // highlight the toolbox category whose section is at the
                            // top of the flyout viewport. Only the visual highlight
                            // (setSelected) is toggled — the real toolbox selection
                            // (used as the jump target) is left untouched, so
                            // scrolling never re-renders or repositions the flyout.
                            let lastHighlightedCat = -1;
                            let spyRafScheduled = false;
                            const scheduleScrollSpy = () => {
                                if (spyRafScheduled) return;
                                spyRafScheduled = true;
                                requestAnimationFrame(() => {
                                    spyRafScheduled = false;
                                    try {
                                        if (!flyoutAny.isVisible?.()) {
                                            lastHighlightedCat = -1;
                                            return;
                                        }
                                        if (Date.now() < suppressScrollSpyUntil) return;
                                        const list = getCategories();
                                        if (list.length === 0) return;
                                        const contents: any[] = flyoutAny.getContents?.() ?? [];
                                        const perCat: number[] = list.map((cat) =>
                                            getCategoryContents(cat).filter((c: any) => !(c && typeof c === 'object' && c.kind === 'sep')).length
                                        );
                                        const itemToCat: number[] = [];
                                        let cat = 0;
                                        let rem = perCat[0] ?? 0;
                                        for (const item of contents) {
                                            if (item.getType() === 'sep') continue;
                                            while (rem <= 0 && cat < list.length - 1) {
                                                cat++;
                                                rem = perCat[cat] ?? 0;
                                            }
                                            itemToCat.push(cat);
                                            rem--;
                                        }
                                        if (itemToCat.length === 0) return;
                                        const flyoutWs = flyoutAny.getWorkspace();
                                        const viewTop = flyoutWs?.getMetrics?.()?.viewTop ?? 0;
                                        let current = 0;
                                        let i = 0;
                                        for (const item of contents) {
                                            if (item.getType() === 'sep') continue;
                                            const el = item.getElement?.();
                                            const rect = el?.getBoundingRectangle?.();
                                            if (rect && rect.top <= viewTop) current = itemToCat[i] ?? 0;
                                            i++;
                                        }
                                        if (current !== lastHighlightedCat) {
                                            list.forEach((c, idx) => c.setSelected?.(idx === current));
                                            lastHighlightedCat = current;
                                        }
                                    } catch {
                                        // The highlight must never break scrolling.
                                    }
                                    if (flyoutAny.isVisible?.()) scheduleScrollSpy();
                                });
                            };
                            flyoutAny.show = function (items: any) {
                                const combined: any[] = [];
                                for (const cat of getCategories()) {
                                    combined.push(...getCategoryContents(cat));
                                }
                                origShow.call(this, combined);
                                fixFlyoutLabelWidths();
                                scheduleScrollSpy();
                            };
                            flyoutAny.scrollToStart = function () {
                                jumpToSelectedSection();
                            };
                            const currentIdx = getCategories().indexOf(toolboxAny.getSelectedItem?.() ?? null);
                            if (currentIdx >= 0) toolboxAny.selectItemByPosition(currentIdx);
                            // The app registers its dynamic toolbox category callbacks
                            // (LEAP_VARIABLES, LEAP_MYBLOCKS, ...) in a later timeout; re-render
                            // once afterwards so those sections are populated on first paint.
                            setTimeout(() => {
                                try {
                                    flyoutAny.show?.([]);
                                } catch {
                                    // ignore
                                }
                            }, 400);
                        } catch {
                            // Flyout patching failed — fall back to default behavior.
                        }

                        // 4. FLYOUT BLOCK PREVIEW (Click to Preview)

                        if (flyout && flyout.getWorkspace()) {

                            flyout.getWorkspace().addChangeListener((event: any) => {

                                if (event.type !== Blockly.Events.CLICK) return;

                                const blockId = (event as any).blockId;

                                if (!blockId) return;

                                const block = flyout.getWorkspace().getBlockById(blockId);

                                if (!block) return;

                                previewBlockActionRef.current(block);

                            });

                        }

                        // 5. KEEP FLYOUT ALWAYS OPEN
                        // Re-select a toolbox category whenever the flyout gets closed
                        // (e.g. by clicking on the workspace background).
                        blocksWorkspace.addChangeListener((event: any) => {
                            if (event.type === Blockly.Events.TOOLBOX_ITEM_SELECT) {
                                // If the toolbox selection was cleared (flyout closing),
                                // re-select the previously active category.
                                if (!(event as any).newItem) {
                                    const toolbox = blocksWorkspace.getToolbox() as any;
                                    if (toolbox) {
                                        // Re-select old item or default to first
                                        const oldId = (event as any).oldItem;
                                        if (oldId) {
                                            const items = toolbox.getToolboxItems?.() || [];
                                            const prev = items.find((i: any) => i.getId?.() === oldId);
                                            if (prev) {
                                                toolbox.setSelectedItem(prev);
                                                return;
                                            }
                                        }
                                        toolbox.selectItemByPosition(0);
                                    }
                                } else {
                                    // A new category was clicked — directly highlight it
                                    // so the scroll-spy doesn't momentarily show the wrong one.
                                    suppressScrollSpyUntil = Date.now() + 300;
                                    const toolbox = blocksWorkspace.getToolbox() as any;
                                    if (toolbox) {
                                        const cats: any[] = (toolbox.getToolboxItems?.() ?? [])
                                            .filter((it: any) => it instanceof Blockly.ToolboxCategory);
                                        const newItem = (event as any).newItem;
                                        cats.forEach((c, idx) => c.setSelected?.(c === newItem || c.getId?.() === newItem));
                                    }
                                }
                            }
                        });

                    }






                    // Auto-open toolbox on load/mode switch

                    setTimeout(() => {

                        if (workspaceRef.current) {

                            const toolbox = workspaceRef.current.getToolbox();

                            if (toolbox) {

                                toolbox.selectItemByPosition(0);

                                workspaceRef.current.refreshToolboxSelection();

                                const flyout = workspaceRef.current.getFlyout() as any;
                                if (flyout?.reflowInternal_) flyout.reflowInternal_();

                            }

                        }

                    }, 50);



                    // Register custom variable category callback
                    workspaceRef.current.registerToolboxCategoryCallback('LEAP_VARIABLES', (ws: any) => {
                        const contents: any[] = [];

                        contents.push(createFlyoutCategoryLabel('Variables'));
                        contents.push(createFlyoutSectionLabel('Variables', 'category-subheader-variables'));
                        contents.push({
                            kind: 'button',
                            text: 'Make a Variable',
                            callbackKey: 'CREATE_VARIABLE'
                        });

                        const allVars = ws.getVariableMap().getAllVariables() || [];
                        const scalars = allVars.filter((v: any) => v.type === '' || v.type === 'Number' || v.type === 'String');
                        const lists = allVars.filter((v: any) => v.type === 'list');
                        const tables = allVars.filter((v: any) => v.type === 'table');

                        scalars.sort((a: any, b: any) => a.getName().localeCompare(b.getName()));

                        scalars.forEach((v: any) => {
                            const currentMonitors = (window as any)._monitors_for_sync?.variable || [];
                            const monitor = currentMonitors.find((m: any) => m.name === v.getName());
                            const isVisible = monitor ? monitor.visible : false;

                            contents.push(createMonitorReporterPlaceholder(
                                'variable_reporter_checkbox',
                                'VARIABLE',
                                v.getName(),
                                isVisible
                            ));
                        });

                        // Add variable blocks — use the first variable alphabetically as default
                        if (scalars.length > 0) {
                            const defaultVar = scalars[0];
                            const blockTypes = [
                                'data_setvariableto',
                                'data_changevariableby',
                                'data_showvariable',
                                'data_hidevariable'
                            ];
                            blockTypes.forEach((type) => {
                                const block: any = {
                                    kind: 'block',
                                    type: type,
                                    fields: {
                                        // Pass full variable object so Blockly resolves by ID, not auto-create
                                        'VARIABLE': {
                                            id: defaultVar.getId(),
                                            name: defaultVar.getName(),
                                            type: defaultVar.type || ''
                                        }
                                    }
                                };
                                if (type === 'data_setvariableto') {
                                    block.inputs = {
                                        'VALUE': {
                                            shadow: {
                                                type: 'text',
                                                fields: {
                                                    'TEXT': '0'
                                                }
                                            }
                                        }
                                    };
                                } else if (type === 'data_changevariableby') {
                                    block.inputs = {
                                        'VALUE': {
                                            shadow: {
                                                type: 'arduino_number',
                                                fields: {
                                                    'NUM': '1'
                                                }
                                            }
                                        }
                                    };
                                }
                                contents.push(block);
                            });
                        }

                        contents.push({ kind: 'sep', gap: 20 });
                        contents.push(createFlyoutSectionLabel('Lists', 'category-subheader-lists'));
                        contents.push({
                            kind: 'button',
                            text: 'Make a List',
                            callbackKey: 'CREATE_LIST'
                        });

                        lists.sort((a: any, b: any) => a.getName().localeCompare(b.getName()));
                        lists.forEach((v: any) => {
                            const currentMonitors = (window as any)._monitors_for_sync?.list || [];
                            const monitor = currentMonitors.find((m: any) => m.name === v.getName());
                            const isVisible = monitor ? monitor.visible : false;

                            contents.push(createMonitorReporterPlaceholder(
                                'list_reporter_checkbox',
                                'LIST',
                                v.getName(),
                                isVisible
                            ));
                        });

                        if (lists.length > 0) {
                            const defaultList = lists[0];
                            const listBlockTypes = [
                                'data_addtolist',
                                'data_deleteoflist',
                                'data_deletealloflist',
                                'data_insertatlist',
                                'data_replaceitemoflist',
                                'data_itemoflist',
                                'data_itemnumoflist',
                                'data_lengthoflist',
                                'data_listcontainsitem',
                                'data_showlist',
                                'data_hidelist'
                            ];
                            listBlockTypes.forEach(type => {
                                contents.push({
                                    kind: 'block',
                                    type: type,
                                    fields: {
                                        'LIST': {
                                            id: defaultList.getId(),
                                            name: defaultList.getName(),
                                            type: defaultList.type || 'list'
                                        }
                                    }
                                });
                            });
                        }

                        contents.push({ kind: 'sep', gap: 20 });
                        contents.push(createFlyoutSectionLabel('Tables', 'category-subheader-tables'));
                        contents.push({
                            kind: 'button',
                            text: 'Make a Table',
                            callbackKey: 'CREATE_TABLE'
                        });

                        tables.sort((a: any, b: any) => a.getName().localeCompare(b.getName()));
                        tables.forEach((v: any) => {
                            const currentMonitors = (window as any)._monitors_for_sync?.table || [];
                            const monitor = currentMonitors.find((m: any) => m.name === v.getName());
                            const isVisible = monitor ? monitor.visible : false;

                            contents.push(createMonitorReporterPlaceholder(
                                'list_reporter_checkbox',
                                'LIST',
                                v.getName(),
                                isVisible
                            ));
                        });

                        if (tables.length > 0) {
                            const defaultTable = tables[0];
                            const tableBlockTypes = [
                                'data_setintable',
                                'data_addcolumn',
                                'data_deletecolumn',
                                'data_showtable',
                                'data_hidetable',
                                'data_deleterow',
                                'data_cleartable',
                                'data_getvalueattable',
                                'data_gettablecount',
                                'data_gettimestamp',
                                'data_exporttable'
                            ];
                            tableBlockTypes.forEach(type => {
                                contents.push({
                                    kind: 'block',
                                    type: type,
                                    fields: {
                                        'TABLE': {
                                            id: defaultTable.getId(),
                                            name: defaultTable.getName(),
                                            type: defaultTable.type || 'table'
                                        }
                                    }
                                });
                            });
                        }

                        return contents;
                    });



                    // Register button callback for "Make a Variable"

                    // Register LEAP_SENSING custom category callback
                    workspaceRef.current.registerToolboxCategoryCallback('LEAP_SENSING', (ws: any) => {
                        const contents: any[] = [];
                        const isStage = selectedSpriteIdRef.current === 'stage';

                        contents.push({
                            kind: 'label',
                            text: 'Sensing',
                            'web-class': 'category-header'
                        });

                        if (!isStage) {
                            contents.push({ kind: 'block', type: 'sensing_touching' });
                            contents.push({ kind: 'block', type: 'sensing_touching_color' });
                            contents.push({ kind: 'block', type: 'sensing_color_touching_color' });
                            contents.push({ kind: 'block', type: 'sensing_distance_to' });
                            contents.push({ kind: 'sep', gap: 20 });
                        }
                        contents.push({ kind: 'label', text: 'Ask', 'web-class': 'category-subheader' });
                        contents.push({
                            kind: 'block',
                            type: 'sensing_ask',
                            inputs: {
                                QUESTION: {
                                    shadow: { type: 'text', fields: { TEXT: 'What is your name?' } }
                                }
                            }
                        });
                        contents.push({ kind: 'block', type: 'sensing_answer' });

                        const sensingReporters = ['answer', 'loudness'];
                        sensingReporters.forEach(name => {
                            const monitor = sensingMonitorsRef.current.find(m => m.name === name);
                            contents.push(createMonitorReporterPlaceholder(
                                'sensing_reporter_checkbox',
                                'VARIABLE',
                                name,
                                !!monitor?.visible
                            ));
                        });

                        // Add timer block without checkbox
                        contents.push({ kind: 'block', type: 'sensing_timer' });
                        contents.push({ kind: 'block', type: 'sensing_reset_timer' });

                        contents.push({ kind: 'sep', gap: 20 });
                        contents.push({ kind: 'label', text: 'Keyboard/Mouse', 'web-class': 'category-subheader' });
                        contents.push({ kind: 'block', type: 'sensing_key_pressed' });
                        contents.push({ kind: 'block', type: 'sensing_mouse_down' });
                        contents.push({ kind: 'block', type: 'sensing_mouse_x' });
                        contents.push({ kind: 'block', type: 'sensing_mouse_y' });

                        contents.push({ kind: 'sep', gap: 20 });
                        contents.push({ kind: 'label', text: 'Date/Time', 'web-class': 'category-subheader' });
                        contents.push({ kind: 'block', type: 'sensing_current_year' });
                        contents.push({ kind: 'block', type: 'sensing_days_since_2000' });
                        contents.push({ kind: 'block', type: 'sensing_username' });

                        contents.push({ kind: 'sep', gap: 20 });
                        contents.push({ kind: 'label', text: 'Attributes', 'web-class': 'category-subheader' });
                        contents.push({ kind: 'block', type: 'sensing_of' });

                        return contents;
                    });

                    // Register LEAP_MYBLOCKS custom category callback
                    workspaceRef.current.registerToolboxCategoryCallback('LEAP_MYBLOCKS', (ws: any) => {
                        const contents: any[] = [];
                        contents.push(createFlyoutCategoryLabel('My Blocks'));
                        contents.push(createFlyoutSectionLabel('Custom Blocks', 'category-subheader-myblocks'));
                        contents.push({
                            kind: 'button',
                            text: 'Make a Block',
                            callbackKey: 'CREATE_PROCEDURE'
                        });

                        // Add existing procedure call blocks
                        const allBlocks = ws.getAllBlocks(false) || [];
                        const defBlocks = allBlocks.filter((b: any) => b.type === 'procedures_defnoreturn');
                        defBlocks.forEach((defBlock: any) => {
                            const name = defBlock.getFieldValue('NAME');
                            if (name) {
                                const mutation = defBlock.mutationToDom();
                                const mutationXml = mutation ? Blockly.Xml.domToText(mutation) : '';
                                contents.push({
                                    kind: 'block',
                                    type: 'procedures_callnoreturn',
                                    extraState: mutationXml,
                                    fields: { 'NAME': name }
                                });
                            }
                        });

                        return contents;
                    });

                    workspaceRef.current.registerToolboxCategoryCallback('LEAP_EXTENSIONBLOCKS', () => {
                        const contents: any[] = [];
                        contents.push(createFlyoutCategoryLabel(MORE_BLOCKS_CATEGORY_NAME));
                        contents.push(createFlyoutSectionLabel('Add custom blocks & categories', 'category-subheader-extensionblocks'));
                        contents.push({
                            kind: 'button',
                            text: 'Choose Extensions',
                            callbackKey: 'OPEN_EXTENSION_LIBRARY'
                        });
                        return contents;
                    });


                    // Register button callback for "Make a Variable"

                    workspaceRef.current.registerButtonCallback('CREATE_VARIABLE', ((btn: any) => {
                        setIsMakeVariableOpen(true);
                    }));

                    // Register button callback for "Choose Extensions"
                    workspaceRef.current.registerButtonCallback('OPEN_EXTENSION_LIBRARY', () => {
                        setShowExtensionLibrary(true);
                    });



                    // Register button callback for "Make a List"

                    workspaceRef.current.registerButtonCallback('CREATE_LIST', ((btn: any) => {
                        setIsMakeListOpen(true);
                    }));



                    // Register button callback for "Make a Table"

                    workspaceRef.current.registerButtonCallback('CREATE_TABLE', ((btn: any) => {
                        setIsMakeTableOpen(true);
                    }));



                    // Register button callback for "Make a Block"
                    workspaceRef.current.registerButtonCallback('CREATE_PROCEDURE', ((btn: any) => {
                        setIsMakeBlockOpen(true);
                    }));



                    // Register checkbox callbacks for toggling monitor visibility
                    workspaceRef.current.registerButtonCallback('TOGGLE_VARIABLE_*', ((btn: any) => {
                        const variableId = btn.target_.replace('TOGGLE_VARIABLE_', '');
                        const ws = workspaceRef.current;
                        if (ws) {
                            const variable = ws.getVariableById(variableId);
                            if (variable) {
                                setVariableMonitors(prev =>
                                    prev.map(monitor =>
                                        monitor.name === variable.getName()
                                            ? { ...monitor, visible: !monitor.visible }
                                            : monitor
                                    )
                                );
                            }
                        }
                    }));

                    workspaceRef.current.registerButtonCallback('TOGGLE_LIST_*', ((btn: any) => {
                        const listId = btn.target_.replace('TOGGLE_LIST_', '');
                        const ws = workspaceRef.current;
                        if (ws) {
                            const list = ws.getVariableById(listId);
                            if (list) {
                                setListMonitors(prev =>
                                    prev.map(monitor =>
                                        monitor.name === list.getName()
                                            ? { ...monitor, visible: !monitor.visible }
                                            : monitor
                                    )
                                );
                            }
                        }
                    }));

                    workspaceRef.current.registerButtonCallback('TOGGLE_TABLE_*', ((btn: any) => {
                        const tableId = btn.target_.replace('TOGGLE_TABLE_', '');
                        const ws = workspaceRef.current;
                        if (ws) {
                            const table = ws.getVariableById(tableId);
                            if (table) {
                                setTableMonitors(prev =>
                                    prev.map(monitor =>
                                        monitor.name === table.getName()
                                            ? { ...monitor, visible: !monitor.visible }
                                            : monitor
                                    )
                                );
                            }
                        }
                    }));

                    workspaceRef.current.registerButtonCallback('TOGGLE_SENSING_*', ((btn: any) => {
                        const monitorName = btn.target_.replace('TOGGLE_SENSING_', '');
                        setSensingMonitors(prev =>
                            prev.map(monitor =>
                                monitor.name === monitorName
                                    ? { ...monitor, visible: !monitor.visible }
                                    : monitor
                            )
                        );
                    }));



                    workspaceRef.current.addChangeListener(handleWorkspaceChange);



                    // Add click listener to the workspace to handle blurring inputs

                    workspaceRef.current.addChangeListener((event: any) => {

                        if (event.type === Blockly.Events.UI && event.element === 'click') {

                            // If a user clicks anywhere on the workspace, blur any active HTML inputs

                            // This fixes the issue where Blockly text inputs stay focused when clicking away

                            const activeElement = document.activeElement;

                            if (activeElement && activeElement.classList.contains('blocklyHtmlInput')) {

                                (activeElement as HTMLElement).blur();

                            }

                        }

                    });

                    

                    // Restore the selected sprite's blocks after workspace re-initialization

                    // Crucial: prioritize activeSpriteIdRef.current as the source of truth for current state

                    const targetSpriteId = activeSpriteIdRef.current || selectedSpriteId;

                    if (targetSpriteId) {

                        const savedJson = spriteWorkspacesRef.current.get(targetSpriteId);

                        if (savedJson && Object.keys(savedJson).length > 0) {

                            console.log('[APP] Restoring workspace for sprite after re-init:', targetSpriteId);

                            const migratedSavedJson = migrateWorkspaceBlocks(savedJson);
                            Blockly.serialization.workspaces.load(migratedSavedJson, blocksWorkspace);

                        }

                        // Ensure activeSpriteIdRef is set and matches selectedSpriteId if they diverged

                        activeSpriteIdRef.current = targetSpriteId;

                        if (targetSpriteId !== selectedSpriteId) {

                            setSelectedSpriteId(targetSpriteId);

                        }

                    }



                    addLog(`Workspace initialized for ${editorMode === 'stage' ? 'Stage' : 'Upload'} mode`);



                    // ── ATTACH LISTENERS ─────────────────────────────────

                    if (workspaceRef.current) {

                        workspaceRef.current.addChangeListener(handleBlockInteraction);



                        // Trigger an initial recompile

                        if (sprites.length > 0 && selectedSpriteId) {

                            handleWorkspaceChange({ isUiEvent: false } as Blockly.Events.Abstract);

                        }



                        // Register highlighting callback

                        animationVM.onHighlightBlock = (spriteId, blockId) => {

                            if (workspaceRef.current && spriteId === selectedSpriteId) {

                                // @ts-ignore

                                workspaceRef.current.highlightBlock(blockId);

                            }

                        };



                        // Clear highlight initially

                        // @ts-ignore

                        workspaceRef.current.highlightBlock(null);

                    }

                }

            }, 0);



            return () => clearTimeout(timer);

        }

        // eslint-disable-next-line react-hooks/exhaustive-deps

    }, [appMode, editorMode, selectedBoard, workspaceTab]); // Re-inject on these changes



    // Update workspace listeners and highlights when sprite selection or workspace changes

    useEffect(() => {
        const ws = workspaceRef.current;
        if (!ws) return;

        console.log('[APP] Attaching listeners for target:', selectedSpriteId);

        // Capture current function instances to ensure correct removal during cleanup
        const currentWsChange = handleWorkspaceChange;
        const currentBlockInteract = handleBlockInteraction;
        const currentBlockDrag = handleBlockDrag;

        ws.addChangeListener(currentWsChange);
        ws.addChangeListener(currentBlockInteract);
        ws.addChangeListener(currentBlockDrag);

        // Highlight
        animationVM.onHighlightBlock = (spriteId, blockId) => {
            if (workspaceRef.current && spriteId === selectedSpriteId) {
                // @ts-ignore
                workspaceRef.current.highlightBlock(blockId);
            }
        };

        // Recompile
        if (sprites.length > 0 && selectedSpriteId) {
            handleWorkspaceChange({ isUiEvent: false } as Blockly.Events.Abstract);
        }

        return () => {
            console.log('[APP] Removing listeners for target:', selectedSpriteId);
            ws.removeChangeListener(currentWsChange);
            ws.removeChangeListener(currentBlockInteract);
            ws.removeChangeListener(currentBlockDrag);
            // Clear highlighting when switching or unmounting
            // @ts-ignore
            ws.highlightBlock(null);
        };
    }, [selectedSpriteId, handleWorkspaceChange, handleBlockInteraction, handleBlockDrag, sprites.length]);



    // Keep Blockly resized correctly when container transitions (like stageLayout changes)

    useEffect(() => {

        if (!blocklyDiv.current) return;

        const resizeObserver = new ResizeObserver(() => {

            if (workspaceRef.current) {

                Blockly.svgResize(workspaceRef.current as Blockly.WorkspaceSvg);

            }

        });

        resizeObserver.observe(blocklyDiv.current);

        return () => resizeObserver.disconnect();

    }, [blocklyDiv, workspaceRef]);

    // Track pointer position for block-to-sprite drag detection
    // Uses capture phase to ensure we get events even during Blockly's pointer capture
    useEffect(() => {
        const handler = (e: PointerEvent) => {
            lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
        };
        document.addEventListener('pointermove', handler, true);
        return () => document.removeEventListener('pointermove', handler, true);
    }, []);



    // Route to Python IDE when appMode changes to 'python'

    useEffect(() => {

        if (appMode === 'python' && onOpenPython) {

            onOpenPython();

        }

    }, [appMode, onOpenPython]);



    // ═══════════════════════════════════════════════════════════════════════

    // RENDER

    // ═══════════════════════════════════════════════════════════════════════



    // Show "Coming Soon" for non-blocks modes (python mode will trigger routing via useEffect)

    if (appMode !== 'blocks') {

        return (

            <div style={{

                display: 'flex',

                flexDirection: 'column',

                justifyContent: 'center',

                alignItems: 'center',

                height: '100vh',

                backgroundColor: '#855CD6',

                color: 'white',

                fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',

            }}>

                <h1 style={{ fontSize: '48px', marginBottom: '16px' }}>

                    {appMode === 'notebook' && '📓 Py Notebook'}

                    {appMode === 'ml' && '🧠 Machine Learning'}

                    {appMode === 'xr' && '🌐 3D & XR Studio'}

                </h1>

                <p style={{ fontSize: '24px', opacity: 0.8, marginBottom: '32px' }}>Coming Soon!</p>

                <button

                    onClick={() => setAppMode('blocks')}

                    style={{

                        padding: '12px 32px',

                        fontSize: '18px',

                        backgroundColor: 'white',

                        color: '#855CD6',

                        border: 'none',

                        borderRadius: '8px',

                        cursor: 'pointer',

                        fontWeight: 600,

                    }}

                >

                    ← Back to Editor

                </button>

            </div>

        );

    }



    // Main Block Editor UI

    return (

        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            width: '100vw',           // ← FIX 5: explicit width anchors children
            overflow: 'hidden',
            backgroundColor: '#f5f5f5',
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        }}>
            {/* Responsive Styles */}
            <style>{`
                /* ── Blockly toolbox: flush with top of workspace ─────────── */
                .blocklyToolboxDiv {
                    top: 0 !important;
                    padding-top: 0 !important;
                }
                .blocklyFlyout {
                    top: 0 !important;
                }

                /* ── MenuBar always visible ───────────────────────────────── */
                @media (max-width: 768px) {
                    .menubar-container {
                        padding: 0 8px !important;
                        height: 52px !important;
                    }
                    .menubar-container button:first-child {
                        display: flex !important;
                        flex-shrink: 0 !important;
                    }
                }

                /* ── RIGHT PANEL: flex column, fills its allocated width ──── */
                /* NEVER set height/max-height here — the flex parent controls  */
                /* height. NEVER set min-width — flexShrink:0 + explicit width  */
                /* on the inline style is the correct pattern.                  */
                .right-panel-responsive {
                    display: flex !important;
                    flex-direction: column !important;
                    overflow: hidden !important;
                    /* height is controlled by the flex parent — do NOT set it */
                }

                /* ── STAGE CONTAINER: fixed size, never shrinks ───────────── */
                .stage-container-responsive {
                    flex-shrink: 0 !important;
                }

                /* ── Tablet (≤ 1024px): narrow the right panel ───────────── */
                @media (max-width: 1024px) {
                    .right-panel-responsive {
                        width: 380px !important;
                        /* NO min-width override — inline flexShrink:0 handles it */
                    }
                    .stage-container-responsive {
                        /* width stays 100% — right panel width controls the size */
                    }
                    .log-area-responsive {
                        height: 180px !important;
                        max-height: 180px !important;
                    }
                }

                /* ── Mobile (≤ 768px): stack vertically ──────────────────── */
                @media (max-width: 768px) {
                    .main-container-responsive {
                        flex-direction: column !important;
                        height: auto !important;
                        min-height: calc(100vh - 52px) !important;
                    }
                    .workspace-container-responsive {
                        width: 100% !important;
                        min-width: 0 !important;
                        height: 60vh !important;
                        min-height: 400px !important;
                    }
                    .right-panel-responsive {
                        width: 100% !important;
                        flex-shrink: 1 !important;
                        border-left: none !important;
                        border-top: 1px solid #d9d9d9 !important;
                        height: auto !important;
                        max-height: 40vh !important;
                    }
                    .stage-container-responsive {
                        width: 100% !important;
                        max-width: 450px !important;
                        margin: 0 auto !important;
                    }
                    .log-area-responsive {
                        height: 150px !important;
                        max-height: 150px !important;
                    }
                }

                /* ── Extra small (≤ 480px) ────────────────────────────────── */
                @media (max-width: 480px) {
                    .workspace-container-responsive {
                        height: 50vh !important;
                        min-height: 350px !important;
                    }
                    .stage-container-responsive {
                        max-width: 100% !important;
                    }
                    .log-area-responsive {
                        height: 120px !important;
                        max-height: 120px !important;
                    }
                }

                /* ── Landscape mobile ─────────────────────────────────────── */
                @media (max-width: 768px) and (orientation: landscape) {
                    .main-container-responsive {
                        flex-direction: row !important;
                    }
                    .workspace-container-responsive {
                        width: 60% !important;
                        min-width: 0 !important;
                        height: calc(100vh - 52px) !important;
                    }
                    .right-panel-responsive {
                        width: 40% !important;
                        border-left: 1px solid #d9d9d9 !important;
                        border-top: none !important;
                        height: calc(100vh - 52px) !important;
                        max-height: none !important;
                    }
                    .log-area-responsive {
                        height: 120px !important;
                        max-height: 120px !important;
                    }
                }

                /* ── Code preview (upload mode) ───────────────────────────── */
                .code-preview-area {
                    flex: 1 1 auto !important;
                    min-height: 80px !important;
                    max-height: none !important;
                    overflow-y: auto !important;
                }

                /* ── Log area ─────────────────────────────────────────────── */
                .log-area-responsive {
                    flex-shrink: 0 !important;
                    display: flex !important;
                    flex-direction: column !important;
                }

                /* ── Blockly workspace min-height ─────────────────────────── */
                .blocklyWorkspace {
                    min-height: 0 !important;
                }
            `}</style>

            {/* Premium Menu Bar */}

            <MenuBar

                onBack={onBack}

                projectName={projectName}

                onProjectNameChange={setProjectName}

                mode={editorMode}

                onModeChange={(m: string) => switchEditorMode(m as EditorMode)}

                board={selectedBoard}

                boardName={selectedBoardName}

                onBoardChange={setSelectedBoard}

                onOpenBoardModal={() => setIsBoardModalOpen(true)}

                isConnected={isConnected}

                onConnect={handleConnect}

                // @ts-ignore

                ports={ports as any}

                selectedPort={selectedPort}

                onPortSelect={setSelectedPort}

                onRefreshPorts={refreshPorts}

                onUpload={handleUpload}

                isUploading={isUploading}

                onFileAction={(action: string) => {

                    if (action === 'new') handleNewProject();

                    if (action === 'save' || action === 'save_as') handleSaveProject();

                    if (action === 'open') handleOpenProject();

                }}

                onDownload={handleDownloadProject}

                onSave={handleSaveProject}

                onEditAction={(action: string) => addLog(`Edit action: ${action}`)}

                onUndo={() => workspaceRef.current?.undo(false)}

                onRedo={() => workspaceRef.current?.undo(true)}

                workspaceRef={workspaceRef}

            />



            {/* Unified Toolbar - Tabs on left, Stage controls on right */}

            {appMode === 'blocks' && (editorMode === 'stage' || editorMode === 'upload') && (

                <div className={styles.unifiedToolbar}>

                    {/* Left: Workspace Tabs */}

                    <div style={{ display: 'flex', height: '100%', alignItems: 'center', paddingLeft: '20px', flex: 1 }}>
                        <div className="flex items-end h-full gap-1">
                            <button
                                className={workspaceTab === 'blocks' ? styles.tabActive : styles.tab}
                                onClick={() => handleWorkspaceTabChange('blocks')}
                            >
                                <LayoutTemplate size={18} color={workspaceTab === 'blocks' ? '#855CD6' : '#999'} /> Blocks
                            </button>

                            {editorMode === 'stage' && (
                                <>
                                    <button
                                        className={workspaceTab === 'python' ? styles.tabActive : styles.tab}
                                        onClick={() => {
                                            if (onOpenPython) {
                                                onOpenPython();
                                            } else {
                                                handleWorkspaceTabChange('python');
                                            }
                                        }}
                                    >
                                        <Terminal size={18} color={workspaceTab === 'python' ? '#855CD6' : '#999'} /> Python
                                    </button>

                                    <button
                                        className={workspaceTab === 'costumes' ? styles.tabActive : styles.tab}
                                        onClick={() => handleWorkspaceTabChange('costumes')}
                                    >
                                        <Pen size={18} color={workspaceTab === 'costumes' ? '#855CD6' : '#999'} /> {selectedSpriteId === 'stage' ? 'Backdrops' : 'Costumes'}
                                    </button>

                                    <button
                                        className={workspaceTab === 'sounds' ? styles.tabActive : styles.tab}
                                        onClick={() => handleWorkspaceTabChange('sounds')}
                                    >
                                        <Volume2 size={18} color={workspaceTab === 'sounds' ? '#855CD6' : '#999'} /> Sounds
                                    </button>
                                </>
                            )}
                        </div>

                        </div>



                    {/* Middle: Undo/Redo Controls + Upload Button */}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '16px', borderRight: '1px solid #ddd', height: '100%', paddingLeft: '16px' }}>

                        <button className={styles.undoRedoBtn} onClick={handleUndo} title="Undo">

                            <Undo2 size={18} color="#575E75" />

                        </button>

                        <button className={styles.undoRedoBtn} onClick={handleRedo} title="Redo">

                            <Redo2 size={18} color="#575E75" />

                        </button>

                        {editorMode === 'upload' && (
                            <button
                                className={styles.uploadButton}
                                onClick={handleUpload}
                                disabled={isUploading}
                                title="Upload to board"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px', backgroundColor: '#22c55e' }}
                            >
                                <Upload size={13} strokeWidth={2.5} />
                                {isUploading ? 'Uploading…' : 'UPLOAD'}
                            </button>
                        )}

                    </div>



                    {/* Right: Stage Controls (Only in Stage Mode) */}

                    {editorMode === 'stage' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '12px', paddingLeft: '12px' }}>

                            <div className={styles.actionButtons}>

                                <button className={`${styles.runButtonTop} ${isRunning ? 'opacity-50 pointer-events-none' : ''}`} onClick={handleRunClick} title="Run" aria-pressed={isRunning} onMouseDown={(e)=> e.currentTarget.style.transform='scale(0.92)'} onMouseUp={(e)=> e.currentTarget.style.transform='scale(1.05)'} onMouseLeave={(e)=> e.currentTarget.style.transform=''}>

                                    <svg viewBox="0 0 24 24" width="22" height="22" className={isRunning ? 'animate-pulse' : ''}><path fill={isRunning ? "#A0A0A0" : "#4CBB17"} d="M5 3v18M19 8l-14-5v10l14 5V8z" stroke={isRunning ? "#A0A0A0" : "#4CBB17"} strokeWidth="1.5" strokeLinejoin="round" /></svg>

                                </button>

                                <button className={`${styles.stopButtonTop} ${!isRunning ? 'opacity-40 pointer-events-none' : 'animate-pulse'}`} onClick={handleStopClick} title="Stop" aria-pressed={!isRunning} onMouseDown={(e)=> e.currentTarget.style.transform='scale(0.92)'} onMouseUp={(e)=> e.currentTarget.style.transform='scale(1.05)'} onMouseLeave={(e)=> e.currentTarget.style.transform=''}>

                                    <svg viewBox="0 0 24 24" width="22" height="22"><polygon fill={!isRunning ? "#A0A0A0" : "#EC5959"} points="7.3,2 16.7,2 22,7.3 22,16.7 16.7,22 7.3,22 2,16.7 2,7.3" /></svg>

                                </button>

                            </div>







                            <div style={{ width: '1px', height: '22px', background: '#d9d9d9' }} />



                            <button className={`${styles.iconBtn} ${isCameraOn ? styles.iconBtnActive : ''}`} onClick={() => setIsCameraOn(!isCameraOn)} title="Toggle Camera">

                                {isCameraOn ? <Camera size={18} /> : <CameraOff size={18} />}

                            </button>

                            <button className={`${styles.iconBtn} ${showGrid ? styles.iconBtnActive : ''}`} onClick={() => setShowGrid(!showGrid)} title="Toggle Grid">

                                <Grid3X3 size={18} />

                            </button>

                            <button className={`${styles.iconBtn} ${stageLayout === 'large' ? styles.iconBtnActive : ''}`} onClick={() => { setStageLayout('large'); addLog("Switched to Large Stage mode"); }} title="Large Stage">

                                <LayoutPanelLeft size={18} />

                            </button>

                            <button className={`${styles.iconBtn} ${isFullscreen ? styles.iconBtnActive : ''}`} onClick={handleFullscreen} title="Fullscreen">

                                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}

                            </button>

                        </div>
                    )}

                </div>

            )}



            <UnsavedWarningModal

                isOpen={showUnsavedModal}

                onYes={() => confirmUnsavedAction(true)}

                onNo={() => confirmUnsavedAction(false)}

                onCancel={() => {

                    setShowUnsavedModal(false);

                    setPendingAction(null);

                }}

            />

            <GoalPopup
                isOpen={showGoalPopup}
                goalText={goalPopupText}
                onClose={() => setShowGoalPopup(false)}
            />



            {/* Hidden file input for sprite upload */}
            <input
                ref={uploadSpriteFileRef}
                type="file"
                accept="image/*,.svg"
                style={{ display: 'none' }}
                onChange={handleUploadSpriteFile}
            />

            {/* Sprite Library Modal */}
            {showSpriteLibrary && (
                <React.Suspense fallback={<Loader />}>
                    <SpriteLibrary
                        isOpen={showSpriteLibrary}
                        onClose={() => setShowSpriteLibrary(false)}
                        onSelectSprite={(sprite: any) => {
                            addSprite(sprite.id as any); // Adapt as needed
                            setShowSpriteLibrary(false);
                        }}
                    />
                </React.Suspense>
            )}

            {showBackdropLibrary && (
                <React.Suspense fallback={<Loader />}>
                    <BackdropLibrary
                        isOpen={showBackdropLibrary}
                        onClose={() => setShowBackdropLibrary(false)}
                        onSelectBackdrop={(backdrop) => handleBackdropSelect(backdrop.name, backdrop.image)}
                    />
                </React.Suspense>
            )}

            {/* Main Content */}

            <div className={`${styles.main} main-container-responsive`}>

                {/* Blockly Workspace */}

                <div className={`${styles.workspaceContainer} workspace-container-responsive`}>



                    {/* Workspace content */}

                    {/* Blockly div — ALWAYS mounted to preserve workspace state across tab switches.
                        Hidden via display:none when not on blocks tab, instead of unmounting,
                        which would orphan the Blockly workspace SVG and lose all blocks. */}
                    <div
                        ref={blocklyDiv}
                        className={`${styles.blockly} ${editorMode === 'stage' && workspaceTab !== 'blocks' ? 'hide-flyout' : ''}`}
                        style={{
                            display: ((editorMode === 'stage' && workspaceTab === 'blocks') || editorMode === 'upload') ? undefined : 'none'
                        }}
                    />

                    {/* Overlay controls — only visible when blocks tab is active */}
                    {((editorMode === 'stage' && workspaceTab === 'blocks') || editorMode === 'upload') && (
                        <>

                            <WorkspaceControls workspaceRef={workspaceRef} onAfterZoom={() => {
                                const flyout = workspaceRef.current?.getFlyout() as any;
                                if (flyout?.getWorkspace()) {
                                    const targetScale = typeof flyout.getFlyoutScale === 'function' ? flyout.getFlyoutScale() : 0.8;
                                    flyout.getWorkspace().setScale(targetScale);
                                }
                            }} style={undefined} />

                            <WorkspaceTrash workspaceRef={workspaceRef} />


                        </>
                    )}



                    {/* Other Tabs - Only relevant in Stage Mode */}

                    {editorMode === 'stage' && workspaceTab === 'python' && (

                        <div className={styles.pythonEditor}>

                            <PythonEditorTab

                                workspace={workspaceRef.current}

                                onOpenFullIDE={() => setAppMode('python')}

                            />

                        </div>

                    )}

                    {editorMode === 'stage' && workspaceTab === 'costumes' && (

                        <div className={styles.costumesEditor}>
                            <SuspenseTab onBackToBlocks={() => handleWorkspaceTabChange('blocks')} tabName="Costumes">
                                <CostumesTab

                                    selectedSpriteId={selectedSpriteId}

                                    sprites={sprites}

                                    stageManager={stageManager}

                                    addLog={addLog}

                                    onClose={() => handleWorkspaceTabChange('blocks')}

                                    onOpenLibrary={selectedSpriteId === 'stage' ? () => setShowBackdropLibrary(true) : undefined}

                                />
                            </SuspenseTab>
                        </div>

                    )}

                    {editorMode === 'stage' && workspaceTab === 'sounds' && (

                        <div className={styles.soundsEditor}>
                            <SuspenseTab onBackToBlocks={() => handleWorkspaceTabChange('blocks')} tabName="Sounds">
                                <SoundsTab

                                    selectedSpriteId={selectedSpriteId}

                                    sprites={sprites}

                                    stageManager={stageManager}

                                    addLog={addLog}

                                    onClose={() => handleWorkspaceTabChange('blocks')}

                                    isEmbedMode={isEmbedMode}

                                    onSelectSprite={handleSpriteSelect}

                                    onSoundChange={handleSoundChange}

                                />
                            </SuspenseTab>
                        </div>

                    )}

                </div>



                {/* Right Panel — hidden in embed mode when sounds tab is active (full-screen sound editor) */}
                {(isEmbedMode && workspaceTab === 'sounds') ? null : (
                    <div className="flex shrink-0 h-full relative">
                        {/* Horizontal Drag Handle for Panel Width */}
                        {!isFullscreen && (
                            <div
                                onMouseDown={handleRightPanelResizeStart}
                                title="Drag left or right to resize right panel width"
                                style={{
                                    width: '6px',
                                    cursor: 'col-resize',
                                    background: '#e5e7eb',
                                    borderLeft: '1px solid #d1d5db',
                                    borderRight: '1px solid #d1d5db',
                                    position: 'relative',
                                    zIndex: 30,
                                    flexShrink: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    userSelect: 'none',
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#4C97FF'; }}
                                onMouseLeave={(e) => { if (!isResizingRightPanelRef.current) (e.currentTarget as HTMLDivElement).style.background = '#e5e7eb'; }}
                            >
                                <div style={{ width: '2px', height: '28px', background: '#9ca3af', borderRadius: '1px' }} />
                            </div>
                        )}

                        <div className={`${styles.rightPanel} right-panel-responsive`} style={{
                            width: isFullscreen ? '100vw' : (stageLayout === 'small' ? '256px' : `${rightPanelWidth}px`),
                            transition: isResizingRightPanelRef.current ? 'none' : 'width 0.15s ease-out',
                        }}>

                        {/* Stage Container — only rendered in stage/fullscreen mode */}
                        {(editorMode === 'stage' || isFullscreen) && (
                            <div ref={stageContainerRef} className={`${!isFullscreen ? styles.stageContainer : ''} stage-container-responsive`} style={{
                                width: isFullscreen ? '100vw' : '100%',
                                height: isFullscreen ? '100vh' : '100%',
                                flex: isFullscreen ? 'none' : '1 1 0%',
                                transition: isFullscreen ? 'none' : 'all 0.2s ease-in-out',
                                position: isFullscreen ? 'fixed' : 'relative',
                                top: isFullscreen ? 0 : 'auto',
                                left: isFullscreen ? 0 : 'auto',
                                zIndex: isFullscreen ? 9999 : 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                justifyContent: 'flex-start',
                                background: isFullscreen ? '#f0f0f0' : 'transparent',
                                overflow: 'hidden',
                                gap: 0,
                            }}>

                                {/* Fullscreen Toolbar — sticky at top, never scrolls */}
                                {isFullscreen && (
                                    <div className="w-full h-[64px] bg-gradient-to-r from-[#0a015a] to-[#080a25] border-b border-white/10 flex items-center justify-between px-4 z-[100] shrink-0">
                                        {/* Left: Exit fullscreen + Logo + EMBED */}
                                        <div className="flex items-center gap-4">
                                            <button onClick={handleFullscreen} className="bg-transparent border-none cursor-pointer p-0">
                                                <div className="w-10 h-10 bg-white/10 border border-white/15 rounded-xl flex items-center justify-center hover:bg-white/20 transition-colors">
                                                    <Minimize size={20} color="#fff" strokeWidth={2.5} />
                                                </div>
                                            </button>
                                            <div className="w-px h-7 bg-white/15" />
                                            <div className="flex items-center gap-2">
                                                <Logo height={40} className="w-auto" />
                                                <span className="hidden sm:inline text-white text-[18px] font-black tracking-[0.08em] font-sans whitespace-nowrap">EMBED</span>
                                            </div>
                                        </div>

                                        {/* Center: Run/Stop + Camera + Grid */}
                                        <div className="flex items-center gap-2.5">
                                            {isRunning ? (
                                                <button onClick={handleStopClick} title="Stop" className="w-[42px] h-[42px] rounded-xl flex items-center justify-center cursor-pointer border-none transition-colors" style={{ background: '#ef4444' }}>
                                                    <Square size={20} fill="#fff" stroke="#fff" />
                                                </button>
                                            ) : (
                                                <button onClick={handleRunClick} title="Run" className="w-[42px] h-[42px] rounded-xl flex items-center justify-center cursor-pointer border-none transition-colors" style={{ background: '#22c55e' }}>
                                                    <Flag size={20} fill="#fff" stroke="#fff" />
                                                </button>
                                            )}
                                            <button onClick={() => setIsCameraOn(!isCameraOn)} title="Toggle Camera" className="w-[42px] h-[42px] rounded-xl flex items-center justify-center cursor-pointer border border-white/20 bg-transparent transition-colors hover:bg-white/10">
                                                <CameraOff size={20} color={isCameraOn ? "#fff" : "#e0e0e0ff"} strokeWidth={2} />
                                            </button>
                                            <button onClick={() => setShowGrid(!showGrid)} title="Toggle Grid" className="w-[42px] h-[42px] rounded-xl flex items-center justify-center cursor-pointer border border-white/20 bg-transparent transition-colors hover:bg-white/10">
                                                <Grid3X3 size={20} color={showGrid ? "#fff" : "#e0e0e0ff"} strokeWidth={2} />
                                            </button>
                                        </div>

                                        {/* Right: Creoleap logo */}
                                        <div className="flex items-center shrink-0">
                                            <img src="assets/logo-creoleap.png" alt="CREOLEAP" className="w-[145px] h-auto object-contain brightness-[1.14] contrast-[1.05]" />
                                        </div>
                                    </div>
                                )}



                                {/* --- STAGE RENDERING --- */}
                                {(() => {
                                    const CANVAS_WIDTH = 480;
                                    const CANVAS_HEIGHT = 310;

                                    const TOOLBAR_H = 64;
                                    const stageScale = isFullscreen
                                        ? Math.min(
                                            window.innerWidth / CANVAS_WIDTH,
                                            (window.innerHeight - TOOLBAR_H) / CANVAS_HEIGHT
                                        )
                                        : (stageLayout === 'small' ? 0.5 : Math.max(0.3, (rightPanelWidth - 16) / CANVAS_WIDTH));

                                    const displayW = Math.round(CANVAS_WIDTH * stageScale);
                                    const displayH = Math.round(CANVAS_HEIGHT * stageScale);

                                    return (
                                        <div style={{
                                            flex: 1,
                                            width: '100%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: isFullscreen ? 'center' : 'stretch',
                                            justifyContent: isFullscreen ? 'center' : 'flex-start',
                                            position: 'relative',
                                            overflow: 'hidden',
                                            height: isFullscreen ? `calc(100vh - ${TOOLBAR_H}px)` : 'auto',
                                        }}>
                                            {/* Stage canvas - display container */}
                                            <div style={{
                                                width: isFullscreen ? `${displayW}px` : '100%',
                                                height: `${displayH}px`,
                                                background: 'white',
                                                boxShadow: isFullscreen ? '0 4px 32px rgba(0,0,0,0.18)' : 'none',
                                                borderRadius: isFullscreen ? '4px' : '0',
                                                overflow: 'hidden',
                                                position: 'relative',
                                                flex: '0 0 auto',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}>
                                                {/* Scaling wrapper - preserves internal resolution at 480x310 */}
                                                <div style={{
                                                    width: `${CANVAS_WIDTH}px`,
                                                    height: `${CANVAS_HEIGHT}px`,
                                                    transform: `scale(${stageScale})`,
                                                    transformOrigin: 'center center',
                                                    flex: '0 0 auto',
                                                    overflow: 'visible',
                                                    imageRendering: 'auto',
                                                }}>
                                                    <Stage

                                                        width={CANVAS_WIDTH}

                                                        height={CANVAS_HEIGHT}

                                                        sprites={sprites}

                                                        isRunning={isRunning}

                                                        showGridNumbers={showGrid}

                                                        onSpriteSelect={handleSpriteSelect}

                                                        onSpriteClick={handleSpriteClick}

                                                        isCameraOn={isCameraOn}

                                                        variableMonitors={variableMonitors}

                                                        listMonitors={listMonitors}

                                                        tableMonitors={tableMonitors}

                                                        selectedSpriteId={selectedSpriteId}

                                                        onMonitorPositionChange={handleMonitorPositionChange}

                                                        onMonitorResize={handleMonitorResize}

                                                        onMonitorBringToFront={handleMonitorBringToFront}

                                                        onVariableModeChange={handleVariableModeChange}

                                                        onVariableValueChange={handleVariableValueChange}

                                                        onVariableSliderRangeChange={handleVariableSliderRangeChange}

                                                        onListAddItem={handleListAddItem}

                                                        onListEditItem={handleListEditItem}

                                                        onListDeleteItem={handleListDeleteItem}

                                                    />

                                                    {/* Ask-and-wait input overlay */}
                                                    {askState.isAsking && (
                                                        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', zIndex: 100 }}>
                                                            <AskBar question={askState.question} onSubmit={handleAskSubmit} />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Sprite & Stage Panel Unit — hidden in fullscreen for clean presentation */}
                                            {editorMode === 'stage' && !isFullscreen && (
                                                <div className={styles.assetsContainer} style={{
                                                    width: isFullscreen ? '240px' : '100%',
                                                    flex: isFullscreen ? 'none' : '1 1 auto',
                                                    minHeight: 0,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    justifyContent: 'flex-start',
                                                    alignItems: 'stretch',
                                                    overflow: 'visible',
                                                    ...(isFullscreen ? {
                                                        position: 'fixed' as const,
                                                        right: 0,
                                                        top: '48px',
                                                        height: 'calc(100vh - 48px)',
                                                        zIndex: 10000,
                                                        background: '#f5f5f5',
                                                        borderLeft: '1px solid #d9d9d9',
                                                    } : {}),
                                                }}>
                                                    <SpritePanel
                                                        sprites={sprites}
                                                        selectedSpriteId={selectedSpriteId}
                                                        onSelectSprite={handleSpriteSelect}
                                                        onAddSprite={addSprite}
                                                        onDeleteSprite={deleteSprite}
                                                        onRemoveBackground={handleRemoveBackground}
                                                        onOpenSpriteLibrary={() => setShowSpriteLibrary(true)}
                                                        onOpenBackdropLibrary={() => setShowBackdropLibrary(true)}
                                                        onUploadSprite={handleUploadSprite}
                                                        stageManager={stageManager}
                                                        backdropVersion={backdropRefresh}
                                                        isFullscreen={isFullscreen}
                                                        onCopyCodeToSprite={handleCopyCodeToSprite}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                    );

                                })()}

                            </div>
                        )}

                        {/* Code Preview - Only in Upload mode AND NOT Fullscreen */}
                        {editorMode === 'upload' && !isFullscreen && (
                            <>

                                {/* Code Preview */}

                                <div className={styles.codeHeader}>
                                    <span>💻 Arduino Code</span>
                                </div>

                                <div className={`${styles.codeArea} code-preview-area`}>

                                    <pre className={styles.codeContent}>

                                        {generatedCode.split('\n').map((line, i) => (

                                            <div key={i} className={styles.codeLine}>

                                                <span className={styles.lineNumber}>{i + 1}</span>

                                                <span>{line}</span>

                                            </div>

                                        ))}

                                    </pre>

                                </div>

                            </>

                        )}



                        {/* Bottom tabs - Only visible in Upload mode */}

                        {editorMode !== 'stage' && (

                            <>

                                {/* Resize handle bar */}
                                <div
                                    onMouseDown={handleLogResizeStart}
                                    title="Drag up or down to resize Serial Monitor / Log"
                                    style={{
                                        height: '6px',
                                        cursor: 'row-resize',
                                        background: '#e5e7eb',
                                        borderTop: '1px solid #d1d5db',
                                        borderBottom: '1px solid #d1d5db',
                                        flexShrink: 0,
                                        position: 'relative',
                                        zIndex: 10,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#4C97FF'; }}
                                    onMouseLeave={(e) => { if (!isResizingLogRef.current) (e.currentTarget as HTMLDivElement).style.background = '#e5e7eb'; }}
                                >
                                    <div style={{ width: '28px', height: '2px', background: '#9ca3af', borderRadius: '1px' }} />
                                </div>

                                <div className={styles.bottomTabs}>

                                    <button

                                        className={activeTab === 'log' ? styles.bottomTabActive : styles.bottomTab}

                                        onClick={() => setActiveTab('log')}

                                    >⏩ Log</button>

                                    <button

                                        className={activeTab === 'serial' ? styles.bottomTabActive : styles.bottomTab}

                                        onClick={() => setActiveTab('serial')}

                                    >📟 Serial Monitor</button>

                                </div>

                                <div ref={logAreaRef} className={`${styles.logArea} log-area-responsive`} style={{ height: logAreaHeight, minHeight: 80, flexShrink: 0, overflowY: activeTab === 'log' ? 'auto' : 'hidden', display: 'flex', flexDirection: 'column' }}>

                                    {activeTab === 'log' ? (

                                        logMessages.map((msg, i) => <div key={i} className={styles.logLine}>{msg}</div>)

                                    ) : (

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

                                    )}

                                </div>

                            </>

                        )}

                    </div>
                    </div>
                )}

            </div>





            {/* Custom Prompt Modal */}

            {

                promptState.isOpen && (

                    <div className={styles.modalOverlay}>

                        <div className={styles.modalContent}>

                            <div className={styles.modalTitle}>

                                {promptState.type === 'variable' ? 'New Variable' : (promptState.message?.includes('Rename') ? 'Rename Variable' : 'Input')}

                                <div

                                    onClick={handlePromptCancel}

                                    style={{ cursor: 'pointer', fontSize: '18px', opacity: 0.8 }}

                                >×</div>

                            </div>



                            <div style={{ padding: '0 16px 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

                                <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>

                                    {promptState.message || 'Enter variable name:'}

                                </p>



                                <input

                                    ref={(input) => { if (input) input.focus(); }}

                                    type="text"

                                    value={promptInput}

                                    onChange={(e) => setPromptInput(e.target.value)}

                                    onKeyDown={(e) => {

                                        if (e.key === 'Enter') handlePromptSubmit();

                                        if (e.key === 'Escape') handlePromptCancel();

                                    }}

                                    className={styles.modalInput}

                                />



                                {promptState.type === 'variable' && (

                                    <>

                                        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>

                                            <span style={{ fontSize: '14px', color: '#575E75' }}>Data Type :</span>

                                            <div style={{ display: 'flex', borderRadius: '4px', overflow: 'hidden', border: '1px solid #ddd' }}>

                                                <div

                                                    onClick={() => setVariableType('Number')}

                                                    style={{

                                                        padding: '4px 12px',

                                                        backgroundColor: variableType === 'Number' ? '#855CD6' : '#eee',

                                                        color: variableType === 'Number' ? 'white' : '#555',

                                                        cursor: 'pointer',

                                                        fontSize: '13px',

                                                        fontWeight: 'bold'

                                                    }}

                                                >Number</div>

                                                <div

                                                    onClick={() => setVariableType('String')}

                                                    style={{

                                                        padding: '4px 12px',

                                                        backgroundColor: variableType === 'String' ? '#855CD6' : '#eee',

                                                        color: variableType === 'String' ? 'white' : '#555',

                                                        cursor: 'pointer',

                                                        fontSize: '13px',

                                                        fontWeight: 'bold'

                                                    }}

                                                >String</div>

                                            </div>

                                        </div>



                                        <div style={{ marginTop: '16px', display: 'flex', borderRadius: '4px', overflow: 'hidden', border: '1px solid #ddd' }}>

                                            <div

                                                onClick={() => setVariableScope('global')}

                                                style={{

                                                    flex: 1,

                                                    padding: '8px 12px',

                                                    backgroundColor: variableScope === 'global' ? '#855CD6' : '#eee',

                                                    color: variableScope === 'global' ? 'white' : '#555',

                                                    cursor: 'pointer',

                                                    fontSize: '13px',

                                                    textAlign: 'center',

                                                    fontWeight: 'bold'

                                                }}

                                            >For all sprites</div>

                                            <div

                                                onClick={() => setVariableScope('local')}

                                                style={{

                                                    flex: 1,

                                                    padding: '8px 12px',

                                                    backgroundColor: variableScope === 'local' ? '#855CD6' : '#eee',

                                                    color: variableScope === 'local' ? 'white' : '#555',

                                                    cursor: 'pointer',

                                                    fontSize: '13px',

                                                    textAlign: 'center',

                                                    fontWeight: 'bold'

                                                }}

                                            >For this sprite only</div>

                                        </div>

                                    </>

                                )}



                                <div className={styles.modalButtons}>

                                    <button onClick={handlePromptCancel} className={styles.modalCancel}>Cancel</button>

                                    <button onClick={handlePromptSubmit} className={styles.modalSubmit}>OK</button>

                                </div>

                            </div>

                        </div>

                    </div>

                )

            }



            {/* New Dialog Components */}
            <MakeVariableDialog
                isOpen={isMakeVariableOpen}
                onClose={() => setIsMakeVariableOpen(false)}
                onCreateVariable={handleCreateVariable}
                workspace={workspaceRef.current}
            />

            <MakeListDialog
                isOpen={isMakeListOpen}
                onClose={() => setIsMakeListOpen(false)}
                onCreateList={handleCreateList}
                workspace={workspaceRef.current}
            />

            <MakeTableDialog
                isOpen={isMakeTableOpen}
                onClose={() => setIsMakeTableOpen(false)}
                onCreateTable={handleCreateTable}
                workspace={workspaceRef.current}
            />

            <MakeBlockDialog
                isOpen={isMakeBlockOpen}
                onClose={() => setIsMakeBlockOpen(false)}
                onCreateBlock={handleCreateBlock}
                workspace={workspaceRef.current}
            />



            {/* Board Selection Modal */}

            <BoardSelectionModal

                isOpen={isBoardModalOpen}

                onClose={() => setIsBoardModalOpen(false)}

                onSelect={(id: string, name: string) => {

                    setSelectedBoard(id);

                    setSelectedBoardName(name);

                    addLog(`Selected board: ${name}`);

                }}

                currentBoard={selectedBoard}

            />



            {/* Backdrop Modals */}

            {/*

                showBackdropLibrary && (

                    <BackdropLibrary

                        onSelect={handleBackdropSelect}

                        onClose={() => setShowBackdropLibrary(false)}

                    />

                )

            */}

            {/*

                showBackdropEditor && (

                    <BackdropEditor

                        onClose={() => setShowBackdropEditor(false)}

                    />

                )

            */}



            {/* Sprite Library Modal */}
            {showSpriteLibrary && (
                <React.Suspense fallback={<Loader />}>
                    <SpriteLibrary
                        isOpen={showSpriteLibrary}
                        onClose={() => setShowSpriteLibrary(false)}
                        onSelectSprite={(entry: SpriteEntry) => {

                            // Save current sprite workspace before adding new one

                            saveCurrentSpriteWorkspace();



                            const id = `sprite_${Date.now()}`;

                            const newSprite = new Sprite(id, entry.name, triggerUpdate, 'cat');



                            // Predefined spread-out positions across the stage

                            const spreadPositions = [

                                { x: 120, y: 0 },      // Right area

                                { x: -120, y: 0 },     // Left area

                                { x: 0, y: 80 },       // Top center

                                { x: 0, y: -80 },      // Bottom center

                                { x: -160, y: 100 },   // Top-left

                                { x: 160, y: 100 },    // Top-right

                                { x: -160, y: -100 },  // Bottom-left

                                { x: 160, y: -100 },   // Bottom-right

                            ];



                            const MIN_DIST = 80;

                            let assigned = false;

                            for (const pos of spreadPositions) {

                                const tooClose = sprites.some(s => {

                                    const dx = Math.abs(s.x - pos.x);

                                    const dy = Math.abs(s.y - pos.y);

                                    return dx < MIN_DIST && dy < MIN_DIST;

                                });

                                if (!tooClose) {

                                    newSprite.setX(pos.x);

                                    newSprite.setY(pos.y);

                                    assigned = true;

                                    break;

                                }

                            }

                            if (!assigned) {

                                // Generate a small random offset explicitly close to the center 

                                // instead of completely scattering them across the stage

                                const offsetX = Math.floor(Math.random() * 60) - 30;

                                const offsetY = Math.floor(Math.random() * 60) - 30;

                                newSprite.setX(offsetX);

                                newSprite.setY(offsetY);

                            }



                            // If the sprite has an image or costumes, use them

                            const costumesToLoad = entry.costumes && entry.costumes.length > 0

                                ? entry.costumes

                                : (entry.image ? [entry.image] : []);



                            if (costumesToLoad.length > 0) {

                                // Load all costumes sequentially to maintain order and wait for completion

                                (async () => {

                                    for (let i = 0; i < costumesToLoad.length; i++) {

                                        const costumeSrc = costumesToLoad[i];

                                        const costumeName = i === 0 ? entry.name : `${entry.name} ${i + 1}`;

                                        await newSprite.addCostume(costumeName, costumeSrc);

                                    }

                                    // Add default sound based on sprite tags/name
                                    const defaultSound = getDefaultSoundForSprite(
                                        (entry as any).tags || [],
                                        entry.name
                                    );
                                    await newSprite.addSound(defaultSound.name, defaultSound.src);



                                    // Set initial costume

                                    newSprite.switchCostume(0);

                                    triggerUpdate();

                                })();

                            } else if (entry.emoji) {

                                // Create costume from emoji by drawing on canvas

                                const canvas = document.createElement('canvas');

                                canvas.width = 200;

                                canvas.height = 200;

                                const ctx = canvas.getContext('2d');

                                if (ctx) {

                                    ctx.font = '120px Arial';

                                    ctx.textAlign = 'center';

                                    ctx.textBaseline = 'middle';

                                    ctx.fillText(entry.emoji, 100, 100);

                                    newSprite.addCostume(entry.name, canvas.toDataURL()).then(() => {

                                        newSprite.switchCostume(entry.name);

                                        triggerUpdate();

                                    });

                                }

                            }

                            animationVM.registerSprite(newSprite);

                            // Add default sound based on sprite tags/name
                            // (Image-based sprites already get a sound in their async loader above,
                            //  but emoji-only sprites don't — this covers both as a fallback.)
                            if (newSprite.sounds.length === 0) {
                                const defaultSound = getDefaultSoundForSprite(
                                    (entry as any).tags || [],
                                    entry.name
                                );
                                newSprite.addSound(defaultSound.name, defaultSound.src);
                            }

                            // Save current sprite's blocks before switching to new sprite
                            saveCurrentSpriteWorkspace();

                            // Initialize empty workspace for the new sprite
                            spriteWorkspacesRef.current.set(id, {});



                            // Silently clear workspace to prevent event bleed

                            if (workspaceRef.current) {

                                isLoadingWorkspaceRef.current = true;
                                Blockly.Events.disable();
                                console.log('[APP] Initializing empty workspace for new sprite:', id);

                                workspaceRef.current.clear();

                                Blockly.Events.enable();

                                // Allow layout events to fizzle before accepting changes

                                setTimeout(() => {

                                    isLoadingWorkspaceRef.current = false;

                                }, 50);

                            }



                            activeSpriteIdRef.current = id;

                            setSelectedSpriteId(id);

                            setShowSpriteLibrary(false);

                            addLog(`Added sprite: ${entry.name}`);

                        }}

                        onPaintSprite={() => {

                            setShowSpriteLibrary(false);

                            showAlert('Paint editor - select a sprite first, then edit its costume', 'Costumes');

                        }}

                    />
                </React.Suspense>
            )}

            {/* Premium Upload Modal */}

            <UploadModal

                isOpen={isUploading}

                progress={uploadProgress}

            />


            {/* Extension Library Modal */}
            {showExtensionLibrary && (
                <React.Suspense fallback={<Loader />}>
                    <JuniorExtensionLibrary
                        onClose={() => setShowExtensionLibrary(false)}
                        onSelectExtension={(id: string) => {
                            handleAddExtension(id);
                            setShowExtensionLibrary(false);
                        }}
                    />
                </React.Suspense>
            )}

            {/* Global styled dialog renderer */}
            <DialogRenderer />
        </div>
    );

};






export default IntermediateApp;
