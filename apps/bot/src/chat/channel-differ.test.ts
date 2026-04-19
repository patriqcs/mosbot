import { describe, it, expect } from 'vitest';
import { applyFilter, diffChannels } from './channel-differ.js';

describe('diffChannels', () => {
  it('computes join/part diffs case-insensitively', () => {
    const res = diffChannels(['Alice', 'bob'], ['bob', 'CAROL']);
    expect(res.part).toEqual(['alice']);
    expect(res.join).toEqual(['carol']);
  });

  it('returns empty arrays when sets match', () => {
    const res = diffChannels(['a'], ['A']);
    expect(res.part).toEqual([]);
    expect(res.join).toEqual([]);
  });
});

describe('applyFilter', () => {
  it('honours blacklist', () => {
    const out = applyFilter(['a', 'b', 'c'], { blacklist: ['b'] });
    expect(out.sort()).toEqual(['a', 'c']);
  });

  it('whitelist overrides — only listed channels pass', () => {
    const out = applyFilter(['a', 'b', 'c'], { whitelist: ['b', 'd'] });
    expect(out).toEqual(['b']);
  });

  it('blacklist still filters inside whitelist', () => {
    const out = applyFilter(['a', 'b'], { whitelist: ['a', 'b'], blacklist: ['B'] });
    expect(out).toEqual(['a']);
  });

  it('deduplicates input', () => {
    const out = applyFilter(['A', 'a', 'A'], {});
    expect(out).toEqual(['a']);
  });
});
