/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * Enhanced Palette Component - Matches Leap App Inventor functionality
 */
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PALETTE_ENHANCED } from '../data/paletteComponents_Enhanced';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import ComponentIcon from './ComponentIcon';

export default function PaletteEnhanced({ onAddComponent }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [collapsedCategories, setCollapsedCategories] = useState({});
    const [hoveredComponent, setHoveredComponent] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const hoverTimeoutRef = useRef(null);

    // Group by category
    const categories = PALETTE_ENHANCED.reduce((acc, curr) => {
        if (!acc[curr.category]) acc[curr.category] = [];
        acc[curr.category].push(curr);
        return acc;
    }, {});

    const toggleCategory = (cat) => {
        setCollapsedCategories(prev => ({
            ...prev,
            [cat]: !prev[cat]
        }));
    };

    const handleDragStart = (e, component) => {
        // hide tooltip neatly during drag
        setHoveredComponent(null);
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        e.dataTransfer.setData('componentType', component.type);
        e.dataTransfer.setData('componentData', JSON.stringify(component));
        // Store for touch devices where dataTransfer may not persist
        window.__dragComponent = { type: component.type, data: JSON.stringify(component) };
        e.dataTransfer.effectAllowed = 'copy';

        // Create neat drag preview - centered under cursor, not clipped
        const dragPreview = document.createElement('div');
        dragPreview.className = 'bg-white border border-slate-200 rounded-xl shadow-xl flex items-center gap-2.5 px-3 py-2.5';
        dragPreview.style.position = 'absolute';
        dragPreview.style.top = '-1000px';
        dragPreview.style.left = '-1000px';
        dragPreview.style.pointerEvents = 'none';
        dragPreview.style.whiteSpace = 'nowrap';
        dragPreview.innerHTML = `<div style="width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#f1f5f9;border:1px solid #e2e8f0;font-size:14px">${component.icon}</div> <span style="font-size:11px;font-weight:800;color:#1e293b;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;">${component.label}</span>`;
        document.body.appendChild(dragPreview);
        // center drag image under cursor
        const rect = dragPreview.getBoundingClientRect();
        const offsetX = Math.min(120, Math.max(60, rect.width / 2));
        const offsetY = rect.height / 2;
        try {
            e.dataTransfer.setDragImage(dragPreview, offsetX, offsetY);
        } catch { /* ignore */ }
        setTimeout(() => {
            try { document.body.removeChild(dragPreview); } catch { /* ignore */ }
        }, 0);
    };

    const handleDragEnd = () => {
        window.__dragComponent = null;
    };

    const handleTouchStart = (e, item) => {
        const touch = e.touches[0];
        window.__touchDragComponent = { type: item.type, data: JSON.stringify(item), label: item.label };
        
        const existingGhost = document.getElementById('creova-touch-ghost');
        if (existingGhost) existingGhost.remove();

        const ghost = document.createElement('div');
        ghost.id = 'creova-touch-ghost';
        ghost.style.position = 'fixed';
        ghost.style.left = `${touch.clientX}px`;
        ghost.style.top = `${touch.clientY}px`;
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '99999';
        ghost.style.whiteSpace = 'nowrap';
        ghost.className = 'bg-white border border-slate-200 rounded-xl shadow-xl flex items-center gap-2.5 px-3 py-2 -translate-x-1/2 -translate-y-1/2';
        ghost.innerHTML = `<span style="width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#f1f5f9;border:1px solid #e2e8f0;font-size:13px">${item.icon}</span><span style="font-size:11px;font-weight:800;color:#1e293b;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;">${item.label}</span>`;
        document.body.appendChild(ghost);
    };

    const handleTouchMove = (e) => {
        if (!window.__touchDragComponent) return;
        const touch = e.touches[0];
        const ghost = document.getElementById('creova-touch-ghost');
        if (ghost) {
            ghost.style.left = `${touch.clientX}px`;
            ghost.style.top = `${touch.clientY}px`;
        }
    };

    const handleTouchEnd = (e) => {
        const ghost = document.getElementById('creova-touch-ghost');
        if (ghost) ghost.remove();

        if (!window.__touchDragComponent) return;

        const touch = e.changedTouches[0];
        if (touch) {
            const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
            if (targetElement) {
                const dropEvent = new CustomEvent('creova-touch-drop', {
                    detail: {
                        type: window.__touchDragComponent.type,
                        componentData: window.__touchDragComponent.data,
                        clientX: touch.clientX,
                        clientY: touch.clientY,
                        target: targetElement
                    },
                    bubbles: true
                });
                targetElement.dispatchEvent(dropEvent);
            }
        }

        window.__touchDragComponent = null;
    };

    const handleCardEnter = (e, item) => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        const rect = e.currentTarget.getBoundingClientRect();
        // position tooltip to the right of the palette, vertically centered on card
        // palette is ~300-360px wide, so rect.right + 12 is safely outside
        const x = rect.right + 12;
        let y = rect.top + rect.height / 2;
        // clamp to viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const tooltipW = 288; // w-72
        const tooltipH = 110;
        if (x + tooltipW > vw - 16) {
            // fallback to left side if not enough space (unlikely)
            setTooltipPos({ x: Math.max(12, rect.left - tooltipW - 12), y: Math.min(Math.max(12, y - tooltipH/2), vh - tooltipH - 12) });
        } else {
            y = Math.min(Math.max(12, y - tooltipH/2), vh - tooltipH - 12);
            setTooltipPos({ x, y });
        }
        setHoveredComponent(item);
    };

    const handleCardLeave = () => {
        // small delay to avoid flicker when moving between cards
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => setHoveredComponent(null), 80);
    };

    return (
        <div className="flex flex-col h-full w-full bg-white">
            {/* Header */}
            <div
                style={{ paddingTop: '13px', paddingBottom: '13px', paddingLeft: '24px', paddingRight: '24px' }}
                className="border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm"
            >
                <div className="relative w-full flex items-center">
                    <div style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="pointer-events-none">
                        <Search className="h-4 w-4 text-slate-900" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search modules..."
                        style={{ paddingLeft: '40px', height: '38px', fontSize: '13px', fontWeight: '600' }}
                        className="w-full bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 placeholder:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 shadow-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* Component Categories */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden leap-panel-body" style={{ paddingBottom: '16px' }}>
                {Object.entries(categories).map(([category, items]) => {
                    const filteredItems = items.filter(item =>
                        item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        item.description?.toLowerCase().includes(searchTerm.toLowerCase())
                    );

                    if (filteredItems.length === 0) return null;

                    const isCollapsed = collapsedCategories[category];

                    return (
                        <div key={category} className="mx-3 mt-3 mb-3 rounded-2xl overflow-hidden border-2 border-slate-200 bg-white transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-sm hover:border-blue-500/30 hover:shadow-md hover:-translate-y-0.5">
                            {/* Category Header */}
                            <button
                                style={{ paddingLeft: '40px', paddingRight: '40px', paddingTop: '24px', paddingBottom: '24px' }}
                                className={`flex items-center justify-between w-full cursor-pointer font-black text-sm text-slate-800 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] relative tracking-wide border-b border-transparent hover:bg-gradient-to-b hover:from-slate-50 hover:to-slate-100 hover:text-slate-900 ${!isCollapsed ? 'bg-gradient-to-br from-blue-500/5 to-blue-500/0 text-blue-600 border-b-blue-500/15' : 'bg-gradient-to-b from-white to-slate-50'}`}
                                onClick={() => toggleCategory(category)}
                            >
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${!isCollapsed ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30 scale-100 border-transparent' : 'bg-gradient-to-br from-slate-50 to-slate-100 border-2 border-blue-500/15 text-blue-600'}`}>
                                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    </span>
                                    <span className="tracking-[0.05em] font-extrabold truncate" title={category}>{category}</span>
                                </span>
                                <span className="text-[10px] bg-slate-100 text-slate-900 px-3 py-1 rounded-md font-black shadow-sm border border-slate-200 shrink-0">&nbsp;{filteredItems.length}&nbsp;</span>
                            </button>

                            {/* Category Items — redesigned for readability: single-column, wide cards, no awkward break-all */}
                            {!isCollapsed && (
                                <div className="flex flex-col bg-slate-50/50" style={{ gap: '8px', padding: '12px' }}>
                                    {filteredItems.map(item => (
                                        <div
                                            key={item.type}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, item)}
                                            onDragEnd={handleDragEnd}
                                            onTouchStart={(e) => handleTouchStart(e, item)}
                                            onTouchMove={handleTouchMove}
                                            onTouchEnd={handleTouchEnd}
                                            onClick={() => onAddComponent?.(item.type, {})}
                                            onMouseEnter={(e) => handleCardEnter(e, item)}
                                            onMouseLeave={handleCardLeave}
                                            className="group/item relative flex items-center gap-3 cursor-grab active:cursor-grabbing border border-slate-200 rounded-xl bg-white hover:border-blue-400 hover:bg-blue-50/40 hover:shadow-sm px-3 py-2.5 transition-all duration-200 min-w-0 select-none"
                                        >
                                            <div className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-slate-50 group-hover/item:bg-white border border-slate-100 group-hover/item:border-blue-100 transition-colors">
                                                <ComponentIcon type={item.type} size={20} className="transition-all duration-200 opacity-90 group-hover/item:scale-105" />
                                            </div>
                                            <span
                                                className="flex-1 min-w-0 text-left font-bold text-slate-800 uppercase tracking-wide leading-snug group-hover/item:text-blue-700 transition-colors"
                                                style={{
                                                    fontSize: '11px',
                                                    overflowWrap: 'anywhere',
                                                    wordBreak: 'normal',
                                                    hyphens: 'auto',
                                                    lineHeight: '1.25'
                                                }}
                                            >
                                                {item.label}
                                            </span>

                                            {/* Subtle affordance */}
                                            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-50 group-hover/item:bg-blue-600 flex items-center justify-center text-slate-400 group-hover/item:text-white transition-colors">
                                                <span className="text-[14px] leading-none font-bold">+</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer Info */}
            <div className="p-5 border-t border-slate-200 bg-white text-[12px] font-extrabold text-slate-900 text-center uppercase tracking-[0.15em]">
                {PALETTE_ENHANCED.length} MODULES DETECTED
            </div>

            {/* Portal tooltip — outside overflow-hidden, neatly positioned, not clipped to 'D' */}
            {hoveredComponent && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed z-[9999] w-72 bg-white text-slate-900 text-xs rounded-2xl p-4 shadow-2xl border border-slate-200 pointer-events-none"
                    style={{ left: tooltipPos.x, top: tooltipPos.y }}
                    onMouseEnter={() => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); }}
                    onMouseLeave={handleCardLeave}
                >
                    <div className="font-extrabold mb-1.5 text-blue-600 uppercase tracking-[0.14em] text-[10px] flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(37,99,235,0.6)] shrink-0" />
                        <span className="truncate">{hoveredComponent.label}</span>
                    </div>
                    <div className="text-slate-700 leading-relaxed font-medium text-[12px]">{hoveredComponent.description}</div>
                    {hoveredComponent.visible !== undefined && (
                        <div className="mt-2 text-[11px] text-slate-500 italic">
                            {hoveredComponent.visible ? 'Visible component' : 'Non-visible component'}
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
