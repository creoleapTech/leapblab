import React, { useRef, useState } from 'react'
import { openSingleImage } from './neuraImageViewer'

interface TestPanelProps {
    prediction: { label: string; confidences: Record<string, number> } | null
    isProcessing: boolean
    cameraOn?: boolean
    testImage?: string | null
    videoRef?: React.RefObject<HTMLVideoElement | null>
    canvasRef?: React.RefObject<HTMLCanvasElement | null>
    onCapture?: () => void
    onUpload?: () => void
    onToggleCamera?: () => void
    onReset?: () => void
    onTryAnother?: () => void
    onExport?: () => void
    fileInputRef?: React.RefObject<HTMLInputElement | null>
    onFileChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    projectName?: string
    testsRun?: number
    inferenceTime?: number
    modelLoading?: boolean
    videoFit?: 'cover' | 'contain'
    children?: React.ReactNode
}

export default function TestPanel({
    prediction,
    isProcessing,
    cameraOn = false,
    testImage = null,
    videoRef,
    canvasRef,
    onCapture = () => {},
    onUpload = () => {},
    onToggleCamera = () => {},
    onReset = () => {},
    onTryAnother = () => {},
    onExport = () => {},
    fileInputRef,
    onFileChange = () => {},
    testsRun = 0,
    inferenceTime = 0,
    modelLoading = false,
    videoFit = 'contain',
    children
}: TestPanelProps) {
    if (children) {
        return <LegacyTestPanel prediction={prediction} isProcessing={isProcessing}>{children}</LegacyTestPanel>
    }

    const sortedConfidences = prediction
        ? Object.entries(prediction.confidences).sort(([, a], [, b]) => b - a)
        : []

    const maxConfidence = sortedConfidences.length > 0 ? sortedConfidences[0][1] : 0
    const displayConfidence = Math.round(maxConfidence * 100)

    const getPredictionLabel = () => {
        if (!prediction) return ''
        return prediction.label
    }

    const [isDragging, setIsDragging] = useState(false)

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (!isDragging) setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            if (onFileChange) {
                onFileChange({ target: { files: e.dataTransfer.files } } as any)
            }
        }
    }

    return (
        <div className="animate-fade-in overflow-y-auto neura-scrollbar w-full flex flex-col h-full">
            {/* Tips */}
            <div className="max-w-[800px] w-full mx-auto mb-2.5">
                <div className="bg-gradient-to-br from-[#f5f3ff] to-[#ede9fe] rounded-lg py-2 px-3 border border-[#630ed4]/10">
                    <div className="flex items-start gap-1.5">
                        <div className="w-5 h-5 rounded bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center text-[10px] shrink-0">💡</div>
                        <div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                {['Take clear photos', 'Good lighting helps', 'Try different angles', 'Drag & drop images to test'].map((tip) => (
                                    <span key={tip} className="flex items-center gap-1 text-[10px] text-gray-600">
                                        <span className="w-1 h-1 rounded-full bg-[#630ed4] shrink-0" />
                                        {tip}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
                {/* Left - Camera / Image Dropzone */}
                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`bg-white/85 backdrop-blur-md rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] flex-1 flex flex-col p-3.5 min-w-0 relative transition-all duration-200 ${
                        isDragging ? 'border-2 border-dashed border-[#630ed4]' : 'border border-gray-200'
                    }`}
                >
                    {/* Camera header */}
                    <div className="flex justify-between items-center mb-2.5">
                        <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${cameraOn ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                            <span className="text-[10px] font-bold text-gray-700 tracking-wider uppercase">
                                {cameraOn ? 'Live Feed' : 'Camera Off'}
                            </span>
                        </div>
                        <button
                            onClick={onToggleCamera}
                            className={`py-1.5 px-2.5 rounded-lg text-[11px] font-bold border-none cursor-pointer flex items-center gap-1 transition-all duration-200 ${
                                cameraOn
                                    ? 'bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-600 shadow-[0_2px_8px_rgba(5,150,105,0.15)]'
                                    : 'bg-gradient-to-br from-[#f5f3ff] to-[#ede9fe] text-[#630ed4] shadow-[0_2px_8px_rgba(99,14,212,0.12)]'
                            }`}
                        >
                            <span className="text-xs">{cameraOn ? '📷' : '🚫'}</span>
                            {cameraOn ? ' On' : ' Off'}
                        </button>
                    </div>

                    {/* Camera viewport */}
                    <div className="flex-1 min-h-0 bg-[#1e1b4b] rounded-xl overflow-hidden relative flex items-center justify-center">
                        {/* Drag and Drop Active Overlay */}
                        {isDragging && (
                            <div className="absolute inset-0 z-[35] bg-[#630ed4]/88 backdrop-blur-md rounded-xl flex flex-col items-center justify-center text-white border-2 border-dashed border-[#c084fc] shadow-[0_8px_32px_rgba(99,14,212,0.4)] animate-fade-in p-5 text-center">
                                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-[2.2rem] mb-3 shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
                                    📥
                                </div>
                                <h3 className="text-[1.1rem] font-extrabold mb-1 drop-shadow-md">
                                    Drop Image Here to Test!
                                </h3>
                                <p className="text-[11px] text-white/85 m-0">
                                    PNG, JPG, WEBP formats supported
                                </p>
                            </div>
                        )}

                        {cameraOn && (
                            <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full rounded-2xl -scale-x-100 ${videoFit === 'contain' ? 'object-contain bg-black' : 'object-cover'}`} />
                        )}
                        {!cameraOn && testImage && (
                            <img src={testImage} alt="Test" onClick={() => openSingleImage(testImage, 'Test image')} title="Click to view (80% screen)" className="w-full h-full object-contain cursor-zoom-in" />
                        )}
                        {!cameraOn && !testImage && (
                            <div className="flex flex-col items-center text-center animate-fade-in p-6">
                                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-3">
                                    <span className="text-[1.5rem]">📸</span>
                                </div>
                                <p className="text-[13px] font-extrabold text-white mb-1">Camera is off</p>
                                <p className="text-[10px] text-white/60 max-w-[220px] mb-4 leading-relaxed">
                                    Turn on camera, <strong className="text-white">drag & drop an image here</strong>, or upload a picture
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={onToggleCamera}
                                        className="px-4 py-2 bg-gradient-to-br from-[#630ed4] to-[#7c3aed] text-white rounded-xl text-[11px] font-bold border-none cursor-pointer shadow-[0_4px_12px_rgba(99,14,212,0.25)]"
                                    >
                                        📷 Turn On Camera
                                    </button>
                                    {fileInputRef && (
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="px-4 py-2 bg-white text-[#630ed4] rounded-xl text-[11px] font-bold border-2 border-[#630ed4] cursor-pointer"
                                        >
                                            📂 Upload Image
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Scan line */}
                        {cameraOn && (
                            <div className="absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#630ed4]/60 to-transparent shadow-[0_0_12px_rgba(99,14,212,0.4)] animate-[scan_3s_infinite_ease-in-out]" />
                        )}

                        {/* LIVE indicator */}
                        {cameraOn && (
                            <div className="absolute top-2 left-2 flex items-center gap-1 py-0.75 px-2 bg-black/50 backdrop-blur-md rounded">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
                                <span className="text-white text-[9px] font-bold">LIVE</span>
                            </div>
                        )}

                        {/* Loading overlay - small center badge only */}
                        {(modelLoading || isProcessing) && (
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 py-2.5 px-4.5 bg-white/90 backdrop-blur-md rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.15)] z-20">
                                <div className="w-4 h-4 border-2 border-[#630ed4] border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs font-bold text-gray-900">{modelLoading ? 'Loading model...' : 'Analyzing...'}</span>
                            </div>
                        )}

                        {/* Capture button overlay - visible when camera is on or test image is uploaded */}
                        {(cameraOn || testImage) && (
                            <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-2 py-1.5 px-3 bg-white/85 backdrop-blur-md rounded-xl border border-white/40 shadow-md z-15">
                                {cameraOn && (
                                    <button
                                        onClick={onCapture}
                                        className="flex items-center gap-1 py-1.5 px-3.5 bg-gradient-to-br from-[#630ed4] to-[#7c3aed] text-white rounded-lg text-[11px] font-bold border-none cursor-pointer"
                                    >
                                        <span className="text-xs">📸</span>
                                        Take Photo
                                    </button>
                                )}
                                {fileInputRef && (
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex items-center gap-1 py-1.5 px-3.5 bg-white text-gray-700 rounded-lg text-[11px] font-bold border border-gray-200 cursor-pointer"
                                    >
                                        <span className="text-xs">📂</span>
                                        {testImage ? 'Upload Another' : 'Upload'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
                    <canvas ref={canvasRef} className="hidden" />
                </div>

                {/* Right - Results */}
                <div className="w-full max-w-[280px] shrink-0 flex flex-col gap-2.5">
                    {/* Result card */}
                    <div className="bg-white/85 backdrop-blur-md rounded-2xl border border-gray-200 shadow-[0_2px_12px_rgba(0,0,0,0.04)] p-4 flex-1 flex flex-col items-center justify-center">
                        {prediction ? (
                            <div className="w-full flex flex-col items-center animate-fade-in">
                                {/* Icon */}
                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center mb-3 shadow-[0_4px_16px_rgba(16,185,129,0.15)]">
                                    <span className="text-2xl">🎯</span>
                                </div>

                                {/* Label */}
                                <span className="text-[9px] font-extrabold text-emerald-600 uppercase tracking-widest mb-1 bg-emerald-50 py-0.5 px-2 rounded-md border border-emerald-500/20">
                                    Prediction
                                </span>
                                <h2 className="text-[1.1rem] font-extrabold text-[#131b2e] mb-3 text-center">
                                    It's a <span className="text-[#630ed4]">{getPredictionLabel()}</span>! 🎉
                                </h2>

                                {/* Confidence */}
                                <div className="w-full mb-3.5">
                                    <div className="flex justify-between mb-1">
                                        <span className="text-[10px] font-bold text-gray-500">Confidence</span>
                                        <span className={`text-sm font-extrabold ${displayConfidence >= 50 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                            {displayConfidence}%
                                        </span>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-[width] duration-200 ease-out ${
                                                displayConfidence >= 50 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-amber-400 to-amber-600'
                                            }`}
                                            style={{ width: `${displayConfidence}%` }}
                                        />
                                    </div>
                                </div>

                                {/* All class confidences */}
                                <div className="w-full mb-3.5">
                                    <span className="text-[9px] font-extrabold text-[#630ed4] uppercase tracking-wider block mb-2">
                                        All Class Scores
                                    </span>
                                    <div className="flex flex-col gap-1.5">
                                        {sortedConfidences.map(([label, conf], idx) => {
                                            const pct = Math.round(conf * 100)
                                            const isTop = idx === 0
                                            return (
                                                <div key={label} className={`rounded-lg p-2 ${isTop ? 'bg-[#f5f3ff] border border-[#630ed4]/15' : 'bg-gray-50 border border-gray-100'}`}>
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className={`text-[11px] font-bold capitalize ${isTop ? 'text-[#630ed4]' : 'text-gray-700'}`}>
                                                            {isTop && <span className="mr-1">🏆</span>}
                                                            {label}
                                                        </span>
                                                        <span className={`text-[11px] font-extrabold ${pct >= 50 ? 'text-emerald-600' : pct >= 25 ? 'text-amber-600' : 'text-gray-400'}`}>
                                                            {pct}%
                                                        </span>
                                                    </div>
                                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-[width] duration-200 ease-out ${
                                                                isTop
                                                                    ? 'bg-gradient-to-r from-[#630ed4] to-[#7c3aed]'
                                                                    : pct >= 25
                                                                        ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                                                                        : 'bg-gray-300'
                                                            }`}
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-2 w-full">
                                    <button
                                        onClick={onTryAnother}
                                        className="flex-1 p-2.5 bg-gray-100 text-gray-700 rounded-xl text-[11px] font-bold border border-gray-200 cursor-pointer"
                                    >
                                        🔄 Try Another
                                    </button>
                                    <button
                                        onClick={onExport}
                                        className="flex-1 p-2.5 bg-gradient-to-br from-[#630ed4] to-[#7c3aed] text-white rounded-xl text-[11px] font-bold border-none cursor-pointer shadow-[0_4px_12px_rgba(99,14,212,0.25)]"
                                    >
                                        💾 Save Report
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-5">
                                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3 border-2 border-dashed border-gray-200">
                                    <span className="text-[1.8rem]">🤔</span>
                                </div>
                                <h3 className="text-xs font-extrabold text-gray-900 mb-1 text-center">Awaiting Input</h3>
                                <p className="text-[10px] text-gray-400 text-center max-w-[180px]">
                                    Take a photo or upload an image to test your model
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Stats row */}
                    <div className="flex gap-2.5">
                        <div className="bg-white/85 backdrop-blur-md rounded-2xl border border-gray-200 shadow-[0_2px_12px_rgba(0,0,0,0.04)] flex-1 p-3 flex items-center gap-2">
                            <div className="w-9 h-9 rounded-xl bg-[#f5f3ff] flex items-center justify-center text-base shrink-0">⚡</div>
                            <div>
                                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider block">Speed</span>
                                <span className="text-sm font-extrabold text-[#131b2e]">{inferenceTime}ms</span>
                            </div>
                        </div>
                        <div className="bg-white/85 backdrop-blur-md rounded-2xl border border-gray-200 shadow-[0_2px_12px_rgba(0,0,0,0.04)] flex-1 p-3 flex items-center gap-2">
                            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-base shrink-0">📊</div>
                            <div>
                                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider block">Tests</span>
                                <span className="text-sm font-extrabold text-[#131b2e]">{testsRun}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes scan {
                    0% { top: 0%; }
                    50% { top: calc(100% - 2px); }
                    100% { top: 0%; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}

function LegacyTestPanel({ prediction, isProcessing, children }: { prediction: { label: string; confidences: Record<string, number> } | null; isProcessing: boolean; children: React.ReactNode }) {
    const sortedConfidences = prediction
        ? Object.entries(prediction.confidences).sort(([, a], [, b]) => b - a)
        : []
    const maxConfidence = sortedConfidences.length > 0 ? sortedConfidences[0][1] : 0

    return (
        <div className="max-w-[600px] w-full">
            {children}
            {isProcessing && (
                <div className="flex items-center justify-center gap-2.5 p-5">
                    <div className="w-4 h-4 border-2 border-[#630ed4] border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-bold text-gray-500">Analyzing... 🔍</span>
                </div>
            )}
            {prediction && !isProcessing && (
                <div className="bg-white/85 backdrop-blur-md rounded-2xl p-5 border border-gray-200 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
                    <div className="text-center mb-4">
                        <p className="text-[9px] text-gray-500 uppercase font-bold tracking-widest mb-2">🎯 Prediction</p>
                        <div className="inline-flex items-center gap-2.5 py-2 px-4 bg-gradient-to-br from-[#f5f3ff] to-[#ede9fe] rounded-xl">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#630ed4] to-[#7c3aed] flex items-center justify-center text-white font-bold text-sm">
                                {prediction.label.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-base font-bold text-[#131b2e]">{prediction.label}</span>
                        </div>
                        <div className="flex items-center justify-center gap-1.5 mt-2">
                            <span className="text-xs text-gray-500">Confidence</span>
                            <span className={`text-sm font-extrabold ${maxConfidence >= 0.7 ? 'text-emerald-600' : maxConfidence >= 0.4 ? 'text-amber-600' : 'text-red-600'}`}>
                                {Math.round(maxConfidence * 100)}%
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="rounded-xl border border-[#630ed4]/10 bg-[#f5f3ff] p-3 text-center">
                            <p className="text-[9px] font-extrabold text-[#630ed4] uppercase tracking-wider mb-1">Top Predicted Class</p>
                            <p className="text-base font-bold text-[#131b2e] capitalize">{prediction.label}</p>
                            <p className="text-xs font-bold text-gray-500 mt-1">{Math.round(maxConfidence * 100)}% accuracy</p>
                        </div>
                    </div>
                </div>
            )}
            {!prediction && !isProcessing && (
                <div className="flex flex-col items-center justify-center p-10 flex-1">
                    <div className="w-12 h-12 rounded-full bg-[#f5f3ff] flex items-center justify-center mb-2.5 border-2 border-dashed border-purple-300">
                        <span className="text-xl">🤔</span>
                    </div>
                    <p className="text-xs font-bold text-gray-500">Waiting for input</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Speak into the mic to test! 🎤</p>
                </div>
            )}
        </div>
    )
}
