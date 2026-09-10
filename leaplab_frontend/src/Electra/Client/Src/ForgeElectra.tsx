/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, Suspense, useEffect, useRef, useCallback, useMemo } from 'react';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import { Node, Edge } from 'reactflow';
import { Code, Library as LibraryIcon } from 'lucide-react';
// Register official leap elements
import '../utils/elements/leap-elements';
import { useForgeStore, getSimulationRunner } from '../utils/store/useForgeStore';
import { getElectraVars, getLightThemeVars } from '../utils/electraTheme';

// Lazy load complex inner components
const ForgeCanvas = lazyWithRetry(() => import('./components/ForgeCanvas'), 'ForgeCanvas');
const ForgeEditor = lazyWithRetry(() => import('./components/Editor/ForgeEditor'), 'ForgeEditor');
import { LibraryManager } from './components/Library/LibraryManager';
import { PartPicker as ComponentSidebar } from './components/Library/PartPicker';
import { IgniteTopbar } from './components/Layout/Topbar';

import Loader from '../../../components/Loader';
import { IS_ELECTRON } from '../../../config/platform';
import * as ProjectService from './services/ProjectService';
import { v4 as uuidv4 } from 'uuid';
import * as LibraryService from './services/LibraryService';
import { pack, unpack, isPacked } from '../utils/compress';
import { fileService } from './services/FileService';
import { useCloudProjectStore } from '../../../store/cloudProjectStore';
import { showToast } from '../../../leapignite/client/components/Toast';

// Hooks and Extracted Components
import { useElectraCompiler } from './hooks/useElectraCompiler';
import { TerminalPanel } from './components/Editor/TerminalPanel';
import { WebOpenModal } from './components/WebOpenModal';
import { BoardConfirmModal } from './components/BoardConfirmModal';

interface ForgeElectraProps {
  onBack: () => void;
  initialBoard?: 'arduino-uno' | 'esp32-c3';
  onRedirectToCreova?: (data: unknown, projectName?: string | null, projectPath?: string | null) => void;
  redirectProjectData?: unknown;
  clearRedirectProjectData?: () => void;
}

const ESP32_DEFAULT_CODE = `// ESP32-C3 Project
void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("LED ON");
  delay(1000);
  digitalWrite(13, LOW);
  Serial.println("LED OFF");
  delay(1000);
}`;

const ARDUINO_DEFAULT_CODE = `// Electra Project
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("System Active");
  delay(1000);
  digitalWrite(13, LOW);
  delay(1000);
}`;

