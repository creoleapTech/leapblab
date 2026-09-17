/**
 * Vision3D - Main Application Component
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 */

import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Canvas3D } from './components/Canvas3D';
import { ShapePanel } from './components/ShapePanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Topbar } from './components/Topbar';
import { SceneList } from './components/SceneList';
import PreviewModal from './components/PreviewModal';
import ShapeNet from './components/ShapeNet';
import { use3DStore } from './store/use3DStore';
import { useCloudProjectStore } from '../store/cloudProjectStore';
import { importSTL, importOBJ, importGLTF, isImportableFile } from './engine/ImportManager';
import { saveVision3DProject } from './utils/cloudSave';
import { importProjectFromJSON } from './utils/indexedDB';
import { log, debug, error } from './utils/logger';
import { serializeGeometry } from './utils/geometry';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ToolbarSection } from './components/ToolbarSection';
import { useLeapLabAuthStore } from '../auth/leaplabAuthStore';
import { showToast } from '../leapignite/client/components/Toast';

const Vision3DApp = ({ onBack }) => {
  const [projectName, setProjectName] = useState('My Project');
  const loadedRef = useRef(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [cloudProjectId, setCloudProjectId] = useState(null);

  const {
    activeTool,
    setTool,
    undo,
    redo,
    duplicateShapes,
    removeShapes,
    addShape,
    selectedIds,
    groupShapes,
    ungroupShape,
    deselectAll,
    shapes,
    autoSaveProject,
    historyIndex,
    history,
    mirrorShapes,
    dropToWorkplane,
    moveShapesByArrow,
    hideShapes,
    showAllHidden,
    toggleLock,
    gridSnap,
    setGridSnap,
    rotationSnap,
    setRotationSnap,
    showGrid,
    setShowGrid,
    showAxes,
    setShowAxes,
    showInspector,
    updateShape,
    updateShapes,
    csgOperation,
    smartDuplicate,
    toggleCameraMode,
    cameraMode,
    setFitSelection,
    setFitAll,
    setTempWorkplane,
    clearTempWorkplane,
    tempWorkplane,
    alignShapes,
    toggleRuler,
    rulerActive,
    distributeShapes,
    importShape,
    clearScene,
    editMode,
    setEditMode,
    editShapeId,
    editTool,
    setEditTool,
    selectedVertices,
    selectedEdges,
    selectedFaces,
    clearComponentSelection,
  } = use3DStore();

  useEffect(() => { log('Vision3DApp: mounted'); }, []);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const fileInputRef = useRef(null);
  const openProjectInputRef = useRef(null);

  const handleImport = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !isImportableFile(file.name)) return;

    log('Importing file:', file.name);
    let result = null;
    if (/\.stl$/i.test(file.name)) {
      result = await importSTL(file);
    } else if (/\.obj$/i.test(file.name)) {
      result = await importOBJ(file);
    } else if (/\.(gltf|glb)$/i.test(file.name)) {
      result = await importGLTF(file);
    }

    if (result) {
      importShape({
        type: result.type || 'stl',
        name: result.name,
        color: result.color,
        position: [0, 1, 0],
        _customGeometry: result.geometry,
      });
    }
    e.target.value = '';
  }, [importShape]);

  const handleOpenProject = useCallback(() => {
    openProjectInputRef.current?.click();
  }, []);

  const handleOpenProjectFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !/\.(json|leap)$/i.test(file.name)) return;

    log('Opening project file:', file.name);
    try {
      const text = await file.text();
      const data = importProjectFromJSON(text);
      if (data.shapes) {
        clearScene();
        data.shapes.forEach((shape) => importShape(shape));
      }
      const name = data.projectName || data.project?.name;
      if (name) {
        setProjectName(name);
      }
      log('Project opened:', file.name);
    } catch (err) {
      error('Failed to open project:', err);
    }
    e.target.value = '';
  }, [clearScene, importShape, setProjectName]);

  useKeyboardShortcuts({ onOpenProject: handleOpenProject });

  const handleSave = async () => {
    const authState = useLeapLabAuthStore.getState();
    if (!authState.isAuthenticated || !authState.token) {
      showToast('Please sign in to save projects. Use Download to save locally.', 'info');
      return;
    }
    if (authState.role === 'trainer') {
      showToast('Trainers cannot save to cloud. Use Download to save locally.', 'info');
      return;
    }
    log('Vision3DApp: save triggered');
    autoSaveProject();
    try {
      const result = await saveVision3DProject(projectName, shapes, use3DStore.getState().project, cloudProjectId);
      if (result?.id && !cloudProjectId) {
        setCloudProjectId(result.id);
        useCloudProjectStore.getState().setActiveProjectId(result.id);
      }
      showToast('Project saved successfully!', 'success');
    } catch (err) {
      log('Cloud save failed (offline mode):', err);
      showToast(err?.message || 'Failed to save project.', 'error');
    }
  };

  const handleSaveAs = async () => {
    const authState = useLeapLabAuthStore.getState();
    if (!authState.isAuthenticated || !authState.token) {
      showToast('Please sign in to save projects. Use Download to save locally.', 'info');
      return;
    }
    if (authState.role === 'trainer') {
      showToast('Trainers cannot save to cloud. Use Download to save locally.', 'info');
      return;
    }
    log('Vision3DApp: save as triggered');
    autoSaveProject();
    try {
      const result = await saveVision3DProject(projectName, shapes, use3DStore.getState().project, cloudProjectId);
      if (result?.id && !cloudProjectId) {
        setCloudProjectId(result.id);
        useCloudProjectStore.getState().setActiveProjectId(result.id);
      }
      showToast('Project saved successfully!', 'success');
    } catch (err) {
      log('Cloud save failed (offline mode):', err);
      showToast(err?.message || 'Failed to save project.', 'error');
    }
  };

  const handleDownload = useCallback(() => {
    log('Vision3DApp: download triggered');
    const project = use3DStore.getState().project || {
      id: `project_${Date.now()}`,
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const payload = {
      version: "1.0",
      projectName,
      mode: "vision3d",
      timestamp: Date.now(),
      project,
      shapes
    };
    const replacer = (key, val) => {
      if ((key === '_customGeometry' || key === '_csgGeometry') && val && val.attributes) {
        return serializeGeometry(val);
      }
      return val;
    };
    const blob = new Blob([JSON.stringify(payload, replacer, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanName = (projectName || '').trim() || 'project';
    link.download = `${cleanName.replace(/\s+/g, '_')}.leap`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [projectName, shapes]);

  useEffect(() => {
    if (loadedRef.current) return;
    const { pendingProject, clearPendingProject } = useCloudProjectStore.getState();
    if (pendingProject && pendingProject.mode === 'vision3d') {
      loadedRef.current = true;
      const data = pendingProject.data;
      log('Vision3DApp: loading cloud project', pendingProject.projectName);
      if (data.projectName) setProjectName(data.projectName);
      if (data.shapes) use3DStore.getState().setShapes(data.shapes);
      if (data.project) use3DStore.getState().setProject(data.project);
      const activeId = useCloudProjectStore.getState().activeProjectId;
      if (activeId) setCloudProjectId(activeId);
      clearPendingProject();
    }
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 font-['Inter','Segoe_UI',system-ui,-apple-system,sans-serif]">
      <Topbar
        onBack={onBack}
        title={projectName}
        onTitleChange={setProjectName}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onOpenProject={handleOpenProject}
        onDownload={handleDownload}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <ToolbarSection
            fileInputRef={fileInputRef}
            openProjectInputRef={openProjectInputRef}
            handleImport={handleImport}
            handleOpenProjectFile={handleOpenProjectFile}
            setNetOpen={setNetOpen}
            setPreviewOpen={setPreviewOpen}
          />

          <div className="flex-1 relative overflow-hidden min-w-0 min-h-0 w-full">
            <Canvas3D />
          </div>
        </div>

        {/* Right side: Shapes Panel + Scene List */}
        <div className={`w-[320px] flex flex-col bg-white border-l border-slate-200 relative overflow-hidden shrink-0 max-lg:w-[280px] max-md:w-[260px]`}>
          {/* Inspector overlay (appears on selection) */}
          <div className={`absolute inset-0 bg-white z-10 transition-[transform_0.2s_ease-out,opacity_0.15s_ease-out] ${showInspector && selectedIds.length > 0 ? 'translate-x-0 opacity-100 pointer-events-auto' : 'translate-x-full opacity-0 pointer-events-none'}`}>
            <PropertiesPanel />
          </div>

          {/* Shapes Panel (always present underneath) */}
          <div className={`flex-1 overflow-hidden transition-[opacity_0.2s_ease] ${showInspector && selectedIds.length > 0 ? 'opacity-0 pointer-events-none absolute inset-0' : ''}`}>
            <ShapePanel />
          </div>

          {/* Scene List (bottom of right panel) */}
          <div className="h-[200px] min-h-[120px] border-t border-slate-200 overflow-y-auto shrink-0">
            <SceneList />
          </div>
        </div>
      </div>
      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} />
      {netOpen && selectedIds.length === 1 && (() => {
        const selectedShape = shapes.find((s) => s.id === selectedIds[0]);
        if (!selectedShape) return null;
        return (
          <ShapeNet
            shape={selectedShape}
            onClose={() => { setNetOpen(false); }}
          />
        );
      })()}
    </div>
  );
};
export default Vision3DApp;
