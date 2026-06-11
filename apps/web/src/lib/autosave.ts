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
  /**
   * Pre-save guard. Return `null` to allow the save, or an error message string
   * to block it (onError is invoked with that message; save is not called).
   */
  validate?: (raw: string) => string | null;
}

export class AutoSaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingRaw: string;
  private lastSavedRaw: string;
  private saveSeq = 0;

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
    const validationError = this.opts.validate?.(toSave) ?? null;
    if (validationError !== null) {
      this.opts.onError(new Error(validationError));
      return;
    }
    // Tag this save; if another flush starts before we resolve, ours is stale
    // and must not clobber the controller's saved-state view (last-write-wins
    // by start order, not by completion order).
    const seq = ++this.saveSeq;
    try {
      const result = await this.opts.save(toSave);
      if (seq !== this.saveSeq) return;
      this.lastSavedRaw = toSave;
      this.opts.onSaved(result, preSnapshot, toSave);
    } catch (err) {
      if (seq !== this.saveSeq) return;
      this.opts.onError(err as Error);
    }
  }
}
