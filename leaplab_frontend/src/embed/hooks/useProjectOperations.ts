import { useCallback } from 'react';
import type React from 'react';
import Blockly from '@blockly-runtime';
import { Sprite } from '../../stage/Sprite';
import { animationVM } from '../../vm/AnimationVM';
import { stageManager } from '../../engine/StageManager';
import { spriteManager } from '../../engine/SpriteManager';
import { setActiveSpriteId } from '../../runtime/RuntimeBridge';
import { migrateWorkspaceBlocks } from '../../utils/blocklyMigration';
import { normalizeAssetPath, resolveAssetPath } from '../utils/assetPaths';
import { EXTENSIONS, registerExtensions } from '../../extensions/extensionDefinitions';
import { extractBroadcastValues } from '../utils/blocklyInit';
import type { VariableMonitorState, ListMonitorState, TableMonitorState, EditorMode } from '../../types/intermediateTypes';
import { normalizeVariableMonitor } from '../../types/intermediateTypes';
import type { CompiledScript } from '../../vm/AnimationVM';
import { fileService } from '../../Electra/Client/Src/services/FileService';
import { showAlert } from '../../utils/dialogStore';
import { useLeapLabAuthStore } from '../../auth/leaplabAuthStore';
import { showToast } from '../../leapignite/client/components/Toast';

