/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useRef, useEffect } from "react";
import { Home, Play, Square, Undo, Redo, Save, Download, Settings, Plus, File, FileCode2, FileText, Share, ChevronDown, FolderOpen, Menu as MenuIcon, Code, Monitor, Rocket } from "lucide-react";
import Logo, { CreoleapLogo } from "../../../components/Logo";
import { useLogix } from "../context/LogixContext";
import LeapLabAuthButton from "../../../auth/LeapLabAuthButton";
import TopbarShareButton from "../../../components/common/TopbarShareButton";
import ProjectNameInput from "../../../components/common/ProjectNameInput";
import ModeSwitcher from "../../../components/common/ModeSwitcher";
import ActionButton from "../../../components/common/ActionButton";
import { useWindowWidth } from "../../../hooks/useWindowWidth";
import MobileDrawer from "../../../components/common/MobileDrawer";

function DropdownMenu({ label, icon: Icon, items, isOpen, onToggle, onClose }) {
    const menuRef = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) onCloseRef.current();
        };
        const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside, true), 0);
        return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClickOutside, true); };
    }, [isOpen]);

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={onToggle}
                className={`flex items-center gap-1.5 px-4 py-2 border-0 text-white text-sm font-semibold rounded-full transition-all tracking-wide cursor-pointer ${
                    isOpen ? 'bg-white/20 backdrop-blur-xs' : 'bg-transparent hover:bg-white/10'
                }`}
            >
                {Icon && <Icon size={16} strokeWidth={2.2} className="opacity-90" />}
                {label}
                <ChevronDown size={14} strokeWidth={2.5} className={`opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`} />
            </button>
            {isOpen && (
                <div className="absolute top-full mt-1.5 left-0 bg-white/90 backdrop-blur-xl rounded-xl shadow-2xl border border-white/60 min-w-[200px] overflow-hidden z-[1000] py-1.5 animate-[logixMenuSlideIn_0.18s_ease-out]">
                    <style>{`
                        @keyframes logixMenuSlideIn {
                            from { opacity: 0; transform: translateY(-6px) scale(0.98); }
                            to { opacity: 1; transform: translateY(0) scale(1); }
                        }
                    `}</style>
                    {items.map((item, idx) => (
                        item.divider ? (
                            <div key={idx} className="h-px bg-gradient-to-r from-transparent via-black/10 to-transparent my-1.5 mx-3" />
                        ) : (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => { item.onClick?.(); onClose(); }}
                                disabled={item.disabled}
                                className={`flex items-center gap-2.5 w-full px-3.5 py-2 border-0 text-sm font-medium text-left transition-all tracking-normal ${
                                    item.disabled
                                        ? 'cursor-not-allowed text-gray-300 bg-transparent'
                                        : 'cursor-pointer text-gray-700 bg-transparent hover:bg-purple-100/60 hover:text-purple-700'
                                }`}
                            >
                                {item.icon && <item.icon size={16} strokeWidth={2} className="text-purple-600 opacity-85 shrink-0" />}
                                <span className="flex-1">{item.label}</span>
                                {item.shortcut && (
                                    <span className="text-xs text-gray-400 font-medium bg-black/5 px-1.5 py-0.5 rounded font-mono">{item.shortcut}</span>
                                )}
                            </button>
                        )
                    ))}
                </div>
            )}
        </div>
    );
}

