import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { Sample } from '../../types/neura.types'
import { openImageViewer } from './neuraImageViewer'

interface SampleGridProps {
    samples: Sample[]
    type: 'image' | 'audio' | 'text' | 'keypoints'
    onRemove: (sampleId: string) => void
    onUndo?: (sample: Sample) => void
}

const TYPE_EMOJI: Record<string, string> = {
    image: '🖼️',
    audio: '🎵',
    text: '📝',
    keypoints: '🤸'
}

const TYPE_COLORS: Record<string, string> = {
    image: 'from-[#eaedff] to-[#faf8ff]',
    audio: 'from-[#d1fae5] to-[#ecfdf5]',
    text: 'from-[#dbeafe] to-[#eff6ff]',
    keypoints: 'from-[#fef3c7] to-[#fffbeb]'
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Hand landmark connections for skeleton visualization
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8], // Index
    [0, 9], [9, 10], [10, 11], [11, 12], // Middle
    [0, 13], [13, 14], [14, 15], [15, 16], // Ring
    [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
    [5, 9], [9, 13], [13, 17], // Palm
]

// Pose landmark connections for body skeleton
const POSE_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4], // Right arm
    [0, 5], [5, 6], [6, 7], [7, 8], // Left arm
    [0, 9], [9, 10], [10, 11], [11, 12], // Right leg
    [0, 13], [13, 14], [14, 15], [15, 16], // Left leg
    [0, 17], [17, 18], [18, 19], [19, 20], // Torso
]

function KeypointSkeleton({ data }: { data: string }) {
    try {
        const keypoints = JSON.parse(data)
        if (!Array.isArray(keypoints) || keypoints.length < 5) {
            return <span className="text-xl">🤸</span>
        }

        const isHand = keypoints.length === 21 || keypoints.length === 78
        const connections = isHand ? HAND_CONNECTIONS : POSE_CONNECTIONS

        // Normalize keypoints to 0-1 range
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const kp of keypoints) {
            const x = kp.x ?? kp[0] ?? 0
            const y = kp.y ?? kp[1] ?? 0
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
        const rangeX = maxX - minX || 1
        const rangeY = maxY - minY || 1

        const normalizedKps = keypoints.map((kp) => {
            const x = kp.x ?? kp[0] ?? 0
            const y = kp.y ?? kp[1] ?? 0
            return {
                x: ((x - minX) / rangeX) * 80 + 10,
                y: ((y - minY) / rangeY) * 80 + 10,
            }
        })

        return (
            <svg viewBox="0 0 100 100" className="w-full h-full p-1">
                {/* Draw connections */}
                {connections.map(([i, j], idx) => {
                    if (i >= normalizedKps.length || j >= normalizedKps.length) return null
                    const kp1 = normalizedKps[i]
                    const kp2 = normalizedKps[j]
                    return (
                        <line
                            key={idx}
                            x1={kp1.x}
                            y1={kp1.y}
                            x2={kp2.x}
                            y2={kp2.y}
                            stroke="#f59e0b"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    )
                })}
                {/* Draw keypoints */}
                {normalizedKps.map((kp, idx) => (
                    <circle
                        key={idx}
                        cx={kp.x}
                        cy={kp.y}
                        r="2"
                        fill="#ea580c"
                        stroke="#fff"
                        strokeWidth="0.5"
                    />
                ))}
            </svg>
        )
    } catch {
        return <span className="text-xl">🤸</span>
    }
}

