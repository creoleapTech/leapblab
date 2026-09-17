/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useEffect, useRef } from 'react';
import { BoardSelectionModal } from './components/BoardSelectionModal';
import ForgeElectra from './ForgeElectra';
import { useForgeStore } from '../utils/store/useForgeStore';
import { useCloudProjectStore } from '../../../store/cloudProjectStore';

interface ElectraWorkspaceProps {
    onBack: () => void;
    onHome: () => void;
    onRedirectToCreova?: (data: unknown, projectName?: string | null, projectPath?: string | null) => void;
    redirectProjectData?: unknown;
    clearRedirectProjectData?: () => void;
}

function detectBoardFromPendingProject(pendingProject: any): 'arduino-uno' | 'esp32-c3' | null {
    if (pendingProject?.mode === 'electra') {
        const d = pendingProject.data || {};
        const board = d.board || d.metadata?.board || d.payload?.board || d.circuit?.board;
        if (board === 'arduino-uno' || board === 'esp32-c3') {
            console.log('[ELECTRA WORKSPACE] Board auto-detected from pending project:', board);
            return board;
        }
        // Fallback: detect board node inside nodes
        const nodes = d.nodes || d.circuit?.nodes || d.payload?.nodes || [];
        if (Array.isArray(nodes)) {
            const boardNode = (nodes as any[]).find((n: any) => n?.data?.type === 'arduino-uno' || n?.data?.type === 'esp32-c3' || n?.type === 'arduino-uno' || n?.type === 'esp32-c3');
            const t = (boardNode?.data?.type || boardNode?.type) as string | undefined;
            if (t === 'arduino-uno' || t === 'esp32-c3') {
                console.log('[ELECTRA WORKSPACE] Board auto-detected from nodes:', t);
                return t as 'arduino-uno' | 'esp32-c3';
            }
        }
    }
    return null;
}

export default function ElectraWorkspace({
    onBack,
    onHome,
    onRedirectToCreova,
    redirectProjectData,
    clearRedirectProjectData
}: ElectraWorkspaceProps) {
    const pendingProject = useCloudProjectStore(s => s.pendingProject);
    // Auto-detect board from saved/shared projects so the user never has to
    // re-pick the board for a project that already knows what it is.
    const [selectedBoard, setSelectedBoard] = useState<'arduino-uno' | 'esp32-c3' | null>(() => {
        if (redirectProjectData) return null; // handled by redirect effect below
        return detectBoardFromPendingProject(pendingProject);
    });

    // Reactively update board when a new LMS project is selected (fixes stale Project A)
    useEffect(() => {
        if (pendingProject?.mode === 'electra' && pendingProject.data?.board) {
            const board = pendingProject.data.board;
            if (board === 'arduino-uno' || board === 'esp32-c3') {
                setSelectedBoard(board);
            }
        }
    }, [pendingProject]);

    // Capture any pending cloud/shared project at render time so we can decide
    // whether to clear the workspace after child effects have finished loading.
    const pendingProjectRef = useRef(pendingProject);
    // Set once a project load is inbound (or has landed) during this mount.
    // ForgeElectra consumes pendingProject and then clears it from the store;
    // without this flag the effect below would re-fire on that clear and wipe
    // the just-loaded canvas (nodes/edges) while local code state survives —
    // i.e. "code is there but components are gone".
    const loadedProjectRef = useRef(!!pendingProject || !!redirectProjectData);

    // Clear workspace when component mounts only if we are not about to load a
    // shared/cloud project. Otherwise the clear would wipe the loaded nodes.
    useEffect(() => {
        pendingProjectRef.current = pendingProject;
        if (redirectProjectData) {
            loadedProjectRef.current = true;
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const hasExternalProject = params.has('share') || params.has('project') || params.has('projectUrl');
        const hasPendingProject = !!pendingProject;

        if (hasExternalProject || hasPendingProject) {
            loadedProjectRef.current = true;
            console.log('[ELECTRA WORKSPACE] Skipping workspace clear — project load in progress');
            return;
        }

        // The child consumes pendingProject and clears it after loading. That
        // store change re-fires this effect with pendingProject === null — it
        // must NOT wipe the canvas that was just populated.
        if (loadedProjectRef.current) {
            console.log('[ELECTRA WORKSPACE] Skipping workspace clear — project already loaded this session');
            return;
        }

        const { clearWorkspace } = useForgeStore.getState();
        clearWorkspace();
        console.log('[ELECTRA WORKSPACE] Workspace cleared on mount');
    }, [redirectProjectData, pendingProject]);

    // Detect board from redirect data
    useEffect(() => {
        if (redirectProjectData) {
            const projectObj = redirectProjectData as { data?: { board?: 'arduino-uno' | 'esp32-c3' } };
            const board = projectObj.data?.board || 'arduino-uno';
            console.log('[ELECTRA WORKSPACE] Board detected from redirect:', board);
            setSelectedBoard(board);
        }
    }, [redirectProjectData]);

    const handleBoardSelect = (board: 'arduino-uno' | 'esp32-c3') => {
        console.log('[ELECTRA WORKSPACE] Board selected:', board);
        setSelectedBoard(board);
    };

    if (!selectedBoard) {
        return <BoardSelectionModal onSelect={handleBoardSelect} onClose={onHome} />;
    }

    return (
        <ForgeElectra
            onBack={onBack}
            initialBoard={selectedBoard}
            onRedirectToCreova={onRedirectToCreova}
            redirectProjectData={redirectProjectData}
            clearRedirectProjectData={clearRedirectProjectData}
        />
    );
}
