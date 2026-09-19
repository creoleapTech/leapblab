/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import { create } from 'zustand';
import { Node, Edge, Connection, addEdge as rfAddEdge } from 'reactflow';
import { v4 as uuidv4 } from 'uuid';

const STORE_LOAD_START = performance.now();
const logStoreTiming = (label: string) => {
  const elapsed = (performance.now() - STORE_LOAD_START).toFixed(2);
  console.log(`[STORE TIMING] ${elapsed}ms - ${label}`);
};

logStoreTiming('Store module started loading');

// Lazy-load engines only when needed — prevents blocking app startup
let simulationRunner: any = null;
let circuitEngine: any = null;
let _esp32SerialListener: ((line: string) => void) | null = null;

export async function getSimulationRunner() {
  const start = performance.now();
  logStoreTiming('getSimulationRunner() called');
  if (!simulationRunner) {
    const module = await import('../../Src/engine/Arduino/SimulationRunner');
    simulationRunner = module.simulationRunner;
    const elapsed = (performance.now() - start).toFixed(2);
    logStoreTiming(`SimulationRunner loaded in ${elapsed}ms`);
  } else {
    logStoreTiming('SimulationRunner already cached');
  }
  return simulationRunner;
}

async function getCircuitEngine() {
  const start = performance.now();
  logStoreTiming('getCircuitEngine() called');
  if (!circuitEngine) {
    const module = await import('../../Src/engine/Arduino/CircuitEngine');
    circuitEngine = module.circuitEngine;
    const elapsed = (performance.now() - start).toFixed(2);
    logStoreTiming(`CircuitEngine loaded in ${elapsed}ms`);
  } else {
    logStoreTiming('CircuitEngine already cached');
  }
  return circuitEngine;
}

export function getCircuitEngineSync() {
  return circuitEngine;
}

logStoreTiming('Lazy loaders defined');

export interface WireDraft {
  source: string;
  sourceHandle: string;
  waypoints: { x: number; y: number }[];
  /**
   * Exact source-pin position in flow coordinates, captured from the handle's
   * real DOM rect on mousedown. Used to anchor the draft wire precisely at
   * the visible pin (the node may be scaled/rotated, so a calculated
   * position from srcNode.width × pinPercent drifts from the actual handle).
   */
  sourcePosition?: { x: number; y: number };
}

