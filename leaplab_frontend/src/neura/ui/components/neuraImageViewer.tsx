import React, { useSyncExternalStore, useCallback } from 'react'
import ImageViewerModal, { type ViewerImage } from './ImageViewerModal'

type ViewerState = { images: ViewerImage[]; index: number } | null

let state: ViewerState = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

function getSnapshot(): ViewerState {
    return state
}

function emit() {
    listeners.forEach(l => l())
}

/** Open the global 80% Neura image viewer. */
export function openImageViewer(images: ViewerImage[] | string[], index = 0) {
    if (!images || images.length === 0) return
    const normalized: ViewerImage[] = (images as any[]).map((img, i) =>
        typeof img === 'string' ? { src: img, label: `Image ${i + 1}` } : img
    ).filter(img => !!img?.src)
    if (normalized.length === 0) return
    state = { images: normalized, index: Math.min(Math.max(index, 0), normalized.length - 1) }
    emit()
}

/** Convenience: open viewer for a single image. */
export function openSingleImage(src: string, label?: string) {
    if (!src) return
    openImageViewer([{ src, label }], 0)
}

export function closeImageViewer() {
    if (state === null) return
    state = null
    emit()
}

function setViewerIndex(index: number) {
    if (!state) return
    state = { ...state, index }
    emit()
}

/** Mount once near the Neura root — renders the viewer modal when open. */
export function NeuraImageViewerHost() {
    const viewer = useSyncExternalStore(subscribe, getSnapshot)
    const handleNavigate = useCallback((i: number) => setViewerIndex(i), [])
    if (!viewer) return null
    return (
        <ImageViewerModal
            images={viewer.images}
            index={viewer.index}
            onClose={closeImageViewer}
            onNavigate={handleNavigate}
        />
    )
}
