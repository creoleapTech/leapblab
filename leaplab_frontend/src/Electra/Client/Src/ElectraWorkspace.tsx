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
        const board = pendingProject.data?.board;
        if (board === 'arduino-uno' || board === 'esp32-c3') {
            console.log('[ELECTRA WORKSPACE] Board auto-detected from pending project:', board);
            return board;
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

    // Clear workspace when component mounts only if we are not about to load a
    // shared/cloud project. Otherwise the clear would wipe the loaded nodes.
    useEffect(() => {
        if (redirectProjectData) return;

        const params = new URLSearchParams(window.location.search);
        const hasExternalProject = params.has('share') || params.has('project') || params.has('projectUrl');
        const hasPendingProject = !!pendingProject;

        if (hasExternalProject || hasPendingProject) {
            console.log('[ELECTRA WORKSPACE] Skipping workspace clear — project load in progress');
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