export interface ForgeState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  projectName: string;

  // Actions
  addNode: (type: string, position: { x: number; y: number }, data?: any) => void;
  removeNode: (id: string) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, data: any) => void;
  rotateNode: (id: string) => void;

  addEdge: (edge: Edge | Connection) => void;
  removeEdge: (id: string) => void;
  updateEdgeData: (id: string, data: any) => void;

  setSelectedNode: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  clearWorkspace: () => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setProjectName: (name: string) => void;

  // Wire Draft (click-to-route)
  wireDraft: WireDraft | null;
  /**
   * Pin that the user is currently pressing the mouse button down on, but
   * has not yet released. The wire draft is deferred until the user
   * releases the mouse — i.e. the user must "click and release" a pin
   * before the rubber-band wire begins following the cursor. Releasing
   * on the same pin starts the wire; releasing on a different pin
   * creates the connection directly (drag-release case).
   */
  pendingSource: { nodeId: string; pinName: string; sourcePosition?: { x: number; y: number } } | null;
  setPendingSource: (source: { nodeId: string; pinName: string; sourcePosition?: { x: number; y: number } } | null) => void;
  /**
   * Nearest pin under the cursor while a wire is being drawn — the magnetic snap
   * target that will be connected if the user releases the mouse now. Drives the
   * red target highlight independently of the (tiny) pin dot hover area.
   */
  draftTargetPin: { nodeId: string; pinName: string } | null;
  setDraftTargetPin: (target: { nodeId: string; pinName: string } | null) => void;
  startWireDraft: (
    source: string,
    sourceHandle: string,
    sourcePosition?: { x: number; y: number },
  ) => void;
  addWireWaypoint: (point: { x: number; y: number }) => void;
  completeWireDraft: (target: string, targetHandle: string) => void;
  cancelWireDraft: () => void;

  // Simulation
  isSimulating: boolean;
  startSimulation: (hexString: string, sourceCode?: string) => void;
  stopSimulation: () => void;
  resetSimulation: () => void;
  toggleSimulation: () => void;

  // Serial Monitor
  serialOutput: string;
  appendSerial: (data: string) => void;
  clearSerial: () => void;

  // WiFi Log (ESP32 only)
  wifiLog: string[];
  appendWiFiLog: (msg: string) => void;
  clearWiFiLog: () => void;

  // Board Configuration
  board: string;
  setBoard: (board: string) => void;

  // Project Configuration
  projectPath: string | null;
  setProjectPath: (path: string | null) => void;

  // Libraries
  importedLibraries: string[];
  setImportedLibraries: (libs: string[]) => void;
  addImportedLibrary: (lib: string) => void;

  // Library Search Persistence
  librarySearchQuery: string;
  librarySearchResults: any[];
  setLibrarySearch: (query: string, results: any[]) => void;

  // UI State
  showPartPicker: boolean;
  setShowPartPicker: (show: boolean) => void;
  uiTheme: 'light' | 'dark';
  setUiTheme: (theme: 'light' | 'dark') => void;
  toggleUiTheme: () => void;

  // Viewport (zoom/pan persistence)
  viewport: { x: number; y: number; zoom: number };
  setViewportState: (vp: { x: number; y: number; zoom: number }) => void;

  // Waypoint Dragging
  isDraggingWaypoint: boolean;
  setIsDraggingWaypoint: (isDragging: boolean) => void;
  sourceCode: string;
}

/** Map canvas node data.type → store board ID */
const BOARD_NODE_TO_BOARD_ID: Record<string, string> = {
  'esp32-c3': 'esp32-c3',
  'esp32': 'esp32-c3',
  'arduino-uno': 'arduino-uno',
  // REMOVED: Only Arduino Uno and ESP32-C3 supported
  // 'arduino-nano': 'arduino-nano',
  // 'arduino-mega': 'arduino-mega',
  // 'attiny85': 'attiny85',
};

/** Detect the board from a list of nodes — returns the first board node found, or null */
function detectBoardFromNodes(nodes: Node[]): string | null {
  for (const node of nodes) {
    const boardId = BOARD_NODE_TO_BOARD_ID[node.data?.type];
    if (boardId) return boardId;
  }
  return null;
}

