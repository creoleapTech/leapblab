import { useState, useRef } from "react";
import Blockly from "@blockly-runtime";
import { fileService } from "../../../Electra/Client/Src/services/FileService";
import { showToast } from "../components/Toast";
import { useLeapLabAuthStore } from "../../../auth/leaplabAuthStore";

interface SpriteData {
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    angle: number;
    size: number;
    visible: boolean;
    mirrored: boolean;
    speech: string | null;
    costumes: Record<string, string>;
    currentCostume: string;
    blocks?: any;
    [key: string]: any;
}

interface SceneData {
    id: string;
    name: string;
    background: string;
    sprites: SpriteData[];
    [key: string]: any;
}

interface ProjectPayload {
    scenes: SceneData[];
    recordedSounds: Record<string, { samples: number[]; sampleRate: number }>;
    installedExtensions: string[];
}

interface AudioEngine {
    soundBank?: {
        assets: Record<string, string>;
        recordedSounds?: Record<string, { samples: number[]; sampleRate: number }>;
        restoreRecordedSound?: (name: string, samples: number[], sampleRate: number) => void;
    };
}

interface UseJuniorProjectProps {
    workspaceRef: React.RefObject<any>;
    scenes: SceneData[];
    setScenes: React.Dispatch<React.SetStateAction<SceneData[]>>;
    currentSceneId: string;
    setCurrentSceneId: (id: string) => void;
    activeSpriteIdRef: React.MutableRefObject<string | null>;
    setActiveSpriteId: (id: string | null) => void;
    stopBlocks?: () => void;
    projectName: string;
    setProjectName: (name: string) => void;
    saveCurrentWorkspace: () => void;
    spriteWorkspacesRef: React.MutableRefObject<Map<string, any>>;
    isLoadingWorkspaceRef: React.MutableRefObject<boolean>;
    audioEngine?: AudioEngine;
    installedExtensionsRef?: React.MutableRefObject<Set<string>>;
    restoreExtensions?: (extensions: string[]) => void;
}

const cloneWorkspaceData = (workspaceJson: any): any => JSON.parse(JSON.stringify(workspaceJson || {}));

