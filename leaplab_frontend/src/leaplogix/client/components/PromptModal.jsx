/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from "react";
import { useLogix } from "../context/LogixContext";
import { X, FilePenLine } from "lucide-react";

export default function PromptModal() {
    const ctx = useLogix();

    if (!ctx.modalState.isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]" onClick={(e) => { if (e.target === e.currentTarget) ctx.handleModalCancel(); }}>
            <div className="bg-white rounded-2xl w-full max-w-[420px] shadow-[0_24px_64px_rgba(0,0,0,0.32),0_8px_24px_rgba(0,0,0,0.18)] overflow-hidden border border-white/80 animate-[logixModalIn_0.22s_ease-out] mx-4">
                <style>{`@keyframes logixModalIn{from{opacity:0;transform:translateY(10px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>

                {/* Header — Logix branded, matches ConfirmModal */}
                <div className="bg-gradient-to-r from-[#0a0a1f] via-[#1a0a8a] to-[#5b21b6] text-white px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center border border-white/20">
                            <span className="text-[11px] font-black tracking-widest">LX</span>
                        </div>
                        <span className="text-[13px] font-bold tracking-wide uppercase opacity-90">LeapLab • Logix</span>
                    </div>
                    <button
                        type="button"
                        onClick={ctx.handleModalCancel}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
                        aria-label="Close"
                    >
                        <X size={14} strokeWidth={2.2} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 pt-6 pb-2 flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center mb-3.5">
                        <FilePenLine size={20} strokeWidth={1.9} />
                    </div>
                    <h3 className="text-[15px] font-bold text-slate-900 leading-tight mb-1.5">
                        {ctx.modalState.title}
                    </h3>
                    <p className="text-[13px] leading-relaxed text-slate-600 max-w-[320px] whitespace-pre-wrap break-words">
                        {ctx.modalState.message}
                    </p>
                </div>

                <div className="px-6 pt-4 pb-2">
                    <input
                        autoFocus
                        type="text"
                        value={ctx.modalInput}
                        onChange={(e) => ctx.setModalInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') ctx.handleModalSubmit(); if (e.key === 'Escape') ctx.handleModalCancel(); }}
                        placeholder="Enter name"
                        className="p-3 text-sm rounded-xl border border-slate-200 w-full outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-300 bg-white shadow-sm font-sans placeholder:text-slate-400"
                    />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-slate-50/70 border-t border-slate-100 mt-4">
                    <button
                        type="button"
                        onClick={ctx.handleModalCancel}
                        className="px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-700 text-[13px] font-semibold hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-all cursor-pointer min-w-[84px]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={ctx.handleModalSubmit}
                        className="px-5 py-2 rounded-full border-0 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-[13px] font-bold shadow-sm shadow-violet-500/20 transition-all cursor-pointer min-w-[92px]"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}
