import React from 'react';
import { Save } from 'lucide-react';

interface ProjectNameInputProps {
  value: string;
  onChange: (val: string) => void;
  onSave: () => void;
  isSaving?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function ProjectNameInput({
  value,
  onChange,
  onSave,
  isSaving,
  className = '',
  style,
}: ProjectNameInputProps) {
  return (
    <div
      className={`bg-white/10 border border-white/15 py-1 px-2.5 rounded-lg flex items-center gap-1.5 h-8.5 box-border min-w-0 flex-1 w-full max-w-[520px] ${className}`}
      style={style}
    >
      <span className="text-xs opacity-60 leading-none select-none shrink-0">
        📁
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="My Project"
        title={value || 'My Project'}
        className="bg-transparent border-0 text-white flex-1 min-w-0 w-full outline-none text-xs font-semibold font-sans placeholder-white/40 truncate"
      />
      <button
        type="button"
        onClick={isSaving ? undefined : onSave}
        title="Save Project"
        className={`bg-transparent border-0 p-0 flex items-center justify-center transition-transform duration-150 shrink-0 text-white hover:scale-110 ${
          isSaving ? 'cursor-default opacity-50' : 'cursor-pointer opacity-80 hover:opacity-100'
        }`}
        disabled={isSaving}
      >
        <Save size={13} />
      </button>
    </div>
  );
}
