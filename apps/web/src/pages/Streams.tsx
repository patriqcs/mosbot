import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { api } from '@/lib/api';
import type { StreamListItem } from '@mosbot/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type SortField = 'streamer' | 'viewers' | 'lang' | 'joined' | 'plays';
type SortDir = 'asc' | 'desc';

const DEFAULT_FIELD: SortField = 'viewers';
const DEFAULT_DIR: SortDir = 'desc';
const STORAGE_KEY = 'mosbot.streams.sort';
const VALID_FIELDS: readonly SortField[] = [
  'streamer',
  'viewers',
  'lang',
  'joined',
  'plays',
];

const loadStoredSort = (): { field: SortField; dir: SortDir } => {
  if (typeof window === 'undefined') return { field: DEFAULT_FIELD, dir: DEFAULT_DIR };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { field: DEFAULT_FIELD, dir: DEFAULT_DIR };
    const parsed = JSON.parse(raw) as { field?: unknown; dir?: unknown };
    const field =
      typeof parsed.field === 'string' && VALID_FIELDS.includes(parsed.field as SortField)
        ? (parsed.field as SortField)
        : DEFAULT_FIELD;
    const dir: SortDir = parsed.dir === 'asc' || parsed.dir === 'desc' ? parsed.dir : DEFAULT_DIR;
    return { field, dir };
  } catch {
    return { field: DEFAULT_FIELD, dir: DEFAULT_DIR };
  }
};

export const StreamsPage = (): JSX.Element => {
  const q = useQuery({ queryKey: ['streams'], queryFn: api.streams, refetchInterval: 10_000 });
  const initial = loadStoredSort();
  const [field, setField] = useState<SortField>(initial.field);
  const [dir, setDir] = useState<SortDir>(initial.dir);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ field, dir }));
    } catch {
      /* quota or private mode — ignore */
    }
  }, [field, dir]);

  const toggle = (f: SortField): void => {
    if (field === f) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setField(f);
      setDir(f === 'viewers' || f === 'plays' ? 'desc' : 'asc');
    }
  };

  const sorted = useMemo(() => {
    const list = [...(q.data ?? [])];
    list.sort((a, b) => compare(a, b, field) * (dir === 'asc' ? 1 : -1));
    return list;
  }, [q.data, field, dir]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Live Streams</h1>
      <Card>
        <CardHeader>
          <CardTitle>Discovered channels</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[45%]" />
              <col className="w-[15%]" />
              <col className="w-[10%]" />
              <col className="w-[20%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <ThSort label="Streamer" f="streamer" field={field} dir={dir} onClick={toggle} align="left" />
                <ThSort label="Viewers" f="viewers" field={field} dir={dir} onClick={toggle} align="right" />
                <ThSort label="Lang" f="lang" field={field} dir={dir} onClick={toggle} align="center" />
                <ThSort label="Joined" f="joined" field={field} dir={dir} onClick={toggle} align="center" />
                <ThSort label="!play" f="plays" field={field} dir={dir} onClick={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.userLogin} className="border-b last:border-0">
                  <td className="pl-4 pr-2 py-2 font-mono text-left truncate">
                    <a
                      href={`https://twitch.tv/${s.userLogin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary hover:underline"
                    >
                      {s.userLogin}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.viewerCount.toLocaleString()}</td>
                  <td className="px-4 py-2 text-center">{s.language}</td>
                  <td className="px-4 py-2 text-center">
                    <div className="inline-flex items-center gap-2">
                      <Badge variant={s.joined ? 'success' : 'outline'}>
                        {s.joined ? 'yes' : 'no'}
                      </Badge>
                      {s.blacklisted && <Badge variant="destructive">blacklisted</Badge>}
                      {s.whitelisted && <Badge variant="secondary">whitelisted</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.playsSent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!q.data || q.data.length === 0) && (
            <div className="p-6 text-center text-muted-foreground">No streams discovered yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

interface ThSortProps {
  label: string;
  f: SortField;
  field: SortField;
  dir: SortDir;
  onClick: (f: SortField) => void;
  align?: 'left' | 'center' | 'right';
}

const ALIGN_CLASSES: Record<NonNullable<ThSortProps['align']>, string> = {
  left: 'text-left pl-4 pr-2',
  center: 'text-center px-4',
  right: 'text-right px-4',
};

const ThSort = ({ label, f, field, dir, onClick, align = 'left' }: ThSortProps): JSX.Element => {
  const active = field === f;
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`py-2 ${ALIGN_CLASSES[align]}`}>
      <button
        type="button"
        onClick={() => onClick(f)}
        className={`inline-flex items-center gap-1 ${
          active ? 'text-foreground' : 'hover:text-foreground'
        }`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
};

const compare = (a: StreamListItem, b: StreamListItem, f: SortField): number => {
  switch (f) {
    case 'streamer':
      return a.userLogin.localeCompare(b.userLogin);
    case 'viewers':
      return a.viewerCount - b.viewerCount;
    case 'lang':
      return (a.language ?? '').localeCompare(b.language ?? '');
    case 'joined':
      return (a.joined ? 1 : 0) - (b.joined ? 1 : 0);
    case 'plays':
      return a.playsSent - b.playsSent;
  }
};
