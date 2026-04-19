import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { eventStream } from '@/lib/ws';
import { ensureLiveSubscription, useLiveStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDuration, formatNumber } from '@/lib/utils';

const Tile = ({ label, value }: { label: string; value: string | number }): JSX.Element => (
  <Card>
    <CardContent className="p-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </CardContent>
  </Card>
);

export const OverviewPage = (): JSX.Element => {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 5_000 });
  const events = useLiveStore((s) => s.events);

  useEffect(() => {
    ensureLiveSubscription();
    eventStream.connect();
    const off = eventStream.on((ev) => {
      if (ev.type === 'play-sent' || ev.type === 'discovery' || ev.type === 'auth') {
        void qc.invalidateQueries({ queryKey: ['status'] });
      }
    });
    return () => off();
  }, [qc]);

  const running = status.data?.running ?? false;
  const counts = status.data?.counts ?? { streamsSeen: 0, channelsJoined: 0, playsSent: 0, lobbiesDetected: 0 };

  const toggle = async (): Promise<void> => {
    if (running) await api.stopBot();
    else await api.startBot();
    await qc.invalidateQueries({ queryKey: ['status'] });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="flex items-center gap-3">
          <Badge variant={running ? 'success' : 'secondary'}>
            {running ? 'Running' : 'Stopped'}
          </Badge>
          <Button onClick={toggle} variant={running ? 'destructive' : 'default'}>
            {running ? (
              <>
                <Square className="mr-2 h-4 w-4" /> Stop
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" /> Start
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Plays sent" value={formatNumber(counts.playsSent)} />
        <Tile label="Lobbies" value={formatNumber(counts.lobbiesDetected)} />
        <Tile label="Channels" value={formatNumber(counts.channelsJoined)} />
        <Tile
          label="Uptime"
          value={formatDuration(status.data?.uptimeSeconds ?? 0)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto space-y-1 font-mono text-xs">
            {events.length === 0 && (
              <div className="text-muted-foreground">waiting for events…</div>
            )}
            {events.slice(0, 100).map((e) => (
              <div key={e.id} className="flex items-center gap-2 whitespace-nowrap">
                <span className="shrink-0 text-muted-foreground">{e.event.at.slice(11, 19)}</span>
                <Badge variant="outline" className="shrink-0">
                  {e.event.type}
                </Badge>
                <span className="truncate">{summarize(e.event)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const summarize = (ev: { type: string } & Record<string, unknown>): string => {
  if (ev.type === 'chat') {
    const ch = typeof ev.channel === 'string' ? ev.channel : '';
    const user = typeof ev.user === 'string' ? ev.user : '';
    const text = typeof ev.text === 'string' ? ev.text : '';
    return `#${ch} <${user}> ${text}`;
  }
  if (ev.type === 'play-sent') {
    const acc = typeof ev.account === 'string' ? ev.account : '';
    const ch = typeof ev.channel === 'string' ? ev.channel : '';
    return `${acc}/${ch} → !play`;
  }
  if (ev.type === 'join' || ev.type === 'part') {
    const acc = typeof ev.account === 'string' ? ev.account : '';
    const ch = typeof ev.channel === 'string' ? ev.channel : '';
    return `${acc} ${ev.type} #${ch}`;
  }
  if (ev.type === 'auth') {
    const acc = typeof ev.account === 'string' ? ev.account : '';
    const phase = typeof ev.phase === 'string' ? ev.phase : '';
    return `${acc} ${phase}`;
  }
  if (ev.type === 'discovery') {
    const streams = ev.streams as unknown as unknown[];
    return `${streams?.length ?? 0} streams`;
  }
  if ('channel' in ev && typeof ev.channel === 'string') {
    const account = 'account' in ev && typeof ev.account === 'string' ? ev.account : '';
    return `${account ? account + '/' : ''}${ev.channel}`;
  }
  return JSON.stringify(ev).slice(0, 120);
};
