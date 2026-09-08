import React, { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface ViewerImage {
    src: string
    label?: string
}

interface ImageViewerModalProps {
    images: ViewerImage[]
    index: number
    onClose: () => void
    onNavigate?: (index: number) => void
}

/**
 * 80%-viewport image viewer for Neura folders/samples.
 * Clicking any folder image opens this modal at 80vw x 80vh.
 */
export default function ImageViewerModal({ images, index, onClose, onNavigate }: ImageViewerModalProps) {
    const safeIndex = images.length === 0 ? 0 : Math.min(Math.max(index, 0), images.length - 1)
    const current = images[safeIndex]

    const goPrev = useCallback(() => {
        if (images.length < 2) return
        onNavigate?.((safeIndex - 1 + images.length) % images.length)
    }, [images.length, safeIndex, onNavigate])

    const goNext = useCallback(() => {
        if (images.length < 2) return
        onNavigate?.((safeIndex + 1) % images.length)
    }, [images.length, safeIndex, onNavigate])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowLeft') goPrev()
            if (e.key === 'ArrowRight') goNext()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose, goPrev, goNext])

    // Lock background scroll while open
    useEffect(() => {
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.body.style.overflow = prev }
    }, [])

    if (!current) return null

    return createPortal(
        <div
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Image viewer"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-md" />
            {/* 80% screen viewer */}
            <div
                className="relative flex flex-col overflow-hidden rounded-2xl bg-slate-950 shadow-2xl border border-white/10"
                style={{ width: '80vw', height: '80vh', maxWidth: '80vw', maxHeight: '80vh' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border-b border-white/10 shrink-0">
                    <span className="text-base">🖼️</span>
                    <p className="flex-1 min-w-0 text-[13px] font-bold text-white truncate">
                        {current.label || `Image ${safeIndex + 1}`}
                    </p>
                    {images.length > 1 && (
                        <span className="text-[11px] font-bold text-slate-400 bg-white/10 px-2 py-0.5 rounded-full shrink-0">
                            {safeIndex + 1} / {images.length}
                        </span>
                    )}
                    <button
                        onClick={onClose}
                        title="Close (Esc)"
                        className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold border-none cursor-pointer transition-colors shrink-0"
                    >
                        ✕
                    </button>
                </div>

                {/* Image area */}
                <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black">
                    <img
                        src={current.src}
                        alt={current.label || `Image ${safeIndex + 1}`}
                        className="max-w-full max-h-full object-contain select-none"
                        draggable={false}
                    />
                    {images.length > 1 && (
                        <>
                            <button
                                onClick={goPrev}
                                title="Previous (←)"
                                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-lg border border-white/20 cursor-pointer backdrop-blur-sm transition-colors"
                            >
                                ‹
                            </button>
                            <button
                                onClick={goNext}
                                title="Next (→)"
                                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-lg border border-white/20 cursor-pointer backdrop-blur-sm transition-colors"
                            >
                                ›
                            </button>
                        </>
                    )}
                </div>

                {/* Footer strip (thumbnails when multiple) */}
                {images.length > 1 && (
                    <div className="shrink-0 px-3 py-2 bg-slate-900 border-t border-white/10">
                        <div className="flex items-center gap-1.5 overflow-x-auto neura-scrollbar">
                            {images.map((img, i) => (
                                <button
                                    key={i}
                                    onClick={() => onNavigate?.(i)}
                                    title={img.label || `Image ${i + 1}`}
                                    className={`shrink-0 w-11 h-11 rounded-lg overflow-hidden border-2 transition-all cursor-pointer p-0 bg-black ${i === safeIndex ? 'border-violet-400 shadow-md scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}
                                >
                                    <img src={img.src} alt="" className="w-full h-full object-cover" draggable={false} />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    )
}
