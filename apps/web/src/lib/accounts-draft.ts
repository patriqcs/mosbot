import { dump as dumpYaml, load as loadYaml } from 'js-yaml';

export interface AccountEntry {
  name: string;
  enabled: boolean;
  clientId: string;
}

export const createAccount = (name: string, clientId: string): AccountEntry => ({
  name,
  enabled: false,
  clientId,
});

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const addAccount = (
  list: readonly AccountEntry[],
  entry: AccountEntry,
): AccountEntry[] => {
  if (list.some((a) => sameName(a.name, entry.name))) {
    throw new Error(`account "${entry.name}" already exists`);
  }
  return [...list, entry];
};

export const toggleAccount = (
  list: readonly AccountEntry[],
  name: string,
): AccountEntry[] => {
  if (!list.some((a) => sameName(a.name, name))) {
    throw new Error(`unknown account "${name}"`);
  }
  return list.map((a) => (sameName(a.name, name) ? { ...a, enabled: !a.enabled } : a));
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const NAME_PATTERN = /^[a-z0-9_]+$/;

export const validateAccountName = (raw: string): ValidationResult => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'name must not be empty' };
  if (trimmed !== trimmed.toLowerCase()) {
    return { ok: false, reason: 'name must be lowercase' };
  }
  if (!NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: 'name may only contain letters, digits, and underscore',
    };
  }
  return { ok: true };
};

export const removeAccount = (
  list: readonly AccountEntry[],
  name: string,
): AccountEntry[] => {
  if (!list.some((a) => sameName(a.name, name))) {
    throw new Error(`unknown account "${name}"`);
  }
  return list.filter((a) => !sameName(a.name, name));
};

export const applyAccountsToYaml = (
  rawYaml: string,
  accounts: readonly AccountEntry[],
): string => {
  const parsed = (loadYaml(rawYaml) ?? {}) as Record<string, unknown>;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config YAML must be a mapping at the top level');
  }
  const next = { ...parsed, accounts: accounts.map((a) => ({ ...a })) };
  return dumpYaml(next, { lineWidth: 100, noRefs: true });
};
