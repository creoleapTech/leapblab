/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Home,
  ChevronDown,
  BookOpen,
  Save,
  Download,
  Share2,
  FileText,
  FolderOpen,
  FilePlus,
  Undo,
  Redo,
  Scissors,
  Copy,
  Clipboard,
  Check,
  Menu,
  X,
  Loader2,
  Code
} from 'lucide-react';
import LeapLabAuthButton from '../../../../../auth/LeapLabAuthButton';
import TopbarShareButton from '../../../../../components/common/TopbarShareButton';
import ProjectNameInput from '../../../../../components/common/ProjectNameInput';

// Extracted Submenus
import { FileDropdownMenu } from './FileDropdownMenu';
import { EditDropdownMenu } from './EditDropdownMenu';
import { BoardDropdownMenu } from './BoardDropdownMenu';

interface IgniteTopbarProps {
  onBack: (hasChanges?: boolean) => void;
  onSave: () => void;
  onSaveAs?: () => void;
  onDownload?: () => void;
  onNew?: () => void;
  onOpen?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onCut?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  title: string;
  onTitleChange: (val: string) => void;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  brandName?: string;
  variant?: 'default' | 'electra';
  canUndo?: boolean;
  canRedo?: boolean;
  onSwitchBoard?: (board: string) => void;
  currentBoard?: string;
  isSaving?: boolean;
  onToggleEditor?: () => void;
  showEditor?: boolean;
}

