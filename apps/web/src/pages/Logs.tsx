import { useEffect, useState } from 'react';
import { ListOrdered, Search } from 'lucide-react';
import { eventStream } from '@/lib/ws';
import { ensureLiveSubscription, useLiveStore } from '@/lib/store';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import type { BotEvent } from '@mosbot/shared';
import { formatTimestamp } from '@/lib/utils';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_RANK: Record<Level, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

const levelColor = (l: Level): string => {
  switch (l) {
    case 'error':
      return 'text-destructive';
    case 'warn':
      return 'text-warning';
    case 'info':
      return 'text-info';
    case 'debug':
      return 'text-muted-foreground';
    case 'trace':
      return 'text-muted-foreground/60';
  }
};

const levelForEvent = (ev: BotEvent): Level => {
  switch (ev.type) {
    case 'chat':
      return 'trace';
    case 'discovery':
    case 'join':
    case 'part':
      return 'debug';
    case 'play-sent':
    case 'lobby-open':
      return 'info';
    case 'auth':
      if (ev.phase === 'failure') return 'error';
      if (ev.phase === 'pending' || ev.phase === 'device-code') return 'warn';
      return 'info';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
};

export const LogsPage = (): JSX.Element => {
  const events = useLiveStore((s) => s.events);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<Level>('info');

  useEffect(() => {
    ensureLiveSubscription();
    eventStream.connect();
  }, []);

  const minRank = LEVEL_RANK[level];
  const filtered = events.filter((e) => {
    if (LEVEL_RANK[levelForEvent(e.event)] < minRank) return false;
    if (!filter) return true;
    return JSON.stringify(e.event).toLowerCase().includes(filter.toLowerCase());
  });

  const changeLevel = async (l: Level): Promise<void> => {
    setLevel(l);
    await api.setLogLevel(l);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Logs"
        description="Live event tail from the bot. Increasing the level changes both the dashboard filter and the runtime log level."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="filter events…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {LEVELS.map((l) => (
            <Button
              key={l}
              variant={level === l ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => void changeLevel(l)}
              className="h-8 px-3 font-mono text-xs uppercase tracking-wide"
            >
              {l}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListOrdered className="h-4 w-4 text-primary" />
            Live tail
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
          </span>
        </CardHeader>
        <CardContent className="pt-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={ListOrdered}
              title="No matching events"
              description={
                filter
                  ? `No events match "${filter}" at level ${level}.`
                  : `Waiting for events at level ${level} or higher…`
              }
            />
          ) : (
            <div className="max-h-[70vh] space-y-0.5 overflow-y-auto rounded-md bg-background/60 p-3 font-mono text-xs ring-1 ring-border/40">
              {filtered.map((e) => {
                const lvl = levelForEvent(e.event);
                return (
                  <div
                    key={e.id}
                    className="whitespace-pre-wrap break-words rounded px-2 py-1 transition-colors hover:bg-muted/20"
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {formatTimestamp(e.event.at)}
                    </span>{' '}
                    <span className={`font-semibold uppercase tracking-wide ${levelColor(lvl)}`}>
                      {lvl}
                    </span>{' '}
                    <span className="font-semibold">[{e.event.type}]</span>{' '}
                    <span className="text-muted-foreground">{JSON.stringify(e.event)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
