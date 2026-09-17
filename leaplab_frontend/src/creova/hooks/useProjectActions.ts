import React, { useCallback } from 'react';
import { fileService } from '../../Electra/Client/Src/services/FileService';
import { showToast } from '../../leapignite/client/components/Toast';
import { useLeapLabAuthStore } from '../../auth/leaplabAuthStore';

export interface UseProjectActionsOptions {
  projectPath?: string | null;
  setProjectPath: (path: string | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onRedirectToElectra?: (projectData: any, nameWithoutExt: string | null, projectPath: string | null) => void;
}

export function useProjectActions(
  appState: any,
  { setProjectPath, fileInputRef, onRedirectToElectra }: UseProjectActionsOptions
) {
  const handleNewProject = useCallback(async (): Promise<void> => {
    return new Promise((resolve) => {
      if (confirm('Create a new project? Unsaved changes will be lost.')) {
        appState.newProject();
        setProjectPath(null);
        if (typeof window !== 'undefined') {
          (window as any).__LEAP_BLOCK_XML__ = '';
        }
      }
      resolve();
    });
  }, [appState, setProjectPath]);

  const handleOpenProject = useCallback(async (): Promise<void> => {
    const win = window as any;
    if (!win.electronAPI || !win.electronAPI.openProject) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const result = await win.electronAPI.openProject();
      if (result && result.data) {
        if (onRedirectToElectra && (result.data.nodes || result.data.edges || result.data.circuit)) {
          onRedirectToElectra(result.data, null, result.projectPath);
          return;
        }
        await appState.loadProject(result.data);
        setProjectPath(result.projectPath);
        const pathParts = result.projectPath.split(/[\\/]/);
        const folderName = pathParts[pathParts.length - 1];
        if (folderName) {
          appState.setAppName(folderName.replace(/\.(leap|lbp)$/i, ''));
        }
      } else if (result && result.error) {
        alert(`Failed to open project: ${result.error}`);
      }
    } catch (err: any) {
      console.error('Failed to open project:', err);
      alert(`Failed to open project: ${err?.message || err}`);
    }
  }, [appState, setProjectPath, fileInputRef, onRedirectToElectra]);

  const handleWebImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const projectData = JSON.parse(content);
          const nameWithoutExt = file.name.replace(/\.(leap|lbp|json)$/i, '');
          if (onRedirectToElectra && (projectData.nodes || projectData.edges || projectData.circuit)) {
            onRedirectToElectra(projectData, nameWithoutExt, null);
            resolve();
            return;
          }
          await appState.loadProject(projectData);
          appState.setAppName(nameWithoutExt);
          setProjectPath(null);
          alert('Project imported successfully!');
          resolve();
        } catch (err: any) {
          console.error('Failed to parse project file:', err);
          alert('Failed to parse project file: ' + (err?.message || err));
          reject(err);
        }
      };
      reader.onerror = (err) => {
        console.error('Failed to read file:', err);
        reject(err);
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }, [appState, setProjectPath, onRedirectToElectra]);

  const handleSaveProject = useCallback(async (): Promise<void> => {
    const authState = useLeapLabAuthStore.getState();
    if (!authState.isAuthenticated || !authState.token) {
      showToast('Please sign in to save projects. Use Download to save locally.', 'info');
      return;
    }
    if (authState.role === 'trainer') {
      showToast('Trainers cannot save to cloud. Use Download to save locally.', 'info');
      return;
    }
    try {
      const payload = appState.getSerializedState();
      const liveBlockXml = typeof window !== 'undefined' ? (window as any).__LEAP_BLOCK_XML__ : null;
      if (typeof liveBlockXml === 'string' && liveBlockXml.trim()) {
        payload.blockLogic = liveBlockXml;
      }
      await fileService.saveProject(appState.appName || 'project', 'creova', payload);
      showToast('Project saved successfully!', 'success');
    } catch (err: any) {
      console.error('Failed to save project:', err);
      alert(`Failed to save project: ${err?.message || err}`);
    }
  }, [appState]);

  const handleDownloadProject = useCallback(async (): Promise<void> => {
    const payload = appState.getSerializedState();
    const liveBlockXml = typeof window !== 'undefined' ? (window as any).__LEAP_BLOCK_XML__ : null;
    if (typeof liveBlockXml === 'string' && liveBlockXml.trim()) {
      payload.blockLogic = liveBlockXml;
    }
    await fileService.saveProjectLocally(appState.appName || 'project', 'creova', payload);
  }, [appState]);

  const handleSaveAsProject = useCallback(async (): Promise<void> => {
    const authState = useLeapLabAuthStore.getState();
    if (!authState.isAuthenticated || !authState.token) {
      showToast('Please sign in to save projects. Use Download to save locally.', 'info');
      return;
    }
    if (authState.role === 'trainer') {
      showToast('Trainers cannot save to cloud. Use Download to save locally.', 'info');
      return;
    }
    const payload = appState.getSerializedState();
    const liveBlockXml = typeof window !== 'undefined' ? (window as any).__LEAP_BLOCK_XML__ : null;
    if (typeof liveBlockXml === 'string' && liveBlockXml.trim()) {
      payload.blockLogic = liveBlockXml;
    }
    const currentName = appState.appName || 'project';
    const win = window as any;
    if (win.electronAPI?.saveProject) {
      try {
        const result = await win.electronAPI.saveProject(payload);
        if (result?.success && result.projectPath) {
          setProjectPath(result.projectPath);
          const parts = result.projectPath.split(/[\\/]/);
          const name = parts[parts.length - 1]?.replace(/\.(leap|lbp)$/i, '');
          if (name) appState.setAppName(name);
        }
        return;
      } catch (e) { console.warn('[Creova] electron saveAs failed, fallback', e); }
    }
    try {
      const res = await fileService.saveProjectAsLocally(currentName, 'creova', payload);
      if (res.saved && res.newName) appState.setAppName(res.newName);
      if (res.saved) showToast('Project saved successfully!', 'success');
    } catch (err: any) {
      console.error('Failed to Save As:', err);
      alert(`Save As failed: ${err?.message || err}`);
    }
  }, [appState, setProjectPath]);

  const handleUndo = useCallback(async (): Promise<void> => {
    const win = window as any;
    if (typeof window !== 'undefined' && win.Blockly) {
      const workspace = win.Blockly.getMainWorkspace();
      if (workspace) workspace.undo(false);
    }
  }, []);

  const handleRedo = useCallback(async (): Promise<void> => {
    const win = window as any;
    if (typeof window !== 'undefined' && win.Blockly) {
      const workspace = win.Blockly.getMainWorkspace();
      if (workspace) workspace.undo(true);
    }
  }, []);

  return {
    handleNewProject,
    handleOpenProject,
    handleWebImport,
    handleSaveProject,
    handleDownloadProject,
    handleSaveAsProject,
    handleUndo,
    handleRedo,
  };
}