export function useJuniorProject({
    workspaceRef,
    scenes,
    setScenes,
    currentSceneId,
    setCurrentSceneId,
    activeSpriteIdRef,
    setActiveSpriteId,
    stopBlocks,
    projectName,
    setProjectName,
    saveCurrentWorkspace,
    spriteWorkspacesRef,
    isLoadingWorkspaceRef,
    audioEngine,
    installedExtensionsRef,
    restoreExtensions
}: UseJuniorProjectProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showUnsavedModal, setShowUnsavedModal] = useState(false);
    const [pendingAction, setPendingAction] = useState<string | null>(null);

    const createDefaultSprite = (): SpriteData => ({
        id: 'robot_default',
        name: 'Robot',
        type: 'robot',
        x: 200,
        y: 150,
        angle: 0,
        size: 100,
        visible: true,
        mirrored: false,
        speech: null,
        costumes: {
            default: 'assets/sprites/robot/robot_idle.svg',
            wave1: 'assets/sprites/robot/robot_wave1.svg',
            wave2: 'assets/sprites/robot/robot_wave2.svg',
            talk: 'assets/sprites/robot/robot_talk1.svg'
        },
        currentCostume: 'default',
        blocks: { blocks: { languageVersion: 0, blocks: [] } }
    });

    const createDefaultScene = (): SceneData => ({
        id: 'scene1',
        name: 'Scene 1',
        background: 'white',
        sprites: [createDefaultSprite()]
    });

    const executeNewProject = (): void => {
        if (spriteWorkspacesRef && spriteWorkspacesRef.current) {
            spriteWorkspacesRef.current.clear();
            console.log('[JuniorProject] Cleared all sprite workspaces');
        }

        if (workspaceRef.current) {
            isLoadingWorkspaceRef.current = true;
            Blockly.Events.disable();
            try {
                workspaceRef.current.clear();
            } finally {
                Blockly.Events.enable();
                setTimeout(() => { isLoadingWorkspaceRef.current = false; }, 50);
            }
        }

        const newSprite = createDefaultSprite();
        const defaultScene = createDefaultScene();

        setScenes([defaultScene]);
        setCurrentSceneId('scene1');
        setActiveSpriteId(newSprite.id);
        activeSpriteIdRef.current = newSprite.id;
        setProjectName('Untitled');
        console.log('[JuniorApp] New project created');
    };

    const handleNewProject = (): void => {
        setPendingAction('new');
        setShowUnsavedModal(true);
    };

    const buildProjectPayload = (): ProjectPayload => ({
        scenes,
        recordedSounds: (audioEngine?.soundBank?.recordedSounds as any) || {},
        installedExtensions: installedExtensionsRef ? Array.from(installedExtensionsRef.current) : []
    });

    const handleSaveProject = async (isSilent = false): Promise<void> => {
        const authState = useLeapLabAuthStore.getState();
        if (!authState.isAuthenticated || !authState.token) {
            showToast("Please sign in to save projects. Use Download to save locally.", "info");
            return;
        }
        if (authState.role === 'trainer') {
            showToast("Trainers cannot save to cloud. Use Download to save locally.", "info");
            return;
        }
        saveCurrentWorkspace();
        setTimeout(async () => {
            const payload = buildProjectPayload();
            try {
                await fileService.saveProject(projectName, 'junior', payload);
                console.log(`[JuniorApp] Project saved: ${projectName}`);
                if (!isSilent) {
                    showToast("Project saved successfully!", "success");
                }
            } catch (err: any) {
                console.error('[JuniorApp] Failed to save project:', err);
                alert(err?.message || 'Failed to save project. Please make sure you are signed in.');
            }
        }, 50);
    };

    const handleSaveAsProject = async (): Promise<void> => {
        const authState = useLeapLabAuthStore.getState();
        if (!authState.isAuthenticated || !authState.token) {
            showToast("Please sign in to save projects. Use Download to save locally.", "info");
            return;
        }
        if (authState.role === 'trainer') {
            showToast("Trainers cannot save to cloud. Use Download to save locally.", "info");
            return;
        }
        saveCurrentWorkspace();
        setTimeout(async () => {
            const payload = buildProjectPayload();
            try {
                await fileService.saveProject(projectName, 'junior', payload);
                console.log(`[JuniorApp] Project saved (Save As): ${projectName}`);
                showToast("Project saved successfully!", "success");
            } catch (err: any) {
                console.error('[JuniorApp] Failed to save project (Save As):', err);
                showToast(err?.message || 'Failed to save project.', 'error');
            }
        }, 50);
    };

    const handleDownloadProject = (): void => {
        saveCurrentWorkspace();
        setTimeout(() => {
            fileService.saveProjectLocally(projectName, 'junior', buildProjectPayload());
            console.log(`[JuniorApp] Project downloaded: ${projectName}`);
        }, 50);
    };

    const handleShareProject = (): void => {
        saveCurrentWorkspace();
        setTimeout(() => {
            fileService.shareProject(projectName, 'junior', buildProjectPayload());
            console.log(`[JuniorApp] Project shared: ${projectName}`);
        }, 50);
    };

    const executeOpenProject = (): void => {
        if (fileInputRef.current) {
            fileInputRef.current.accept = '.leap,.lbproject,application/json';
            fileInputRef.current.click();
        }
    };

    const handleOpenProject = (): void => {
        setPendingAction('open');
        setShowUnsavedModal(true);
    };

    const confirmUnsavedAction = (saveFirst: boolean): void => {
        setShowUnsavedModal(false);
        if (saveFirst) {
            handleSaveProject(true);
            setTimeout(() => {
                if (pendingAction === 'new') executeNewProject();
                if (pendingAction === 'open') executeOpenProject();
                setPendingAction(null);
            }, 500);
        } else {
            if (pendingAction === 'new') executeNewProject();
            if (pendingAction === 'open') executeOpenProject();
            setPendingAction(null);
        }
    };

    const loadProjectData = async (data: any): Promise<boolean> => {
        const validation = fileService.validateProject(data, 'junior');

        if (!validation.isValid) {
            showToast(validation.error, 'error');
            return false;
        }

        if (!data.scenes) throw new Error('Invalid Junior project file (missing scenes array)');

        console.log(`[JuniorApp] Loading project: ${data.projectName || 'Untitled'}`);

        if (stopBlocks) stopBlocks();

        if (spriteWorkspacesRef && spriteWorkspacesRef.current) {
            spriteWorkspacesRef.current.clear();
            data.scenes.forEach((scene: any) => {
                scene.sprites.forEach((sprite: any) => {
                    if (sprite.blocks && Object.keys(sprite.blocks).length > 0) {
                        spriteWorkspacesRef.current.set(sprite.id, cloneWorkspaceData(sprite.blocks));
                        console.log(`[JuniorProject] Pre-loaded workspace for sprite: ${sprite.id}`);
                    }
                });
            });
        }

        if (workspaceRef.current) {
            isLoadingWorkspaceRef.current = true;
            Blockly.Events.disable();
            try {
                workspaceRef.current.clear();
            } finally {
                Blockly.Events.enable();
                setTimeout(() => {
                    isLoadingWorkspaceRef.current = false;
                }, 50);
            }
        }

        setProjectName(data.projectName || 'My Project');
        setScenes(data.scenes);

        if (data.recordedSounds && audioEngine?.soundBank) {
            for (const [name, record] of Object.entries(data.recordedSounds)) {
                const { samples, sampleRate } = record as { samples: number[]; sampleRate: number };
                (audioEngine.soundBank as any).restoreRecordedSound(name, samples, sampleRate);
            }
            console.log(`[JuniorProject] Restored ${Object.keys(data.recordedSounds).length} recorded sound(s)`);
        }

        if (Array.isArray(data.installedExtensions) && data.installedExtensions.length > 0 && restoreExtensions) {
            restoreExtensions(data.installedExtensions);
            console.log(`[JuniorProject] Restored ${data.installedExtensions.length} extension(s): ${data.installedExtensions.join(', ')}`);
        }

        const firstScene = data.scenes[0];
        if (firstScene) {
            setCurrentSceneId(firstScene.id);
            const firstSprite = firstScene.sprites[0];
            if (firstSprite) {
                const newId = firstSprite.id;
                setActiveSpriteId(newId);
                activeSpriteIdRef.current = newId;

                setTimeout(() => {
                    if (workspaceRef.current) {
                        isLoadingWorkspaceRef.current = true;
                        Blockly.Events.disable();
                        try {
                            const json = spriteWorkspacesRef?.current?.get(newId) || cloneWorkspaceData(firstSprite.blocks);
                            if (json && Object.keys(json).length > 0) {
                                Blockly.serialization.workspaces.load(cloneWorkspaceData(json), workspaceRef.current);
                                console.log(`[JuniorProject] Loaded workspace for first sprite: ${newId}`);
                            }
                        } catch (err) {
                            console.error('[JuniorProject] Error loading workspace:', err);
                        } finally {
                            Blockly.Events.enable();
                            setTimeout(() => {
                                isLoadingWorkspaceRef.current = false;
                            }, 50);
                        }
                    }
                }, 100);
            } else {
                setActiveSpriteId(null);
                activeSpriteIdRef.current = null;
                if (workspaceRef.current) workspaceRef.current.clear();
            }
        }

        console.log('[JuniorApp] Project loaded successfully');
        return true;
    };

    const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const data = await fileService.loadProject(file);
            await loadProjectData(data);
        } catch (err: any) {
            console.error('Failed to load project:', err);
            showToast('Failed to load project file: ' + err.message, 'error');
        } finally {
            e.target.value = "";
        }
    };

    return {
        fileInputRef,
        showUnsavedModal,
        setShowUnsavedModal,
        handleNewProject,
        handleSaveProject,
        handleSaveAsProject,
        handleDownloadProject,
        handleShareProject,
        handleOpenProject,
        confirmUnsavedAction,
        handleFileLoad,
        loadProjectData,
        pendingAction,
        setPendingAction
    };
}