export default function ForgeElectra({
  onBack,
  initialBoard = 'arduino-uno',
  onRedirectToCreova,
  redirectProjectData,
  clearRedirectProjectData
}: ForgeElectraProps) {
  const {
    nodes,
    edges,
    isSimulating,
    startSimulation,
    stopSimulation,
    clearSerial,
    serialOutput,
    wifiLog,
    clearWiFiLog,
    projectPath,
    setProjectPath,
    setNodes,
    setEdges,
    projectName,
    setProjectName,
    board,
    setBoard,
    uiTheme,
    setImportedLibraries,
  } = useForgeStore();

  // ── Undo/Redo History ────────────────────────────────────────────
  // Single state object avoids stale-closure bugs from separate history/index states.
  // History captures full circuit + code snapshot for reliable revert of:
  // add/delete/move component, add/remove wires, code edits, board changes.
  const [historyState, setHistoryState] = useState<{ history: Array<{ nodes: any[]; edges: any[]; code: string }>; index: number }>({ history: [], index: -1 });
  const history = historyState.history;
  const historyIndex = historyState.index;
  const [code, setCode] = useState(initialBoard === 'esp32-c3' ? ESP32_DEFAULT_CODE : ARDUINO_DEFAULT_CODE);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref mirror for synchronous reads inside callbacks (prevents stale index)
  const historyRef = useRef(historyState);
  useEffect(() => { historyRef.current = historyState; }, [historyState]);
  // Flag to suppress debounced push while restoring via undo/redo
  const isRestoringRef = useRef(false);



  const autoInstallLibraries = async (libs: string[]) => {
    if (!libs || libs.length === 0) return;
    try {
      console.log('[FORGE ELECTRA] Checking libraries for auto-installation:', libs);
      const installed = await LibraryService.getLibraries();
      const installedNames = new Set(installed.map((l: any) => l.name.toLowerCase()));

      for (const libName of libs) {
        if (!installedNames.has(libName.toLowerCase())) {
          console.log(`[FORGE ELECTRA] Auto-installing missing library: ${libName}`);

          let libToInstall: LibraryService.Library = {
            name: libName,
            author: '',
            description: '',
            version: '1.0.0',
          };

          try {
            const indexMatches = await LibraryService.searchLibraries(libName);
            const exactMatch = indexMatches.find(l => l.name.toLowerCase() === libName.toLowerCase());
            if (exactMatch) {
              libToInstall = exactMatch;
              console.log(`[FORGE ELECTRA] Found library metadata in index for ${libName}:`, exactMatch);
            } else {
              console.warn(`[FORGE ELECTRA] No exact match in index for ${libName}. Using fallback metadata.`);
            }
          } catch (searchErr) {
            console.warn(`[FORGE ELECTRA] Error searching library index for ${libName}:`, searchErr);
          }

          const result = await LibraryService.installLibrary(libToInstall);
          if (result.success) {
            console.log(`[FORGE ELECTRA] Successfully auto-installed: ${libName}`);
          } else {
            console.error(`[FORGE ELECTRA] Failed to auto-install: ${libName}. Error:`, result.error);
          }
        } else {
          console.log(`[FORGE ELECTRA] Library already installed: ${libName}`);
        }
      }
    } catch (err) {
      console.error('[FORGE ELECTRA] Error in autoInstallLibraries:', err);
    }
  };

  // Save current state to history – synchronous via functional updater
  const saveToHistory = useCallback((overrideNodes?: any[], overrideEdges?: any[], overrideCode?: string) => {
    const storeState = useForgeStore.getState();
    const currentNodes = overrideNodes ?? storeState.nodes;
    const currentEdges = overrideEdges ?? storeState.edges;
    const currentCode = overrideCode !== undefined ? overrideCode : code;

    if (currentNodes.length === 0) return;

    const snapshot = {
      nodes: JSON.parse(JSON.stringify(currentNodes)),
      edges: JSON.parse(JSON.stringify(currentEdges)),
      code: currentCode,
    };

    setHistoryState(prev => {
      const base = prev.history.slice(0, prev.index + 1);
      if (base.length > 0) {
        const last = base[base.length - 1];
        if (
          JSON.stringify(last.nodes) === JSON.stringify(snapshot.nodes) &&
          JSON.stringify(last.edges) === JSON.stringify(snapshot.edges) &&
          last.code === snapshot.code
        ) {
          return prev; // no-op duplicate
        }
      }
      let nextHistory = [...base, snapshot];
      let nextIndex = base.length; // index of pushed snapshot
      if (nextHistory.length > 50) {
        nextHistory = nextHistory.slice(-50);
        nextIndex = nextHistory.length - 1;
      }
      return { history: nextHistory, index: nextIndex };
    });
  }, [code]);

  const handleUndo = useCallback(() => {
    const { history: h, index } = historyRef.current;
    if (index <= 0) return;
    isRestoringRef.current = true;
    const prevState = h[index - 1];
    const currentStore = useForgeStore.getState();
    const boardNodeInPrev = prevState.nodes.find((n: any) => ['esp32-c3', 'esp32', 'arduino-uno'].includes(n.data?.type));
    let restoredNodes = [...prevState.nodes];
    if (!boardNodeInPrev) {
      const currentBoardNode = currentStore.nodes.find((n: any) => ['esp32-c3', 'esp32', 'arduino-uno'].includes(n.data?.type));
      if (currentBoardNode) restoredNodes.unshift(currentBoardNode);
    }
    setNodes(restoredNodes);
    setEdges(prevState.edges);
    setCode(prevState.code);
    setHistoryState(prev => ({ history: prev.history, index: prev.index - 1 }));
    setTimeout(() => { isRestoringRef.current = false; }, 50);
  }, [setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const { history: h, index } = historyRef.current;
    if (index >= h.length - 1) return;
    isRestoringRef.current = true;
    const nextState = h[index + 1];
    const currentStore = useForgeStore.getState();
    const boardNodeInNext = nextState.nodes.find((n: any) => ['esp32-c3', 'esp32', 'arduino-uno'].includes(n.data?.type));
    let restoredNodes = [...nextState.nodes];
    if (!boardNodeInNext) {
      const currentBoardNode = currentStore.nodes.find((n: any) => ['esp32-c3', 'esp32', 'arduino-uno'].includes(n.data?.type));
      if (currentBoardNode) restoredNodes.unshift(currentBoardNode);
    }
    setNodes(restoredNodes);
    setEdges(nextState.edges);
    setCode(nextState.code);
    setHistoryState(prev => ({ history: prev.history, index: prev.index + 1 }));
    setTimeout(() => { isRestoringRef.current = false; }, 50);
  }, [setNodes, setEdges]);

  // Stop simulation when navigating away from ForgeElectra
  useEffect(() => {
    return () => {
      if (useForgeStore.getState().isSimulating) {
        useForgeStore.getState().stopSimulation();
      }
    };
  }, []);

  // Circuit changes (add/delete/move/wire) → 350ms debounce for snappy undo
  useEffect(() => {
    if (isRestoringRef.current) return;
    const timer = setTimeout(() => {
      const { history: h, index } = historyRef.current;
      if (h.length === 0) return;
      const lastState = h[index];
      const s = useForgeStore.getState();
      const circuitChanged =
        JSON.stringify(lastState?.nodes) !== JSON.stringify(s.nodes) ||
        JSON.stringify(lastState?.edges) !== JSON.stringify(s.edges);
      if (circuitChanged) saveToHistory();
    }, 350);
    return () => clearTimeout(timer);
  }, [nodes, edges, saveToHistory]);

  // Code typing → 800ms debounce (avoids history spam while typing)
  useEffect(() => {
    if (isRestoringRef.current) return;
    const timer = setTimeout(() => {
      const { history: h, index } = historyRef.current;
      if (h.length === 0) return;
      if (h[index]?.code !== code) saveToHistory();
    }, 800);
    return () => clearTimeout(timer);
  }, [code, saveToHistory]);

  const loadProjectData = useCallback((data: any, rProjectName?: string | null, rProjectPath?: string | null) => {
    const loadedNodes = (data.nodes || data.circuit?.nodes || []) as Node[];
    const loadedEdges = (data.edges || data.circuit?.edges || []) as Edge[];
    const loadedCode = data.code || '';
    const loadedLibs = data.libraries || [];

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setCode(loadedCode);
    setImportedLibraries(loadedLibs);
    autoInstallLibraries(loadedLibs);

    if (data.board === 'arduino-uno' || data.board === 'esp32-c3') {
      setBoard(data.board);
    }

    if (rProjectPath) {
      setProjectPath(rProjectPath);
      const pathParts = rProjectPath.split(/[\\/]/);
      const folderName = pathParts[pathParts.length - 1];
      const cleanName = folderName ? folderName.replace(/\.(leap|lbp)$/i, '') : 'Loaded Project';
      setProjectName(cleanName);
    } else if (rProjectName) {
      setProjectName(rProjectName);
      setProjectPath(null);
    }

    setHistoryState({ history: [], index: -1 });
    setTimeout(() => {
      saveToHistory();
    }, 0);
  }, []);

  // Process redirect project data
  useEffect(() => {
    if (redirectProjectData && clearRedirectProjectData) {
      console.log('[FORGE ELECTRA] Processing redirect project data:', redirectProjectData);

      const projectObj = redirectProjectData as {
        data: {
          nodes?: unknown[];
          edges?: unknown[];
          circuit?: { nodes?: unknown[]; edges?: unknown[] };
          code?: string;
          board?: string;
          libraries?: string[];
        };
        projectName?: string | null;
        projectPath?: string | null;
      };

      loadProjectData(projectObj.data, projectObj.projectName, projectObj.projectPath);
      clearRedirectProjectData();
    }
  }, [redirectProjectData, clearRedirectProjectData, loadProjectData]);

  // Auto-load project from cloud storage (My Projects)
  useEffect(() => {
    const { pendingProject, clearPendingProject } = useCloudProjectStore.getState();
    if (!pendingProject || pendingProject.mode !== 'electra') return;

    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        console.log('[FORGE ELECTRA] Loading project from cloud...');
        loadProjectData(pendingProject.data, pendingProject.projectName);
        clearPendingProject();
      } catch (err) {
        console.error('[FORGE ELECTRA] Failed to load project from cloud:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [loadProjectData]);

  // Initialize board from prop on mount (does not re-fire on internal board changes)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasShareParam = params.has('share') || params.has('shareId');
    if (initialBoard && board !== initialBoard && !hasShareParam) {
      setBoard(initialBoard);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBoard, setBoard]);

  // Add the selected board to canvas on mount if no nodes exist and not loading a shared project
  useEffect(() => {
    const state = useForgeStore.getState();
    console.log('[FORGE ELECTRA] Checking if board needs to be added. Current nodes:', state.nodes.length, 'Initial board:', initialBoard);

    const params = new URLSearchParams(window.location.search);
    const hasShareParam = params.has('share') || params.has('shareId');

    if (state.nodes.length === 0 && initialBoard && !hasShareParam) {
      console.log('[FORGE ELECTRA] Adding board to canvas:', initialBoard);
      // Use the store's addNode function to properly add the board
      state.addNode(initialBoard, { x: 400, y: 300 }, {
        label: initialBoard === 'esp32-c3' ? 'ESP32-C3' : 'Arduino Uno'
      });
      console.log('[FORGE ELECTRA] Board added. New nodes count:', useForgeStore.getState().nodes.length);
      setTimeout(() => {
        saveToHistory();
      }, 50);
    }
  }, [initialBoard]); // Run when initialBoard changes

  const [activeTab, setActiveTab] = useState<'code' | 'serial' | 'wifi' | 'libraries'>('code');
  const [showEditor, setShowEditor] = useState(() => typeof window !== 'undefined' ? window.innerWidth > 768 : true);
  const { showPartPicker, setShowPartPicker, rotateNode } = useForgeStore();
  const [wifiStatus, setWifiStatus] = useState('');
  const [showWebOpenModal, setShowWebOpenModal] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectService.LeapProject[]>([]);

  useEffect(() => {
    if (board !== 'esp32-c3' || !isSimulating) {
      setWifiStatus('');
      return;
    }

    if (wifiLog.length > 0) {
      const latestLog = wifiLog[wifiLog.length - 1];
      if (latestLog.includes('connected')) setWifiStatus('Connected');
      else if (latestLog.includes('disconnected')) setWifiStatus('Disconnected');
      else if (latestLog.startsWith('ip:')) setWifiStatus(`IP: ${latestLog.replace('ip:', '').trim()}`);
    }
  }, [wifiLog, board, isSimulating]);

  const { isCompiling, handleToggleSimulation } = useElectraCompiler({
    board,
    code,
    isSimulating,
    startSimulation,
    stopSimulation,
    clearSerial,
    setWifiStatus,
  });
  const [isSaving, setIsSaving] = useState(false);

  // File Operations
  const handleNewProject = () => {
    if (confirm('Create a new project? Unsaved changes will be lost.')) {
      if (isSimulating) {
        stopSimulation();
      } else {
        clearSerial();
        clearWiFiLog();
      }
      setNodes([]);
      setEdges([]);
      setCode(board === 'esp32-c3' ? ESP32_DEFAULT_CODE : ARDUINO_DEFAULT_CODE);
      setProjectName('Untitled Project');
      setProjectPath(null);
      setHistoryState({ history: [], index: -1 });
      saveToHistory();

      // Add board back to canvas
      const state = useForgeStore.getState();
      state.addNode(board, { x: 400, y: 300 }, {
        label: board === 'esp32-c3' ? 'ESP32-C3' : 'Arduino Uno'
      });
    }
  };

  const handleOpenProject = async () => {
    if (IS_ELECTRON) {
      try {
        const result = await (window as any).electronAPI.openProject();
        if (result && result.data) {
          // Check if it's actually a Creova project (contains screens or schemaVersion)
          if (result.data.screens || result.data.schemaVersion) {
            console.log('[Electra/ForgeElectra] Detected Creova project file, redirecting...');
            if (onRedirectToCreova) {
              onRedirectToCreova(result.data, null, result.projectPath);
              return;
            }
          }

          if (isSimulating) {
            stopSimulation();
          } else {
            clearSerial();
            clearWiFiLog();
          }

          const { nodes: loadedNodes, edges: loadedEdges, code: loadedCode, libraries: loadedLibs, board: loadedBoard } = result.data;
          setNodes(loadedNodes || []);
          setEdges(loadedEdges || []);
          setCode(loadedCode || '');
          setImportedLibraries(loadedLibs || []);
          autoInstallLibraries(loadedLibs || []);
          if (loadedBoard === 'arduino-uno' || loadedBoard === 'esp32-c3') {
            setBoard(loadedBoard);
          }
          setProjectPath(result.projectPath);

          const pathParts = result.projectPath.split(/[\\/]/);
          const folderName = pathParts[pathParts.length - 1];
          const cleanName = folderName ? folderName.replace(/\.(leap|lbp)$/i, '') : 'Loaded Project';
          setProjectName(cleanName);

          setHistoryState({ history: [], index: -1 });
          saveToHistory();
        }
      } catch (err) {
        console.error('[FORGE] Failed to open project:', err);
        alert('Failed to open project.');
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleWebImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const projectData = isPacked(content) ? unpack<any>(content) : JSON.parse(content);

        // Check if it's actually a Creova project (contains screens or schemaVersion)
        if (projectData.screens || projectData.schemaVersion) {
          console.log('[Electra/ForgeElectra] Detected Creova project file, redirecting...');
          if (onRedirectToCreova) {
            const nameWithoutExt = file.name.replace(/\.(leap|lbp|json)$/i, '');
            onRedirectToCreova(projectData, nameWithoutExt, null);
            return;
          }
        }

        if (projectData.nodes && projectData.edges) {
          if (isSimulating) {
            stopSimulation();
          } else {
            clearSerial();
            clearWiFiLog();
          }

          setNodes(projectData.nodes || []);
          setEdges(projectData.edges || []);
          setCode(projectData.code || '');
          setImportedLibraries(projectData.libraries || []);
          autoInstallLibraries(projectData.libraries || []);
          if (projectData.board) setBoard(projectData.board);

          const nameWithoutExt = file.name.replace(/\.(leap|lbp|json)$/i, '');
          setProjectName(nameWithoutExt);
          setProjectPath(null);

          setHistoryState({ history: [], index: -1 });
          saveToHistory();
          alert('Project imported successfully!');
        } else {
          alert('Invalid project file format. Missing nodes or edges.');
        }
      } catch (err: any) {
        console.error('Failed to parse project file:', err);
        alert('Failed to parse project file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const loadWebProject = (project: ProjectService.LeapProject) => {
    setNodes(project.circuit.nodes || []);
    setEdges(project.circuit.edges || []);
    setCode(project.code || '');
    setImportedLibraries(project.libraries || []);
    autoInstallLibraries(project.libraries || []);
    if (project.board === 'arduino-uno' || project.board === 'esp32-c3') {
      setBoard(project.board);
    }
    setProjectPath(project.id);
    setProjectName(project.name);
    setHistoryState({ history: [], index: -1 });
    saveToHistory();
    setShowWebOpenModal(false);
  };

  const handleSaveProject = async () => {
    if (isSaving) return;
    setIsSaving(true);
    showToast("Saving project...", "info", 30000);
    try {
      const projectData = {
        nodes,
        edges,
        code,
        board,
        mode: 'electra' as const,
      };
      await fileService.saveProject(projectName || 'project', 'electra', projectData);
      if (!projectPath) {
        setProjectPath(uuidv4());
      }
      showToast("Project saved successfully!", "success");
    } catch (err: any) {
      console.error('[FORGE] Failed to save project:', err);
      showToast(err?.message || 'Failed to save project.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadProject = () => {
    const projectData = {
      nodes,
      edges,
      code,
      board,
      mode: 'electra' as const,
    };
    fileService.saveProjectLocally(projectName || 'project', 'electra', projectData);
  };

  const handleSaveAsProject = async () => {
    const projectData = {
      nodes,
      edges,
      code,
      board,
      mode: 'electra' as const,
    };
    const win = window as any;
    // Electron: native Save As dialog (no existing path)
    if (win.electronAPI?.saveProject) {
      try {
        const result = await win.electronAPI.saveProject(projectData);
        if (result?.success && result.projectPath) {
          setProjectPath(result.projectPath);
          const parts = result.projectPath.split(/[\\/]/);
          const name = parts[parts.length - 1]?.replace(/\.(leap|lbp)$/i, '');
          if (name) setProjectName(name);
          showToast('Project saved successfully!', 'success');
        }
        return;
      } catch (e) { console.warn('[Forge] electron saveAs failed, fallback to picker', e); }
    }
    // Web: File System Access API with filename prompt
    try {
      const res = await fileService.saveProjectAsLocally(projectName || 'project', 'electra', projectData);
      if (res.saved && res.newName) setProjectName(res.newName);
      if (res.saved) showToast('Project saved successfully!', 'success');
    } catch (e: any) {
      console.error('[Forge] Save As failed', e);
      showToast(e?.message || 'Save As failed', 'error');
    }
  };

  // Edit Operations
  const handleCut = () => {
    // Copy selected nodes/edges to clipboard then delete
    handleCopy();
    const state = useForgeStore.getState();
    if (state.selectedNodeId) {
      state.removeNode(state.selectedNodeId);
    }
    if (state.selectedEdgeId) {
      state.removeEdge(state.selectedEdgeId);
    }
  };

  const handleCopy = () => {
    const state = useForgeStore.getState();
    const clipboardData: any = {};

    if (state.selectedNodeId) {
      const node = nodes.find(n => n.id === state.selectedNodeId);
      if (node) {
        clipboardData.node = JSON.parse(JSON.stringify(node));
      }
    }

    if (state.selectedEdgeId) {
      const edge = edges.find(e => e.id === state.selectedEdgeId);
      if (edge) {
        clipboardData.edge = JSON.parse(JSON.stringify(edge));
      }
    }

    // Store in sessionStorage (clipboard API requires user interaction)
    if (Object.keys(clipboardData).length > 0) {
      sessionStorage.setItem('forge-clipboard', JSON.stringify(clipboardData));
      console.log('[FORGE] Copied to clipboard:', clipboardData);
    }
  };

  const handlePaste = () => {
    try {
      const clipboardStr = sessionStorage.getItem('forge-clipboard');
      if (!clipboardStr) return;

      const clipboardData = JSON.parse(clipboardStr);
      const state = useForgeStore.getState();

      if (clipboardData.node) {
        // Paste node with offset position
        const newNode = {
          ...clipboardData.node,
          id: `${clipboardData.node.id}-copy-${Date.now()}`,
          position: {
            x: clipboardData.node.position.x + 50,
            y: clipboardData.node.position.y + 50
          }
        };
        state.addNode(newNode.data.type, newNode.position, newNode.data);
        console.log('[FORGE] Pasted node:', newNode);
      }
    } catch (err) {
      console.error('[FORGE] Failed to paste:', err);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Ctrl/Cmd+Shift+S: Save As (must be checked before plain Save)
      if (mod && e.shiftKey && key === 's') {
        e.preventDefault();
        handleSaveAsProject();
      }
      // Ctrl/Cmd+S: Save
      else if (mod && key === 's') {
        e.preventDefault();
        handleSaveProject();
      }
      // Ctrl/Cmd+N: New Project
      else if (mod && key === 'n') {
        e.preventDefault();
        handleNewProject();
      }
      // Ctrl/Cmd+O: Open Project
      else if (mod && key === 'o') {
        e.preventDefault();
        handleOpenProject();
      }
      // Ctrl/Cmd+Z: Undo
      else if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z: Redo
      else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        handleRedo();
      }
      // Ctrl/Cmd+X: Cut
      else if (mod && key === 'x') {
        // Don't intercept if user is in code editor or input field
        const activeElement = document.activeElement;
        const isInEditor = activeElement?.classList.contains('monaco-editor') ||
          activeElement?.closest('.monaco-editor') ||
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA';
        if (!isInEditor) {
          e.preventDefault();
          handleCut();
        }
      }
      // Ctrl/Cmd+C: Copy
      else if (mod && key === 'c') {
        // Don't intercept if user is in code editor or input field
        const activeElement = document.activeElement;
        const isInEditor = activeElement?.classList.contains('monaco-editor') ||
          activeElement?.closest('.monaco-editor') ||
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA';
        if (!isInEditor) {
          e.preventDefault();
          handleCopy();
        }
      }
      // Ctrl/Cmd+V: Paste
      else if (mod && key === 'v') {
        // Don't intercept if user is in code editor or input field
        const activeElement = document.activeElement;
        const isInEditor = activeElement?.classList.contains('monaco-editor') ||
          activeElement?.closest('.monaco-editor') ||
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA';
        if (!isInEditor) {
          e.preventDefault();
          handlePaste();
        }
      }
      // R: Rotate selected node (works regardless of CapsLock)
      else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        const activeElement = document.activeElement;
        const isInEditor = activeElement?.classList.contains('monaco-editor') ||
          activeElement?.closest('.monaco-editor') ||
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA';

        if (!isInEditor) {
          const state = useForgeStore.getState();
          if (state.selectedNodeId) {
            e.preventDefault();
            rotateNode(state.selectedNodeId);
          }
        }
      }
      // Delete / Backspace: Remove selected node or edge
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeElement = document.activeElement;
        const isInEditor = activeElement?.classList.contains('monaco-editor') ||
          activeElement?.closest('.monaco-editor') ||
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA' ||
          activeElement?.tagName === 'SELECT';

        if (!isInEditor) {
          const state = useForgeStore.getState();
          if (state.selectedNodeId) {
            // Prevent deleting board elements (ESP32, Arduino)
            const node = state.nodes.find(n => n.id === state.selectedNodeId);
            const isBoardNode = node && ['esp32-c3', 'esp32', 'arduino-uno'].includes(node.data?.type);
            if (!isBoardNode) {
              e.preventDefault();
              state.removeNode(state.selectedNodeId);
              state.setSelectedNode(null);
            }
          } else if (state.selectedEdgeId) {
            e.preventDefault();
            state.removeEdge(state.selectedEdgeId);
            state.setSelectedEdge(null);
          }
        }
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, nodes, edges, code, projectPath]);



  const [showBoardConfirm, setShowBoardConfirm] = useState(false);
  const [pendingBoard, setPendingBoard] = useState<string | null>(null);

  const hasModifications = () => {
    const defaultCode = board === 'esp32-c3' ? ESP32_DEFAULT_CODE : ARDUINO_DEFAULT_CODE;
    return nodes.length > 1 || edges.length > 0 || code !== defaultCode;
  };

  const handleSwitchBoard = (targetBoard: string) => {
    if (targetBoard === board) return;

    if (hasModifications()) {
      setPendingBoard(targetBoard);
      setShowBoardConfirm(true);
      return;
    }

    executeBoardSwitch(targetBoard);
  };

  const executeBoardSwitch = (targetBoard: string) => {
    if (isSimulating) {
      stopSimulation();
      setWifiStatus('');
    }

    setNodes([]);
    setEdges([]);
    setCode(targetBoard === 'esp32-c3' ? ESP32_DEFAULT_CODE : ARDUINO_DEFAULT_CODE);
    setBoard(targetBoard);

    const state = useForgeStore.getState();
    state.addNode(targetBoard, { x: 400, y: 300 }, {
      label: targetBoard === 'esp32-c3' ? 'ESP32-C3' : 'Arduino Uno'
    });

    setHistoryState({ history: [], index: -1 });
    saveToHistory();
  };

  const handleBack = () => {
    if (isSimulating) {
      stopSimulation();
      setWifiStatus('');
    }
    onBack();
  };



  const electraVars = useMemo(() => getElectraVars(board, uiTheme), [board, uiTheme]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden font-sans transition-colors duration-400 bg-slate-950 text-slate-100" style={electraVars as React.CSSProperties}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;700&family=Space+Mono:wght@400;700&display=swap');
        @keyframes tabGlowEntrance { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.1); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalScale { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes badgePulse { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.8); opacity: 0; } }
        @keyframes analysisFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes overlay-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modal-slide-up { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .react-flow__node { background: transparent !important; border: none !important; outline: none !important; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
        .react-flow__node.selected .leap-node-wrapper, .react-flow__node:focus .leap-node-wrapper, .react-flow__node:focus-visible .leap-node-wrapper { outline: none !important; box-shadow: none !important; border: none !important; }
        .react-flow__edge-interaction { stroke-width: 4px !important; }
        .leap-node-wrapper { background: transparent; outline: none; box-shadow: none; transition: none; }
        .leap-node-wrapper:hover { background: transparent; outline: none; box-shadow: none; transform: none; filter: none; }
        .leap-node-svg-container { transition: filter 0.18s ease; filter: none; }
        .leap-node-svg-container:hover { filter: drop-shadow(0 0 1.5px rgba(34, 211, 238, 0.5)); }
        .leap-node-wrapper.is-selected .leap-node-svg-container { filter: drop-shadow(0 0 1px rgba(34, 211, 238, 0.9)) drop-shadow(0 0 3px rgba(34, 211, 238, 0.4)); }
        .monaco-editor, .monaco-editor .margin, .monaco-editor-background { background-color: transparent !important; }
        .board-arduino-uno .component-sidebar { background: #ffffff !important; border-right: 1px solid #e2e8f0 !important; font-family: 'Outfit', sans-serif !important; }
        .board-arduino-uno .component-sidebar div, .board-arduino-uno .component-sidebar span { color: #475569 !important; }
        .board-arduino-uno .component-sidebar button { color: #64748b !important; }
        .board-arduino-uno .component-sidebar input { color: #0f172a !important; }
        .board-arduino-uno .component-sidebar .component-card { background: #ffffff !important; border: 1px solid #e2e8f0 !important; border-radius: 8px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.04) !important; transition: all 0.2s ease !important; }
        .board-arduino-uno .component-sidebar .component-card:hover { border-color: #06b6d4 !important; background: #ffffff !important; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08) !important; transform: translateY(-1px) !important; }
        .theme-light .component-sidebar { background: #ffffff !important; border-right: 1px solid var(--lp-border) !important; }
        .theme-light .component-sidebar div, .theme-light .component-sidebar span { color: #475569 !important; }
        .theme-light .component-sidebar button { color: #64748b !important; }
        .theme-light .component-sidebar input { color: #0f172a !important; background: #ffffff !important; border: 1px solid #e2e8f0 !important; }
        .theme-light .component-sidebar .component-card { background: #ffffff !important; border: 1px solid #e2e8f0 !important; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.02) !important; }
        .theme-light .component-sidebar .component-card:hover { border-color: var(--lp-accent-primary) !important; background: #ffffff !important; transform: translateY(-2px) !important; box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04) !important; }
        .circuit-analysis-panel::-webkit-scrollbar { width: 8px; }
        .circuit-analysis-panel::-webkit-scrollbar-track { background: #0f172a; }
        .circuit-analysis-panel::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .circuit-analysis-panel::-webkit-scrollbar-thumb:hover { background: #475569; }
        @media (max-width: 1024px) { .forge-main-split { position: relative; } }
        @media (max-width: 1024px) { .forge-main-split { padding: 8px; gap: 8px; } }
      `}</style>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".leap,.lbp,.json"
        onChange={handleWebImport}
      />
      <IgniteTopbar
        title={projectName}
        onTitleChange={setProjectName}
        onBack={handleBack}
        onSave={handleSaveProject}
        onSaveAs={handleSaveAsProject}
        onDownload={handleDownloadProject}
        onNew={handleNewProject}
        onOpen={handleOpenProject}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onSwitchBoard={handleSwitchBoard}
        currentBoard={board}
        isSaving={isSaving}
        onToggleEditor={() => setShowEditor(!showEditor)}
        showEditor={showEditor}
      />

      <main className={`forge-main-split flex-1 flex gap-2 p-2 bg-transparent min-h-0 min-w-0 ${uiTheme === 'light' ? 'max-lg:relative text-slate-900' : ''}`} style={uiTheme === 'light' ? (getLightThemeVars(board) as React.CSSProperties) : undefined}>
        {/* Far Left: Component Drawer */}
        {showPartPicker && (
          <div className="part-picker-pane h-full border border-slate-700/50 overflow-hidden flex flex-col relative backdrop-blur-md max-lg:absolute max-lg:top-2 max-lg:right-2 max-lg:bottom-2 max-lg:w-[320px] max-lg:z-70 max-md:w-[calc(100%-16px)] max-md:right-2 max-md:left-2 w-[280px] bg-slate-900/90 rounded-2xl shadow-xl">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
            <ComponentSidebar
              onSelect={(type) => {
                const state = useForgeStore.getState();
                // Place part at the center of the currently visible viewport
                const container = document.querySelector('.forge-canvas-container');
                const vp = state.viewport;
                let pos = { x: 400, y: 300 };
                if (container) {
                  const rect = container.getBoundingClientRect();
                  // Convert screen center to flow coordinates
                  pos = {
                    x: (rect.width / 2 - vp.x) / vp.zoom,
                    y: (rect.height / 2 - vp.y) / vp.zoom,
                  };
                }
                state.addNode(type, pos, { label: type.toUpperCase() });
                // Push history quickly so Undo can revert immediately (debounced circuit effect is 350ms, but immediate is snappier)
                setTimeout(() => saveToHistory(), 80);
              }}
              onClose={() => setShowPartPicker(false)}
              currentBoard={board as any}
            />
          </div>
        )}

        {/* Middle: Simulation Canvas (takes flex: 1) */}
        <div className="canvas-pane flex-[1.2] max-lg:flex-[1_1_100%] max-lg:w-full max-lg:h-full max-lg:z-10 overflow-hidden flex flex-col relative backdrop-blur-md bg-slate-900/90 border border-slate-700/50 rounded-2xl shadow-xl">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent transition-all duration-400" />
          <div className="flex-1 relative h-full">
            <Suspense fallback={<Loader />}>
              <ForgeCanvas
                onToggleSimulation={handleToggleSimulation}
                isCompiling={isCompiling}
                showEditor={showEditor}
                onToggleEditor={() => {
                  if (!showEditor && window.innerWidth <= 1024 && showPartPicker) {
                    setShowPartPicker(false);
                  }
                  setShowEditor(!showEditor);
                }}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={historyIndex > 0}
                canRedo={historyIndex < history.length - 1}
              />
            </Suspense>

            {/* Floating WiFi Status */}
            {board === 'esp32-c3' && isSimulating && wifiStatus && (
              <div className="absolute bottom-5 right-5 z-10">
                <div className="flex items-center gap-2 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/40 rounded-xl shadow-lg">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-[pulse-dot_1.5s_ease-in-out_infinite] shadow-[0_0_8px_#22d3ee]" />
                  {wifiStatus}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Middle/Right: Interactive Programming Pane */}
        {showEditor && (
          <div className="editor-pane flex-[0.8] min-w-[400px] max-lg:absolute max-lg:top-2 max-lg:right-2 max-lg:bottom-2 max-lg:w-[420px] max-lg:z-60 max-md:w-[calc(100%-16px)] max-md:right-2 max-md:left-2 overflow-hidden flex flex-col relative backdrop-blur-md bg-slate-900/90 border border-slate-700/50 rounded-2xl shadow-xl">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent transition-all duration-400" />
            {/* Top: Sketch Editor */}
            <div className={`flex flex-col min-h-0 ${activeTab === 'libraries' ? 'flex-1 border-b-0' : 'flex-[1.5] border-b border-slate-700/50'}`}>
              <div
                className={`flex items-center relative z-10 h-9.5 px-4 gap-0.5 border-b backdrop-blur-md ${
                  uiTheme === 'light'
                    ? 'bg-white border-slate-200'
                    : 'bg-slate-950/40 border-white/5'
                }`}
              >
                {/* Board badge */}
                <div
                  className={`flex items-center gap-2 py-1 px-3 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 h-5.5 box-border border ${
                    uiTheme === 'light'
                      ? (board === 'arduino-uno' ? 'bg-sky-500/8 border-sky-500/15 text-sky-600' : 'bg-orange-500/8 border-orange-500/15 text-orange-600')
                      : 'bg-white/3 border-white/8 text-cyan-400 shadow-inner'
                  }`}
                >
                  <span
                    className={`block w-1.5 h-1.5 rounded-full shrink-0 ${
                      uiTheme === 'light'
                        ? (board === 'arduino-uno' ? 'bg-sky-500' : 'bg-orange-500')
                        : 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]'
                    }`}
                  />
                  <span className="leading-none inline-block">
                    {board === 'esp32-c3' ? 'ESP32-C3' : 'ARDUINO UNO'}
                  </span>
                </div>

                {/* Divider */}
                <div className={`w-px h-4.5 mx-2.5 ${uiTheme === 'light' ? 'bg-slate-200' : 'bg-white/6'}`} />

                {/* SKETCH tab */}
                <button
                  className={`relative flex items-center gap-1.5 px-3 h-9.5 text-[10px] font-bold tracking-wider uppercase cursor-pointer border-none bg-transparent transition-colors duration-200 ${
                    activeTab === 'code'
                      ? 'text-cyan-400'
                      : (uiTheme === 'light' ? 'text-slate-500/60 hover:text-slate-700' : 'text-slate-400/50 hover:text-slate-200')
                  }`}
                  onClick={() => setActiveTab('code')}
                >
                  <Code size={13} strokeWidth={2.5} />
                  Sketch
                  {/* Active indicator */}
                  {activeTab === 'code' && (
                    <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-t-xs bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
                  )}
                </button>

                {/* LIBRARIES tab */}
                <button
                  className={`relative flex items-center gap-1.5 px-3 h-9.5 text-[10px] font-bold tracking-wider uppercase cursor-pointer border-none bg-transparent transition-colors duration-200 ${
                    activeTab === 'libraries'
                      ? 'text-cyan-400'
                      : (uiTheme === 'light' ? 'text-slate-500/60 hover:text-slate-700' : 'text-slate-400/50 hover:text-slate-200')
                  }`}
                  onClick={() => setActiveTab('libraries')}
                >
                  <LibraryIcon size={13} strokeWidth={2.5} />
                  Libraries
                  {activeTab === 'libraries' && (
                    <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-t-xs bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
                  )}
                </button>
              </div>

              <div className="flex-1 relative overflow-hidden">
                {activeTab === 'libraries' ? (
                  <LibraryManager />
                ) : (
                  <Suspense fallback={<Loader />}>
                    <ForgeEditor code={code} onChange={(val) => setCode(val || '')} />
                  </Suspense>
                )}
              </div>
            </div>

            <TerminalPanel
              board={board}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              serialOutput={serialOutput}
              clearSerial={clearSerial}
              wifiLog={wifiLog}
              clearWiFiLog={clearWiFiLog}
              isSimulating={isSimulating}
            />
          </div>
        )}
      </main>

      <footer className={`flex items-center px-4 justify-between relative text-[10px] h-[30px] bg-slate-950 border-t border-slate-800 text-slate-400 ${uiTheme === 'light' ? 'text-slate-700' : ''}`} style={uiTheme === 'light' ? (getLightThemeVars(board) as React.CSSProperties) : undefined}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-cyan-500/30 to-transparent" />
        <div className="flex items-center gap-5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-sm font-bold text-[9px] uppercase tracking-widest border bg-slate-800 text-cyan-400 border-slate-700">Electra Engine v1.0</span>
          {isSimulating && (
            <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-[pulse-dot_1.5s_ease-in-out_infinite] shadow-[0_0_8px_#10b981]" />
              SIMULATION ACTIVE ({board.toUpperCase()})
            </div>
          )}
        </div>
        <div className="font-semibold tracking-wider">
          {new Date().toLocaleTimeString()}
        </div>
      </footer>

      <WebOpenModal
        isOpen={!IS_ELECTRON && showWebOpenModal}
        onClose={() => setShowWebOpenModal(false)}
        recentProjects={recentProjects}
        loadWebProject={loadWebProject}
      />

      <BoardConfirmModal
        isOpen={showBoardConfirm}
        onClose={() => {
          setShowBoardConfirm(false);
          setPendingBoard(null);
        }}
        pendingBoard={pendingBoard}
        executeBoardSwitch={executeBoardSwitch}
      />
    </div>
  );
}
