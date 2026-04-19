import { useEffect, useState } from 'react';
import { eventStream } from '@/lib/ws';
import { ensureLiveSubscription, useLiveStore } from '@/lib/store';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BotEvent } from '@mosbot/shared';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_RANK: Record<Level, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

const levelColor = (l: Level): string => {
  switch (l) {
    case 'error':
      return 'text-red-500';
    case 'warn':
      return 'text-yellow-500';
    case 'info':
      return 'text-blue-400';
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
      <h1 className="text-2xl font-bold">Logs</h1>
      <div className="flex gap-2 items-center">
        <Input
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1">
          {LEVELS.map((l) => (
            <Button
              key={l}
              variant={level === l ? 'default' : 'outline'}
              size="sm"
              onClick={() => changeLevel(l)}
            >
              {l}
            </Button>
          ))}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Live tail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[70vh] overflow-y-auto font-mono text-xs space-y-0.5">
            {filtered.map((e) => {
              const lvl = levelForEvent(e.event);
              return (
                <div key={e.id} className="whitespace-pre-wrap break-words">
                  <span className="text-muted-foreground">{e.event.at}</span>{' '}
                  <span className={`font-semibold uppercase ${levelColor(lvl)}`}>{lvl}</span>{' '}
                  <span className="font-semibold">[{e.event.type}]</span>{' '}
                  {JSON.stringify(e.event)}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-muted-foreground">no matching events</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
