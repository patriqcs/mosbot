export type EmoteProvider = 'twitch' | 'bttv' | '7tv';

export interface EmoteToken {
  readonly type: 'emote';
  readonly provider: EmoteProvider;
  readonly id: string;
  readonly name: string;
}

export interface TextToken {
  readonly type: 'text';
  readonly text: string;
}

export type ChatToken = EmoteToken | TextToken;

interface EmoteRange {
  start: number;
  end: number;
  id: string;
}

/**
 * Splits a chat message into text + emote tokens using Twitch's IRC emote
 * offsets. Offsets are codepoint-indexed and inclusive (start..end), so we
 * decompose the text via Array.from to count user-perceived characters
 * correctly when the message contains astral codepoints.
 */
export const tokenizeChatText = (
  text: string,
  emoteOffsets: Record<string, readonly string[]>,
): ChatToken[] => {
  const ranges = collectRanges(emoteOffsets);
  if (ranges.length === 0) {
    return text ? [{ type: 'text', text }] : [];
  }
  const cps = Array.from(text);
  ranges.sort((a, b) => a.start - b.start);

  const tokens: ChatToken[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor || r.end >= cps.length || r.start > r.end) continue;
    if (r.start > cursor) {
      tokens.push({ type: 'text', text: cps.slice(cursor, r.start).join('') });
    }
    const name = cps.slice(r.start, r.end + 1).join('');
    tokens.push({ type: 'emote', provider: 'twitch', id: r.id, name });
    cursor = r.end + 1;
  }
  if (cursor < cps.length) {
    tokens.push({ type: 'text', text: cps.slice(cursor).join('') });
  }
  return tokens;
};

const collectRanges = (
  emoteOffsets: Record<string, readonly string[]>,
): EmoteRange[] => {
  const ranges: EmoteRange[] = [];
  for (const [id, offsets] of Object.entries(emoteOffsets)) {
    for (const off of offsets) {
      const dash = off.indexOf('-');
      if (dash < 0) continue;
      const start = Number(off.slice(0, dash));
      const end = Number(off.slice(dash + 1));
      if (Number.isInteger(start) && Number.isInteger(end)) {
        ranges.push({ start, end, id });
      }
    }
  }
  return ranges;
};

export type EmoteTheme = 'light' | 'dark';
export type EmoteScale = '1.0' | '2.0' | '3.0';

/**
 * Twitch CDN URL for a static-or-animated emote. `default` format means the
 * server picks animated when available and falls back to static otherwise.
 */
export const twitchEmoteUrl = (
  id: string,
  theme: EmoteTheme = 'dark',
  scale: EmoteScale = '2.0',
): string => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/${theme}/${scale}`;

export type BttvScale = '1x' | '2x' | '3x';

export const bttvEmoteUrl = (id: string, scale: BttvScale = '2x'): string =>
  `https://cdn.betterttv.net/emote/${id}/${scale}`;

export type SevenTvScale = '1x' | '2x' | '3x' | '4x';
export type SevenTvFormat = 'webp' | 'avif' | 'gif' | 'png';

export const sevenTvEmoteUrl = (
  id: string,
  scale: SevenTvScale = '2x',
  format: SevenTvFormat = 'webp',
): string => `https://cdn.7tv.app/emote/${id}/${scale}.${format}`;

export interface NameLookupEntry {
  readonly id: string;
}

/**
 * Replaces whole words in text-tokens with emote-tokens whenever the word
 * matches a key in `lookup`. Word boundaries are runs of whitespace — this
 * matches how Twitch IRC emotes behave (substring-of-word never matches).
 * Already-resolved emote-tokens are passed through untouched.
 */
export const applyEmoteLookup = (
  tokens: ChatToken[],
  lookup: Record<string, NameLookupEntry>,
  provider: EmoteProvider,
): ChatToken[] => {
  if (tokens.length === 0) return tokens;
  if (Object.keys(lookup).length === 0) return tokens;

  const out: ChatToken[] = [];
  for (const tok of tokens) {
    if (tok.type === 'emote') {
      out.push(tok);
      continue;
    }
    const parts = tok.text.split(/(\s+)/);
    let buffer = '';
    for (const part of parts) {
      const match = part.length > 0 && /\S/.test(part) ? lookup[part] : undefined;
      if (match) {
        if (buffer) {
          out.push({ type: 'text', text: buffer });
          buffer = '';
        }
        out.push({ type: 'emote', provider, id: match.id, name: part });
      } else {
        buffer += part;
      }
    }
    if (buffer) out.push({ type: 'text', text: buffer });
  }
  return out;
};
