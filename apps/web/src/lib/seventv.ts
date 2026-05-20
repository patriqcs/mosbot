import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const TTL_MS = 24 * 60 * 60 * 1000;
const SEVENTV_GLOBAL_URL = 'https://7tv.io/v3/emote-sets/global';
const SEVENTV_CHANNEL_URL = (twitchUserId: string): string =>
  `https://7tv.io/v3/users/twitch/${encodeURIComponent(twitchUserId)}`;

export interface SevenTvEmote {
  readonly id: string;
  readonly name: string;
}

export interface SevenTvChannelData {
  readonly byName: Record<string, SevenTvEmote>;
  readonly fetchedAt: number;
}

interface SevenTvState {
  global: SevenTvChannelData | null;
  channels: Record<string, SevenTvChannelData>;
  inflightGlobal: boolean;
  inflightChannels: Record<string, boolean>;
  ensureGlobal: () => Promise<void>;
  ensureChannel: (login: string, twitchUserId: string) => Promise<void>;
}

interface SevenTvEmoteSetEmote {
  id: string;
  name: string;
  data?: { id?: string };
}

interface SevenTvGlobalResponse {
  emotes?: SevenTvEmoteSetEmote[];
}

interface SevenTvChannelResponse {
  emote_set?: { emotes?: SevenTvEmoteSetEmote[] };
}

const indexByName = (emotes: SevenTvEmoteSetEmote[]): Record<string, SevenTvEmote> => {
  const out: Record<string, SevenTvEmote> = {};
  for (const e of emotes) {
    const id = e.data?.id ?? e.id;
    if (id && e.name) out[e.name] = { id, name: e.name };
  }
  return out;
};

const isFresh = (data: SevenTvChannelData | undefined | null, now: number): boolean =>
  !!data && now - data.fetchedAt < TTL_MS;

export const useSevenTvStore = create<SevenTvState>()(
  persist(
    (set, get) => ({
      global: null,
      channels: {},
      inflightGlobal: false,
      inflightChannels: {},

      ensureGlobal: async (): Promise<void> => {
        const s = get();
        if (s.inflightGlobal) return;
        if (isFresh(s.global, Date.now())) return;
        set({ inflightGlobal: true });
        try {
          const r = await fetch(SEVENTV_GLOBAL_URL);
          if (!r.ok) throw new Error(`7tv global ${r.status}`);
          const data = (await r.json()) as SevenTvGlobalResponse;
          set({
            global: { byName: indexByName(data.emotes ?? []), fetchedAt: Date.now() },
            inflightGlobal: false,
          });
        } catch (err) {
          console.warn('[7tv] global fetch failed', err);
          set({ inflightGlobal: false });
        }
      },

      ensureChannel: async (login, twitchUserId): Promise<void> => {
        if (!twitchUserId) return;
        const key = login.toLowerCase();
        const s = get();
        if (s.inflightChannels[key]) return;
        if (isFresh(s.channels[key], Date.now())) return;
        set((state) => ({
          inflightChannels: { ...state.inflightChannels, [key]: true },
        }));
        try {
          const r = await fetch(SEVENTV_CHANNEL_URL(twitchUserId));
          let byName: Record<string, SevenTvEmote> = {};
          if (r.ok) {
            const data = (await r.json()) as SevenTvChannelResponse;
            byName = indexByName(data.emote_set?.emotes ?? []);
          } else if (r.status !== 404) {
            throw new Error(`7tv channel ${r.status}`);
          }
          set((state) => ({
            channels: { ...state.channels, [key]: { byName, fetchedAt: Date.now() } },
            inflightChannels: { ...state.inflightChannels, [key]: false },
          }));
        } catch (err) {
          console.warn('[7tv] channel fetch failed', login, err);
          set((state) => ({
            inflightChannels: { ...state.inflightChannels, [key]: false },
          }));
        }
      },
    }),
    {
      name: 'mosbot.7tv',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ global: state.global, channels: state.channels }),
    },
  ),
);
