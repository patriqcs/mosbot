import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const TTL_MS = 24 * 60 * 60 * 1000;
const BTTV_GLOBAL_URL = 'https://api.betterttv.net/3/cached/emotes/global';
const BTTV_CHANNEL_URL = (twitchUserId: string): string =>
  `https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(twitchUserId)}`;

export interface BttvEmote {
  readonly id: string;
  readonly code: string;
  readonly imageType: 'png' | 'gif';
}

export interface BttvChannelData {
  readonly byName: Record<string, BttvEmote>;
  readonly fetchedAt: number;
}

interface BttvState {
  global: BttvChannelData | null;
  channels: Record<string, BttvChannelData>;
  inflightGlobal: boolean;
  inflightChannels: Record<string, boolean>;
  ensureGlobal: () => Promise<void>;
  ensureChannel: (login: string, twitchUserId: string) => Promise<void>;
}

interface BttvRaw {
  id: string;
  code: string;
  imageType?: string;
}

interface BttvChannelResponse {
  channelEmotes?: BttvRaw[];
  sharedEmotes?: BttvRaw[];
}

const toEmote = (e: BttvRaw): BttvEmote => ({
  id: e.id,
  code: e.code,
  imageType: e.imageType === 'gif' ? 'gif' : 'png',
});

const indexByCode = (emotes: BttvRaw[]): Record<string, BttvEmote> => {
  const out: Record<string, BttvEmote> = {};
  for (const e of emotes) {
    if (e.id && e.code) out[e.code] = toEmote(e);
  }
  return out;
};

const isFresh = (data: BttvChannelData | undefined | null, now: number): boolean =>
  !!data && now - data.fetchedAt < TTL_MS;

export const useBttvStore = create<BttvState>()(
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
          const r = await fetch(BTTV_GLOBAL_URL);
          if (!r.ok) throw new Error(`bttv global ${r.status}`);
          const raw = (await r.json()) as BttvRaw[];
          set({
            global: { byName: indexByCode(raw), fetchedAt: Date.now() },
            inflightGlobal: false,
          });
        } catch (err) {
          console.warn('[bttv] global fetch failed', err);
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
          const r = await fetch(BTTV_CHANNEL_URL(twitchUserId));
          let byName: Record<string, BttvEmote> = {};
          if (r.ok) {
            const data = (await r.json()) as BttvChannelResponse;
            byName = {
              ...indexByCode(data.channelEmotes ?? []),
              ...indexByCode(data.sharedEmotes ?? []),
            };
          } else if (r.status !== 404) {
            throw new Error(`bttv channel ${r.status}`);
          }
          set((state) => ({
            channels: { ...state.channels, [key]: { byName, fetchedAt: Date.now() } },
            inflightChannels: { ...state.inflightChannels, [key]: false },
          }));
        } catch (err) {
          console.warn('[bttv] channel fetch failed', login, err);
          set((state) => ({
            inflightChannels: { ...state.inflightChannels, [key]: false },
          }));
        }
      },
    }),
    {
      name: 'mosbot.bttv',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ global: state.global, channels: state.channels }),
    },
  ),
);
