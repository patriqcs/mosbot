export interface SaveResult {
  restartRequired: boolean;
  restartRequiredSections: string[];
  appliedSections: string[];
}

export interface AutoSaveControllerOptions {
  initialRaw: string;
  debounceMs: number;
  save: (raw: string) => Promise<SaveResult>;
  onSaved: (result: SaveResult, undoSnapshot: string, savedRaw: string) => void;
  onError: (err: Error) => void;
}

export class AutoSaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingRaw: string;
  private lastSavedRaw: string;

  constructor(private readonly opts: AutoSaveControllerOptions) {
    this.pendingRaw = opts.initialRaw;
    this.lastSavedRaw = opts.initialRaw;
  }

  setRaw(next: string): void {
    this.pendingRaw = next;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.debounceMs);
  }

  /** Revert to `snapshot` and save it immediately, skipping the debounce window. */
  async undo(snapshot: string): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingRaw = snapshot;
    await this.flush();
  }

  /** Cancel any pending debounced save without flushing. */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async flush(): Promise<void> {
    if (this.pendingRaw === this.lastSavedRaw) return;
    const preSnapshot = this.lastSavedRaw;
    const toSave = this.pendingRaw;
    try {
      const result = await this.opts.save(toSave);
      this.lastSavedRaw = toSave;
      this.opts.onSaved(result, preSnapshot, toSave);
    } catch (err) {
      this.opts.onError(err as Error);
    }
  }
}
