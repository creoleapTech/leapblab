import { useEffect, useRef } from 'react';

export interface KeyboardShortcutHandlers {
  onSave?: () => void | Promise<void>;
  onSaveAs?: () => void | Promise<void>;
  onNew?: () => void | Promise<void>;
  onOpen?: () => void | Promise<void>;
  onUndo?: () => void | Promise<void>;
  onRedo?: () => void | Promise<void>;
}

export function useKeyboardShortcuts(
  handlers: KeyboardShortcutHandlers,
  deps: React.DependencyList = []
): void {
  const handlersRef = useRef(handlers);
  // Keep ref in sync so latest handlers are always invoked even if deps are stale
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Ctrl/Cmd+Shift+S: Save As (must be checked before plain Save)
      if (mod && e.shiftKey && key === 's') {
        e.preventDefault();
        if (handlersRef.current.onSaveAs) await handlersRef.current.onSaveAs();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        if (handlersRef.current.onSave) await handlersRef.current.onSave();
        return;
      }
      if (mod && key === 'n') {
        e.preventDefault();
        if (handlersRef.current.onNew) await handlersRef.current.onNew();
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        if (handlersRef.current.onOpen) await handlersRef.current.onOpen();
        return;
      }
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (handlersRef.current.onUndo) await handlersRef.current.onUndo();
        return;
      }
      // Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z: Redo
      if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        if (handlersRef.current.onRedo) await handlersRef.current.onRedo();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // Empty deps - listener is stable and uses ref; keep deps param for backwards compatibility
    // but we intentionally do not use it to avoid stale closure bugs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
