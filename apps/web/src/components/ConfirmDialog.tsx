import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps): JSX.Element => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 animate-in fade-in" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background p-5 shadow-lg animate-in fade-in zoom-in-95">
        <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
        <Dialog.Description asChild>
          <div className="mt-2 text-sm text-muted-foreground">{description}</div>
        </Dialog.Description>
        <div className="mt-5 flex justify-end gap-2">
          <Dialog.Close asChild>
            <Button variant="outline" size="sm">
              {cancelLabel}
            </Button>
          </Dialog.Close>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
