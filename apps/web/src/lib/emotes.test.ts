import { describe, it, expect } from 'vitest';
import {
  applyEmoteLookup,
  bttvEmoteUrl,
  sevenTvEmoteUrl,
  tokenizeChatText,
  twitchEmoteUrl,
} from './emotes';

describe('tokenizeChatText', () => {
  it('returns a single text token when no offsets are given', () => {
    expect(tokenizeChatText('hello world', {})).toEqual([
      { type: 'text', text: 'hello world' },
    ]);
  });

  it('returns no tokens for empty input without offsets', () => {
    expect(tokenizeChatText('', {})).toEqual([]);
  });

  it('splits a single emote sitting in the middle of the text', () => {
    // "hi Kappa there" — "Kappa" is at codepoint indices 3..7 (inclusive)
    const tokens = tokenizeChatText('hi Kappa there', { '25': ['3-7'] });
    expect(tokens).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'emote', provider: 'twitch', id: '25', name: 'Kappa' },
      { type: 'text', text: ' there' },
    ]);
  });

  it('keeps multiple unsorted emote ranges in textual order', () => {
    // "LULW Kappa LULW" — first LULW 0..3, Kappa 5..9, second LULW 11..14
    const tokens = tokenizeChatText('LULW Kappa LULW', {
      '25': ['5-9'],
      'lulw-id': ['0-3', '11-14'],
    });
    expect(tokens.map((t) => (t.type === 'emote' ? `e:${t.name}` : `t:${t.text}`))).toEqual([
      'e:LULW',
      't: ',
      'e:Kappa',
      't: ',
      'e:LULW',
    ]);
  });

  it('respects codepoint-based offsets when an astral codepoint is present', () => {
    // "🎉 Kappa" — 🎉 is 1 codepoint (but 2 UTF-16 units), then space, then Kappa@2..6
    const tokens = tokenizeChatText('🎉 Kappa', { '25': ['2-6'] });
    expect(tokens).toEqual([
      { type: 'text', text: '🎉 ' },
      { type: 'emote', provider: 'twitch', id: '25', name: 'Kappa' },
    ]);
  });

  it('drops malformed and out-of-bounds ranges silently', () => {
    const tokens = tokenizeChatText('hi', {
      '1': ['oops'],
      '2': ['5-7'],
      '3': ['1-0'],
    });
    expect(tokens).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('skips overlapping ranges that come after an already-consumed cursor', () => {
    // first range 0..4 ("Kappa"), second range 2..6 overlaps and is dropped
    const tokens = tokenizeChatText('Kappa!', {
      a: ['0-4'],
      b: ['2-6'],
    });
    expect(tokens).toEqual([
      { type: 'emote', provider: 'twitch', id: 'a', name: 'Kappa' },
      { type: 'text', text: '!' },
    ]);
  });
});

describe('twitchEmoteUrl', () => {
  it('defaults to dark theme and 2.0 scale', () => {
    expect(twitchEmoteUrl('25')).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
    );
  });

  it('honors explicit theme and scale', () => {
    expect(twitchEmoteUrl('25', 'light', '3.0')).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/25/default/light/3.0',
    );
  });
});

describe('bttvEmoteUrl', () => {
  it('defaults to 2x scale', () => {
    expect(bttvEmoteUrl('abc')).toBe('https://cdn.betterttv.net/emote/abc/2x');
  });

  it('honors explicit scale', () => {
    expect(bttvEmoteUrl('abc', '3x')).toBe('https://cdn.betterttv.net/emote/abc/3x');
  });
});

describe('sevenTvEmoteUrl', () => {
  it('defaults to 2x scale and webp format', () => {
    expect(sevenTvEmoteUrl('abc')).toBe('https://cdn.7tv.app/emote/abc/2x.webp');
  });

  it('honors explicit scale and format', () => {
    expect(sevenTvEmoteUrl('abc', '4x', 'avif')).toBe(
      'https://cdn.7tv.app/emote/abc/4x.avif',
    );
  });
});

describe('applyEmoteLookup', () => {
  const KEKW = { id: 'kekw-id' };
  const monkaS = { id: 'monka-id' };

  it('is a no-op with an empty lookup', () => {
    const tokens = [{ type: 'text' as const, text: 'KEKW' }];
    expect(applyEmoteLookup(tokens, {}, 'bttv')).toBe(tokens);
  });

  it('replaces whole-word matches in a text token', () => {
    const tokens = [{ type: 'text' as const, text: 'hello KEKW world' }];
    expect(applyEmoteLookup(tokens, { KEKW }, 'bttv')).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'emote', provider: 'bttv', id: 'kekw-id', name: 'KEKW' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('does not match substrings inside larger words', () => {
    // "MEGAKEKWGG" must NOT match KEKW
    const tokens = [{ type: 'text' as const, text: 'MEGAKEKWGG' }];
    expect(applyEmoteLookup(tokens, { KEKW }, 'bttv')).toEqual([
      { type: 'text', text: 'MEGAKEKWGG' },
    ]);
  });

  it('replaces multiple distinct matches in one token', () => {
    const tokens = [{ type: 'text' as const, text: 'KEKW monkaS KEKW' }];
    expect(
      applyEmoteLookup(tokens, { KEKW, monkaS }, 'bttv').map((t) =>
        t.type === 'emote' ? `e:${t.name}` : `t:${t.text}`,
      ),
    ).toEqual(['e:KEKW', 't: ', 'e:monkaS', 't: ', 'e:KEKW']);
  });

  it('passes through pre-existing emote tokens untouched', () => {
    const tokens = [
      { type: 'emote' as const, provider: 'twitch' as const, id: '25', name: 'Kappa' },
      { type: 'text' as const, text: ' KEKW' },
    ];
    const out = applyEmoteLookup(tokens, { KEKW }, 'bttv');
    expect(out).toEqual([
      { type: 'emote', provider: 'twitch', id: '25', name: 'Kappa' },
      { type: 'text', text: ' ' },
      { type: 'emote', provider: 'bttv', id: 'kekw-id', name: 'KEKW' },
    ]);
  });

  it('preserves surrounding whitespace exactly', () => {
    const tokens = [{ type: 'text' as const, text: '  KEKW   KEKW  ' }];
    const out = applyEmoteLookup(tokens, { KEKW }, 'bttv');
    expect(out.filter((t) => t.type === 'text').map((t) => t.type === 'text' && t.text)).toEqual([
      '  ',
      '   ',
      '  ',
    ]);
  });
});
