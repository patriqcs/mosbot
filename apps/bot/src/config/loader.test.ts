import { describe, it, expect } from 'vitest';
import { interpolateEnv } from './loader.js';

describe('interpolateEnv', () => {
  const env = { FOO: 'bar', KEY: 'secret' };

  it('replaces a single placeholder', () => {
    expect(interpolateEnv('${FOO}', env)).toBe('bar');
  });

  it('replaces multiple placeholders', () => {
    expect(interpolateEnv('${FOO}-${KEY}', env)).toBe('bar-secret');
  });

  it('leaves undefined vars empty', () => {
    expect(interpolateEnv('${MISSING}', env)).toBe('');
  });

  it('recurses into objects and arrays', () => {
    const input = {
      top: '${FOO}',
      nested: { key: '${KEY}' },
      list: ['${FOO}', 'literal'],
    };
    expect(interpolateEnv(input, env)).toEqual({
      top: 'bar',
      nested: { key: 'secret' },
      list: ['bar', 'literal'],
    });
  });
});
