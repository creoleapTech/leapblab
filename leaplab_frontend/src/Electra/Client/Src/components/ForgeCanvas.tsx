/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  MiniMap,
  Edge,
  Node,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  BackgroundVariant,
  useReactFlow,
  useViewport,
  Panel
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useShallow } from 'zustand/react/shallow';
import { useForgeStore } from '../../utils/store/useForgeStore';
import { LeapNode } from './Nodes/LeapNode';
import { PartPicker } from './Library/PartPicker';
import { SelectionToolbar } from './SelectionToolbar';
import { WireEdge } from './Edges/WireEdge';

import { getComponentPins } from '../lib/PinMap';
import { Plus, Play, Square, RotateCcw, Code, Sun, Moon, ZoomIn, ZoomOut, Maximize, Hand, Copy, Clipboard, Trash2, Undo2, Redo2 } from 'lucide-react';

interface ForgeCanvasProps {
  onToggleSimulation?: () => void;
  isCompiling?: boolean;
  showEditor?: boolean;
  onToggleEditor?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const ForgeCanvasInner: React.FC<ForgeCanvasProps> = ({
  onToggleSimulation,
  isCompiling,
  showEditor = true,
  onToggleEditor,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  const nodeTypes = useMemo(() => ({
    leap: LeapNode,
  }), []);

  const edgeTypes = useMemo(() => ({
    wire: WireEdge,
  }), []);

  const { zoomIn, zoomOut, fitView, getNodes, setViewport, getViewport, screenToFlowPosition } = useReactFlow();
  const currentViewport = useViewport();
  const store = useForgeStore(useShallow(state => ({
    isSimulating: state.isSimulating,
    toggleSimulation: state.toggleSimulation,
    nodes: state.nodes,
    edges: state.edges,
    addNode: state.addNode,
    updateNodePosition: state.updateNodePosition,
    uiTheme: state.uiTheme,
    toggleUiTheme: state.toggleUiTheme,
    viewport: state.viewport,
    setViewportState: state.setViewportState,
    wireDraft: state.wireDraft,
    pendingSource: state.pendingSource,
    addWireWaypoint: state.addWireWaypoint,
    cancelWireDraft: state.cancelWireDraft,
    setPendingSource: state.setPendingSource,
    startWireDraft: state.startWireDraft,
    setSelectedNode: state.setSelectedNode,
    setSelectedEdge: state.setSelectedEdge,
    isDraggingWaypoint: state.isDraggingWaypoint,
    selectedNodeId: state.selectedNodeId,
    selectedEdgeId: state.selectedEdgeId,
    resetSimulation: state.resetSimulation,
    showPartPicker: state.showPartPicker,
    setShowPartPicker: state.setShowPartPicker,
  })));
  const {
    isSimulating,
    toggleSimulation: toggleStoreSimulation,
    nodes: storeNodes,
    edges: storeEdges,
    addNode,
    updateNodePosition,
    uiTheme,
    toggleUiTheme,
    viewport: savedViewport,
    setViewportState,
    wireDraft,
    pendingSource,
    addWireWaypoint,
    cancelWireDraft,
    setPendingSource,
    startWireDraft,
  } = store;

  const {
    setSelectedNode,
    setSelectedEdge,
    isDraggingWaypoint,
    selectedNodeId,
    selectedEdgeId,
    resetSimulation,
    showPartPicker,
    setShowPartPicker,
  } = store;

  // Ref-style bridge to WireDraftOverlay. The overlay registers its setMousePos
  // here on mount; we call it on every throttled mouse move. This keeps the
  // heavy <ReactFlow> / <MiniMap> subtree from re-rendering on each frame.
  const wireOverlayUpdateRef = useRef<((pos: { x: number; y: number } | null) => void) | null>(null);
  const registerWireOverlayUpdate = useCallback((fn: ((pos: { x: number; y: number } | null) => void) | null) => {
    wireOverlayUpdateRef.current = fn;
  }, []);

  const [nodes, setNodes, defaultOnNodesChange] = useNodesState([]);
  const [edges, setEdges, defaultOnEdgesChange] = useEdgesState([]);

  // Wrap node-change handler: sync selection state with store and prevent spurious unselections on simulation updates
  const onNodesChange = useCallback(
    (changes: any[]) => {
      defaultOnNodesChange(changes);
      for (const change of changes) {
        if (change.type === 'select') {
          if (change.selected) {
            setSelectedNode(change.id);
          }
        }
      }
    },
    [setSelectedNode, defaultOnNodesChange]
  );

  // Wrap edge-change handler: block selection changes while dragging a waypoint
  const onEdgesChange = useCallback(
    (changes: any[]) => {
      if (isDraggingWaypoint) {
        changes = changes.filter((c: any) => c.type !== 'select');
      }
      defaultOnEdgesChange(changes);
    },
    [isDraggingWaypoint, defaultOnEdgesChange]
  );

  // Sync store -> local React Flow state (preserving selection state during simulation updates)
  useEffect(() => {
    const selectedId = selectedNodeId;
    const nodesWithSelection = storeNodes.map(node => ({
      ...node,
      selected: node.id === selectedId
    }));
    setNodes(nodesWithSelection);
  }, [storeNodes, selectedNodeId, setNodes]);

  useEffect(() => {
    setEdges(storeEdges);
  }, [storeEdges, setEdges]);

  // ── Canvas panning ───────────────────────────────────────────────────
  // FIX: Previously left-drag panning required `panDragEnabled` (double-click
  // toggle), making hand/pan intermittent when zoomed in – user had to
  // discover the double-click gesture. Now left-drag consistently pans
  // (like Wokwi/Tinkercad) – double-click toggle is kept for backward
  // compat but is no longer required. Middle-drag always pans.
  // Space+drag also pans (Figma-style).
  const [panDragEnabled, setPanDragEnabled] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);

  // Space held → temporary hand/pan (even without panDragEnabled)
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      const tag = el?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space' && !e.repeat && !isSpaceHeld) {
        // Prevent page scroll on Space
        if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
        setIsSpaceHeld(true);
      }
      if (e.key === 'Escape' && panDragEnabled) setPanDragEnabled(false);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpaceHeld(false);
    };
    const onBlur = () => setIsSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [panDragEnabled, isSpaceHeld]);

  // Keep legacy Escape listener for panDragEnabled (now also handled above)
  useEffect(() => {
    if (!panDragEnabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanDragEnabled(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panDragEnabled]);

  // Effective pan config: left+middle always pan on empty pane, except
  // while wiring (wireDraft/pendingSource) where left-drag is reserved
  // for wire creation. This makes zoomed-in panning consistent.
  const effectivePanOnDrag: any = useMemo(() => {
    if (wireDraft || pendingSource) return [1]; // only middle while wiring
    // Always allow left-drag panning – fixes intermittent hand state
    // (panDragEnabled and Space are now additive, not gating)
    return [0, 1];
  }, [wireDraft, pendingSource]);

  // ── Keyboard zoom shortcuts (Wokwi-style) ──────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn({ duration: 200 });
      } else if (ctrl && e.key === '-') {
        e.preventDefault();
        zoomOut({ duration: 200 });
      } else if (ctrl && e.key === '0') {
        e.preventDefault();
        const selected = getNodes().filter((n) => n.selected);
        if (selected.length > 0) {
          fitView({ nodes: selected, duration: 300, padding: 0.3 });
        } else {
          fitView({ duration: 300, padding: 0.2 });
        }
      } else if (ctrl && e.key === '1') {
        e.preventDefault();
        // Zoom to 100%
        const vp = getViewport();
        setViewport({ ...vp, zoom: 1 }, { duration: 200 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut, fitView, setViewport, getViewport, getNodes]);

  // ── Escape cancels wire draft AND any armed pending pin ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (wireDraft || pendingSource)) {
        cancelWireDraft();
        wireOverlayUpdateRef.current?.(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [wireDraft, pendingSource, cancelWireDraft]);

  // ── Tinkercad-style drag-release wire cancellation ──
  // When the user mouse-downs on a pin and releases on empty space (a drag, not a click),
  // the in-progress wire must be cancelled. A quick mousedown+mouseup on empty space
  // (a click) is NOT a drag — it should fall through to onPaneClick and add a waypoint.
  // Also handles the case where a pin is "armed" (pendingSource set) and the user
  // released on empty space without clicking another pin — clears the armed state.
  useEffect(() => {
    if (!wireDraft && !pendingSource) return;
    let downPos: { x: number; y: number } | null = null;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.react-flow__handle') || target?.closest('.leap-pin-dot')) return;
      downPos = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.react-flow__handle') || target?.closest('.leap-pin-dot')) {
        downPos = null;
        return;
      }
      if (downPos) {
        const dx = e.clientX - downPos.x;
        const dy = e.clientY - downPos.y;
        const moved = Math.hypot(dx, dy) > 5;
        downPos = null;
        if (moved) {
          cancelWireDraft();
          wireOverlayUpdateRef.current?.(null);
          return;
        }
        if (pendingSource) {
          setPendingSource(null);
        }
      } else if (pendingSource && !wireDraft) {
        setPendingSource(null);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.react-flow__handle') || target?.closest('.leap-pin-dot')) return;
      if (e.touches.length === 1) {
        downPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.react-flow__handle') || target?.closest('.leap-pin-dot')) {
        downPos = null;
        return;
      }
      if (downPos) {
        const touch = e.changedTouches[0];
        if (touch) {
          const dx = touch.clientX - downPos.x;
          const dy = touch.clientY - downPos.y;
          const moved = Math.hypot(dx, dy) > 5;
          downPos = null;
          if (moved) {
            cancelWireDraft();
            wireOverlayUpdateRef.current?.(null);
            return;
          }
        }
        if (pendingSource) {
          setPendingSource(null);
        }
      } else if (pendingSource && !wireDraft) {
        setPendingSource(null);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [wireDraft, pendingSource, cancelWireDraft, setPendingSource]);

  // ── Track mouse for draft wire end ──
  // Throttled with requestAnimationFrame so we only commit a state update once
  // per frame (~60Hz max). We push the latest cursor position to the
  // WireDraftOverlay via a ref-callback — the parent does NOT keep a
  // `mousePos` state, so the heavy <ReactFlow> / <MiniMap> subtree is not
  // forced to reconcile on every frame. Only the small overlay re-renders.
  const rafRef = useRef<number | null>(null);
  const latestScreenPosRef = useRef<{ x: number; y: number } | null>(null);
  const onContainerMouseMove = useCallback((event: React.MouseEvent | React.PointerEvent) => {
    const state = useForgeStore.getState();
    const activeWireDraft = state.wireDraft;
    const activePendingSource = state.pendingSource;

    if (!activeWireDraft && !activePendingSource) return;

    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;

    const clientX = (event as React.PointerEvent).clientX ?? (event as React.MouseEvent).clientX;
    const clientY = (event as React.PointerEvent).clientY ?? (event as React.MouseEvent).clientY;

    // Promote pendingSource to wireDraft on drag (> 3px)
    if (activePendingSource && !activeWireDraft) {
      const vp = getViewport();
      const startScreenX = activePendingSource.sourcePosition
        ? activePendingSource.sourcePosition.x * vp.zoom + vp.x
        : clientX;
      const startScreenY = activePendingSource.sourcePosition
        ? activePendingSource.sourcePosition.y * vp.zoom + vp.y
        : clientY;

      const dx = clientX - startScreenX;
      const dy = clientY - startScreenY;

      if (Math.hypot(dx, dy) > 3) {
        startWireDraft(activePendingSource.nodeId, activePendingSource.pinName, activePendingSource.sourcePosition);
      }
      return;
    }

    latestScreenPosRef.current = { x: clientX, y: clientY };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pos = latestScreenPosRef.current;
      if (!pos) return;
      const bounds = target.getBoundingClientRect();
      const vp = getViewport();
      wireOverlayUpdateRef.current?.({
        x: (pos.x - bounds.left - vp.x) / vp.zoom,
        y: (pos.y - bounds.top - vp.y) / vp.zoom,
      });
    });
  }, [getViewport, startWireDraft]);

  // Clean up any pending rAF if the component unmounts mid-draft
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // Note: draft wire source pin position and SVG path are computed inside
  // `WireDraftOverlay` (a separate memoized component) so the parent
  // `ForgeCanvasInner` is not forced to re-render on every mouse move.
  // See <WireDraftOverlay wireDraft={wireDraft} ... /> below.

  // ── Blur editor safely on node/edge selection changes to enable canvas hotkeys without event interruption ──
  useEffect(() => {
    if (selectedNodeId || selectedEdgeId) {
      const active = document.activeElement;
      if (active && active instanceof HTMLElement) {
        if (
          active.closest('.monaco-editor') ||
          active.classList.contains('monaco-editor') ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'INPUT'
        ) {
          active.blur();
        }
      }
    }
  }, [selectedNodeId, selectedEdgeId]);

  // ── Restore viewport from saved state on mount ────────────────────
  useEffect(() => {
    if (savedViewport.x !== 0 || savedViewport.y !== 0 || savedViewport.zoom !== 1) {
      setViewport(savedViewport);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist viewport to store on every pan/zoom change ────────────
  useEffect(() => {
    setViewportState(currentViewport);
  }, [currentViewport.x, currentViewport.y, currentViewport.zoom, setViewportState]);

  const onNodeDragStop = useCallback((_: any, node: Node) => {
    updateNodePosition(node.id, node.position);
  }, [updateNodePosition]);

  // ── Edge auto-scroll while dragging a node ──
  // When the user drags a component and the cursor approaches the canvas
  // border (while still INSIDE the canvas), the viewport pans in that
  // direction at a speed proportional to the cursor's distance from the
  // edge. The moment the cursor leaves the canvas bounds, panning stops
  // and the canvas stays static — the user wanted the auto-scroll to be
  // bounded to the canvas area only, not the surrounding panels / toolbar.
  const AUTO_SCROLL_EDGE = 60;     // px from the edge where panning starts
  const AUTO_SCROLL_MAX = 14;      // max viewport delta per drag event
  const onNodeDrag = useCallback((event: React.MouseEvent, _node: Node) => {
    const canvas = document.querySelector('.forge-canvas-container') as HTMLElement | null;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = event.clientX;
    const cy = event.clientY;

    // Only auto-scroll when the cursor is strictly INSIDE the canvas.
    // If the cursor exits (over toolbar, panels, browser chrome, etc.),
    // the canvas stays static.
    if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) {
      return;
    }

    let dx = 0;
    let dy = 0;

    // Horizontal: cursor near left/right edge
    const distLeft = cx - rect.left;
    const distRight = rect.right - cx;
    if (distLeft < AUTO_SCROLL_EDGE) {
      dx = -AUTO_SCROLL_MAX * (1 - distLeft / AUTO_SCROLL_EDGE);
    } else if (distRight < AUTO_SCROLL_EDGE) {
      dx = AUTO_SCROLL_MAX * (1 - distRight / AUTO_SCROLL_EDGE);
    }

    // Vertical: cursor near top/bottom edge
    const distTop = cy - rect.top;
    const distBottom = rect.bottom - cy;
    if (distTop < AUTO_SCROLL_EDGE) {
      dy = -AUTO_SCROLL_MAX * (1 - distTop / AUTO_SCROLL_EDGE);
    } else if (distBottom < AUTO_SCROLL_EDGE) {
      dy = AUTO_SCROLL_MAX * (1 - distBottom / AUTO_SCROLL_EDGE);
    }

    if (dx !== 0 || dy !== 0) {
      const vp = getViewport();
      setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom });
    }
  }, [getViewport, setViewport]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNode(node.id);
  }, [setSelectedNode]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.id);
  }, [setSelectedNode]);

  // ── Double-click on empty canvas toggles pan-drag mode ───────────────
  const onContainerDoubleClick = useCallback((event: React.MouseEvent) => {
    // Ignore double-clicks on nodes, edges, handles, or UI controls
    const target = event.target as HTMLElement;
    if (
      target.closest('.react-flow__node') ||
      target.closest('.react-flow__edge') ||
      target.closest('.react-flow__handle') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('.glass-minimap') ||
      target.closest('.canvas-action-panel')
    ) return;
    setPanDragEnabled(prev => {
      const next = !prev;
      console.log(`[FORGE] Pan-drag mode: ${next ? 'ON' : 'OFF'}`);
      return next;
    });
  }, []);



  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (wireDraft) {
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addWireWaypoint(pos);
    } else {
      setSelectedNode(null);
      setSelectedEdge(null);
    }
  }, [wireDraft, addWireWaypoint, setSelectedNode, setSelectedEdge, screenToFlowPosition]);


  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    // Block edge selection while a waypoint drag is active on another wire
    if (isDraggingWaypoint) return;
    setSelectedEdge(edge.id);
  }, [isDraggingWaypoint, setSelectedEdge]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/forge-component');
      if (!type) return;
      // Convert drop screen coordinates to flow coordinates (zoom/pan aware)
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode(type, position, { label: `${type.toUpperCase()}` });
    },
    [addNode, screenToFlowPosition]
  );

  const handleAddPart = (type: string) => {
    // Place the new part at the center of the currently visible viewport
    const container = document.querySelector('.forge-canvas-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      const center = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      addNode(type, center, { label: `${type.toUpperCase()}` });
    } else {
      // Fallback if container not found
      addNode(type, { x: 400, y: 300 }, { label: `${type.toUpperCase()}` });
    }
  };

  return (
    <div
      className={`forge-canvas-container w-full h-full relative ${uiTheme === 'light'
          ? 'bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.04)_1px,transparent_0)]'
          : 'bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.03)_1px,transparent_0)]'
        } ${isSpaceHeld ? 'is-space-panning' : ''} ${panDragEnabled ? 'is-panning' : ''}`}
      style={{
        background: 'var(--lp-dark-bg)',
        backgroundSize: '24px 24px',
        touchAction: wireDraft || pendingSource ? 'none' : 'auto'
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onMouseMove={onContainerMouseMove}
      onPointerMove={onContainerMouseMove}
      onDoubleClick={onContainerDoubleClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}


        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'wire', updatable: false }}
        nodesConnectable={false}
        nodesDraggable={!isSpaceHeld}
        // Panning: left-drag and middle-drag consistently pan the canvas
        // (especially critical when zoomed in). Double-click toggle and
        // Space+drag are kept as additive hand states, but left-drag no
        // longer gates on panDragEnabled – fixes intermittent hand/pan.
        // While wiring (wireDraft/pendingSource) left-drag is reserved for
        // wire creation, so only middle-drag pans.
        panOnDrag={effectivePanOnDrag as any}
        selectionOnDrag={false}
        panOnScroll={false}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        snapToGrid
        snapGrid={[10, 10]}
        minZoom={0.1}
        maxZoom={4}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        style={{
          background: 'transparent',
          // Always show grab hand when pan is available; grabbing while
          // Space held or legacy panDragEnabled gives consistent feedback
          cursor: wireDraft || pendingSource ? 'crosshair' : isSpaceHeld || (effectivePanOnDrag as number[]).includes(0) ? 'grab' : undefined,
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--lp-border-active)"
        />

        {/* ── Wokwi-style MiniMap with component labels ── */}
        <MiniMap
          className="glass-minimap rounded-[16px] overflow-hidden"
          style={{
            background: 'var(--lp-glass)',
            backdropFilter: 'blur(10px)',
            border: '1px solid var(--lp-border)',
          }}
          nodeColor={(n: any) => {
            const t = n.data?.type;
            if (t === 'boards') return 'var(--lp-accent-primary)';
            if (t?.includes('oled') || t?.includes('ssd1306')) return '#f59e0b';
            if (t?.includes('led')) return '#ef4444';
            if (t?.includes('sensor') || t?.includes('dht') || t?.includes('pir')) return '#10b981';
            if (t?.includes('motor') || t?.includes('servo') || t?.includes('stepper')) return '#8b5cf6';
            if (t?.includes('button') || t?.includes('keypad')) return '#6366f1';
            if (t?.includes('tft') || t?.includes('ili9341')) return '#06b6d4';
            return '#cbd5e1';
          }}
          nodeStrokeWidth={2}
          nodeBorderRadius={4}
          maskColor="rgba(0, 0, 0, 0.6)"
          pannable
          zoomable
          inversePan={true}
        />

        {/* ── Zoom percentage display (Wokwi-style) ── */}
        <Panel position="bottom-right" className="mb-[8px] mr-[8px]">
          <div className="zoom-display">
            {Math.round(currentViewport.zoom * 100)}%
          </div>
        </Panel>

        {/* ── Pan-drag mode indicator ── */}
        {panDragEnabled && (
          <Panel position="bottom-center" className="mb-[16px]">
            <div className="flex items-center gap-[10px] bg-white p-[10px_18px] rounded-[14px] border-2 border-slate-200 shadow-lg"
              style={{ animation: 'fadeIn 0.2s ease-out' }}>
              <div className="flex items-center justify-center w-[28px] h-[28px] bg-blue-50 rounded-[8px] border border-blue-200">
                <Hand size={14} className="text-blue-500" />
              </div>
              <span className="text-[13px] font-semibold text-slate-600">
                Drag to move canvas
              </span>
              <span className="text-[11px] font-medium text-slate-400 bg-slate-100 px-[8px] py-[3px] rounded-[6px]">
                Esc to exit
              </span>
            </div>
          </Panel>
        )}
      </ReactFlow>



      {/* Draft wire overlay (click-to-route) — isolated in its own memoized
          component so the heavy parent (<ReactFlow> + <MiniMap> + toolbar)
          does not re-render on every mouse move during a wire draft. */}
      {wireDraft && (
        <WireDraftOverlay
          wireDraft={wireDraft}
          onRequestUpdate={registerWireOverlayUpdate}
        />
      )}

      <style>{`
        /* ── Premium custom hand cursor – uses provided pointing-hand asset ──
           File: /cursors/electra-hand.svg (32×32, white #f0f8ff + left blue shadow #b8d4e8 + 3 palm lines)
           Hotspot at fingertip (16,1) for precise pointing; premium dual-shadow for visibility on dark/light */
        .forge-canvas-container, .forge-canvas-container .react-flow__pane, .forge-canvas-container .react-flow__viewport {
          cursor: url("/cursors/electra-hand.svg") 14 2, grab !important;
        }
        .forge-canvas-container:active, .forge-canvas-container .react-flow__pane:active, .forge-canvas-container .react-flow__viewport:active,
        .forge-canvas-container.is-panning, .forge-canvas-container.is-space-panning {
          cursor: url("/cursors/electra-hand.svg") 14 2, grabbing !important;
          filter: brightness(0.96) saturate(1.05);
        }
        /* Premium hover – subtle saturation lift */
        .forge-canvas-container:hover {
          filter: saturate(1.03);
        }
        /* Fallback for browsers that block external SVG cursors (e.g. Firefox size limit) */
        @supports not (cursor: url("/cursors/electra-hand.svg") 14 2, grab) {
          .forge-canvas-container, .forge-canvas-container .react-flow__pane {
            cursor: grab !important;
          }
          .forge-canvas-container:active, .forge-canvas-container .react-flow__pane:active {
            cursor: grabbing !important;
          }
        }
        .react-flow__edges { z-index: 1000 !important; }
        .react-flow__connectionline { z-index: 1001 !important; pointer-events: none; }
        .react-flow__edge { pointer-events: all; }
        .react-flow__nodes { z-index: 50 !important; }
        .react-flow__handle { z-index: 10 !important; }
        .react-flow__attribution { display: none !important; }
        
        /* Modern Zoom Controls Styling */
        .zoom-display {
          background: var(--lp-glass);
          backdrop-filter: blur(10px);
          border: 1px solid var(--lp-border);
          border-radius: 8px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
          color: var(--lp-text);
          font-family: 'JetBrains Mono', 'SF Mono', monospace;
          user-select: none;
          min-width: 48px;
          text-align: center;
          box-shadow: var(--lp-shadow);
        }
        .theme-light .zoom-display {
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.7);
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
        }
        .glass-minimap {
          border-radius: 6px !important;
          color: var(--lp-zinc-400) !important;
          transition: all 0.2s !important;
          margin: 1px !important;
        }

        /* Modern MiniMap Styling */
        .glass-minimap {
          border: 1px solid var(--lp-border) !important;
          border-radius: 12px !important;
          background: var(--lp-glass) !important;
          box-shadow: var(--lp-shadow) !important;
          overflow: hidden !important;
        }
        .theme-light .glass-minimap {
          border: 1px solid rgba(15, 23, 42, 0.08) !important;
          background: rgba(255, 255, 255, 0.7) !important;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04) !important;
        }

        /* Floating Action Panel */
        .canvas-action-panel {
          position: absolute;
          top: 16px;
          right: 16px;
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: var(--lp-glass);
          border: 1px solid var(--lp-border);
          border-radius: 24px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.15);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          z-index: 100;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .theme-light .canvas-action-panel {
          background: #ffffff !important;
          border: 1px solid rgba(15, 23, 42, 0.08) !important;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 4px rgba(15, 23, 42, 0.04) !important;
        }

        /* Divider */
        .canvas-divider {
          width: 1px;
          height: 18px;
          background: rgba(255, 255, 255, 0.12);
          margin: 0 4px;
        }
        .theme-light .canvas-divider {
          background: rgba(15, 23, 42, 0.08);
        }

        /* Floating Panel Buttons */
        .canvas-btn {
          height: 38px;
          border-radius: 19px;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          font-family: inherit;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* Simulation Buttons */
        .sim-btn {
          padding: 0 16px;
          background: var(--lp-emerald);
          color: #ffffff;
          gap: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .sim-btn:hover {
          background: #059669;
          transform: translateY(-1.5px);
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3), 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .sim-btn.simulating {
          background: var(--lp-rose);
        }
        .sim-btn.simulating:hover {
          background: #e11d48;
          box-shadow: 0 6px 16px rgba(244, 63, 94, 0.3), 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        /* Secondary Round Buttons */
        .canvas-btn.secondary {
          width: 38px;
          background: var(--lp-zinc-800);
          border: 1px solid var(--lp-border);
          color: var(--lp-zinc-400);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
        }
        .canvas-btn.secondary:hover {
          color: var(--lp-accent-bright);
          border-color: rgba(96, 165, 250, 0.3);
          background: var(--lp-zinc-700);
          transform: translateY(-1.5px);
          box-shadow: 0 6px 14px rgba(0, 0, 0, 0.25);
        }
        .canvas-btn.secondary.active {
          background: var(--lp-accent-primary);
          border-color: transparent;
          color: #ffffff;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.25);
        }
        .canvas-btn.secondary.active:hover {
          background: var(--lp-accent-bright);
          transform: translateY(-1.5px);
          box-shadow: 0 6px 14px rgba(59, 130, 246, 0.35);
        }

        /* Primary Add Button */
        .canvas-btn.primary-add {
          width: 38px;
          background: var(--lp-accent-primary);
          color: #ffffff;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.2);
        }
        .canvas-btn.primary-add:hover {
          background: var(--lp-accent-bright);
          transform: translateY(-1.5px);
          box-shadow: 0 6px 14px rgba(59, 130, 246, 0.3);
        }
        .canvas-btn.primary-add.active {
          background: var(--lp-accent-bright);
        }


        /* Compiling Spinner */
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        /* Zoom label in toolbar (Wokwi-style) */
        .canvas-zoom-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--lp-text-secondary, #94a3b8);
          font-family: 'JetBrains Mono', 'SF Mono', monospace;
          user-select: none;
          min-width: 40px;
          text-align: center;
          padding: 0 4px;
          cursor: default;
        }
        .canvas-zoom-label:hover {
          color: var(--lp-text, #e2e8f0);
        }

        @media (max-width: 768px) {
          .glass-minimap {
            display: none !important;
          }
          .canvas-action-panel {
            top: 8px;
            right: 8px;
            left: auto;
            padding: 4px 8px;
            gap: 4px;
            border-radius: 16px;
            flex-wrap: nowrap;
          }
          .canvas-btn {
            height: 32px;
            border-radius: 16px;
            font-size: 10px;
          }
          .canvas-btn.secondary {
            width: 32px;
          }
          .sim-btn {
            padding: 0 10px;
            font-size: 10px;
          }
          .canvas-btn.primary-add {
            width: 32px;
          }
          .canvas-zoom-label {
            font-size: 10px;
            min-width: 32px;
          }
          .canvas-divider {
            display: none;
          }
          .toolbar-hide-mobile {
            display: none !important;
          }
        }
        @media (max-width: 480px) {
          .canvas-action-panel {
            top: 8px;
            right: 8px;
            left: auto;
            padding: 4px 6px;
            gap: 4px;
          }
          .canvas-btn {
            height: 34px;
            border-radius: 17px;
          }
          .canvas-btn.secondary {
            width: 34px;
          }
          .canvas-btn.primary-add {
            width: 34px;
          }
          .sim-btn {
            padding: 0 10px;
            font-size: 10px;
          }
          .toolbar-hide-small {
            display: none !important;
          }
        }
      `}</style>

      {/* ── SELECTION TOOLBAR ─────────────────────────── */}
      <SelectionToolbar />

      {/* ── FLOATING ACTION PANEL (Tinkercad Style Toolbar) ────────────────── */}
      <div className="canvas-action-panel">
        {/* Play/Stop Labeled Simulation Button */}
        <button
          onClick={onToggleSimulation || toggleStoreSimulation}
          disabled={isCompiling}
          className={`canvas-btn sim-btn ${isSimulating ? 'simulating' : ''}`}
        >
          {isCompiling ? (
            <div className="spinner" />
          ) : isSimulating ? (
            <>
              <Square size={14} fill="currentColor" />
              <span>Stop Simulation</span>
            </>
          ) : (
            <>
              <Play size={14} fill="currentColor" />
              <span>Start Simulation</span>
            </>
          )}
        </button>

        {/* Reset Button */}
        <button
          onClick={resetSimulation}
          className="canvas-btn secondary"
          title="Reset Simulation"
        >
          <RotateCcw size={16} />
        </button>

        {/* ── Undo / Redo – Circuit Editor History ── */}
        <div className="canvas-divider toolbar-hide-mobile" />
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`canvas-btn secondary toolbar-hide-mobile ${!canUndo ? 'opacity-40 cursor-not-allowed' : ''}`}
          title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
          aria-label="Undo"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`canvas-btn secondary toolbar-hide-mobile ${!canRedo ? 'opacity-40 cursor-not-allowed' : ''}`}
          title={canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo'}
          aria-label="Redo"
        >
          <Redo2 size={16} />
        </button>

        {/* Zoom In Button */}
        <button
          onClick={() => zoomIn({ duration: 200 })}
          className="canvas-btn secondary toolbar-hide-mobile"
          title="Zoom In (Ctrl+=)"
        >
          <ZoomIn size={16} />
        </button>

        {/* Zoom Percentage Display */}
        <div className="canvas-zoom-label toolbar-hide-mobile" title="Current zoom level">
          {Math.round(currentViewport.zoom * 100)}%
        </div>

        {/* Zoom Out Button */}
        <button
          onClick={() => zoomOut({ duration: 200 })}
          className="canvas-btn secondary toolbar-hide-mobile"
          title="Zoom Out (Ctrl+-)"
        >
          <ZoomOut size={16} />
        </button>

        {/* Fit View Button */}
        <button
          onClick={() => fitView({ duration: 400, padding: 0.2 })}
          className="canvas-btn secondary toolbar-hide-small"
          title="Fit View (Ctrl+0)"
        >
          <Maximize size={16} />
        </button>

        <div className="canvas-divider" />

        {/* Code Panel Toggle Button */}
        {onToggleEditor && (
          <button
            onClick={onToggleEditor}
            className={`canvas-btn secondary toolbar-hide-mobile ${showEditor ? 'active' : ''}`}
            title="Toggle Code Panel"
          >
            <Code size={16} />
          </button>
        )}

        {/* Theme Toggle Button */}
        <button
          onClick={toggleUiTheme}
          className="canvas-btn secondary toolbar-hide-small"
          title={uiTheme === 'light' ? "Switch to Dark Mode" : "Switch to Light Mode"}
        >
          {uiTheme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        {/* Add Component (Part Picker) Button */}
        <button
          onClick={() => {
            if (!showPartPicker && window.innerWidth <= 1024 && showEditor && onToggleEditor) {
              onToggleEditor();
            }
            setShowPartPicker(!showPartPicker);
          }}
          className={`canvas-btn primary-add ${showPartPicker ? 'active' : ''}`}
          title="Toggle Components Panel"
        >
          <Plus size={20} />
        </button>

      </div>

      {/* ComponentSidebar is now docked in ForgeElectra */}
    </div>
  );
};


