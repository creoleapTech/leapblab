/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import { saveProjectToCloud, updateSharedProject, updateCloudProject, listMyProjects } from '../../../../services/cloudProjectApi';
import { useLeapLabAuthStore } from '../../../../auth/leaplabAuthStore';
import { useCloudProjectStore } from '../../../../store/cloudProjectStore';

export type SessionMode = 'junior' | 'intermediate' | 'python' | 'advanced_blocks' | 'creocad' | 'app_game_dev' | 'neura' | 'electra' | 'creova';

export interface ProjectData {
    version: string;
    projectName: string;
    mode: SessionMode;
    timestamp: number;
    [key: string]: any;
}

const MODE_NAMES: Record<SessionMode, string> = {
    junior: 'Ignite / Junior Blocks',
    intermediate: 'Embed / Intermediate Blocks',
    python: 'Logix / Python IDE',
    advanced_blocks: 'Advanced Blocks',
    creocad: 'CreoCAD',
    app_game_dev: 'App & Game Development',
    neura: 'Neura / AI',
    electra: 'Electra / Circuits',
    creova: 'Creova / App Builder'
};

async function captureProjectScreenshot(): Promise<Blob | null> {
    try {
        // Check if we are in Electra / Forge canvas mode
        const forgeCanvas = document.querySelector('.forge-canvas-container') || document.querySelector('.react-flow');
        if (forgeCanvas) {
            const svgElement = forgeCanvas.querySelector('.react-flow__edges') || forgeCanvas.querySelector('svg');
            if (svgElement instanceof SVGElement) {
                const svgString = new XMLSerializer().serializeToString(svgElement);
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const URL = window.URL || window.webkitURL || window;
                const blobURL = URL.createObjectURL(svgBlob);
                
                const image = new Image();
                const canvas = document.createElement('canvas');
                canvas.width = forgeCanvas.clientWidth || 800;
                canvas.height = forgeCanvas.clientHeight || 600;
                const context = canvas.getContext('2d');
                
                return new Promise((resolve) => {
                    image.onload = () => {
                        if (context) {
                            context.fillStyle = '#ffffff';
                            context.fillRect(0, 0, canvas.width, canvas.height);
                            context.drawImage(image, 0, 0);
                            canvas.toBlob((blob) => {
                                URL.revokeObjectURL(blobURL);
                                resolve(blob);
                            }, 'image/png');
                        } else {
                            resolve(null);
                        }
                    };
                    image.onerror = () => resolve(null);
                    image.src = blobURL;
                });
            }
        }

        // 1. Look for the main active canvas element on the page (excluding minimap canvases)
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const activeCanvas = canvases.find(c => {
            const rect = c.getBoundingClientRect();
            const isMinimap = c.closest('.react-flow__minimap') || c.closest('.glass-minimap');
            return !isMinimap && rect.width > 0 && rect.height > 0 && c.width > 0 && c.height > 0;
        });

        if (activeCanvas) {
            return new Promise((resolve) => {
                activeCanvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/png');
            });
        }

        // 2. Look for ReactFlow minimap canvas (Electra circuits fallback)
        const minimapCanvas = document.querySelector('.react-flow__minimap canvas') || document.querySelector('.glass-minimap canvas');
        if (minimapCanvas instanceof HTMLCanvasElement) {
            return new Promise((resolve) => {
                minimapCanvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/png');
            });
        }

        // 3. Fallback: search for any visible SVG element
        const svgElement = document.querySelector('.react-flow__viewport svg') || document.querySelector('.forge-canvas-container svg') || document.querySelector('svg');
        if (svgElement instanceof SVGElement) {
            const svgString = new XMLSerializer().serializeToString(svgElement);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const URL = window.URL || window.webkitURL || window;
            const blobURL = URL.createObjectURL(svgBlob);
            
            const image = new Image();
            const canvas = document.createElement('canvas');
            canvas.width = svgElement.clientWidth || 800;
            canvas.height = svgElement.clientHeight || 600;
            const context = canvas.getContext('2d');
            
            return new Promise((resolve) => {
                image.onload = () => {
                    if (context) {
                        context.fillStyle = '#ffffff';
                        context.fillRect(0, 0, canvas.width, canvas.height);
                        context.drawImage(image, 0, 0);
                        canvas.toBlob((blob) => {
                            URL.revokeObjectURL(blobURL);
                            resolve(blob);
                        }, 'image/png');
                    } else {
                        resolve(null);
                    }
                };
                image.onerror = () => {
                    resolve(null);
                };
                image.src = blobURL;
            });
        }
    } catch (err) {
        console.error('[Screenshot] Failed to capture project screenshot:', err);
    }
    return null;
}

