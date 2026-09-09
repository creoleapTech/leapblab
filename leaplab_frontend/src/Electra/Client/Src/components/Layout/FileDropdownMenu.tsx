import React from 'react';
import { FilePlus, FolderOpen, Download, FileText, Save as SaveIcon, Share2 } from 'lucide-react';

interface FileDropdownMenuProps {
  isOpen: boolean;
  isElectra: boolean;
  brandName: string;
  onNew?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onDownload?: () => void;
  onSaveAs?: () => void;
  onShare?: () => void;
  onBack: () => void;
  onClose: () => void;
}

export const FileDropdownMenu: React.FC<FileDropdownMenuProps> = ({
  isOpen,
  isElectra,
  brandName,
  onNew,
  onOpen,
  onSave,
  onDownload,
  onSaveAs,
  onShare,
  onBack,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className={`absolute top-full mt-1.5 left-0 rounded-xl min-w-[220px] py-1.5 z-50 overflow-hidden backdrop-blur-xl shadow-2xl border transition-all animate-[electraMenuSlideIn_0.18s_ease-out] ${
        isElectra
          ? 'bg-[#18181b]/95 border-[#27272a] shadow-black/50'
          : 'bg-white/90 border-white/60'
      }`}
    >
      <style>{`
        @keyframes electraMenuSlideIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <button
        type="button"
        className={`flex items-center justify-between w-full px-3.5 py-2 border-0 bg-transparent text-sm font-medium text-left cursor-pointer transition-all tracking-normal ${
          isElectra ? 'text-zinc-100 hover:bg-cyan-500/10 hover:text-cyan-400' : 'text-gray-700 hover:bg-purple-100/60 hover:text-purple-700'
        }`}
        onClick={() => {
          onNew?.();
          onClose();
        }}
      >
        <div className="flex items-center gap-2.5">
          <FilePlus size={16} strokeWidth={2} className={isElectra ? 'text-cyan-400 opacity-85' : 'text-purple-600 opacity-85'} />
          <span>New Project</span>
        </div>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded font-medium ${isElectra ? 'bg-zinc-800 text-zinc-400' : 'bg-black/5 text-gray-400'}`}>Ctrl+N</span>
      </button>

      <button
        type="button"
        className={`flex items-center justify-between w-full px-3.5 py-2 border-0 bg-transparent text-sm font-medium text-left cursor-pointer transition-all tracking-normal ${
          isElectra ? 'text-zinc-100 hover:bg-cyan-500/10 hover:text-cyan-400' : 'text-gray-700 hover:bg-purple-100/60 hover:text-purple-700'
        }`}
        onClick={() => {
          onOpen?.();
          onClose();
        }}
      >
        <div className="flex items-center gap-2.5">
          <FolderOpen size={16} strokeWidth={2} className={isElectra ? 'text-cyan-400 opacity-85' : 'text-purple-600 opacity-85'} />
          <span>Open Project</span>
        </div>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded font-medium ${isElectra ? 'bg-zinc-800 text-zinc-400' : 'bg-black/5 text-gray-400'}`}>Ctrl+O</span>
      </button>

      <div className={`h-px my-1.5 mx-3 ${isElectra ? 'bg-white/10' : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'}`} />

      <button
        type="button"
        className={`flex items-center justify-between w-full px-3.5 py-2 border-0 bg-transparent text-sm font-medium text-left cursor-pointer transition-all tracking-normal ${
          isElectra ? 'text-zinc-100 hover:bg-cyan-500/10 hover:text-cyan-400' : 'text-gray-700 hover:bg-purple-100/60 hover:text-purple-700'
        }`}
        onClick={() => {
          onSave?.();
          onClose();
        }}
      >
        <div className="flex items-center gap-2.5">
          <SaveIcon size={16} strokeWidth={2} className={isElectra ? 'text-cyan-400 opacity-85' : 'text-purple-600 opacity-85'} />
          <span>Save</span>
        </div>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded font-medium ${isElectra ? 'bg-zinc-800 text-zinc-400' : 'bg-black/5 text-gray-400'}`}>Ctrl+S</span>
      </button>

      {onDownload && (
        <button
          type="button"
          className={`flex items-center justify-between w-full px-3.5 py-2 border-0 bg-transparent text-sm font-medium text-left cursor-pointer transition-all tracking-normal ${
            isElectra ? 'text-zinc-100 hover:bg-cyan-500/10 hover:text-cyan-400' : 'text-gray-700 hover:bg-purple-100/60 hover:text-purple-700'
          }`}
          onClick={() => {
            onDownload();
            onClose();
          }}
        >
          <div className="flex items-center gap-2.5">
            <Download size={16} strokeWidth={2} className={isElectra ? 'text-cyan-400 opacity-85' : 'text-purple-600 opacity-85'} />
            <span>Download .leap</span>
          </div>
        </button>
      )}

      <button
        type="button"
        className={`flex items-center justify-between w-full px-3.5 py-2 border-0 bg-transparent text-sm font-medium text-left cursor-pointer transition-all tracking-normal ${
          isElectra ? 'text-zinc-100 hover:bg-cyan-500/10 hover:text-cyan-400' : 'text-gray-700 hover:bg-purple-100/60 hover:text-purple-700'
        }`}
        onClick={() => {
          onSaveAs?.();
          onClose();
        }}
      >
        <div className="flex items-center gap-2.5">
          <FileText size={16} strokeWidth={2} className={isElectra ? 'text-cyan-400 opacity-85' : 'text-purple-600 opacity-85'} />
          <span>Save As...</span>
        </div>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded font-medium ${isElectra ? 'bg-zinc-800 text-zinc-400' : 'bg-black/5 text-gray-400'}`}>Ctrl+Shift+S</span>
      </button>

      <div className={`h-px my-1.5 mx-3 ${isElectra ? 'bg-white/10' : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'}`} />

      {onShare && (
        <button
          type="button"
          className={`flex items-center justify-between w-full px-3.5 py-2 border-0 bg-transparent text-sm font-medium text-left cursor-pointer transition-all tracking-normal ${
            isElectra ? 'text-zinc-100 hover:bg-cyan-500/10 hover:text-cyan-400' : 'text-gray-700 hover:bg-purple-100/60 hover:text-purple-700'
          }`}
          onClick={() => {
            onShare();
            onClose();
          }}
        >
          <div className="flex items-center gap-2.5">
            <Share2 size={16} strokeWidth={2} className={isElectra ? 'text-cyan-400 opacity-85' : 'text-purple-600 opacity-85'} />
            <span>Share</span>
          </div>
        </button>
      )}

      <div className={`h-px my-1.5 mx-3 ${isElectra ? 'bg-white/10' : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'}`} />

      <button
        type="button"
        className={`flex items-center justify-between w-full px-3.5 py-2 border-0 bg-transparent text-sm font-medium text-left cursor-pointer transition-all tracking-normal ${
          isElectra ? 'text-zinc-100 hover:bg-cyan-500/10 hover:text-cyan-400' : 'text-gray-700 hover:bg-purple-100/60 hover:text-purple-700'
        }`}
        onClick={() => {
          const currentModule = brandName === 'CREOVA' ? 'creova' : brandName === 'NEURA' ? 'neura' : 'electra';
          sessionStorage.setItem('landingActiveTab', 'my-projects');
          sessionStorage.setItem('myProjectsSelectedMode', currentModule);
          onClose();
          onBack();
        }}
      >
        <div className="flex items-center gap-2.5">
          <FolderOpen size={16} strokeWidth={2} className={isElectra ? 'text-cyan-400 opacity-85' : 'text-purple-600 opacity-85'} />
          <span>My Projects</span>
        </div>
      </button>
    </div>
  );
};
