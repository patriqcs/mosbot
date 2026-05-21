import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';

interface UndoToastProps {
  count: number;
  restartRequired: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}

export const UndoToast = ({
  count,
  restartRequired,
  onUndo,
  onDismiss,
}: UndoToastProps): JSX.Element => {
  const label = count === 1 ? 'Saved.' : `Saved (${count} changes).`;
  return createPortal(
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-md border bg-background px-4 py-2 shadow-lg animate-in fade-in slide-in-from-bottom-2"
    >
      <span className="text-sm">
        {label}
        {restartRequired && (
          <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
            restart required for some fields
          </span>
        )}
      </span>
      <Button variant="outline" size="sm" onClick={onUndo}>
        Undo
      </Button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground"
        aria-label="dismiss"
      >
        ×
      </button>
    </div>,
    document.body,
  );
};

interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
}

export const ErrorToast = ({ message, onDismiss }: ErrorToastProps): JSX.Element =>
  createPortal(
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 flex max-w-md items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 shadow-lg animate-in fade-in slide-in-from-bottom-2"
    >
      <span className="text-sm text-destructive">
        <span className="font-medium">Save failed: </span>
        {message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-destructive/70 hover:text-destructive"
        aria-label="dismiss"
      >
        ×
      </button>
    </div>,
    document.body,
  );
