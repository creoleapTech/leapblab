/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 */
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    Upload, Search, File, Image as ImageIcon, Music, Video,
    Trash2, Eye, Download, FolderOpen, Play, Pause, MoreVertical, Grid, List,
    AlertTriangle, X
} from 'lucide-react';

export default function MediaManager({ appState }) {
    const { media, addMedia, deleteMedia } = appState;
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewFile, setPreviewFile] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef(null);
    const audioRef = useRef(null);
    const dragCounterRef = useRef(0);

    // Register global window drag-and-drop upload handler
    useEffect(() => {
        window.__activeUpload = {
            handler: (files) => {
                const fileList = Array.from(files);
                fileList.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const data = event.target.result;
                        const b64len = data.indexOf(',') >= 0 ? data.length - data.indexOf(',') - 1 : data.length;
                        if (data.length < 50 || b64len < 10) {
                            console.warn('[MEDIA-UPLOAD] File appears empty:', file.name, 'size:', file.size, 'dataLen:', data.length, 'b64Len:', b64len);
                        }
                        addMedia({
                            filename: file.name,
                            type: file.type,
                            size: file.size,
                            data: data,
                            timestamp: Date.now()
                        });
                    };
                    reader.onerror = () => {
                        console.error('[MEDIA-UPLOAD] FileReader error for', file.name, reader.error);
                    };
                    reader.readAsDataURL(file);
                });
            },
            label: 'Media Library'
        };
        return () => { window.__activeUpload = null; };
    }, [addMedia]);

    // Format file size
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Get file extension
    const getFileExtension = (filename) => {
        return filename.split('.').pop().toUpperCase();
    };

    // Get file category for filtering
    const getFileCategory = (type) => {
        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('audio/')) return 'audio';
        if (type.startsWith('video/')) return 'video';
        return 'other';
    };

    // Get icon based on file type
    const getFileIcon = (type, className = "h-6 w-6") => {
        if (type.startsWith('image/')) return <ImageIcon className={className} />;
        if (type.startsWith('audio/')) return <Music className={className} />;
        if (type.startsWith('video/')) return <Video className={className} />;
        return <File className={className} />;
    };

const handleFileUpload = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const data = event.target.result;
                const commaIdx = data.indexOf(',');
                const b64len = commaIdx >= 0 ? data.length - commaIdx - 1 : data.length;
                const b64prefix = commaIdx >= 0 ? data.substring(0, Math.min(commaIdx, 60)) : 'none';
                console.log('[MEDIA-UPLOAD] File:', file.name, '| size:', file.size, '| type:', file.type, '| dataLen:', data.length, '| b64Len:', b64len, '| b64Prefix:', b64prefix);
                if (file.size > 0 && (b64len < 10 || b64len < file.size * 0.1)) {
                    console.warn('[MEDIA-UPLOAD] WARNING: b64 data is suspiciously small for file size', file.name, file.size, b64len);
                }
                addMedia({
                    filename: file.name,
                    type: file.type,
                    size: file.size,
                    data: data,
                    timestamp: Date.now()
                });
            };
            reader.onerror = () => {
                console.error('[MEDIA-UPLOAD] FileReader error for', file.name, reader.error);
            };
            reader.readAsDataURL(file);
        });