export const useForgeStore = create<ForgeState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  projectName: 'Untitled Project',
  sourceCode: '',
  isSimulating: false,
  serialOutput: '',
  wifiLog: [],
  board: 'arduino-uno',
  projectPath: null,

  importedLibraries: [],
  librarySearchQuery: '',
  librarySearchResults: [],
  showPartPicker: false,
  uiTheme: 'light',
  viewport: { x: 0, y: 0, zoom: 1 },
  wireDraft: null,
  pendingSource: null,
  draftTargetPin: null,
  isDraggingWaypoint: false,

  setUiTheme: (theme) => set({ uiTheme: theme }),
  toggleUiTheme: () => set((state) => ({ uiTheme: state.uiTheme === 'light' ? 'dark' : 'light' })),
  setViewportState: (vp) => set({ viewport: vp }),
  setIsDraggingWaypoint: (isDragging) => set({ isDraggingWaypoint: isDragging }),

  setPendingSource: (source) => {
    if (source === null) {
      set({ pendingSource: null });
      return;
    }
    console.log(`[FORGE STORE] Pending source armed: ${source.nodeId}:${source.pinName}`);
    set({ pendingSource: source });
  },

  setDraftTargetPin: (target) => set((state) => {
    const current = state.draftTargetPin;
    if (current === target) return state;
    if (current && target && current.nodeId === target.nodeId && current.pinName === target.pinName) return state;
    return { draftTargetPin: target };
  }),

  startWireDraft: (source, sourceHandle, sourcePosition) => {
    console.log(
      `[FORGE STORE] Wire draft started: ${source}:${sourceHandle}` +
      (sourcePosition
        ? ` @ (${sourcePosition.x.toFixed(1)}, ${sourcePosition.y.toFixed(1)})`
        : ''),
    );
    set({
      // Clear any pending source — the draft is now active and supersedes it.
      pendingSource: null,
      draftTargetPin: null,
      wireDraft: {
        source,
        sourceHandle,
        waypoints: [],
        sourcePosition,
      },
    });
  },

  addWireWaypoint: (point) => set((state) => {
    if (!state.wireDraft) return state;
    console.log(`[FORGE STORE] Wire waypoint added: (${point.x.toFixed(0)}, ${point.y.toFixed(0)})`);
    return { wireDraft: { ...state.wireDraft, waypoints: [...state.wireDraft.waypoints, point] } };
  }),

  completeWireDraft: (target, targetHandle) => set((state) => {
    if (!state.wireDraft) return state;
    const { source, sourceHandle, waypoints } = state.wireDraft;
    const edge = {
      source,
      sourceHandle,
      target,
      targetHandle: `${targetHandle}__target`,
      id: `e-${uuidv4()}`,
      type: 'wire',
      data: { color: '#22c55e', waypoints },
    };
    console.log(`[FORGE STORE] Wire draft completed: ${source}:${sourceHandle} → ${target}:${targetHandle}`);
    return { edges: [...state.edges, edge as any], wireDraft: null, pendingSource: null, draftTargetPin: null };
  }),

  cancelWireDraft: () => {
    console.log('[FORGE STORE] Wire draft cancelled');
    set({ wireDraft: null, pendingSource: null, draftTargetPin: null });
  },

  setProjectPath: (path) => {
    console.log(`[FORGE STORE] projectPath updated to: ${path}`);
    set({ projectPath: path });
  },

  setImportedLibraries: (libs) => {
    console.log(`[FORGE STORE] importedLibraries list updated (${libs.length} items)`);
    set({ importedLibraries: libs });
  },
  addImportedLibrary: (lib) => set((state) => {
    if (state.importedLibraries.includes(lib)) {
      return state;
    }
    console.log(`[FORGE STORE] Adding library to project: ${lib}`);
    return {
      importedLibraries: [...state.importedLibraries, lib]
    };
  }),

  setBoard: (board) => {
    // Only update runner if already loaded — avoids triggering the 4s avr8js load
    if (simulationRunner) {
      simulationRunner.setBoard(board);
    }
    set({ board });
  },

  setLibrarySearch: (query, results) => set({
    librarySearchQuery: query,
    librarySearchResults: results
  }),

  setShowPartPicker: (show) => set({ showPartPicker: show }),

  startSimulation: (hexString, sourceCode) => {
    const state = useForgeStore.getState();
    console.log('[FORGE STORE] startSimulation triggered. Hex length:', hexString.length);

    // Set simulating immediately for UI feedback
    set({ isSimulating: true, serialOutput: '', wifiLog: [], sourceCode: sourceCode || '' });

    // Load engines and start simulation asynchronously
    Promise.all([getCircuitEngine(), getSimulationRunner()]).then(([engine, runner]) => {
      if (sourceCode) {
        runner.setSourceCode(sourceCode);
      }
      engine.init();

      const isESP32Transpiled = hexString === '__esp32_c3_transpiled__';
      const isESP32Binary = hexString === '__esp32_c3_binary__' || hexString === '__esp32_c3_riscv__';
      const isESP32Sentinel = isESP32Transpiled || isESP32Binary;
      const isESP32Board = state.board === 'esp32-c3' || state.board === 'esp32';
      // Guard: transpiled sentinel is only valid for ESP32 boards. If caller sent
      // '__esp32_c3_transpiled__' while board is still 'arduino-uno' (historical
      // fallback bug), treat as error rather than init empty AVR CPU with no output.
      if (isESP32Sentinel && !isESP32Board) {
        console.error(`[FORGE STORE] ❌ Mismatched sentinel ${hexString} for board ${state.board} — aborting (use compile hex for AVR)`);
        set((s) => ({
          serialOutput: s.serialOutput +
            `\n❌ SIMULATION CONFIG ERROR:\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Transpiled ESP32 payload received while board is ${state.board}.\n` +
            `This indicates a compiler fallback bug. Please retry — the cloud compiler may be cold.\n` +
            `If this persists, switch board to ESP32-C3 or ensure PlatformIO compile succeeds.\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
          isSimulating: false,
        }));
        return;
      }
      const isESP32 = isESP32Sentinel && isESP32Board;

      if (!isESP32) {
        // AVR path — hex must be non-empty compiled HEX, not a sentinel
        if (!hexString || hexString.startsWith('__')) {
          console.error('[FORGE STORE] ❌ Invalid hex for AVR:', hexString.slice(0, 40));
          set((s) => ({
            serialOutput: s.serialOutput + `\n❌ COMPILATION FAILED: No HEX produced for ${state.board}. Check compiler logs.\n`,
            isSimulating: false,
          }));
          return;
        }
        runner.setBoard(state.board);
        console.log('[FORGE STORE] Initializing AVR CPU with hex...');
        runner.initCPU(hexString);
      } else if (isESP32Transpiled) {
        // Transpiled JS path — ArduinoRuntime handles everything.
        // Initialize early so ESP32C3Runner is available during syncCircuitGraph()
        console.log('[FORGE STORE] ESP32-C3 transpiled path — initializing early...');
        runner.setBoard(state.board);
        runner.initCPU('');
      } else {
        console.log('[FORGE STORE] ESP32-C3 RISC-V path — initializing ESP32-C3 runner before syncCircuitGraph...');
        runner.initCPU(''); // triggers ESP32-C3 branch in initCPU (board already set via setBoard)

        // Wire ESP32-C3 serial output → store + GPIO pin parser
        const esp32c3Runner = runner.ESP32C3Runner;
        if (esp32c3Runner) {
          if (_esp32SerialListener) {
            esp32c3Runner.removeSerialListener(_esp32SerialListener);
          }

          _esp32SerialListener = (line: string) => {
            // Parse __LF_WIFI: prefixed messages and route to WiFi log
            const wifiMatch = line.match(/__LF_WIFI:(.+)/);
            if (wifiMatch) {
              const wifiMsg = wifiMatch[1].trim();
              useForgeStore.getState().appendWiFiLog(wifiMsg);
              return; // Don't append to serial output
            }

            // Regular serial output
            useForgeStore.getState().appendSerial(line);

            // Parse __LF_GPIO:pin:value lines and drive SimulationRunner pin states
            const gpioMatch = line.match(/__LF_GPIO:(\d+):(\d+)/);
            if (gpioMatch) {
              const pin = parseInt(gpioMatch[1], 10);
              const val = parseInt(gpioMatch[2], 10);
              runner.setPinState(`ESP${pin}`, val ? 'HIGH' : 'LOW');
            }

            // Parse __LF_PWM:pin:value lines
            const pwmMatch = line.match(/__LF_PWM:(\d+):(\d+)/);
            if (pwmMatch) {
              const pin = parseInt(pwmMatch[1], 10);
              const val = parseInt(pwmMatch[2], 10);
              runner.setPinState(`ESP${pin}`, val > 127 ? 'HIGH' : 'LOW');
            }
          };

          esp32c3Runner.addSerialListener(_esp32SerialListener);
          console.log('[FORGE STORE] ESP32-C3 serial listener wired to store.appendSerial + GPIO parser + WiFi log');
        }
      }

      engine.syncCircuitGraph();

      console.log('[FORGE STORE] Firing simulationRunner.start()');
      runner.start().catch((err: any) => {
        console.error('[FORGE STORE] simulationRunner.start() failed:', err);
        set((state) => ({
          serialOutput: state.serialOutput +
            `\n❌ SIMULATION RUNTIME ERROR:\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${err.message || String(err)}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Please check your code for typos or syntax errors.\n`,
          isSimulating: false
        }));
        runner.stop();
      });
    });
  },

  stopSimulation: () => {
    console.log('[FORGE STORE] stopSimulation triggered.');
    const { nodes } = get();
    const cleanedNodes = nodes.map(node => {
      const sv = node.data?.sensorValues;
      if (sv && (sv.touched || sv.motionDetected || sv.obstacleDetected)) {
        return {
          ...node,
          data: {
            ...node.data,
            sensorValues: {
              ...sv,
              touched: false,
              touchX: 0,
              touchY: 0,
              motionDetected: false,
              obstacleDetected: false,
            }
          }
        };
      }
      return node;
    });
    set({ isSimulating: false, nodes: cleanedNodes });
    getSimulationRunner().then(runner => runner.stop());
  },

  resetSimulation: () => {
    console.log('[FORGE STORE] resetSimulation triggered (Clear Canvas/States).');

    // Properties that are set during simulation and should be cleared on reset
    const SIMULATION_DATA_KEYS = [
      'lcdState', 'oledImageData', 'tftImageData', 'tftDisplayOn', 'tftRotation',
      'pinStates', 'damaged',
      'angle', 'speed', 'direction',
      'neopixelPixels', 'segValues',
      'relayEnergized',
      'pressedKey',
      'ena', 'enb', 'in1', 'in2', 'in3', 'in4',
      'innerHandAngle', 'innerEnergized', 'outerHandAngle', 'outerEnergized',
      'beatPhase', 'adcValue', 'sensorValues',
    ];

    const { nodes } = get();
    const cleanedNodes = nodes.map(node => {
      const cleanData = { ...node.data };
      for (const key of SIMULATION_DATA_KEYS) {
        delete cleanData[key];
      }
      return { ...node, data: cleanData };
    });

    set({
      isSimulating: false,
      serialOutput: '',
      wifiLog: [],
      nodes: cleanedNodes,
    });

    getSimulationRunner().then(runner => runner.reset());
  },

  toggleSimulation: () => {
    const { isSimulating, stopSimulation } = get();
    if (isSimulating) {
      stopSimulation();
    } else {
      // Note: Full toggle logic usually handled in the UI button that has access to the hex data.
      console.warn('[FORGE STORE] toggleSimulation called, but start requires hex.');
    }
  },

  appendSerial: (data) => set((state) => ({
    serialOutput: state.serialOutput + data
  })),

  clearSerial: () => set({ serialOutput: '' }),

  appendWiFiLog: (msg) => set((state) => ({
    wifiLog: [...state.wifiLog.slice(-199), msg], // keep last 200 lines
  })),

  clearWiFiLog: () => set({ wifiLog: [] }),

  addNode: (type, position, data = {}) => {
    const state = useForgeStore.getState();

    // Smart position adjustment to guarantee components never overlap
    let targetX = position.x;
    let targetY = position.y;

    const hasOverlap = (x: number, y: number) => {
      return state.nodes.some(n => Math.abs(n.position.x - x) < 60 && Math.abs(n.position.y - y) < 60);
    };

    let attempts = 0;
    while (hasOverlap(targetX, targetY) && attempts < 20) {
      targetX += 160;
      targetY += 60;
      attempts++;
    }

    const newNode = {
      id: uuidv4(),
      type: 'leap',
      position: { x: targetX, y: targetY },
      data: { ...data, type, rotation: data.rotation || 0 }
    };
    const newNodes = [...state.nodes, newNode];

    // Auto-switch engine when a board node is placed
    const boardId = BOARD_NODE_TO_BOARD_ID[type];
    if (boardId && boardId !== state.board) {
      console.log(`[FORGE STORE] Board node "${type}" added → switching to "${boardId}"`);
      set({ nodes: newNodes, board: boardId, selectedNodeId: newNode.id });
      if (simulationRunner) simulationRunner.setBoard(boardId);
    } else {
      set({ nodes: newNodes, selectedNodeId: newNode.id });
    }
  },

  removeNode: (id) => {
    const state = useForgeStore.getState();
    const removedNode = state.nodes.find(n => n.id === id);

    // CRITICAL FIX: Prevent deletion of Arduino Uno and ESP32-C3 board nodes
    // These are the primary simulation boards and should persist
    const isBoardNode = removedNode && BOARD_NODE_TO_BOARD_ID[removedNode.data?.type];
    const isProtectedBoard = removedNode?.data?.type === 'arduino-uno' || removedNode?.data?.type === 'esp32-c3';

    if (isBoardNode && isProtectedBoard) {
      console.warn(`[FORGE STORE] ⚠ Cannot remove ${removedNode.data.type} board - it is required for simulation`);
      return; // Block deletion of Arduino Uno and ESP32-C3
    }

    const newNodes = state.nodes.filter(n => n.id !== id);

    // If a board node was removed, detect remaining board or revert to default
    let newBoard = state.board;
    if (isBoardNode) {
      const detected = detectBoardFromNodes(newNodes);
      newBoard = detected ?? 'arduino-uno';
      if (newBoard !== state.board) {
        console.log(`[FORGE STORE] Board node removed → switching to "${newBoard}"`);
        if (simulationRunner) simulationRunner.setBoard(newBoard);
      }
    }

    set({
      nodes: newNodes,
      edges: state.edges.filter(e => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      board: newBoard,
    });
  },

  updateNodePosition: (id, position) => set((state) => ({
    nodes: state.nodes.map(n => n.id === id ? { ...n, position } : n)
  })),

  updateNodeData: (id, data) => set((state) => ({
    nodes: state.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n)
  })),

  rotateNode: (id) => set((state) => ({
    nodes: state.nodes.map(n => {
      if (n.id === id) {
        const currentRotation = n.data?.rotation || 0;
        return { ...n, data: { ...n.data, rotation: (currentRotation + 90) % 360 } };
      }
      return n;
    })
  })),

  addEdge: (connection) => set((state) => {
    const edge = {
      ...connection,
      id: `e-${uuidv4()}`,
      type: 'wire',
      data: { color: '#22c55e' } // Default Green
    };
    return {
      edges: rfAddEdge(edge as any, state.edges)
    };
  }),

  removeEdge: (id) => set((state) => ({
    edges: state.edges.filter(e => e.id !== id),
    selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId
  })),

  updateEdgeData: (id, data) => set((state) => ({
    edges: state.edges.map(e => e.id === id ? { ...e, data: { ...e.data, ...data } } : e)
  })),

  setSelectedNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),

  clearWorkspace: () => {
    const { isSimulating, stopSimulation } = get();
    if (isSimulating) {
      stopSimulation();
    }
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      serialOutput: '',
      wifiLog: []
    });
  },

  setNodes: (nodes) => {
    const state = useForgeStore.getState();
    // Auto-detect board from loaded nodes
    const detected = detectBoardFromNodes(nodes);
    if (detected && detected !== state.board) {
      console.log(`[FORGE STORE] setNodes: detected board "${detected}" → switching engine`);
      set({ nodes, board: detected });
      if (simulationRunner) simulationRunner.setBoard(detected);
    } else {
      set({ nodes });
    }
  },
  setEdges: (edges) => set({ edges }),
  setProjectName: (name) => set({ projectName: name }),
}));