class FileService {
    async saveProject(projectName: string, mode: SessionMode, payload: any): Promise<void> {
        const sharedInfo = useCloudProjectStore.getState().sharedProjectInfo;
        const thumbnail = await captureProjectScreenshot();

        // Curriculum protection: if this is a curriculum copy (from LMS) or a viewer-shared project,
        // never overwrite the original – force Save As (create new).
        const isCurriculumCopy = !!(payload?.isCurriculumCopy || payload?.projectData?.isCurriculumCopy || (payload as any)?.originalCurriculumId)
        if (isCurriculumCopy) {
            // Clear any active ID that points to the curriculum master so we create a student copy
            useCloudProjectStore.getState().clearActiveProjectId();
        }

        // If this project was opened via a shared link with editor permission,
        // save changes back to the shared project (no auth required).
        if (sharedInfo?.permission === 'editor' && !isCurriculumCopy) {
            await updateSharedProject(sharedInfo.shareId, {
                projectName,
                mode,
                payload,
                thumbnail,
            });
            return;
        }
        // Viewer-shared or curriculum copies must not overwrite the master – force Save As
        if (sharedInfo?.permission === 'viewer') {
            useCloudProjectStore.getState().clearActiveProjectId();
        }

        const authState = useLeapLabAuthStore.getState();

        if (!authState.isAuthenticated || !authState.token) {
            throw new Error('Please sign in to save projects to the cloud.');
        }

        if (authState.role === 'trainer') {
            throw new Error('Trainers are not allowed to save projects to the cloud.');
        }

        let activeProjectId = useCloudProjectStore.getState().activeProjectId;
        const metadata = payload?.board ? { board: payload.board } : undefined;

        // Check if a project with the same name already exists in cloud projects for this mode
        try {
            const existingProjects = await listMyProjects(mode);
            const duplicate = existingProjects.find(
                p => p.id !== activeProjectId && p.name.trim().toLowerCase() === projectName.trim().toLowerCase()
            );

            if (duplicate) {
                const confirmed = window.confirm(
                    `A cloud project named "${projectName}" already exists. Do you want to overwrite it?`
                );
                if (!confirmed) {
                    throw new Error(`Save cancelled: A project named "${projectName}" already exists.`);
                }
                // If confirmed to overwrite, update the duplicate project
                activeProjectId = duplicate.id;
                useCloudProjectStore.getState().setActiveProjectId(duplicate.id);
            }
        } catch (err: any) {
            if (err.message?.includes('Save cancelled')) {
                throw err;
            }
            console.warn('[FileService] Failed to check duplicate cloud projects:', err);
        }

        if (activeProjectId) {
            await updateCloudProject(activeProjectId, {
                projectName,
                mode,
                payload,
                thumbnail,
                metadata,
            });
        } else {
            const newProject = await saveProjectToCloud({
                projectName,
                mode,
                payload,
                thumbnail,
                metadata,
            });
            useCloudProjectStore.getState().setActiveProjectId(newProject.id);
        }
    }

