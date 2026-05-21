import { describe, expect, it } from 'vitest';
import { load as loadYaml } from 'js-yaml';
import {
  addAccount,
  applyAccountsToYaml,
  createAccount,
  removeAccount,
  toggleAccount,
  validateAccountName,
} from './accounts-draft';

describe('createAccount', () => {
  it('returns a disabled entry with the given name and client id', () => {
    const a = createAccount('main', '${TWITCH_CLIENT_ID}');
    expect(a).toEqual({
      name: 'main',
      enabled: false,
      clientId: '${TWITCH_CLIENT_ID}',
    });
  });
});

describe('addAccount', () => {
  it('appends the entry to a fresh list', () => {
    const a = createAccount('main', '${A}');
    const next = addAccount([], a);
    expect(next).toEqual([a]);
  });

  it('returns a new array (does not mutate input)', () => {
    const list = [createAccount('main', '${A}')];
    const next = addAccount(list, createAccount('alt', '${B}'));
    expect(next).not.toBe(list);
    expect(list).toHaveLength(1);
  });

  it('throws when the name is already taken (case-insensitive)', () => {
    const list = [createAccount('Main', '${A}')];
    expect(() => addAccount(list, createAccount('main', '${B}'))).toThrow(
      /already exists/i,
    );
  });
});

describe('toggleAccount', () => {
  it('flips the enabled flag for the named entry', () => {
    const list = [
      { name: 'a', enabled: false, clientId: '${A}' },
      { name: 'b', enabled: true, clientId: '${B}' },
    ];
    const next = toggleAccount(list, 'a');
    expect(next.find((x) => x.name === 'a')?.enabled).toBe(true);
    expect(next.find((x) => x.name === 'b')?.enabled).toBe(true);
  });

  it('matches names case-insensitively', () => {
    const list = [{ name: 'Main', enabled: false, clientId: '${A}' }];
    const next = toggleAccount(list, 'main');
    expect(next[0]?.enabled).toBe(true);
  });

  it('throws on unknown account', () => {
    expect(() => toggleAccount([], 'ghost')).toThrow(/unknown account/i);
  });

  it('does not mutate the input list', () => {
    const list = [{ name: 'a', enabled: false, clientId: '${A}' }];
    toggleAccount(list, 'a');
    expect(list[0]?.enabled).toBe(false);
  });
});

describe('removeAccount', () => {
  it('drops the named entry', () => {
    const list = [
      { name: 'a', enabled: false, clientId: '${A}' },
      { name: 'b', enabled: true, clientId: '${B}' },
    ];
    expect(removeAccount(list, 'a')).toEqual([
      { name: 'b', enabled: true, clientId: '${B}' },
    ]);
  });

  it('matches names case-insensitively', () => {
    const list = [{ name: 'Main', enabled: true, clientId: '${A}' }];
    expect(removeAccount(list, 'main')).toEqual([]);
  });

  it('throws on unknown account', () => {
    expect(() => removeAccount([], 'ghost')).toThrow(/unknown account/i);
  });
});

describe('validateAccountName', () => {
  it.each([
    ['main'],
    ['bot1'],
    ['my_bot_2'],
    ['a'],
  ])('accepts %p', (name) => {
    expect(validateAccountName(name)).toEqual({ ok: true });
  });

  it.each([
    ['', /empty/i],
    ['   ', /empty/i],
    ['Main', /lowercase/i],
    ['has space', /letters/i],
    ['bad-name', /letters/i],
    ['bad.name', /letters/i],
    ['über', /letters/i],
  ])('rejects %p', (name, expected) => {
    const r = validateAccountName(name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(expected);
  });
});

describe('applyAccountsToYaml', () => {
  const baseYaml = `server:
  host: 0.0.0.0
  port: 8787
accounts:
  - name: main
    enabled: true
    clientId: \${TWITCH_CLIENT_ID}
discovery:
  intervalMinutes: 5
`;

  it('replaces the accounts: section with the new list', () => {
    const next = [
      { name: 'main', enabled: false, clientId: '${TWITCH_CLIENT_ID}' },
      { name: 'alt', enabled: true, clientId: '${OTHER_CLIENT_ID}' },
    ];
    const out = applyAccountsToYaml(baseYaml, next);
    const parsed = loadYaml(out) as { accounts: unknown };
    expect(parsed.accounts).toEqual(next);
  });

  it('preserves other top-level keys', () => {
    const out = applyAccountsToYaml(baseYaml, []);
    const parsed = loadYaml(out) as Record<string, unknown>;
    expect(parsed.server).toEqual({ host: '0.0.0.0', port: 8787 });
    expect(parsed.discovery).toEqual({ intervalMinutes: 5 });
  });

  it('writes an empty list when no accounts remain', () => {
    const out = applyAccountsToYaml(baseYaml, []);
    const parsed = loadYaml(out) as { accounts: unknown };
    expect(parsed.accounts).toEqual([]);
  });

  it('creates the accounts section if missing', () => {
    const yaml = 'server:\n  host: 0.0.0.0\n';
    const out = applyAccountsToYaml(yaml, [
      { name: 'main', enabled: true, clientId: '${A}' },
    ]);
    const parsed = loadYaml(out) as { accounts: unknown };
    expect(parsed.accounts).toEqual([
      { name: 'main', enabled: true, clientId: '${A}' },
    ]);
  });
});
