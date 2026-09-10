import React, { useState, useCallback } from 'react'
import { DATASET_CATEGORIES, getDatasetImagePath, type DatasetCategory, type DatasetSubcategory } from '../../data/imageDatasets'
import type { UseNeuraProjectReturn } from '../../hooks/useNeuraProject'

interface ImageDatasetBrowserProps {
    mode: UseNeuraProjectReturn
    onImagesAdded?: (count: number) => void
}

type ViewState = 'categories' | 'subcategories' | 'confirm'

export default function ImageDatasetBrowser({ mode, onImagesAdded }: ImageDatasetBrowserProps) {
    const [viewState, setViewState] = useState<ViewState>('categories')
    const [selectedCategory, setSelectedCategory] = useState<DatasetCategory | null>(null)
    const [selectedSubcategory, setSelectedSubcategory] = useState<DatasetSubcategory | null>(null)
    const [quantity, setQuantity] = useState(5)
    const [isDownloading, setIsDownloading] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState(0)
    const [downloadComplete, setDownloadComplete] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const selectedClass = mode.getSelectedClass()

    const handleSelectCategory = useCallback((category: DatasetCategory) => {
        setSelectedCategory(category)
        setViewState('subcategories')
        setError(null)
    }, [])

    const handleSelectSubcategory = useCallback((sub: DatasetSubcategory) => {
        setSelectedSubcategory(sub)
        setViewState('confirm')
        setError(null)
    }, [])

    const handleBack = useCallback(() => {
        if (viewState === 'confirm') {
            setViewState('subcategories')
            setSelectedSubcategory(null)
        } else if (viewState === 'subcategories') {
            setViewState('categories')
            setSelectedCategory(null)
        }
        setError(null)
    }, [viewState])

    const handleDownload = useCallback(async () => {
        if (!selectedCategory || !selectedSubcategory || !selectedClass) return

        setIsDownloading(true)
        setDownloadProgress(0)
        setDownloadComplete(false)
        setError(null)

        const imagesToFetch = selectedSubcategory.images.slice(0, quantity)
        let addedCount = 0

        try {
            for (let i = 0; i < imagesToFetch.length; i++) {
                const img = imagesToFetch[i]
                const url = getDatasetImagePath(selectedCategory.id, selectedSubcategory.id, img.filename)

                try {
                    const response = await fetch(url)
                    if (!response.ok) throw new Error(`Failed to fetch ${img.filename}`)

                    const blob = await response.blob()
                    const dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(reader.result as string)
                        reader.onerror = reject
                        reader.readAsDataURL(blob)
                    })

                    const added = mode.addSample(selectedClass.id, {
                        type: 'image',
                        data: dataUrl
                    })

                    if (added) addedCount++
                    else {
                        setError(`"${selectedClass.name}" is full (20 max) – stopped at ${addedCount} images`)
                        break
                    }
                } catch (fetchErr) {
                    console.warn(`[Dataset] Could not fetch ${url}:`, fetchErr)
                    // Generate a placeholder image instead
                    const placeholderUrl = generatePlaceholder(selectedSubcategory.name, selectedSubcategory.color, i + 1)
                    const added = mode.addSample(selectedClass.id, {
                        type: 'image',
                        data: placeholderUrl
                    })
                    if (added) addedCount++
                    else {
                        setError(`"${selectedClass.name}" is full (20 max) – stopped at ${addedCount} images`)
                        break
                    }
                }

                setDownloadProgress(Math.floor(((i + 1) / imagesToFetch.length) * 100))
            }

            setDownloadComplete(true)
            onImagesAdded?.(addedCount)
        } catch (err) {
            setError('Something went wrong while downloading images. Please try again.')
            console.error('[Dataset] Download error:', err)
        } finally {
            setIsDownloading(false)
        }
    }, [selectedCategory, selectedSubcategory, quantity, selectedClass, mode, onImagesAdded])

    const handleReset = useCallback(() => {
        setViewState('categories')
        setSelectedCategory(null)
        setSelectedSubcategory(null)
        setDownloadComplete(false)
        setDownloadProgress(0)
        setError(null)
    }, [])

    if (!selectedClass) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full py-10 px-8 text-center">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#f3f0ff] to-[#ede9fe] flex items-center justify-center mb-6 shadow-lg shadow-purple-600/10 border border-purple-200/50">
                    <span className="text-4xl">📁</span>
                </div>
                <h3 className="text-lg font-extrabold text-[#131b2e] mb-2 tracking-tight">Select a class first</h3>
                <p className="text-sm text-gray-500 leading-relaxed max-w-[260px] font-medium">Choose or create a class in the sidebar, then come back to browse images.</p>
                <div className="mt-6 flex items-center gap-2 py-2.5 px-4 rounded-xl bg-[#f8f7ff] border border-purple-200/60">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#630ed4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
                    <span className="text-xs font-bold text-[#630ed4]">Look in the sidebar</span>
                </div>
            </div>
        )
    }

    // Download complete
    if (downloadComplete) {
        return (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center animate-fade-in">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#d1fae5] to-[#a7f3d0] flex items-center justify-center mb-4 shadow-xs">
                    <span className="text-3xl">✅</span>
                </div>
                <h3 className="text-lg font-extrabold text-[#131b2e] mb-1.5">Images Added!</h3>
                <p className="text-xs text-[#6b7280] mb-1">
                    {quantity} images added to <span className="font-bold" style={{ color: selectedClass.color }}>{selectedClass.name}</span>
                </p>
                <p className="text-[10px] text-[#9ca3af] mb-5">
                    ({selectedClass.samples.length} total images in this class)
                </p>
                <button
                    type="button"
                    onClick={handleReset}
                    className="px-5 py-2.5 bg-[#f3f0ff] text-[#630ed4] rounded-xl text-xs font-bold hover:bg-[#e8e0ff] transition-all cursor-pointer border-none"
                >
                    🔄 Browse More
                </button>
            </div>
        )
    }

    // Confirm & download
    if (viewState === 'confirm' && selectedSubcategory) {
        return (
            <div className="flex flex-col items-center py-6 px-4 animate-fade-in">
                <button type="button" onClick={handleBack} className="self-start mb-4 flex items-center gap-1 text-[11px] font-bold text-[#630ed4] hover:underline bg-transparent border-none cursor-pointer">
                    ← Back
                </button>

                <div className="text-center mb-5">
                    <span className="text-4xl mb-2 block">{selectedSubcategory.emoji}</span>
                    <h3 className="text-base font-extrabold text-[#131b2e] mb-1">{selectedSubcategory.name} Images</h3>
                    <p className="text-[11px] text-[#6b7280]">
                        Adding to: <span className="font-bold" style={{ color: selectedClass.color }}>{selectedClass.name}</span>
                    </p>
                </div>

                {/* Quantity selector */}
                <div className="w-full max-w-[280px] mb-5">
                    <label className="text-[11px] font-bold text-[#4a4455] block mb-2 text-center">How many images?</label>
                    <div className="flex gap-2 justify-center">
                        {[5, 10, 15, 20].map(q => (
                            <button
                                key={q}
                                type="button"
                                onClick={() => setQuantity(q)}
                                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all border-none cursor-pointer ${
                                    quantity === q
                                        ? 'bg-[#630ed4] text-white shadow-md'
                                        : 'bg-[#f3f0ff] text-[#4a4455] hover:bg-[#e8e0ff]'
                                }`}
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Preview grid */}
                <div className="grid grid-cols-5 gap-2 mb-5 w-full max-w-[260px]">
                    {selectedSubcategory.images.slice(0, quantity).map((img, i) => (
                        <div
                            key={i}
                            className="aspect-square rounded-lg overflow-hidden border border-[#e5e7eb]"
                            style={{ backgroundColor: `${selectedSubcategory.color}12` }}
                        >
                            <div className="w-full h-full flex items-center justify-center">
                                <span className="text-base">{selectedSubcategory.emoji}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {error && (
                    <div className="w-full max-w-[280px] bg-[#fef2f2] rounded-xl px-4 py-2.5 mb-4 text-center border border-[#fecaca]">
                        <p className="text-[11px] font-bold text-[#991b1b]">{error}</p>
                    </div>
                )}

                {/* Download button */}
                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="px-6 py-2.5 bg-gradient-to-r from-[#630ed4] to-[#7c3aed] text-white rounded-xl text-xs font-bold hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2 border-none cursor-pointer"
                >
                    {isDownloading ? (
                        <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Downloading... {downloadProgress}%
                        </>
                    ) : (
                        <>📥 Download {quantity} Images</>
                    )}
                </button>

                {/* Progress bar */}
                {isDownloading && (
                    <div className="w-full max-w-[280px] mt-3">
                        <div className="h-1.5 bg-[#e5e7eb] rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-[#630ed4] to-[#7c3aed] rounded-full transition-all duration-300"
                                style={{ width: `${downloadProgress}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // Subcategories view
    if (viewState === 'subcategories' && selectedCategory) {
        return (
            <div className="flex flex-col py-6 px-4 animate-fade-in">
                <button type="button" onClick={handleBack} className="self-start mb-4 flex items-center gap-1 text-[11px] font-bold text-[#630ed4] hover:underline bg-transparent border-none cursor-pointer">
                    ← Back to Categories
                </button>

                <div className="text-center mb-5">
                    <span className="text-3xl mb-2 block">{selectedCategory.emoji}</span>
                    <h3 className="text-base font-extrabold text-[#131b2e] mb-1">{selectedCategory.name}</h3>
                    <p className="text-[11px] text-[#6b7280]">{selectedCategory.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                    {selectedCategory.subcategories.map(sub => (
                        <button
                            key={sub.id}
                            type="button"
                            onClick={() => handleSelectSubcategory(sub)}
                            className="flex flex-col items-center p-3.5 bg-white rounded-xl border border-[#e5e7eb] hover:border-[#630ed4]/30 hover:shadow-md transition-all group cursor-pointer"
                        >
                            <span className="text-2xl mb-1.5 group-hover:scale-110 transition-transform">{sub.emoji}</span>
                            <span className="text-xs font-bold text-[#131b2e]">{sub.name}</span>
                            <span className="text-[10px] text-[#9ca3af]">{sub.images.length} images</span>
                        </button>
                    ))}
                </div>
            </div>
        )
    }

    // Categories view (default)
    return (
        <div className="flex flex-col py-6 px-4 animate-fade-in">
            <div className="text-center mb-5">
                <h3 className="text-base font-extrabold text-[#131b2e] mb-1">📥 Image Dataset</h3>
                <p className="text-[11px] text-[#6b7280]">Browse categories and add images to your class</p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
                {DATASET_CATEGORIES.map(category => (
                    <button
                        key={category.id}
                        type="button"
                        onClick={() => handleSelectCategory(category)}
                        className="flex flex-col items-center p-4 bg-white rounded-xl border border-[#e5e7eb] hover:border-[#630ed4]/30 hover:shadow-md transition-all group cursor-pointer"
                    >
                        <span className="text-3xl mb-1.5 group-hover:scale-110 transition-transform">{category.emoji}</span>
                        <span className="text-xs font-bold text-[#131b2e] mb-0.5">{category.name}</span>
                        <span className="text-[10px] text-[#9ca3af]">{category.subcategories.length} types</span>
                    </button>
                ))}
            </div>
        </div>
    )
}

/**
 * Generate a placeholder image as a data URL when real images aren't available.
 * Creates varied images with different patterns for better visual diversity.
 */
function generatePlaceholder(label: string, color: string, index: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 200
    const ctx = canvas.getContext('2d')!
    if (!ctx) return ''

    const seed = index * 7 + label.length * 13
    const rand = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280

    const palettes = [
        ['#fef3c7', '#fde68a', '#fbbf24'],
        ['#dbeafe', '#bfdbfe', '#60a5fa'],
        ['#dcfce7', '#bbf7d0', '#4ade80'],
        ['#fce7f3', '#fbcfe8', '#f472b6'],
        ['#e0e7ff', '#c7d2fe', '#818cf8'],
        ['#ffedd5', '#fed7aa', '#fb923c'],
        ['#f0fdf4', '#dcfce7', '#22c55e'],
        ['#fdf2f8', '#fce7f3', '#ec4899'],
        ['#f5f3ff', '#ede9fe', '#a78bfa'],
        ['#ecfdf5', '#d1fae5', '#34d399'],
    ]
    const palette = palettes[index % palettes.length]

    ctx.fillStyle = palette[0]
    ctx.fillRect(0, 0, 200, 200)

    ctx.globalAlpha = 0.25
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = palette[1 + (i % 2)]
        const x = rand(i * 3) * 160
        const y = rand(i * 3 + 1) * 160
        const size = 25 + rand(i * 3 + 2) * 70
        const shape = (seed + i) % 3
        if (shape === 0) {
            ctx.beginPath()
            ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
            ctx.fill()
        } else if (shape === 1) {
            ctx.fillRect(x, y, size, size)
        } else {
            ctx.beginPath()
            ctx.moveTo(x + size / 2, y)
            ctx.lineTo(x + size, y + size)
            ctx.lineTo(x, y + size)
            ctx.closePath()
            ctx.fill()
        }
    }
    ctx.globalAlpha = 1

    ctx.save()
    ctx.translate(100, 100)
    ctx.rotate(((rand(20) - 0.5) * 0.15))
    ctx.translate(-100, -100)
    ctx.strokeStyle = palette[2]
    ctx.lineWidth = 3
    ctx.strokeRect(12, 12, 176, 176)
    ctx.restore()

    ctx.fillStyle = palette[2]
    ctx.font = 'bold 28px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label.length > 8 ? label.slice(0, 7) + '..' : label, 100, 80)

    ctx.font = 'bold 16px system-ui, sans-serif'
    ctx.fillStyle = palette[2] + 'AA'
    ctx.fillText(`#${index}`, 100, 112)

    ctx.beginPath()
    ctx.arc(100, 145, 10, 0, Math.PI * 2)
    ctx.fillStyle = palette[2] + '50'
    ctx.fill()

    return canvas.toDataURL('image/jpeg', 0.8)
}