    saveProjectLocally(projectName: string, mode: SessionMode, payload: any): void {
        const projectData: ProjectData = {
            version: '1.0',
            projectName,
            mode,
            timestamp: Date.now(),
            ...payload
        };

        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const cleanName = (projectName || '').trim() || 'project';
        link.download = `${cleanName.replace(/\s+/g, '_')}.leap`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async saveProjectAsLocally(projectName: string, mode: SessionMode, payload: any): Promise<{ saved: boolean; newName?: string }> {
        const projectData: ProjectData = {
            version: '1.0',
            projectName,
            mode,
            timestamp: Date.now(),
            ...payload
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const cleanName = (projectName || '').trim() || 'project';
        const suggestedFileName = `${cleanName.replace(/\s+/g, '_')}.leap`;

        // Try native File System Access API (Chrome/Edge) - shows Save As dialog with filename prompt
        const win = window as any;
        if (typeof win.showSaveFilePicker === 'function') {
            try {
                const handle = await win.showSaveFilePicker({
                    suggestedName: suggestedFileName,
                    types: [{ description: 'LeapLab Project', accept: { 'application/json': ['.leap'] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                // Derive new name from picked file if available
                const pickedName: string | undefined = handle?.name || (handle as any)?.name;
                const newName = pickedName ? pickedName.replace(/\.leap$/i, '') : undefined;
                return { saved: true, newName };
            } catch (err: any) {
                // AbortError means user cancelled - don't fallback to download
                if (err?.name === 'AbortError') return { saved: false };
                console.warn('[FileService] showSaveFilePicker failed, falling back to prompt/download', err);
            }
        }

        // Fallback: prompt for filename (works in all browsers) then download
        let newName: string | null = null;
        try {
            newName = window.prompt('Save As - Enter file name:', cleanName);
        } catch {}
        if (newName === null) return { saved: false }; // cancelled prompt
        const finalClean = (newName.trim() || cleanName).replace(/\s+/g, '_');
        const finalFileName = `${finalClean}.leap`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = finalFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        const changed = finalClean !== cleanName.replace(/\s+/g, '_');
        return { saved: true, newName: changed ? newName.trim() : undefined };
    }

    async shareProject(projectName: string, mode: SessionMode, payload: any): Promise<void> {
        const projectData: ProjectData = {
            version: '1.0',
            projectName,
            mode,
            timestamp: Date.now(),
            ...payload
        };

        const jsonStr = JSON.stringify(projectData, null, 2);
        const cleanName = (projectName || '').trim() || 'project';
        const fileName = `${cleanName.replace(/\s+/g, '_')}.leap`;
        const file = new File([jsonStr], fileName, { type: 'application/json' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    title: `${projectName} — LeapBlocks Project`,
                    text: `Check out my LeapBlocks project "${projectName}"!`,
                    files: [file]
                });
                console.log('[FileService] Project shared successfully');
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.warn('[FileService] Share failed, falling back to cloud save:', err);
                    try {
                        await this.saveProject(projectName, mode, payload);
                    } catch (saveErr: any) {
                        console.error('[FileService] Cloud save fallback failed:', saveErr);
                        throw saveErr;
                    }
                }
            }
        } else {
            console.log('[FileService] Web Share API not supported, falling back to cloud save');
            try {
                await this.saveProject(projectName, mode, payload);
            } catch (saveErr: any) {
                console.error('[FileService] Cloud save fallback failed:', saveErr);
                throw saveErr;
            }
        }
    }

    async loadProject(file: File): Promise<any> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target?.result as string);
                    resolve(data);
                } catch (err) {
                    reject(new Error('Invalid project file format'));
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    validateProject(data: any, expectedMode: SessionMode): { isValid: boolean; error?: string } {
        if (!data || typeof data !== 'object') {
            return { isValid: false, error: 'Invalid project data' };
        }

        const projectMode = data.mode as SessionMode;

        if (!projectMode) {
            // Fallback for legacy files without mode field
            if (data.scenes) return this.checkMode('junior', expectedMode);
            if (data.sprites && data.workspaces) return this.checkMode('intermediate', expectedMode);
            return { isValid: false, error: 'This file does not appear to be a valid LeapBlocks project.' };
        }

        return this.checkMode(projectMode, expectedMode);
    }

    private checkMode(actualMode: SessionMode, expectedMode: SessionMode): { isValid: boolean; error?: string } {
        if (actualMode === expectedMode) {
            return { isValid: true };
        }

        const actualName = MODE_NAMES[actualMode] || actualMode;
        const expectedName = MODE_NAMES[expectedMode] || expectedMode;

        return {
            isValid: false,
            error: `This looks like a ${actualName} project. Please open it in the ${actualName} session instead of ${expectedName}.`
        };
    }

    validateNeuraImport(data: any): { isValid: boolean; error?: string } {
        if (!data || typeof data !== 'object') {
            return { isValid: false, error: 'Invalid project data' };
        }
        return { isValid: true };
    }
}

let _fileService: FileService | null = null;
export function getFileService(): FileService {
    if (!_fileService) _fileService = new FileService();
    return _fileService;
}
export const fileService: FileService = new Proxy({} as FileService, {
    get(_target, prop) {
        const instance = getFileService();
        const value = (instance as any)[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(_target, prop, value) { (getFileService() as any)[prop] = value; return true; }
});
