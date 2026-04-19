export interface DiffResult {
  join: string[];
  part: string[];
}

export interface ChannelFilter {
  whitelist?: string[];
  blacklist?: string[];
}

const lc = (s: string): string => s.toLowerCase();

export const applyFilter = (
  logins: Iterable<string>,
  filter: ChannelFilter,
): string[] => {
  const wl = new Set((filter.whitelist ?? []).map(lc));
  const bl = new Set((filter.blacklist ?? []).map(lc));
  const out = new Set<string>();
  for (const raw of logins) {
    const name = lc(raw);
    if (wl.size > 0 && !wl.has(name)) continue;
    if (bl.has(name)) continue;
    out.add(name);
  }
  return [...out];
};

export const diffChannels = (
  currently: Iterable<string>,
  desired: Iterable<string>,
): DiffResult => {
  const cur = new Set([...currently].map(lc));
  const des = new Set([...desired].map(lc));
  return {
    join: [...des].filter((c) => !cur.has(c)),
    part: [...cur].filter((c) => !des.has(c)),
  };
};