export const IgniteTopbar: React.FC<IgniteTopbarProps> = ({
  onBack,
  onSave,
  onSaveAs,
  onDownload,
  onNew,
  onOpen,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  title,
  onTitleChange,
  centerContent,
  rightContent,
  brandName = 'ELECTRA',
  variant = 'default',
  canUndo = false,
  canRedo = false,
  onSwitchBoard,
  currentBoard,
  isSaving = false,
  onToggleEditor,
  showEditor = true
}) => {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const boardMenuRef = useRef<HTMLDivElement>(null);

  const isElectra = variant === 'electra';

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(event.target as Node)) {
        setFileMenuOpen(false);
      }
      if (editMenuRef.current && !editMenuRef.current.contains(event.target as Node)) {
        setEditMenuOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
      if (boardMenuRef.current && !boardMenuRef.current.contains(event.target as Node)) {
        setBoardMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, []);

  return (
    <>
      <div
        className="flex items-center justify-between h-[68px] pl-0.5 pr-[18px] z-[100] select-none min-w-0 border-b gap-4 bg-gradient-to-br from-[#0a0a1f] via-[#0a015a] to-[#080a25] border-sky-400/10 shadow-[0_4px_20px_rgba(8,10,37,0.5),inset_0_-1px_0_rgba(255,255,255,0.06)]"
      >
        {/* Left section – fixed, never squeezes center title */}
        <div className="flex items-center gap-3.5 shrink-0 min-w-0 h-full">
          <button
            type="button"
            title="Back to Home"
            onClick={() => {
              sessionStorage.setItem('landingActiveTab', 'modules');
              sessionStorage.removeItem('myProjectsSelectedMode');
              onBack(false);
            }}
            className={`flex items-center justify-center w-10 h-10 ml-4 rounded-xl cursor-pointer transition-colors duration-200 shrink-0 border ${isElectra
                ? 'bg-zinc-800/50 border-zinc-800 text-zinc-100 hover:bg-cyan-400/10 hover:border-cyan-400 hover:text-cyan-400'
                : 'bg-blue-400/18 border-blue-400/25 text-white hover:bg-blue-300/25'
              }`}
          >
            <Home size={20} strokeWidth={2.2} />
          </button>

          <div className={`h-8 w-px shrink-0 ${isElectra ? 'bg-zinc-800/60' : 'bg-blue-200/25'}`} />

          <div className={`flex items-center mr-2.5 shrink-0 ${isElectra ? '' : 'filter drop-shadow-[0_0_14px_rgba(56,189,248,0.3)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.3)]'
            }`}>
            <img
              alt="LeapLab"
              src="assets/leaplab_logo_transparent.png"
              className="h-12 object-contain"
            />
            <span className={`text-[22px] font-black tracking-[0.08em] font-sans ml-2.5 ${isElectra ? 'text-cyan-400' : 'text-white'}`}>
              {brandName}
            </span>
          </div>

          <div className={`h-8 w-px shrink-0 ${isElectra ? 'bg-zinc-800/60' : 'bg-blue-200/25'}`} />

          {/* Desktop dropdown menus */}
          <div className="hidden min-[1440px]:flex items-center gap-3 h-full">
            {/* File Menu */}
            <div ref={fileMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setFileMenuOpen(!fileMenuOpen);
                  setEditMenuOpen(false);
                  setBoardMenuOpen(false);
                }}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-full transition-all tracking-wide cursor-pointer border-0 ${isElectra ? 'text-zinc-100 hover:bg-cyan-400/10' : 'text-white hover:bg-white/10'
                  } ${fileMenuOpen ? (isElectra ? 'bg-cyan-400/20' : 'bg-white/20 backdrop-blur-xs') : 'bg-transparent'}`}
              >
                File
                <ChevronDown size={14} strokeWidth={2.5} className={`opacity-50 transition-transform duration-200 ${fileMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              <TopbarShareButton onSave={onSave} projectName={title}>
                {({ onClick: handleShareClick }) => (
                  <FileDropdownMenu
                    isOpen={fileMenuOpen}
                    isElectra={isElectra}
                    brandName={brandName}
                    onNew={onNew}
                    onOpen={onOpen}
                    onSave={onSave}
                    onDownload={onDownload}
                    onSaveAs={onSaveAs}
                    onShare={handleShareClick}
                    onBack={onBack}
                    onClose={() => setFileMenuOpen(false)}
                  />
                )}
              </TopbarShareButton>
            </div>

            {/* Edit Menu */}
            <div ref={editMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setEditMenuOpen(!editMenuOpen);
                  setFileMenuOpen(false);
                  setBoardMenuOpen(false);
                }}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-full transition-all tracking-wide cursor-pointer border-0 ${isElectra ? 'text-zinc-100 hover:bg-cyan-400/10' : 'text-white hover:bg-white/10'
                  } ${editMenuOpen ? (isElectra ? 'bg-cyan-400/20' : 'bg-white/20 backdrop-blur-xs') : 'bg-transparent'}`}
              >
                Edit
                <ChevronDown size={14} strokeWidth={2.5} className={`opacity-50 transition-transform duration-200 ${editMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              <EditDropdownMenu
                isOpen={editMenuOpen}
                isElectra={isElectra}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={onUndo}
                onRedo={onRedo}
                onCut={onCut}
                onCopy={onCopy}
                onPaste={onPaste}
                onClose={() => setEditMenuOpen(false)}
              />
            </div>

            {/* Board Switcher */}
            {onSwitchBoard && currentBoard && (
              <div ref={boardMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setBoardMenuOpen(!boardMenuOpen);
                    setFileMenuOpen(false);
                    setEditMenuOpen(false);
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-full transition-all tracking-wide cursor-pointer border-0 ${isElectra ? 'text-zinc-100 hover:bg-cyan-400/10' : 'text-white hover:bg-white/10'
                    } ${boardMenuOpen ? (isElectra ? 'bg-cyan-400/20' : 'bg-white/20 backdrop-blur-xs') : 'bg-transparent'}`}
                >
                  <span>{currentBoard === 'esp32-c3' ? 'ESP32-C3' : 'ARDUINO UNO'}</span>
                  <ChevronDown size={14} strokeWidth={2.5} className={`opacity-50 transition-transform duration-200 ${boardMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                <BoardDropdownMenu
                  isOpen={boardMenuOpen}
                  isElectra={isElectra}
                  currentBoard={currentBoard}
                  onSwitchBoard={onSwitchBoard}
                  onClose={() => setBoardMenuOpen(false)}
                />
              </div>
            )}

            <button
              type="button"
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-full transition-all tracking-wide cursor-pointer border-0 bg-transparent ${isElectra ? 'text-zinc-100 hover:bg-cyan-400/10' : 'text-white hover:bg-white/10'
                }`}
            >
              <BookOpen size={16} strokeWidth={2.2} className={isElectra ? 'opacity-70' : 'opacity-90'} />
              Tutorials
              <ChevronDown size={14} strokeWidth={2.5} className="opacity-50" />
            </button>
          </div>
        </div>

        {/* Center section – flex-1 with generous max-width so title never collapses to "D…" */}
        <div className="flex items-center justify-center gap-2 sm:gap-4 px-2 sm:px-4 flex-1 min-w-[180px] max-w-[560px] w-full">
          <div className="hidden md:flex items-center gap-4 shrink-0">{centerContent}</div>

          <ProjectNameInput
            value={title}
            onChange={onTitleChange}
            onSave={onSave}
            isSaving={isSaving}
            className="flex-1 min-w-0 w-full"
          />
        </div>

        {/* Right section – fixed, never squeezes center */}
        <div className="flex items-center justify-end gap-3 shrink-0 min-w-0">
          {/* Quick actions - Desktop only */}
          <div className={`hidden sm:flex items-center gap-3 pr-4 mr-2 border-r h-8 shrink-0 ${isElectra ? 'border-zinc-800' : 'border-blue-200/20'
            }`}>
            <TopbarShareButton className={`bg-transparent border-none cursor-pointer transition-colors duration-200 flex items-center ${isElectra ? 'text-zinc-400 hover:text-cyan-400' : 'text-blue-200/85 hover:text-white'}`} size={16} onSave={onSave} projectName={title} />
          </div>

          {rightContent && (
            <div className="flex items-center shrink-0">
              {rightContent}
            </div>
          )}
          <div className="hidden sm:flex sm:items-center sm:gap-4 shrink-0 ml-4">
            <LeapLabAuthButton variant="dark" size="sm" style={{ height: 36, borderRadius: '16px', boxSizing: 'border-box' }} />
          </div>

          {/* Creoleap brand logo (large desktop only) */}
          <div className={`hidden min-[1500px]:flex ml-2 items-center shrink-0 h-12 overflow-hidden ${isElectra ? '' : 'filter drop-shadow-[0_0_20px_rgba(167,139,250,0.7)] drop-shadow-[0_0_8px_rgba(255,255,255,0.25)] drop-shadow-[0_3px_10px_rgba(0,0,0,0.5)]'
            }`}>
            <img
              alt="Leap into the AI Future"
              src="assets/logo-creoleap.png"
              className="w-[145px] h-auto object-contain block shrink-0 brightness-[1.14] contrast-[1.05]"
            />
          </div>

          {/* Hamburger menu trigger (visible below lg screen size) */}
          <button
            type="button"
            title="Open Menu"
            onClick={() => setMobileMenuOpen(true)}
            className={`min-[1440px]:hidden flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer transition-colors duration-200 shrink-0 border ${isElectra
              ? 'bg-zinc-800/50 border-zinc-800 text-zinc-100 hover:bg-cyan-400/10 hover:border-cyan-400 hover:text-cyan-400'
              : 'bg-blue-400/18 border-blue-400/25 text-white hover:bg-blue-300/25'
              }`}
          >
            <Menu size={20} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* Backdrop overlay for mobile menu drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-[999] transition-opacity duration-300"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Slide-out mobile menu drawer */}
      <div
        ref={mobileMenuRef}
        className={`fixed top-0 right-0 h-full z-[1000] shadow-2xl flex flex-col gap-6 transition-all duration-300 ease-in-out border-l w-[min(290px,80vw)] max-w-[80vw] p-6 box-border ${isElectra
          ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
          : 'bg-[#0b1b42] border-blue-200/20 text-white'
          } ${mobileMenuOpen ? 'translate-x-0 visible opacity-100' : 'translate-x-full invisible opacity-0'}`}
      >
        {/* Drawer Header */}
        <div className={`flex items-center justify-between border-b pb-4 ${isElectra ? 'border-zinc-800' : 'border-white/10'
          }`}>
          <div className="flex items-center gap-2.5">
            <img src="/assets/leaplabicon.ico" alt="LeapLab" className="w-6 h-6 rounded object-contain" />
            <span className="font-sans font-bold text-lg tracking-wide">Menu</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className={`w-10 h-10 flex items-center justify-center rounded-lg border transition-colors ${isElectra
              ? 'bg-zinc-800/50 border-zinc-800 text-zinc-100 hover:bg-cyan-400/10 hover:border-cyan-400 hover:text-cyan-400'
              : 'bg-blue-400/10 border-blue-400/20 text-white hover:bg-white/10'
              }`}
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>

        {/* Drawer Body (Scrollable container) */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-6">
          {/* File Operations */}
          <div className="flex flex-col gap-0.5">
            <span className={`text-[13px] font-bold uppercase tracking-wider px-3 mb-1.5 ${isElectra ? 'text-zinc-400 opacity-60' : 'text-blue-300/80'}`}>
              File
            </span>
            <button
              type="button"
              onClick={() => { onNew?.(); setMobileMenuOpen(false); }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <FilePlus size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>New Project</span>
            </button>
            <button
              type="button"
              onClick={() => { onOpen?.(); setMobileMenuOpen(false); }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <FolderOpen size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Open Project</span>
            </button>
            <button
              type="button"
              onClick={() => { onSave?.(); setMobileMenuOpen(false); }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <Save size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Save</span>
            </button>
            <button
              type="button"
              onClick={() => { onSaveAs?.(); setMobileMenuOpen(false); }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <FileText size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Save As...</span>
            </button>

            {onDownload && (
              <button
                type="button"
                onClick={() => { onDownload(); setMobileMenuOpen(false); }}
                className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                  }`}
              >
                <Download size={18} strokeWidth={2} className="opacity-80 shrink-0" />
                <span>Download .leap</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const currentModule = brandName === 'CREOVA' ? 'creova' : brandName === 'NEURA' ? 'neura' : 'electra';
                sessionStorage.setItem('landingActiveTab', 'my-projects');
                sessionStorage.setItem('myProjectsSelectedMode', currentModule);
                setMobileMenuOpen(false);
                onBack();
              }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <FolderOpen size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>My Projects</span>
            </button>
          </div>

          {/* Edit Operations */}
          <div className="flex flex-col gap-0.5">
            <span className={`text-[13px] font-bold uppercase tracking-wider px-3 mb-1.5 ${isElectra ? 'text-zinc-400 opacity-60' : 'text-blue-300/80'}`}>
              Edit
            </span>
            <button
              type="button"
              disabled={!canUndo}
              onClick={() => { if (canUndo) { onUndo?.(); setMobileMenuOpen(false); } }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 ${!canUndo
                ? 'opacity-35 cursor-not-allowed text-inherit'
                : isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400 cursor-pointer' : 'hover:bg-white/10 text-white/90 hover:text-white cursor-pointer'
                }`}
            >
              <Undo size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Undo</span>
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={() => { if (canRedo) { onRedo?.(); setMobileMenuOpen(false); } }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 ${!canRedo
                ? 'opacity-35 cursor-not-allowed text-inherit'
                : isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400 cursor-pointer' : 'hover:bg-white/10 text-white/90 hover:text-white cursor-pointer'
                }`}
            >
              <Redo size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Redo</span>
            </button>
            <button
              type="button"
              onClick={() => { onCut?.(); setMobileMenuOpen(false); }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <Scissors size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Cut</span>
            </button>
            <button
              type="button"
              onClick={() => { onCopy?.(); setMobileMenuOpen(false); }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <Copy size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Copy</span>
            </button>
            <button
              type="button"
              onClick={() => { onPaste?.(); setMobileMenuOpen(false); }}
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <Clipboard size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Paste</span>
            </button>
          </div>

          {/* Board Selector */}
          {onSwitchBoard && currentBoard && (
            <div className="flex flex-col gap-0.5">
              <span className={`text-[13px] font-bold uppercase tracking-wider px-3 mb-1.5 ${isElectra ? 'text-zinc-400 opacity-60' : 'text-blue-300/80'}`}>
                Switch Board
              </span>
              <button
                type="button"
                onClick={() => { if (currentBoard !== 'arduino-uno') onSwitchBoard('arduino-uno'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors border-0 cursor-pointer ${currentBoard === 'arduino-uno'
                  ? isElectra ? 'text-cyan-400 bg-cyan-400/10' : 'text-blue-300 bg-white/10'
                  : isElectra ? 'text-zinc-400 hover:text-white hover:bg-white/5' : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${currentBoard === 'arduino-uno' ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
                <span>Arduino Uno</span>
              </button>
              <button
                type="button"
                onClick={() => { if (currentBoard !== 'esp32-c3') onSwitchBoard('esp32-c3'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors border-0 cursor-pointer ${currentBoard === 'esp32-c3'
                  ? isElectra ? 'text-cyan-400 bg-cyan-400/10' : 'text-blue-300 bg-white/10'
                  : isElectra ? 'text-zinc-400 hover:text-white hover:bg-white/5' : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${currentBoard === 'esp32-c3' ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
                <span>ESP32-C3</span>
              </button>
            </div>
          )}

          {/* Additional controls */}
          <div className={`flex flex-col gap-0.5 border-t pt-4 ${isElectra ? 'border-zinc-800' : 'border-white/10'
            }`}>
            {onToggleEditor && (
              <button
                type="button"
                onClick={() => { onToggleEditor(); setMobileMenuOpen(false); }}
                className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                  }`}
              >
                <Code size={18} strokeWidth={2} className="opacity-80 shrink-0" />
                <span>{showEditor ? 'Hide Code' : 'Show Code'}</span>
              </button>
            )}
            <button
              type="button"
              className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                }`}
            >
              <BookOpen size={18} strokeWidth={2} className="opacity-80 shrink-0" />
              <span>Tutorials</span>
            </button>
            <TopbarShareButton size={18} onSave={onSave} projectName={title}>
              {({ onClick, loading }: { onClick: () => void; loading: boolean }) => (
                <button
                  type="button"
                  className={`flex items-center gap-3.5 w-full py-2.5 px-3 text-base font-medium rounded-lg text-left transition-colors bg-transparent border-0 cursor-pointer ${isElectra ? 'hover:bg-cyan-400/10 text-zinc-100 hover:text-cyan-400' : 'hover:bg-white/10 text-white/90 hover:text-white'
                    }`}
                  onClick={onClick}
                  disabled={loading}
                >
                  <Share2 size={18} strokeWidth={2} className="opacity-80 shrink-0" />
                  <span>Share project</span>
                </button>
              )}
            </TopbarShareButton>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className={`border-t pt-4 flex flex-col gap-4 ${isElectra ? 'border-zinc-800' : 'border-white/10'
          }`}>
          {rightContent}
          <LeapLabAuthButton variant="dark" size="sm" style={{ height: 40, borderRadius: '8px', boxSizing: 'border-box', width: '100%', fontSize: '1rem', fontWeight: 600 }} />
        </div>
      </div>
    </>
  );
};

export default IgniteTopbar;
