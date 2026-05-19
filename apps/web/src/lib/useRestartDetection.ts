import { useEffect, useRef } from 'react';
import { api } from './api';

/**
 * Polls /api/health periodically and invokes `onRestart` when the bot's
 * process uptime drops (i.e. the container was restarted between two polls).
 * The hook is idempotent across mounts; the callback may be triggered at most
 * once per detected drop.
 */
export const useRestartDetection = (
  onRestart: () => void,
  pollMs = 30_000,
): void => {
  const lastUptimeRef = useRef<number | null>(null);
  const onRestartRef = useRef(onRestart);
  onRestartRef.current = onRestart;

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const { uptime } = await api.health();
        if (cancelled) return;
        const prev = lastUptimeRef.current;
        if (prev !== null && uptime < prev) {
          onRestartRef.current();
        }
        lastUptimeRef.current = uptime;
      } catch {
        // network blip — try again next tick
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);
};
