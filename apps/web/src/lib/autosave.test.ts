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
});