export function useProjectOperations(
    sprites: Sprite[],
    setSprites: React.Dispatch<React.SetStateAction<Sprite[]>>,
    selectedSpriteId: string | null,
    setSelectedSpriteId: React.Dispatch<React.SetStateAction<string | null>>,
    projectName: string,
    setProjectName: React.Dispatch<React.SetStateAction<string>>,
    addLog: (msg: string) => void,
    triggerUpdate: () => void,
    spriteWorkspacesRef: React.MutableRefObject<Map<string, any>>,
    workspaceRef: React.MutableRefObject<Blockly.WorkspaceSvg | null>,
    isLoadingWorkspaceRef: React.MutableRefObject<boolean>,
    activeSpriteIdRef: React.MutableRefObject<string | null>,
    installedExtensionsRef: React.MutableRefObject<Set<string>>,
    setInstalledExtensions: React.Dispatch<React.SetStateAction<Set<string>>>,
    variableMonitors: VariableMonitorState[],
    setVariableMonitors: React.Dispatch<React.SetStateAction<VariableMonitorState[]>>,
    listMonitors: ListMonitorState[],
    setListMonitors: React.Dispatch<React.SetStateAction<ListMonitorState[]>>,
    tableMonitors: TableMonitorState[],
    setTableMonitors: React.Dispatch<React.SetStateAction<TableMonitorState[]>>,
    sensingMonitors: any[],
    setSensingMonitors: React.Dispatch<React.SetStateAction<any[]>>,
    setCompiledScripts: React.Dispatch<React.SetStateAction<CompiledScript[]>>,
    setIsRunning: React.Dispatch<React.SetStateAction<boolean>>,
    loadSpriteWorkspace: (spriteId: string) => void,
    editorMode?: EditorMode,
    setEditorMode?: React.Dispatch<React.SetStateAction<EditorMode>>
) {

    const executeNewProject = useCallback(() => {
        sprites.forEach(s => animationVM.unregisterSprite(s.id));
        setSprites([]);
        setSelectedSpriteId(null);
        setProjectName('Untitled');
        spriteWorkspacesRef.current.clear();

        if (workspaceRef.current) {
            isLoadingWorkspaceRef.current = true;
            Blockly.Events.disable();
            workspaceRef.current.clear();
            Blockly.Events.enable();
            setTimeout(() => { isLoadingWorkspaceRef.current = false; }, 50);
        }

        setVariableMonitors([]);
        setListMonitors([]);
        setTableMonitors([]);
        setCompiledScripts([]);
        setIsRunning(false);

        animationVM.resetState();
        stageManager.reset();

        const stageSprite = new Sprite('stage', 'Stage', triggerUpdate, 'cat');
        stageSprite.hide();
        animationVM.registerSprite(stageSprite);
        spriteWorkspacesRef.current.set('stage', {});

        const robotId = 'sprite_default';
        const robotSprite = new Sprite(robotId, 'Robot', triggerUpdate, 'robot');
        robotSprite.setX(0);
        robotSprite.setY(0);
        spriteWorkspacesRef.current.set(robotId, {});

        const loadAssets = async () => {
            await robotSprite.addCostume('idle', 'assets/sprites/robot/robot_idle.svg');
            await robotSprite.addCostume('wave 1', 'assets/sprites/robot/image-removebg-preview (1).png');
            await robotSprite.addCostume('wave 2', 'assets/sprites/robot/image-Photoroom.png');
            await robotSprite.addCostume('talk', 'assets/sprites/robot/image-removebg-preview.png');
            await robotSprite.addSound('Meow', 'assets/sounds/83c36d806dc92327b9e7049a565c6bff.wav');

            animationVM.registerSprite(robotSprite);
            setSprites([stageSprite, robotSprite]);
            activeSpriteIdRef.current = robotId;
            setSelectedSpriteId(robotId);
            triggerUpdate();
            window.dispatchEvent(new Event('leap-stage-update'));
        };

        loadAssets().catch(err => console.error('[APP] Failed to initialize assets:', err));
        addLog('New project created');
    }, [triggerUpdate, addLog, sprites, setSprites, setSelectedSpriteId, setProjectName, setVariableMonitors, setListMonitors, setTableMonitors, setCompiledScripts, setIsRunning, spriteWorkspacesRef, workspaceRef, isLoadingWorkspaceRef, activeSpriteIdRef]);

    const buildProjectPayload = useCallback(() => {
        const activeId = activeSpriteIdRef.current;
        if (workspaceRef.current && activeId) {
            const json = Blockly.serialization.workspaces.save(workspaceRef.current);
            spriteWorkspacesRef.current.set(activeId, json);
        }

        const spritesData = sprites.map(s => ({
            id: s.id,
            name: s.name,
            spriteType: s.spriteType,
            x: s.x,
            y: s.y,
            direction: s.direction,
            size: s.size,
            visible: s.visible,
            volume: s.volume,
            soundEffects: { ...s.soundEffects },
            sounds: (s.id === 'stage' ? stageManager.getAllSounds() : s.sounds).map(sound => ({
                name: sound.name,
                src: normalizeAssetPath(sound.src)
            })),
            costumes: s.costumes.map(c => ({
                name: c.name,
                src: normalizeAssetPath(c.image.src)
            }))
        }));

        const workspacesData: Record<string, any> = {};
        spriteWorkspacesRef.current.forEach((val, key) => {
            if (val && Object.keys(val).length > 0) {
                workspacesData[key] = val;
            }
        });

        return {
            mode: 'intermediate',
            editorMode: editorMode || 'stage',
            version: '1.0',
            sprites: spritesData,
            workspaces: workspacesData,
            backdrops: stageManager.getAllBackdrops().map(b => ({
                name: b.name,
                src: normalizeAssetPath(b.src)
            })),
            currentBackdropIndex: stageManager.getCurrentBackdropIndex(),
            broadcasts: animationVM.getBroadcastMessages(),
            monitors: {
                variables: variableMonitors,
                lists: listMonitors,
                tables: tableMonitors,
                sensing: sensingMonitors
            },
            installedExtensions: Array.from(installedExtensionsRef.current)
        };
    }, [sprites, variableMonitors, listMonitors, tableMonitors, sensingMonitors, spriteWorkspacesRef, workspaceRef, activeSpriteIdRef, installedExtensionsRef, editorMode]);

    const handleSaveProject = useCallback(async (isSilent = false) => {
        const authState = useLeapLabAuthStore.getState();
        if (!authState.isAuthenticated || !authState.token) {
            showToast("Please sign in to save projects. Use Download to save locally.", "info");
            return;
        }
        if (authState.role === 'trainer') {
            showToast("Trainers cannot save to cloud. Use Download to save locally.", "info");
            return;
        }
        const payload = buildProjectPayload();
        try {
            await fileService.saveProject(projectName, 'intermediate', payload);
            addLog(`Project saved: ${projectName}`);
            if (!isSilent) {
                showToast("Project saved successfully!", "success");
            }
        } catch (err: any) {
            console.error('[IntermediateApp] Failed to save project:', err);
            showAlert(err?.message || 'Failed to save project. Please make sure you are signed in.', 'Save Error');
        }
    }, [projectName, buildProjectPayload, addLog]);

    const handleSaveAsProject = useCallback(async () => {
        const authState = useLeapLabAuthStore.getState();
        if (!authState.isAuthenticated || !authState.token) {
            showToast("Please sign in to save projects. Use Download to save locally.", "info");
            return;
        }
        if (authState.role === 'trainer') {
            showToast("Trainers cannot save to cloud. Use Download to save locally.", "info");
            return;
        }
        const payload = buildProjectPayload();
        try {
            await fileService.saveProject(projectName, 'intermediate', payload);
            addLog(`Project saved: ${projectName}`);
            showToast("Project saved successfully!", "success");
        } catch (err: any) {
            console.error('[IntermediateApp] Failed to save project (Save As):', err);
            showToast(err?.message || 'Failed to save project.', 'error');
        }
    }, [projectName, buildProjectPayload, addLog]);

    const handleDownloadProject = useCallback(() => {
        const payload = buildProjectPayload();
        fileService.saveProjectLocally(projectName, 'intermediate', payload);
    }, [projectName, buildProjectPayload]);

    const loadProjectFromData = useCallback(async (data: any, source: string) => {
        try {
            const validation = fileService.validateProject(data, 'intermediate');
            if (!validation.isValid) {
                addLog(`Invalid project: ${validation.error}`);
                return;
            }

            if (data.editorMode && (data.editorMode === 'stage' || data.editorMode === 'upload') && setEditorMode) {
                setEditorMode(data.editorMode);
            }

            if (!data.sprites || !data.workspaces) {
                throw new Error('Invalid project file (missing sprites or workspaces)');
            }

            addLog(`Loading project: ${data.projectName || 'Untitled'}`);

            spriteManager.getAllSprites().forEach(s => animationVM.unregisterSprite(s.id));
            spriteWorkspacesRef.current.clear();
            if (workspaceRef.current) workspaceRef.current.clear();

            setProjectName(data.projectName || 'My Project');

            const newSprites: Sprite[] = [];
            stageManager.clearSounds();
            stageManager.clearBackdrops();

            for (const sData of data.sprites) {
                const s = new Sprite(sData.id, sData.name, triggerUpdate, sData.spriteType || 'cat');
                s.setX(sData.x);
                s.setY(sData.y);
                s.pointInDirection(sData.direction);
                s.setSize(sData.size);
                if (sData.visible) s.show(); else s.hide();
                if (typeof sData.volume === 'number') s.setVolume(sData.volume);
                if (sData.soundEffects) {
                    if (typeof sData.soundEffects.pitch === 'number') s.setSoundEffect('pitch', sData.soundEffects.pitch);
                    if (typeof sData.soundEffects.pan === 'number') s.setSoundEffect('pan', sData.soundEffects.pan);
                }
                for (const cData of sData.costumes) {
                    const resolvedSrc = resolveAssetPath(cData.src);
                    await s.addCostume(cData.name, resolvedSrc);
                }
                if (Array.isArray(sData.sounds)) {
                    if (sData.id === 'stage') {
                        for (const soundData of sData.sounds)
                            await stageManager.addSound(soundData.name, resolveAssetPath(soundData.src));
                    } else {
                        for (const soundData of sData.sounds)
                            await s.addSound(soundData.name, resolveAssetPath(soundData.src));
                    }
                }
                newSprites.push(s);
                animationVM.registerSprite(s);
            }

            if (Array.isArray(data.backdrops)) {
                for (const bData of data.backdrops)
                    await stageManager.addBackdrop(bData.name, resolveAssetPath(bData.src));
                if (typeof data.currentBackdropIndex === 'number' && data.currentBackdropIndex >= 0)
                    stageManager.setBackdrop(data.currentBackdropIndex);
            }

            if (Array.isArray(data.broadcasts)) {
                for (const msg of data.broadcasts)
                    animationVM.registerBroadcast(msg);
            }

            for (const [id, workspaceJson] of Object.entries(data.workspaces))
                extractBroadcastValues(workspaceJson as any, animationVM);

            if (Array.isArray(data.installedExtensions) && data.installedExtensions.length > 0) {
                for (const extId of data.installedExtensions) {
                    if (EXTENSIONS[extId]) {
                        registerExtensions(Blockly, [extId]);
                        if (!installedExtensionsRef.current.has(extId))
                            installedExtensionsRef.current = new Set([...installedExtensionsRef.current, extId]);
                    }
                }
                setInstalledExtensions(new Set(installedExtensionsRef.current));
            }

            Object.keys(data.workspaces).forEach(id => {
                spriteWorkspacesRef.current.set(id, migrateWorkspaceBlocks(data.workspaces[id]));
            });

            if (data.monitors) {
                setVariableMonitors((data.monitors.variables || []).map((monitor: VariableMonitorState, index: number) => normalizeVariableMonitor(monitor, index)));
                setListMonitors(data.monitors.lists || []);
                setTableMonitors(data.monitors.tables || []);
                if (data.monitors.sensing) {
                    setSensingMonitors(data.monitors.sensing);
                }
            } else {
                setVariableMonitors([]);
                setListMonitors([]);
                setTableMonitors([]);
            }

            setSprites(newSprites);

            const initialTarget = newSprites.find(s => s.id !== 'stage' && !s.id.includes('_clone_'))
                || newSprites.find(s => s.id !== 'stage')
                || newSprites[0]
                || null;
            const initialId = initialTarget ? initialTarget.id : null;

            activeSpriteIdRef.current = initialId;
            setSelectedSpriteId(initialId);
            if (initialId) setActiveSpriteId(initialId);

            if (initialId) {
                let attempts = 0;
                const tryLoad = () => {
                    if (workspaceRef.current) {
                        loadSpriteWorkspace(initialId);
                        triggerUpdate();
                        addLog('Project loaded successfully');
                    } else if (attempts < 10) {
                        attempts++;
                        setTimeout(tryLoad, 200);
                    } else {
                        addLog('Project loaded (Workspace loading delayed)');
                    }
                };
                tryLoad();
            } else {
                triggerUpdate();
                addLog('Project loaded successfully (Empty)');
            }
        } catch (err: any) {
            console.error(`Failed to load project from ${source}:`, err);
            addLog(`Failed to load project: ${err.message}`);
        }
    }, [addLog, setProjectName, setSprites, setSelectedSpriteId, setActiveSpriteId, setVariableMonitors, setListMonitors, setTableMonitors, setSensingMonitors, setInstalledExtensions, loadSpriteWorkspace, triggerUpdate, spriteWorkspacesRef, workspaceRef, activeSpriteIdRef, installedExtensionsRef]);

    const executeOpenProject = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.leap,.lbproject,application/json';

        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const data = await fileService.loadProject(file);
                const validation = fileService.validateProject(data, 'intermediate');

                if (!validation.isValid) {
                    showAlert(validation.error, 'Invalid Project');
                    return;
                }

                if (!data.sprites || !data.workspaces) {
                    throw new Error('Invalid project file (missing sprites or workspaces)');
                }

                addLog(`Loading project: ${data.projectName || 'Untitled'}`);

                sprites.forEach(s => animationVM.unregisterSprite(s.id));
                spriteWorkspacesRef.current.clear();
                if (workspaceRef.current) workspaceRef.current.clear();

                setProjectName(data.projectName || 'My Project');

                const newSprites: Sprite[] = [];
                stageManager.clearSounds();
                stageManager.clearBackdrops();

                for (const sData of data.sprites) {
                    const s = new Sprite(sData.id, sData.name, triggerUpdate, sData.spriteType || 'cat');
                    s.setX(sData.x);
                    s.setY(sData.y);
                    s.pointInDirection(sData.direction);
                    s.setSize(sData.size);
                    if (sData.visible) s.show(); else s.hide();
                    if (typeof sData.volume === 'number') s.setVolume(sData.volume);
                    if (sData.soundEffects) {
                        if (typeof sData.soundEffects.pitch === 'number') s.setSoundEffect('pitch', sData.soundEffects.pitch);
                        if (typeof sData.soundEffects.pan === 'number') s.setSoundEffect('pan', sData.soundEffects.pan);
                    }
                    for (const cData of sData.costumes) {
                        const resolvedSrc = resolveAssetPath(cData.src);
                        await s.addCostume(cData.name, resolvedSrc);
                    }
                    if (Array.isArray(sData.sounds)) {
                        if (sData.id === 'stage') {
                            for (const soundData of sData.sounds)
                                await stageManager.addSound(soundData.name, resolveAssetPath(soundData.src));
                        } else {
                            for (const soundData of sData.sounds)
                                await s.addSound(soundData.name, resolveAssetPath(soundData.src));
                        }
                    }
                    newSprites.push(s);
                    animationVM.registerSprite(s);
                }

                if (Array.isArray(data.backdrops)) {
                    for (const bData of data.backdrops)
                        await stageManager.addBackdrop(bData.name, resolveAssetPath(bData.src));
                    if (typeof data.currentBackdropIndex === 'number' && data.currentBackdropIndex >= 0)
                        stageManager.setBackdrop(data.currentBackdropIndex);
                }

                if (Array.isArray(data.broadcasts)) {
                    for (const msg of data.broadcasts)
                        animationVM.registerBroadcast(msg);
                }

                for (const [id, workspaceJson] of Object.entries(data.workspaces))
                    extractBroadcastValues(workspaceJson as any, animationVM);

                if (Array.isArray(data.installedExtensions) && data.installedExtensions.length > 0) {
                    for (const extId of data.installedExtensions) {
                        if (EXTENSIONS[extId]) {
                            registerExtensions(Blockly, [extId]);
                            if (!installedExtensionsRef.current.has(extId))
                                installedExtensionsRef.current = new Set([...installedExtensionsRef.current, extId]);
                        }
                    }
                    setInstalledExtensions(new Set(installedExtensionsRef.current));
                }

                Object.keys(data.workspaces).forEach(id => {
                    spriteWorkspacesRef.current.set(id, migrateWorkspaceBlocks(data.workspaces[id]));
                });

                if (data.monitors) {
                    setVariableMonitors((data.monitors.variables || []).map((monitor: VariableMonitorState, index: number) => normalizeVariableMonitor(monitor, index)));
                    setListMonitors(data.monitors.lists || []);
                    setTableMonitors(data.monitors.tables || []);
                    if (data.monitors.sensing) {
                        setSensingMonitors(data.monitors.sensing);
                    }
                } else {
                    setVariableMonitors([]);
                    setListMonitors([]);
                    setTableMonitors([]);
                }

                setSprites(newSprites);

                const initialTarget = newSprites.find(s => s.id !== 'stage' && !s.id.includes('_clone_'))
                    || newSprites.find(s => s.id !== 'stage')
                    || newSprites[0]
                    || null;
                const initialId = initialTarget ? initialTarget.id : null;

                activeSpriteIdRef.current = initialId;
                setSelectedSpriteId(initialId);
                if (initialId) setActiveSpriteId(initialId);

                if (initialId) {
                    let attempts = 0;
                    const tryLoad = () => {
                        if (workspaceRef.current) {
                            loadSpriteWorkspace(initialId);
                            triggerUpdate();
                            addLog('Project loaded successfully');
                        } else if (attempts < 10) {
                            attempts++;
                            setTimeout(tryLoad, 200);
                        } else {
                            addLog('Project loaded (Workspace loading delayed)');
                        }
                    };
                    tryLoad();
                } else {
                    triggerUpdate();
                    addLog('Project loaded successfully (Empty)');
                }
            } catch (err: any) {
                console.error('Failed to load project:', err);
                showAlert(`Failed to load project file: ${err.message}`, 'Load Error');
            }
        };
        input.click();
    }, [triggerUpdate, sprites, loadSpriteWorkspace, addLog, spriteWorkspacesRef, workspaceRef, setProjectName, setSprites, setSelectedSpriteId, setVariableMonitors, setListMonitors, setTableMonitors, setSensingMonitors, setInstalledExtensions, activeSpriteIdRef, installedExtensionsRef]);

    return {
        executeNewProject,
        buildProjectPayload,
        handleSaveProject,
        handleSaveAsProject,
        handleDownloadProject,
        loadProjectFromData,
        executeOpenProject,
    };
}
