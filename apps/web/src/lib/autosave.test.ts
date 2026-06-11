import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSaveController, type SaveResult } from './autosave';

const okResult = (): SaveResult => ({
  restartRequired: false,
  restartRequiredSections: [],
  appliedSections: [],
});

describe('AutoSaveController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces setRaw and saves once after idle window', async () => {
    const save = vi.fn(async () => okResult());
    const onSaved = vi.fn();
    const c = new AutoSaveController({
      initialRaw: 'a',
      debounceMs: 500,
      save,
      onSaved,
      onError: vi.fn(),
    });
    c.setRaw('b');
    c.setRaw('c');
    c.setRaw('d');
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('d');
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('skips save when raw is unchanged from last saved value', async () => {
    const save = vi.fn(async () => okResult());
    const c = new AutoSaveController({
      initialRaw: 'a',
      debounceMs: 500,
      save,
      onSaved: vi.fn(),
      onError: vi.fn(),
    });
    c.setRaw('a');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
  });

  it('emits the previous saved value as undoSnapshot', async () => {
    const save = vi.fn(async () => okResult());
    const onSaved = vi.fn();
    const c = new AutoSaveController({
      initialRaw: 'v0',
      debounceMs: 500,
      save,
      onSaved,
      onError: vi.fn(),
    });
    c.setRaw('v1');
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), 'v0', 'v1');

    c.setRaw('v2');
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(onSaved).toHaveBeenLastCalledWith(expect.anything(), 'v1', 'v2');
  });

  it('calls onError and does NOT advance lastSavedRaw when save throws', async () => {
    const save = vi
      .fn<(raw: string) => Promise<SaveResult>>()
      .mockRejectedValueOnce(new Error('boom'));
    const onSaved = vi.fn();
    const onError = vi.fn();
    const c = new AutoSaveController({
      initialRaw: 'v0',
      debounceMs: 500,
      save,
      onSaved,
      onError,
    });
    c.setRaw('v1');
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();

    // After a failed save, the next attempt with the same value should retry
    save.mockResolvedValueOnce(okResult());
    c.setRaw('v1');
    // setRaw('v1') equals pendingRaw='v1', but pendingRaw was already 'v1'; setTimeout was set
    // so we still wait the debounce
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), 'v0', 'v1');
  });

  it('undo() flushes pending debounce, then reverts to a given snapshot and saves it', async () => {
    const save = vi.fn(async () => okResult());
    const onSaved = vi.fn();
    const c = new AutoSaveController({
      initialRaw: 'v0',
      debounceMs: 500,
      save,
      onSaved,
      onError: vi.fn(),
    });
    c.setRaw('v1');
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledWith('v1');

    await c.undo('v0');
    expect(save).toHaveBeenCalledWith('v0');
    expect(save).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenLastCalledWith(expect.anything(), 'v1', 'v0');
  });

  it('discards a stale in-flight save when a newer save resolves first', async () => {
    const deferreds: Array<{ raw: string; resolve: () => void }> = [];
    const save = vi.fn(
      (raw: string) =>
        new Promise<SaveResult>((res) => {
          deferreds.push({ raw, resolve: () => res(okResult()) });
        }),
    );
    const onSaved = vi.fn();
    const c = new AutoSaveController({
      initialRaw: 'v0',
      debounceMs: 500,
      save,
      onSaved,
      onError: vi.fn(),
    });
    c.setRaw('A');
    await vi.advanceTimersByTimeAsync(500); // flush A -> save('A') pending
    const undoPromise = c.undo('B'); // overlapping immediate flush -> save('B')
    await Promise.resolve();
    expect(deferreds.map((d) => d.raw)).toEqual(['A', 'B']);
    // Newer save B completes first, then the older A resolves late.
    deferreds[1]!.resolve();
    deferreds[0]!.resolve();
    await undoPromise;
    await vi.runAllTimersAsync();
    // The server last received 'B'; the late 'A' result must not become the
    // controller's notion of saved state.
    expect(onSaved).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'B');
    // 'B' is now the saved state -> a no-op setRaw('B') must not re-save.
    c.setRaw('B');
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('dispose() clears the pending debounce so no save fires after', async () => {
    const save = vi.fn(async () => okResult());
    const c = new AutoSaveController({
      initialRaw: 'v0',
      debounceMs: 500,
      save,
      onSaved: vi.fn(),
      onError: vi.fn(),
    });
    c.setRaw('v1');
    c.dispose();
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
  });

  it('skips save and calls onError when validator returns an error', async () => {
    const save = vi.fn(async () => okResult());
    const onError = vi.fn();
    const onSaved = vi.fn();
    const validate = vi.fn((raw: string) => (raw === 'bad' ? 'cannot parse' : null));
    const c = new AutoSaveController({
      initialRaw: 'v0',
      debounceMs: 500,
      save,
      onSaved,
      onError,
      validate,
    });
    c.setRaw('bad');
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain('cannot parse');
  });

  it('saves when validator returns null (valid)', async () => {
    const save = vi.fn(async () => okResult());
    const onSaved = vi.fn();
    const validate = vi.fn(() => null);
    const c = new AutoSaveController({
      initialRaw: 'v0',
      debounceMs: 500,
      save,
      onSaved,
      onError: vi.fn(),
      validate,
    });
    c.setRaw('ok');
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
