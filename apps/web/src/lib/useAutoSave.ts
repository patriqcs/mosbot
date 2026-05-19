import { useCallback, useEffect, useRef, useState } from 'react';
import { AutoSaveController, type SaveResult } from './autosave';

const TOAST_VISIBLE_MS = 10_000;

export interface UndoState {
  count: number;
  undoSnapshot: string;
  expiresAt: number;
  lastResult: SaveResult;
}

export interface UseAutoSaveResult {
  raw: string;
  setRaw: (next: string) => void;
  undoState: UndoState | null;
  undo: () => Promise<void>;
  dismissUndo: () => void;
  error: string | null;
  clearError: () => void;
}

/**
 * React-binding around AutoSaveController.
 *
 * Expects `initialRaw` to be available at mount; the parent should defer
 * rendering until the initial value is loaded.
 *
 * `save` is captured in a ref, so it does not need to be memoised.
 */
export const useAutoSave = (
  initialRaw: string,
  save: (raw: string) => Promise<SaveResult>,
  debounceMs = 500,
): UseAutoSaveResult => {
  const [raw, setRawState] = useState(initialRaw);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AutoSaveController | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const c = new AutoSaveController({
      initialRaw,
      debounceMs,
      save: (next) => saveRef.current(next),
      onSaved: (result, undoSnapshot) => {
        setError(null);
        setUndoState((prev) => {
          const now = Date.now();
          if (prev && prev.expiresAt > now) {
            return {
              ...prev,
              count: prev.count + 1,
              expiresAt: now + TOAST_VISIBLE_MS,
              lastResult: result,
            };
          }
          return {
            count: 1,
            undoSnapshot,
            expiresAt: now + TOAST_VISIBLE_MS,
            lastResult: result,
          };
        });
      },
      onError: (err) => setError(err.message),
    });
    controllerRef.current = c;
    return () => {
      c.dispose();
      controllerRef.current = null;
    };
    // initialRaw and debounceMs are intentionally bound at mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hide the toast when its visible window expires
  useEffect(() => {
    if (!undoState) return;
    const remaining = undoState.expiresAt - Date.now();
    if (remaining <= 0) {
      setUndoState(null);
      return;
    }
    const t = setTimeout(() => setUndoState(null), remaining);
    return () => clearTimeout(t);
  }, [undoState]);

  const setRaw = useCallback((next: string): void => {
    setRawState(next);
    controllerRef.current?.setRaw(next);
  }, []);

  const undo = useCallback(async (): Promise<void> => {
    const state = undoState;
    if (!state) return;
    const snap = state.undoSnapshot;
    setRawState(snap);
    setUndoState(null);
    await controllerRef.current?.undo(snap);
  }, [undoState]);

  const dismissUndo = useCallback((): void => setUndoState(null), []);
  const clearError = useCallback((): void => setError(null), []);

  return { raw, setRaw, undoState, undo, dismissUndo, error, clearError };
};
