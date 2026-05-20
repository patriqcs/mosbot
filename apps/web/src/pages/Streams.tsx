import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronsUpDown, ExternalLink, Star, Tv } from 'lucide-react';
import { api } from '@/lib/api';
import type { StreamListItem } from '@mosbot/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusDot } from '@/components/ui/status-dot';

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

  const totalCount = q.data?.length ?? 0;
  const joinedCount = q.data?.filter((s) => s.joined).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Live Streams"
        description="Marbles-on-Stream channels discovered via Twitch Helix. The bot joins channels marked Joined."
        actions={
          <span className="inline-flex items-center gap-3 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs">
            <span className="font-mono tabular-nums">
              {joinedCount}
              <span className="text-muted-foreground"> / {totalCount}</span>
            </span>
            <span className="text-muted-foreground">joined</span>
          </span>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Tv className="h-4 w-4 text-primary" />
            Discovered channels
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={Tv}
                title="No streams discovered yet"
                description="Once the next discovery cycle finds live Marbles streams, they'll appear here."
                className="border-none bg-transparent"
              />
            </div>
          ) : (
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[42%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[24%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="border-b border-border/60 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <ThSort
                    label="Streamer"
                    f="streamer"
                    field={field}
                    dir={dir}
                    onClick={toggle}
                    align="left"
                  />
                  <ThSort
                    label="Viewers"
                    f="viewers"
                    field={field}
                    dir={dir}
                    onClick={toggle}
                    align="right"
                  />
                  <ThSort
                    label="Lang"
                    f="lang"
                    field={field}
                    dir={dir}
                    onClick={toggle}
                    align="center"
                  />
                  <ThSort
                    label="Status"
                    f="joined"
                    field={field}
                    dir={dir}
                    onClick={toggle}
                    align="center"
                  />
                  <ThSort
                    label="!play"
                    f="plays"
                    field={field}
                    dir={dir}
                    onClick={toggle}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr
                    key={s.userLogin}
                    className={`group border-b border-border/40 transition-colors last:border-0 hover:bg-muted/20 ${
                      s.preferred ? 'bg-warning/5' : ''
                    }`}
                  >
                    <td className="truncate py-2.5 pl-4 pr-2 text-left font-mono">
                      <div className="inline-flex items-center gap-2">
                        {s.preferred && (
                          <Star
                            className="h-3.5 w-3.5 shrink-0 fill-warning text-warning"
                            aria-label="preferred"
                          />
                        )}
                        <a
                          href={`https://twitch.tv/${s.userLogin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 transition-colors hover:text-primary"
                        >
                          {s.userLogin}
                          <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {s.viewerCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono text-xs uppercase text-muted-foreground">
                      {s.language || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                        {s.joined ? (
                          <Badge variant="success" className="gap-1">
                            <StatusDot variant="success" pulse className="h-1.5 w-1.5" />
                            joined
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            not joined
                          </Badge>
                        )}
                        {s.preferred && (
                          <Badge className="border-transparent bg-warning/90 text-warning-foreground">
                            preferred
                          </Badge>
                        )}
                        {s.blacklisted && (
                          <Badge variant="destructive">blacklisted</Badge>
                        )}
                        {s.whitelisted && (
                          <Badge variant="secondary">whitelisted</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {s.playsSent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  right: 'text-right px-4 justify-end',
};

const ThSort = ({
  label,
  f,
  field,
  dir,
  onClick,
  align = 'left',
}: ThSortProps): JSX.Element => {
  const active = field === f;
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`py-2.5 font-medium ${ALIGN_CLASSES[align]}`}>
      <button
        type="button"
        onClick={() => onClick(f)}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`inline-flex items-center gap-1 transition-colors ${
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
