/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 *
 * NeuraApp — ML module with kid-friendly classifier UI.
 */

import React, { useState, useCallback, Suspense } from 'react'
import type { ProjectType } from './types/neura.types'
import Loader from '../components/Loader'
import { useCloudProjectStore } from '../store/cloudProjectStore'
import { lazyWithRetry } from '../utils/lazyWithRetry'

const NeuraHome = lazyWithRetry(() => import('./ui/NeuraHome'), 'NeuraHome')
const ProjectWorkspace = lazyWithRetry(() => import('./ui/ProjectWorkspace'), 'ProjectWorkspace')
const ImageClassifierPanel = lazyWithRetry(() => import('./ui/panels/ImageClassifierPanel'), 'ImageClassifierPanel')
const AudioClassifierPanel = lazyWithRetry(() => import('./ui/panels/AudioClassifierPanel'), 'AudioClassifierPanel')
const PoseClassifierPanel = lazyWithRetry(() => import('./ui/panels/PoseClassifierPanel'), 'PoseClassifierPanel')
const HandPoseClassifierPanel = lazyWithRetry(() => import('./ui/panels/HandPoseClassifierPanel'), 'HandPoseClassifierPanel')
const TextClassifierPanel = lazyWithRetry(() => import('./ui/panels/TextClassifierPanel'), 'TextClassifierPanel')
const NumberClassifierPanel = lazyWithRetry(() => import('./ui/panels/NumberClassifierPanel'), 'NumberClassifierPanel')
const ObjectDetectorPanel = lazyWithRetry(() => import('./ui/panels/ObjectDetectorPanel'), 'ObjectDetectorPanel')
const VirtualPianoPanel = lazyWithRetry(() => import('./projects/M1-VirtualPiano/VirtualPianoPanel'), 'VirtualPianoPanel')
const DrawingCanvasPanel = lazyWithRetry(() => import('./projects/M1-DrawingCanvas/DrawingCanvasPanel'), 'DrawingCanvasPanel')
const FingerCounterPanel = lazyWithRetry(() => import('./projects/M1-FingerCounter/FingerCounterPanel'), 'FingerCounterPanel')

interface NeuraAppProps {
    onBack?: () => void
}

type ViewState = { screen: 'home' } | { screen: 'workspace'; type: ProjectType; template?: { name: string; classes: string[] } }

function getClassifierPanel(type: ProjectType) {
    switch (type) {
        case 'image-classifier':
            return ImageClassifierPanel
        case 'audio-classifier':
            return AudioClassifierPanel
        case 'pose-classifier':
        case 'yoga-checker':
        case 'rep-counter':
        case 'dance-pose':
        case 'posture-monitor':
            return PoseClassifierPanel
        case 'virtual-piano':
            return VirtualPianoPanel
        case 'hand-pose-classifier':
            return HandPoseClassifierPanel
        case 'finger-counter':
            return FingerCounterPanel
        case 'drawing-canvas':
            return DrawingCanvasPanel
        case 'text-classifier':
            return TextClassifierPanel
        case 'numbers-cr':
            return NumberClassifierPanel
        case 'object-detection':
            return ObjectDetectorPanel
        default:
            return ImageClassifierPanel
    }
}

export default function NeuraApp({ onBack }: NeuraAppProps) {
    const [view, setView] = useState<ViewState>({ screen: 'home' })

    React.useEffect(() => {
        const { pendingProject } = useCloudProjectStore.getState()
        if (pendingProject && pendingProject.mode === 'neura') {
            const data = pendingProject.data
            const projectType: ProjectType = data.type || 'image-classifier'
            setView({ screen: 'workspace', type: projectType })
        }
    }, [])

    const handleSelectType = (type: ProjectType, template?: { name: string; classes: string[] }) => {
        setView({ screen: 'workspace', type, template })
    }

    const handleBackToHome = useCallback(() => {
        if (view.screen === 'workspace') {
            const projectType = view.type
            try {
                localStorage.removeItem(`neura-project-${projectType}`)
                localStorage.removeItem(`neura-annotations-${projectType}`)
            } catch { /* ignore */ }
            useCloudProjectStore.getState().clearPendingProject()
        }
        setView({ screen: 'home' })
    }, [view])

    const handleBack = useCallback((hasChanges?: boolean) => {
        if (view.screen === 'workspace') {
            handleBackToHome()
        } else if (onBack) {
            onBack(hasChanges)
        }
    }, [view.screen, onBack, handleBackToHome])

    return (
        <div className="w-full h-screen bg-gray-50">
            <Suspense fallback={<Loader />}>
                {view.screen === 'home' && (
                    <NeuraHome
                        onSelect={handleSelectType}
                        onBack={onBack || handleBackToHome}
                    />
                )}

                {view.screen === 'workspace' && (
                    <ProjectWorkspace
                        type={view.type}
                        onBack={handleBack}
                        template={view.template}
                    >
                        {({ mode }) => {
                            const Panel = getClassifierPanel(view.type)
                            return <Panel mode={mode} />
                        }}
                    </ProjectWorkspace>
                )}
            </Suspense>
        </div>
    )
}
