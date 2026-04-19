import { create } from 'zustand';
import type { BotEvent } from '@mosbot/shared';

interface EventLogEntry extends Record<string, unknown> {
  id: number;
  event: BotEvent;
}

interface LiveState {
  events: EventLogEntry[];
  pushEvent: (ev: BotEvent) => void;
  clear: () => void;
}

let counter = 0;
const MAX = 500;

export const useLiveStore = create<LiveState>((set) => ({
  events: [],
  pushEvent: (event) =>
    set((state) => {
      counter += 1;
      const next = [{ id: counter, event }, ...state.events];
      if (next.length > MAX) next.length = MAX;
      return { events: next };
    }),
  clear: () => set({ events: [] }),
}));