export default function SampleGrid({ samples, type, onRemove, onUndo }: SampleGridProps) {
    const [deletedSample, setDeletedSample] = useState<{ sample: Sample; classId?: string } | null>(null)
    const undoTimerRef = useRef<NodeJS.Timeout | null>(null)

    const handleRemove = useCallback((sample: Sample) => {
        setDeletedSample({ sample })
        onRemove(sample.id)

        if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
        undoTimerRef.current = setTimeout(() => {
            setDeletedSample(null)
        }, 3000)
    }, [onRemove])

    const handleUndo = useCallback(() => {
        if (deletedSample && onUndo) {
            onUndo(deletedSample.sample)
            setDeletedSample(null)
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
        }
    }, [deletedSample, onUndo])

    useEffect(() => {
        return () => {
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
        }
    }, [])

    if (samples.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-6 py-4 bg-[#faf8ff]/50 rounded-xl border-2 border-dashed border-[#ccc3d8]/40 h-full min-h-[80px]">
                <span className="text-2xl mb-2">{TYPE_EMOJI[type]}</span>
                <p className="text-xs font-bold text-[#7b7487]">No samples yet</p>
                <p className="text-[10px] text-slate-400 mt-1">Capture some to teach your AI!</p>
            </div>
        )
    }

    return (
        <div className="relative h-full overflow-y-auto pr-0.5">
            <div className="grid grid-cols-3 gap-1.5">
                {samples.map((sample, index) => (
                    <div
                        key={sample.id}
                        onClick={() => { if (type === 'image' && sample.data) openImageViewer(samples.filter(x => x.data).map((x, xi) => ({ src: x.data, label: `Image ${xi + 1}` })), samples.filter(x => x.data).findIndex(x => x.id === sample.id)) }}
                        title={type === 'image' ? 'Click to view (80% screen)' : undefined}
                        className={`group relative aspect-square rounded-lg overflow-hidden bg-white border border-slate-200 transition-all duration-150 hover:shadow-md hover:scale-[1.02] ${type === 'image' ? 'cursor-zoom-in' : 'cursor-default'}`}
                    >
                        {type === 'image' && (
                            <img
                                src={sample.data}
                                alt={`Sample ${index + 1}`}
                                className="w-full h-full object-cover pointer-events-none"
                                draggable={false}
                            />
                        )}
                        {type === 'audio' && (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-emerald-100 to-emerald-50">
                                <span className="text-xl">🎵</span>
                            </div>
                        )}
                        {type === 'text' && (
                            <div className="w-full h-full flex items-center justify-center p-1.5 bg-gradient-to-br from-blue-100 to-blue-50">
                                <p className="text-[8px] text-slate-600 text-center overflow-hidden">
                                    {sample.data.slice(0, 50)}
                                </p>
                            </div>
                        )}
                        {type === 'keypoints' && (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-amber-100 to-amber-50 relative">
                                <KeypointSkeleton data={sample.data} />
                            </div>
                        )}

                        {type === 'image' && (
                            <span className="absolute bottom-1 right-1 w-5 h-5 rounded-md bg-black/55 text-white hidden group-hover:flex items-center justify-center text-[10px] pointer-events-none">⛶</span>
                        )}

                        {/* Delete button */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                handleRemove(sample)
                            }}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] border-none cursor-pointer shadow-[0_2px_6px_rgba(239,68,68,0.3)] z-10 opacity-90 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-150"
                        >
                            ✕
                        </button>

                        {/* Time badge */}
                        <div className="absolute bottom-0.75 left-0.75 px-1.25 py-0.5 rounded bg-black/55 backdrop-blur-xs z-10 opacity-90 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-150">
                            <span className="text-white text-[8px] font-semibold">
                                {formatTime(sample.timestamp)}
                            </span>
                        </div>

                        {/* Index number */}
                        <div className="absolute top-0.75 left-0.75 w-4 h-4 rounded bg-black/45 backdrop-blur-xs flex items-center justify-center">
                            <span className="text-white text-[8px] font-bold">
                                {index + 1}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Undo toast */}
            {deletedSample && onUndo && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[#131b2e]/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/10">
                        <span className="text-sm">🗑️</span>
                        <span className="text-xs font-semibold text-white">Deleted</span>
                        <button
                            onClick={handleUndo}
                            className="px-2.5 py-1.25 bg-[#630ed4] text-white rounded-lg text-[11px] font-bold border-none cursor-pointer transition-all duration-150 hover:bg-[#520bb2]"
                        >
                            ↩️ Undo
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