export default function TopBar() {
    const ctx = useLogix();
    const [openMenuId, setOpenMenuId] = useState(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const mobileMenuRef = useRef(null);

    const [showMenuItems, setShowMenuItems] = useState(window.innerWidth >= 1100);
    const windowWidth = useWindowWidth();
    const showDesktopMenus = windowWidth >= 1710;

    useEffect(() => {
        const handleResize = () => {
            setShowMenuItems(window.innerWidth >= 1100);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (!mobileMenuOpen) return;
        const handleClickOutside = (e) => {
            if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
                setMobileMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside, true);
        return () => document.removeEventListener('mousedown', handleClickOutside, true);
    }, [mobileMenuOpen]);

    return (
        <TopbarShareButton size={18} onSave={ctx.handleSaveProject} projectName={ctx.projectName}>
            {({ onClick: handleShareClick, loading: shareLoading }) => (
                <>
                <header className="sticky top-0 h-[68px] bg-gradient-to-r from-[#0a0a1f] via-[#0a015a] to-[#080a25] flex items-center px-3 sm:px-6 justify-between text-white z-[1000] shrink-0 flex-nowrap shadow-[0_4px_20px_rgba(8,10,37,0.5),inset_0_-1px_0_rgba(255,255,255,0.06)] border-b border-sky-400/10">
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        <button onClick={() => {
                            sessionStorage.setItem('landingActiveTab', 'modules');
                            sessionStorage.removeItem('myProjectsSelectedMode');
                            ctx.onBack(false);
                        }} className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 bg-white/10 border border-white/10 rounded-xl text-white cursor-pointer transition-all shrink-0 hover:bg-white/20" title="Back to Home">
                            <Home size={18} strokeWidth={2.2} />
                        </button>
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0 cursor-pointer" onClick={() => {
                            sessionStorage.setItem('landingActiveTab', 'modules');
                            sessionStorage.removeItem('myProjectsSelectedMode');
                            ctx.onBack(false);
                        }}>
                            <Logo height={48} className="w-auto" />
                            <span className="hidden sm:inline text-white text-[16px] sm:text-[18px] lg:text-[22px] font-black tracking-[0.08em] font-sans border-l border-white/15 pl-1.5 sm:pl-2 whitespace-nowrap">LOGIX</span>
                        </div>

                        {windowWidth >= 768 && (
                            <>
                                <div className="h-8 w-px bg-white/15 mx-1" />

                                <DropdownMenu label="File" isOpen={openMenuId === 'file'} onToggle={() => setOpenMenuId(openMenuId === 'file' ? null : 'file')} onClose={() => setOpenMenuId(null)}
                                    items={[
                                        { label: 'New Project', icon: File, onClick: ctx.handleNewProject, shortcut: 'Ctrl+N' },
                                        { label: 'Open from your computer', icon: FolderOpen, onClick: ctx.handleOpenProject, shortcut: 'Ctrl+O' },
                                        { label: 'Open Python File', icon: FileCode2, onClick: ctx.handleOpenPythonFile },
                                        { divider: true },
                                        { label: 'Save to your computer', icon: Save, onClick: ctx.handleSaveProject, shortcut: 'Ctrl+S' },
                                        { label: 'Download .leap file', icon: Download, onClick: ctx.handleDownloadProject },
                                        { divider: true },
                                        { label: 'Share', icon: Share, onClick: () => { setOpenMenuId(null); handleShareClick(); } },
                                        { divider: true },
                                        {
                                            label: 'My Projects',
                                            icon: FolderOpen,
                                            onClick: () => {
                                                sessionStorage.setItem('landingActiveTab', 'my-projects');
                                                sessionStorage.setItem('myProjectsSelectedMode', 'python');
                                                ctx.onBack(false);
                                            }
                                        }
                                    ]} />

                                <DropdownMenu label="Edit" isOpen={openMenuId === 'edit'} onToggle={() => setOpenMenuId(openMenuId === 'edit' ? null : 'edit')} onClose={() => setOpenMenuId(null)}
                                    items={[
                                        { label: 'Undo', icon: Undo, shortcut: 'Ctrl+Z', onClick: () => ctx.editorRef.current?.trigger('keyboard', 'undo', null) },
                                        { label: 'Redo', icon: Redo, shortcut: 'Ctrl+Y', onClick: () => ctx.editorRef.current?.trigger('keyboard', 'redo', null) },
                                    ]} />

                                {windowWidth >= 1400 && ctx.workflowMode === "upload" && ["Board", "Connect"].map((menuLabel) => (
                                    <button key={menuLabel}
                                        className="bg-transparent border-none text-white font-sans text-[15px] font-medium cursor-pointer opacity-90 px-2 py-1.5 rounded-md transition-all hover:bg-white/10"
                                        onClick={() => {
                                            if (menuLabel === "Board") ctx.setIsBoardModalOpen(true);
                                            if (menuLabel === "Connect") ctx.handleConnectToBoard();
                                        }}>
                                        {menuLabel}
                                    </button>
                                ))}
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 flex-1 justify-end min-w-0">
                        <div className="shrink min-w-0">
                            <ProjectNameInput
                                value={ctx.projectName}
                                onChange={ctx.setProjectName}
                                onSave={ctx.handleSaveProject}
                            />
                        </div>

                        {/* RUN / STOP BUTTON — only in IDE and Stage modes */}
                        {ctx.workflowMode !== 'upload' && (
                            ctx.isRunning ? (
                                <ActionButton
                                    variant="danger"
                                    icon={<Square size={12} fill="#fff" stroke="none" />}
                                    label={windowWidth < 520 ? "" : "Stop"}
                                    onClick={ctx.handleStop}
                                    title="Stop (Escape)"
                                />
                            ) : (
                                <ActionButton
                                    variant="success"
                                    icon={<Play size={12} fill="#fff" stroke="none" />}
                                    label={windowWidth < 520 ? "" : "Run"}
                                    onClick={ctx.handleRun}
                                    title="Run Code (Ctrl+Enter or F5)"
                                />
                            )
                        )}

                        {windowWidth >= 1000 && (
                            <ModeSwitcher
                                modes={[
                                    { id: 'ide', label: 'IDE', icon: <Code size={13} strokeWidth={2} />, activeIcon: <Code size={13} strokeWidth={2.5} fill="currentColor" /> },
                                    { id: 'stage', label: 'Stage', icon: <Monitor size={13} strokeWidth={2} />, activeIcon: <Monitor size={13} strokeWidth={2.5} fill="currentColor" /> },
                                    { id: 'upload', label: 'Upload', icon: <Rocket size={13} strokeWidth={2} />, activeIcon: <Rocket size={13} strokeWidth={2.5} fill="currentColor" /> },
                                ]}
                                activeMode={ctx.workflowMode}
                                onChange={ctx.setWorkflowMode}
                            />
                        )}

                        {windowWidth >= 1200 && (
                            <button
                                type="button"
                                title="Share project"
                                onClick={handleShareClick}
                                disabled={shareLoading}
                                className="bg-transparent border-none text-white/70 cursor-pointer px-2 py-1.5 rounded-md flex items-center transition-all hover:text-white shrink-0"
                            >
                                {shareLoading ? (
                                    <span className="inline-block rounded-full border-2 border-current border-t-transparent animate-spin w-4.5 h-4.5" />
                                ) : (
                                    <Share size={18} strokeWidth={2.2} />
                                )}
                            </button>
                        )}

                        {windowWidth >= 1600 && (
                            <div className="shrink-0">
                                <LeapLabAuthButton variant="dark" size="sm" style={{ height: 34, borderRadius: '9999px', boxSizing: 'border-box' }} />
                            </div>
                        )}

                        <div className="hidden min-[1500px]:flex ml-2 items-center shrink-0 h-12 overflow-hidden filter drop-shadow-[0_0_20px_rgba(167,139,250,0.7)] drop-shadow-[0_0_8px_rgba(255,255,255,0.25)] drop-shadow-[0_3px_10px_rgba(0,0,0,0.5)]">
                            <img
                                src="assets/logo-creoleap.png"
                                alt="CREOLEAP"
                                className="w-[145px] h-auto object-contain block shrink-0 brightness-[1.14] contrast-[1.05]"
                            />
                        </div>

                        {windowWidth < 1500 && (
                            <button
                                onClick={() => setMobileMenuOpen(true)}
                                className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/10 border border-white/15 text-white cursor-pointer ml-0.5 shrink-0 hover:bg-white/20"
                                title="Open Menu"
                            >
                                <MenuIcon size={18} strokeWidth={2.2} />
                            </button>
                        )}
                    </div>
                </header>
                <MobileDrawer
                    isOpen={mobileMenuOpen}
                    onClose={() => setMobileMenuOpen(false)}
                    theme="dark"
                >
                    {windowWidth < 768 && (
                        <>
                            <div className="text-[11px] font-bold uppercase tracking-wider opacity-50 mb-1">File Operations</div>
                            {[
                                { label: 'New Project', icon: File, onClick: ctx.handleNewProject },
                                { label: 'Open from your computer', icon: FolderOpen, onClick: ctx.handleOpenProject },
                                { label: 'Open Python File', icon: FileCode2, onClick: ctx.handleOpenPythonFile },
                                { label: 'Save to your computer', icon: Save, onClick: ctx.handleSaveProject },
                                { label: 'Download .leap file', icon: Download, onClick: ctx.handleDownloadProject },
                                {
                                    label: 'My Projects', icon: FolderOpen,
                                    onClick: () => {
                                        sessionStorage.setItem('landingActiveTab', 'my-projects');
                                        sessionStorage.setItem('myProjectsSelectedMode', 'python');
                                        ctx.onBack(false);
                                    }
                                },
                            ].map((item, i) => (
                                <button key={i} onClick={() => { item.onClick?.(); setMobileMenuOpen(false); }}
                                    className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-gray-200 text-[13px] font-medium cursor-pointer text-left transition-all hover:bg-purple-600/25 hover:text-white"
                                >
                                    {item.icon && <item.icon size={15} color="#a78bfa" strokeWidth={2} />}
                                    {item.label}
                                </button>
                            ))}

                            <div className="h-px bg-white/10 my-2" />

                            <div className="text-[11px] font-bold uppercase tracking-wider opacity-50 mb-1">Edit Operations</div>
                            {[
                                { label: 'Undo', icon: Undo, onClick: () => ctx.editorRef.current?.trigger('keyboard', 'undo', null) },
                                { label: 'Redo', icon: Redo, onClick: () => ctx.editorRef.current?.trigger('keyboard', 'redo', null) },
                            ].map((item, i) => (
                                <button key={i} onClick={() => { item.onClick?.(); setMobileMenuOpen(false); }}
                                    className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-gray-200 text-[13px] font-medium cursor-pointer text-left transition-all hover:bg-purple-600/25 hover:text-white"
                                >
                                    {item.icon && <item.icon size={15} color="#a78bfa" strokeWidth={2} />}
                                    {item.label}
                                </button>
                            ))}
                            <div className="h-px bg-white/10 my-2" />
                        </>
                    )}

                    {windowWidth < 1400 && ctx.workflowMode === "upload" && (
                        <>
                            <div className="text-[11px] font-bold uppercase tracking-wider opacity-50 mb-1">Board Controls</div>
                            {["Board", "Connect"].map((label) => (
                                <button key={label} onClick={() => {
                                    if (label === "Board") ctx.setIsBoardModalOpen(true);
                                    if (label === "Connect") ctx.handleConnectToBoard();
                                    setMobileMenuOpen(false);
                                }}
                                    className="flex items-center gap-2.5 w-full px-2.5 py-2 border-none rounded-lg bg-transparent text-gray-200 text-[13px] font-medium cursor-pointer text-left transition-all hover:bg-purple-600/25 hover:text-white"
                                >
                                    {label}
                                </button>
                            ))}
                            <div className="h-px bg-white/10 my-2" />
                        </>
                    )}

                    {windowWidth < 900 && (
                        <>
                            <div className="text-[11px] font-bold uppercase tracking-wider opacity-50 mb-1">Workspace Mode</div>
                            <ModeSwitcher
                                modes={[
                                    { id: 'ide', label: 'IDE', icon: <Code size={13} strokeWidth={2} />, activeIcon: <Code size={13} strokeWidth={2.5} fill="currentColor" /> },
                                    { id: 'stage', label: 'Stage', icon: <Monitor size={13} strokeWidth={2} />, activeIcon: <Monitor size={13} strokeWidth={2.5} fill="currentColor" /> },
                                    { id: 'upload', label: 'Upload', icon: <Rocket size={13} strokeWidth={2} />, activeIcon: <Rocket size={13} strokeWidth={2.5} fill="currentColor" /> },
                                ]}
                                activeMode={ctx.workflowMode}
                                onChange={(mode) => {
                                    ctx.setWorkflowMode(mode);
                                    setMobileMenuOpen(false);
                                }}
                            />
                            <div className="h-px bg-white/10 my-2" />
                        </>
                    )}

                    {windowWidth < 900 && (
                        <button
                            onClick={() => { setMobileMenuOpen(false); handleShareClick(); }}
                            disabled={shareLoading}
                            className="flex items-center gap-2.5 w-full p-2 px-2.5 border-none rounded-lg bg-transparent text-gray-200 text-[13px] font-medium cursor-pointer text-left transition-all hover:bg-purple-600/25 hover:text-white mb-2"
                        >
                            <Share size={15} color="#a78bfa" strokeWidth={2} />
                            Share Project
                        </button>
                    )}

                    {windowWidth < 1200 && (
                        <div className="mt-auto pt-3 border-t border-white/10 flex flex-col gap-2">
                            <LeapLabAuthButton variant="dark" size="sm" style={{ width: '100%', height: 34, borderRadius: '9999px', boxSizing: 'border-box' }} />
                        </div>
                    )}
                </MobileDrawer>
                </>
            )}
        </TopbarShareButton>
    );
}