e.target.value = null;
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        if (dragCounterRef.current === 1) {
            setIsDragOver(true);
        }
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setIsDragOver(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const data = event.target.result;
                const commaIdx = data.indexOf(',');
                const b64len = commaIdx >= 0 ? data.length - commaIdx - 1 : data.length;
                const b64prefix = commaIdx >= 0 ? data.substring(0, Math.min(commaIdx, 60)) : 'none';
                console.log('[MEDIA-UPLOAD] Drop file:', file.name, '| size:', file.size, '| type:', file.type, '| dataLen:', data.length, '| b64Len:', b64len);
                if (file.size > 0 && (b64len < 10 || b64len < file.size * 0.1)) {
                    console.warn('[MEDIA-UPLOAD] WARNING: b64 data is suspiciously small for file size', file.name, file.size, b64len);
                }
                addMedia({
                    filename: file.name,
                    type: file.type,
                    size: file.size,
                    data: data,
                    timestamp: Date.now()
                });
            };
            reader.onerror = () => {
                console.error('[MEDIA-UPLOAD] FileReader error for', file.name, reader.error);
            };
            reader.readAsDataURL(file);
        });
    };

    const handleDelete = (filename) => {
        setDeleteTarget(filename);
    };

    const confirmDelete = () => {
        if (!deleteTarget) return;
        deleteMedia(deleteTarget);
        if (selectedFile === deleteTarget) setSelectedFile(null);
        if (previewFile?.filename === deleteTarget) setPreviewFile(null);
        setDeleteTarget(null);
    };

    const handleDeleteSelected = () => {
        if (selectedFile) handleDelete(selectedFile);
    };

    const handleDownload = (file) => {
        const link = document.createElement('a');
        link.href = file.data;
        link.download = file.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handlePreview = (file) => {
        setPreviewFile(file);
        setIsPlaying(false);
    };

    const toggleAudio = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const filteredMedia = media.filter(file => {
        const matchesSearch = file.filename.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter = filterType === 'all' || getFileCategory(file.type) === filterType;
        return matchesSearch && matchesFilter;
    });

    const stats = {
        total: media.length,
        totalSize: media.reduce((acc, file) => acc + file.size, 0)
    };

    // Cleanup audio on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
            }
        };
    }, []);

    return (
        <div
            className="flex flex-col h-full bg-white overflow-hidden relative"
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Global drag overlay */}
            {isDragOver && (
                <div className="absolute inset-0 z-50 bg-blue-50/95 border-2 border-dashed border-blue-400 rounded-2xl flex flex-col items-center justify-center pointer-events-none">
                    <div className="p-5 bg-blue-100 rounded-full mb-4">
                        <Upload size={32} className="text-blue-500" />
                    </div>
                    <p className="text-[16px] font-bold text-blue-600 mb-1">Drop files here</p>
                    <p className="text-[12px] text-blue-400 font-medium">Release to upload your assets</p>
                </div>
            )}
            {/* Standardized Header */}
            <div className="py-2.5 px-4 bg-gradient-to-b from-white to-slate-50 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between shrink-0 shadow-sm">
                <span className="text-[16px] font-bold uppercase tracking-[0.08em] text-slate-900">Media</span>
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full text-[11px] font-extrabold uppercase tracking-wide shadow-sm hover:shadow-md transition-all active:scale-95 cursor-pointer"
                    title="Upload Media"
                >
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                </button>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,audio/*,video/*,.txt,.json,.csv,.xml"
                onChange={handleFileUpload}
                className="hidden"
            />

            {/* Primary Upload Action — always visible without scrolling (UI Improvement) */}
            <div className="px-3 pt-3 pb-3 bg-white border-b border-slate-100 shrink-0">
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-sm hover:shadow-md hover:-translate-y-px transition-all active:scale-[0.98] cursor-pointer"
                >
                    <Upload size={14} strokeWidth={2.5} />
                    Browse Files
                </button>
                <p className="text-[10px] text-center text-slate-400 font-medium mt-1.5 tracking-wide">or drag &amp; drop files here</p>
            </div>

            {/* Search and Filters Section - Refined Spacing */}
            <div className="p-3 flex flex-col gap-2.5 bg-white border-b border-slate-100 shrink-0">
                {/* Search Bar */}
                <div className="relative group">
                    <Search className="w-4.5 h-4.5 absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-900 group-focus-within:text-blue-600 transition-colors" />
                    <input
                        type="text"
                        placeholder="Search assets..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10.5 pr-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-400 bg-slate-50/30 transition-all placeholder:text-slate-900 font-bold tracking-wide"
                    />
                </div>

                {/* Filter Tabs - Precise Pill Style (Non-Scrollable, Wrapping) */}
                <div className="flex gap-2 flex-wrap pb-0.5">
                    {['all', 'image', 'audio', 'video'].map((type) => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`flex-shrink-0 rounded-full uppercase tracking-[0.07em] transition-all duration-200 cursor-pointer text-[10px] font-black px-2.5 py-1.5 ${filterType === type
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'bg-slate-50 text-slate-900 hover:bg-slate-100 hover:text-slate-950'
                                }`}
                        >
                            {type}
                        </button>
                    ))}
                </div>

                {/* View Mode Toggle */}
                <div className="flex justify-between items-center pt-2.5 border-t border-slate-100">
                    <div className="text-[11px] font-black text-slate-900 uppercase tracking-[0.1em] pl-2">
                        {filteredMedia.length} {filteredMedia.length === 1 ? 'Asset' : 'Assets'}
                    </div>
                    <div className="flex gap-1 bg-slate-50 p-1 rounded-lg">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`rounded-md transition-all duration-200 cursor-pointer text-[11px] font-extrabold px-3 py-1.25 ${viewMode === 'grid'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-900 hover:text-slate-950'
                                }`}
                        >
                            Grid
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`rounded-md transition-all duration-200 cursor-pointer text-[11px] font-extrabold px-3 py-1.25 ${viewMode === 'list'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-900 hover:text-slate-950'
                                }`}
                        >
                            List
                        </button>
                    </div>
                </div>
            </div>

            {/* Media Grid/List */}
            <div className="flex-1 bg-white leap-panel-body overflow-y-auto overflow-x-hidden">
                {filteredMedia.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-full px-4 py-6 transition-all duration-300">
                        {/* Icon */}
                        <div className={`relative mb-3 transition-transform duration-300 ${isDragOver ? 'scale-110' : ''}`}>
                            <div className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-300 ${isDragOver ? 'bg-gradient-to-br from-blue-100 to-blue-200 border border-blue-300' : 'bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200'}`}>
                                <FolderOpen className={`w-5 h-5 transition-colors duration-300 ${isDragOver ? 'text-blue-500' : 'text-slate-400'}`} strokeWidth={1.5} />
                            </div>
                        </div>

                        {/* Text */}
                        {isDragOver ? (
                            <div className="text-center">
                                <p className="text-[13px] font-bold text-blue-600 mb-0.5">Drop your files here</p>
                                <p className="text-[11px] text-blue-400 font-medium">Release to upload</p>
                            </div>
                        ) : (
                            <div className="text-center flex flex-col items-center">
                                <p className="text-xs font-bold text-slate-700 mb-0.5">No Assets Yet</p>
                                <p className="text-[11px] text-slate-400 font-medium mb-3 max-w-[200px] leading-snug">
                                    {searchTerm ? 'Try different search terms' : 'Drag files here or click below to upload'}
                                </p>
                                {!searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all border-none cursor-pointer mb-2"
                                    >
                                        <Upload size={12} strokeWidth={2.5} />
                                        Browse Files
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    viewMode === 'grid' ? (
                        <div className={`grid grid-cols-2 gap-3 transition-all duration-200 ${isDragOver ? 'bg-blue-50 border-2 border-dashed border-blue-400 rounded-2xl p-4' : 'px-4 pb-4 pt-2'}`}>
                            {isDragOver && (
                                <div className="col-span-2 flex flex-col items-center justify-center py-8 text-blue-500">
                                    <Upload size={24} className="mb-2 animate-bounce" />
                                    <p className="text-[13px] font-semibold">Drop files to upload</p>
                                </div>
                            )}
                            {filteredMedia.map((item, index) => (
                                <div
                                    key={index}
                                    className={`group flex flex-col rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 bg-white ${selectedFile === item.filename
                                        ? 'border-blue-500 ring-2 ring-blue-500/10 shadow-sm'
                                        : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'
                                        }`}
                                    onClick={() => setSelectedFile(item.filename)}
                                >
                                    {/* Thumbnail container */}
                                    <div className="w-full aspect-[4/3] bg-slate-50 flex items-center justify-center overflow-hidden border-b border-slate-50 relative">
                                        {getFileCategory(item.type) === 'image' ? (
                                            <img
                                                src={item.data}
                                                alt={item.filename}
                                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                            />
                                        ) : (
                                            <div className="text-slate-500 group-hover:text-blue-600 transition-colors">
                                                {getFileIcon(item.type, 'h-8 w-8')}
                                            </div>
                                        )}

                                        {/* Hover actions panel overlay */}
                                        <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 p-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePreview(item);
                                                }}
                                                className="w-8 h-8 flex items-center justify-center bg-white hover:bg-slate-100 rounded-full text-slate-700 transition-all cursor-pointer shadow active:scale-90"
                                                title="Preview"
                                            >
                                                <Eye size={15} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDownload(item);
                                                }}
                                                className="w-8 h-8 flex items-center justify-center bg-white hover:bg-slate-100 rounded-full text-slate-700 transition-all cursor-pointer shadow active:scale-90"
                                                title="Download"
                                            >
                                                <Download size={15} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(item.filename);
                                                }}
                                                className="w-8 h-8 flex items-center justify-center bg-rose-500 hover:bg-rose-600 rounded-full text-white transition-all cursor-pointer shadow active:scale-90"
                                                title="Delete"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Dedicated text block */}
                                    <div className="px-3 py-2.5 flex flex-col items-center gap-1 bg-white min-w-0">
                                        <div className="text-[11px] font-bold text-slate-700 truncate w-full text-center" title={item.filename}>
                                            {item.filename}
                                        </div>
                                        <div className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider text-center">
                                            {formatFileSize(item.size)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={`space-y-2.5 transition-all duration-200 ${isDragOver ? 'bg-blue-50 border-2 border-dashed border-blue-400 rounded-2xl p-4' : 'px-4 pb-4 pt-2'}`}>
                            {isDragOver && (
                                <div className="flex flex-col items-center justify-center py-6 text-blue-500">
                                    <Upload size={24} className="mb-2 animate-bounce" />
                                    <p className="text-[13px] font-semibold">Drop files to upload</p>
                                </div>
                            )}
                            {filteredMedia.map((item, index) => (
                                <div
                                    key={index}
                                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 cursor-pointer ${selectedFile === item.filename
                                        ? 'bg-blue-50/50 border-blue-200/50 shadow-sm'
                                        : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50/30'
                                        }`}
                                    onClick={() => setSelectedFile(item.filename)}
                                >
                                    <div className="w-12 h-12 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0 border border-slate-100 overflow-hidden">
                                        {getFileCategory(item.type) === 'image' ? (
                                            <img src={item.data} className="w-full h-full object-cover" />
                                        ) : getFileIcon(item.type, 'h-6 w-6 text-slate-900')}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-extrabold text-slate-700 truncate">{item.filename}</div>
                                        <div className="text-[10px] font-black text-slate-900 uppercase tracking-widest mt-1">
                                            {formatFileSize(item.size)} • {getFileExtension(item.filename)}
                                        </div>
                                    </div>
                                    <div className="flex gap-1.5">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handlePreview(item);
                                            }}
                                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-900 transition-colors"
                                        >
                                            <Eye className="w-4.5 h-4.5" />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(item.filename);
                                            }}
                                            className="p-2 hover:bg-red-50 rounded-lg text-red-400 transition-colors"
                                        >
                                            <Trash2 className="w-4.5 h-4.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                )}
            </div>

            {/* Stats Footer - Standardized Pro Style */}
            {media.length > 0 && (
                <div className="pt-2 px-3 pb-3 border-t border-slate-100 bg-slate-50/30 shrink-0">
                    <div className="flex gap-2">
                        <div className="flex-1 relative overflow-hidden border border-slate-200/60 rounded-xl bg-white hover:shadow-sm hover:border-slate-300/80 transition-all duration-300 text-center py-1.5 px-2">
                            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5 leading-none">Total Files</div>
                            <div className="text-sm font-black text-slate-800 leading-tight">{stats.total}</div>
                        </div>
                        <div className="flex-1 relative overflow-hidden border border-slate-200/60 rounded-xl bg-white hover:shadow-sm hover:border-slate-300/80 transition-all duration-300 text-center py-1.5 px-2">
                            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5 leading-none">Total Size</div>
                            <div className="text-sm font-black text-slate-800 leading-tight">{formatFileSize(stats.totalSize)}</div>
                        </div>
                    </div>
                    {selectedFile && (
                        <button
                            onClick={handleDeleteSelected}
                            className="w-full h-8 mt-2 px-4 bg-red-500 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl transition-all duration-200 shadow-md shadow-red-500/10 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                            <Trash2 className="w-3.25 h-3.25" />
                            Delete Selected
                        </button>
                    )}
                </div>
            )}
            {/* Preview Modal */}
            {previewFile && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/75">
                    <div className="relative w-full max-w-2xl max-h-[calc(100vh-2rem)] md:max-h-[90vh] flex flex-col bg-white rounded-[28px] overflow-hidden shadow-2xl">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 flex items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100/50 shadow-sm shrink-0">
                                    {getFileIcon(previewFile.type, "h-5 w-5")}
                                </div>
                                <div className="text-left min-w-0">
                                    <div className="text-[15px] font-black text-slate-800 tracking-tight leading-none truncate">{previewFile.filename}</div>
                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1.5">{formatFileSize(previewFile.size)}</div>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setPreviewFile(null);
                                    setIsPlaying(false);
                                }}
                                className="w-9 h-9 flex items-center justify-center bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-500 hover:text-slate-800 rounded-full transition-all border border-slate-100 cursor-pointer shrink-0 ml-3"
                                title="Close"
                            >
                                <X className="h-4 w-4 text-slate-900" />
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 bg-slate-950 flex items-center justify-center p-6">
                            {getFileCategory(previewFile.type) === 'image' && (
                                <img src={previewFile.data} className="max-w-full max-h-[45vh] rounded-xl shadow-lg object-contain" alt="Preview" />
                            )}
                            {getFileCategory(previewFile.type) === 'audio' && (
                                <div className="flex flex-col items-center gap-8 w-full max-w-sm">
                                    <div className={`p-10 rounded-full bg-white shadow-xl transition-transform duration-500 ${isPlaying ? 'scale-110' : 'scale-100'}`}>
                                        <Music className={`h-16 w-16 ${isPlaying ? 'text-blue-600' : 'text-slate-900'}`} />
                                    </div>
                                    <audio
                                        ref={audioRef}
                                        src={previewFile.data}
                                        onEnded={() => setIsPlaying(false)}
                                        className="hidden"
                                    />
                                    <div className="flex items-center gap-6">
                                        <button
                                            onClick={toggleAudio}
                                            className="p-5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl shadow-blue-500/30 transition-all active:scale-95"
                                        >
                                            {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {getFileCategory(previewFile.type) === 'video' && (
                                <div className="relative rounded-xl overflow-hidden shadow-lg border border-white/10 bg-black flex items-center justify-center max-w-full max-h-[45vh]">
                                    <video src={previewFile.data} controls className="max-w-full max-h-[45vh] object-contain" />
                                </div>
                            )}
                            {getFileCategory(previewFile.type) === 'other' && (
                                <div className="text-center">
                                    <File className="h-20 w-20 text-slate-900 mx-auto mb-4" />
                                    <p className="text-slate-900 font-medium">No visual preview available</p>
                                </div>
                            )}
                        </div>

                        <div className="p-7 px-6 flex justify-end gap-3 items-center bg-slate-50 border-t border-slate-200 shrink-0">
                            <button
                                onClick={() => setPreviewFile(null)}
                                className="min-w-[120px] py-3.5 px-7 inline-flex items-center justify-center rounded-xl font-extrabold text-sm transition-all border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            >
                                Close
                            </button>
                            <button
                                onClick={() => handleDownload(previewFile)}
                                className="min-w-[150px] py-3.5 px-7 inline-flex items-center justify-center gap-2.5 rounded-xl font-extrabold text-sm transition-all border-none bg-indigo-600 text-white cursor-pointer shadow-[0_4px_12px_rgba(79,70,229,0.25)] hover:bg-indigo-700 hover:shadow-[0_6px_16px_rgba(79,70,229,0.3)]"
                            >
                                <Download className="h-5 w-5" />
                                <span>Download File</span>
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {deleteTarget && createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/70"
                    onClick={() => setDeleteTarget(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-[420px] max-w-[90vw] m-auto flex flex-col overflow-hidden border border-slate-100"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="pt-6 px-6 pb-3 flex items-center justify-between bg-white shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-500 border border-rose-200 flex items-center justify-center shrink-0">
                                    <AlertTriangle className="w-5.5 h-5.5" />
                                </div>
                                <span className="text-lg font-black text-slate-800 tracking-tight">Delete Asset</span>
                            </div>
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 border border-slate-200 bg-transparent hover:bg-slate-100 hover:text-slate-800 transition-all cursor-pointer shrink-0 ml-3"
                                title="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="py-2 px-6 pb-5">
                            <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center overflow-hidden border border-slate-200 shrink-0">
                                    {(media.find(m => m.filename === deleteTarget)?.type || '').startsWith('image/') ? (
                                        <img src={media.find(m => m.filename === deleteTarget)?.data} className="w-full h-full object-cover" />
                                    ) : (
                                        <File className="w-6 h-6 text-rose-500" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-extrabold text-slate-800 truncate max-w-[240px] leading-tight">{deleteTarget}</div>
                                    <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mt-1">
                                        {media.find(m => m.filename === deleteTarget)?.type || 'Unknown'}
                                    </div>
                                </div>
                            </div>
                            <p className="mt-3.5 text-xs text-slate-500 font-medium leading-relaxed">
                                Are you sure you want to delete this asset? This action <span className="font-extrabold text-rose-500">cannot be undone</span>. All references to this file will break.
                            </p>
                        </div>

                        {/* Footer */}
                        <div className="p-7 px-6 flex justify-end gap-3 items-center bg-slate-50 border-t border-slate-200 shrink-0">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="min-w-[120px] py-3.5 px-7 inline-flex items-center justify-center rounded-xl font-extrabold text-sm transition-all border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="min-w-[130px] py-3.5 px-7 inline-flex items-center justify-center gap-2.5 rounded-xl font-extrabold text-sm transition-all border-none bg-rose-600 text-white cursor-pointer shadow-[0_4px_12px_rgba(225,29,72,0.25)] hover:bg-rose-700 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(225,29,72,0.3)]"
                            >
                                <Trash2 className="w-4.5 h-4.5" />
                                <span>Delete</span>
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}