import { useEffect, useState } from 'react';
import { eventStream } from '@/lib/ws';
import { ensureLiveSubscription, useLiveStore } from '@/lib/store';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;

export const LogsPage = (): JSX.Element => {
  const events = useLiveStore((s) => s.events);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('info');

  useEffect(() => {
    ensureLiveSubscription();
    eventStream.connect();
  }, []);

  const filtered = events.filter((e) => {
    if (!filter) return true;
    return JSON.stringify(e.event).toLowerCase().includes(filter.toLowerCase());
  });

  const changeLevel = async (l: (typeof LEVELS)[number]): Promise<void> => {
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
            {filtered.map((e) => (
              <div key={e.id} className="whitespace-pre-wrap break-words">
                <span className="text-muted-foreground">{e.event.at}</span>{' '}
                <span className="font-semibold">[{e.event.type}]</span>{' '}
                {JSON.stringify(e.event)}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-muted-foreground">no matching events</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