const ForgeCanvas: React.FC<ForgeCanvasProps> = (props) => (
  <ReactFlowProvider>
    <ForgeCanvasInner {...props} />
  </ReactFlowProvider>
);

// ── WireDraftOverlay ──────────────────────────────────────────────────────
// Self-contained SVG overlay that renders the in-progress wire. It manages
// its own mousePos state so the heavy parent (ForgeCanvas) does NOT re-render
// on every mouse move — only the overlay does. The parent pushes cursor
// updates through a ref-style callback (`pushMousePos`), which is also
// rAF-throttled inside the parent to cap work at ~60Hz.
interface WireDraftOverlayProps {
  wireDraft: any;
  onRequestUpdate: (fn: ((pos: { x: number; y: number } | null) => void) | null) => void;
}
const WireDraftOverlayImpl: React.FC<WireDraftOverlayProps> = ({ wireDraft, onRequestUpdate }) => {
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const { getViewport } = useReactFlow();

  // Expose our setMousePos to the parent via a stable callback registration.
  // The parent calls it on every throttled mouse move. This avoids the parent
  // re-rendering on every mousemove.
  useEffect(() => {
    onRequestUpdate(setMousePos);
    return () => onRequestUpdate(null);
  }, [onRequestUpdate]);

  // Compute the source pin position once per draft change. waypoints are
  // stable per draft; mousePos is the only thing that changes per frame.
  const srcPinPos = useMemo(() => {
    if (!wireDraft) return null;
    if (wireDraft.sourcePosition) return wireDraft.sourcePosition;
    return null;
  }, [wireDraft]);

  // Build the SVG path. The screen-coordinate math uses the live viewport
  // (read once via getViewport()) so we don't allocate a new object on every
  // frame. Straight line construction is O(n) where n = waypoints + 2.
  const draftWirePath = useMemo(() => {
    if (!wireDraft || !mousePos || !srcPinPos) return '';
    const vp = getViewport();
    const allPoints = [srcPinPos, ...wireDraft.waypoints, mousePos];
    const screenPoints = allPoints.map(p => ({
      x: p.x * vp.zoom + vp.x,
      y: p.y * vp.zoom + vp.y,
    }));
    // Straight line between each consecutive point (no 90° L-bends)
    return screenPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }, [wireDraft, mousePos, srcPinPos, getViewport]);

  // Cached viewport for waypoint dot rendering (avoid calling getViewport
  // inside the map callback, which would re-execute on every frame).
  const waypointDots = useMemo(() => {
    if (!wireDraft) return null;
    const vp = getViewport();
    return wireDraft.waypoints.map((pt: { x: number; y: number }, i: number) => {
      const sx = pt.x * vp.zoom + vp.x;
      const sy = pt.y * vp.zoom + vp.y;
      return { key: i, sx, sy };
    });
  }, [wireDraft, mousePos, getViewport]);

  if (!wireDraft || !draftWirePath) return null;

  return (
    <svg
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-[1001]"
    >
      <path
        d={draftWirePath}
        stroke="#22c55e"
        strokeWidth={5}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="drop-shadow-[0_0_3px_rgba(34,197,94,0.5)]"
      />
      {waypointDots?.map((dot: { key: number; sx: number; sy: number }) => (
        <circle key={dot.key} cx={dot.sx} cy={dot.sy} r={3} fill="#22c55e" stroke="#09090b" strokeWidth={1} />
      ))}
    </svg>
  );
};
const WireDraftOverlay = React.memo(WireDraftOverlayImpl);

export default ForgeCanvas;
