import React, { useState, useEffect, useRef } from 'react';

if (typeof window !== 'undefined' && typeof window.define === 'function' && window.define.amd) {
  window.define = undefined;
}
import { useAppState } from './hooks/useAppState';
import { useProjectActions } from './hooks/useProjectActions';
import { useBuildApk } from './hooks/useBuildApk';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import AppInventorLayout from './components/AppInventorLayout';
import { useCloudProjectStore } from '../store/cloudProjectStore';

export default function AppInventor({ onBack, onRedirectToElectra, redirectProjectData, clearRedirectProjectData }) {
  const appState = useAppState();
  const [activeTab, setActiveTab] = useState('designer');
  const [projectPath, setProjectPath] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (redirectProjectData && clearRedirectProjectData) {
      appState.loadProject(redirectProjectData.data).catch((err) => {
        console.error('[AppInventor] Failed to load redirect project:', err);
      });
      if (redirectProjectData.projectPath) {
        setProjectPath(redirectProjectData.projectPath);
        const pathParts = redirectProjectData.projectPath.split(/[\\/]/);
        const folderName = pathParts[pathParts.length - 1];
        if (folderName) appState.setAppName(folderName.replace(/\.(leap|lbp)$/i, ''));
      } else if (redirectProjectData.projectName) {
        appState.setAppName(redirectProjectData.projectName);
        setProjectPath(null);
      }
      clearRedirectProjectData();
    }
  }, [redirectProjectData, appState, clearRedirectProjectData]);

  const pendingProject = useCloudProjectStore(s => s.pendingProject);
  const clearPendingProject = useCloudProjectStore(s => s.clearPendingProject);

  useEffect(() => {
    if (!pendingProject || pendingProject.mode !== 'creova') return;

    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        await appState.loadProject(pendingProject.data);
        if (pendingProject.projectName) {
          appState.setAppName(pendingProject.projectName);
        }
        setProjectPath(null);
        clearPendingProject();
      } catch (err) {
        console.error('[AppInventor] Failed to load project from cloud:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [pendingProject, appState, clearPendingProject]);

  const [isBuildModalOpen, setIsBuildModalOpen] = useState(false);
  const [buildState, setBuildState] = useState('idle');
  const [buildLogs, setBuildLogs] = useState([]);
  const [apkPath, setApkPath] = useState(null);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onBuildLog) {
      window.electronAPI.onBuildLog((msg) => {
        setBuildLogs((prev) => [...prev, msg]);
      });
      return () => {
        if (window.electronAPI.removeBuildLogListener) {
          window.electronAPI.removeBuildLogListener();
        }
      };
    }
  }, []);

  const {
    handleNewProject,
    handleOpenProject,
    handleWebImport,
    handleSaveProject,
    handleDownloadProject,
    handleSaveAsProject,
    handleUndo,
    handleRedo,
  } = useProjectActions(appState, { projectPath, setProjectPath, fileInputRef, onRedirectToElectra });

  const { handleBuildApk, handleOpenFile } = useBuildApk(appState, {
    isBuildModalOpen, setIsBuildModalOpen,
    buildState, setBuildState,
    buildLogs, setBuildLogs,
    apkPath, setApkPath,
    onTranspileFailMessage: true,
  });

  useKeyboardShortcuts({
    onSave: handleSaveProject,
    onSaveAs: handleSaveAsProject,
    onNew: handleNewProject,
    onOpen: handleOpenProject,
    onUndo: handleUndo,
    onRedo: handleRedo,
  }, [projectPath, appState, activeTab]);

  return (
    <AppInventorLayout
      appState={appState}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      fileInputRef={fileInputRef}
      handleWebImport={handleWebImport}
      handleNewProject={handleNewProject}
      handleOpenProject={handleOpenProject}
      handleSaveProject={handleSaveProject}
      handleSaveAsProject={handleSaveAsProject}
      handleDownloadProject={handleDownloadProject}
      handleBuildApk={handleBuildApk}
      handleOpenFile={handleOpenFile}
      handleUndo={handleUndo}
      handleRedo={handleRedo}
      isBuildModalOpen={isBuildModalOpen}
      setIsBuildModalOpen={setIsBuildModalOpen}
      buildState={buildState}
      buildLogs={buildLogs}
      apkPath={apkPath}
      onBack={onBack}
    />
  );
}
