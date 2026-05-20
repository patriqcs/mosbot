import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  Hash,
  Play,
  Radio,
  Send,
  Square,
  Timer,
  Tv,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { eventStream } from '@/lib/ws';
import { ensureLiveSubscription, useLiveStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MetricTile } from '@/components/ui/metric-tile';
import { PageHeader } from '@/components/ui/page-header';
import { StatusDot } from '@/components/ui/status-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { ChatBubble } from '@/components/ChatBubble';
import { useBttvStore } from '@/lib/bttv';
import { useSevenTvStore } from '@/lib/seventv';
import type { NameLookupEntry } from '@/lib/emotes';
import { formatDuration, formatNumber, formatTimestamp } from '@/lib/utils';
import type { BotEvent, MarblesTimerStatus } from '@mosbot/shared';

export const OverviewPage = (): JSX.Element => {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 5_000 });
  const streamsQuery = useQuery({
    queryKey: ['streams'],
    queryFn: api.streams,
    refetchInterval: 30_000,
  });
  const events = useLiveStore((s) => s.events);
  const avatars = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of streamsQuery.data ?? []) {
      if (s.profileImageUrl) m.set(s.userLogin, s.profileImageUrl);
    }
    return m;
  }, [streamsQuery.data]);
  const userIds = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of streamsQuery.data ?? []) {
      if (s.userId) m.set(s.userLogin, s.userId);
    }
    return m;
  }, [streamsQuery.data]);

  const bttvGlobal = useBttvStore((s) => s.global);
  const bttvChannels = useBttvStore((s) => s.channels);
  const ensureBttvGlobal = useBttvStore((s) => s.ensureGlobal);
  const ensureBttvChannel = useBttvStore((s) => s.ensureChannel);
  const sevenTvGlobal = useSevenTvStore((s) => s.global);
  const sevenTvChannels = useSevenTvStore((s) => s.channels);
  const ensureSevenTvGlobal = useSevenTvStore((s) => s.ensureGlobal);
  const ensureSevenTvChannel = useSevenTvStore((s) => s.ensureChannel);

  useEffect(() => {
    void ensureBttvGlobal();
    void ensureSevenTvGlobal();
  }, [ensureBttvGlobal, ensureSevenTvGlobal]);

  const activeChatChannels = useMemo(() => {
    const set = new Set<string>();
    for (const e of events.slice(0, LIVE_EVENTS_LIMIT)) {
      if (e.event.type === 'chat') set.add(e.event.channel);
    }
    return set;
  }, [events]);

  useEffect(() => {
    for (const ch of activeChatChannels) {
      const uid = userIds.get(ch);
      if (!uid) continue;
      void ensureBttvChannel(ch, uid);
      void ensureSevenTvChannel(ch, uid);
    }
  }, [activeChatChannels, userIds, ensureBttvChannel, ensureSevenTvChannel]);

  const bttvByChannel = useMemo(() => {
    const m = new Map<string, Record<string, NameLookupEntry>>();
    const globalByName = bttvGlobal?.byName ?? {};
    for (const ch of activeChatChannels) {
      const channelByName = bttvChannels[ch.toLowerCase()]?.byName ?? {};
      m.set(ch, { ...globalByName, ...channelByName });
    }
    return m;
  }, [bttvGlobal, bttvChannels, activeChatChannels]);

  const sevenTvByChannel = useMemo(() => {
    const m = new Map<string, Record<string, NameLookupEntry>>();
    const globalByName = sevenTvGlobal?.byName ?? {};
    for (const ch of activeChatChannels) {
      const channelByName = sevenTvChannels[ch.toLowerCase()]?.byName ?? {};
      m.set(ch, { ...globalByName, ...channelByName });
    }
    return m;
  }, [sevenTvGlobal, sevenTvChannels, activeChatChannels]);

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
  const counts = status.data?.counts ?? {
    streamsSeen: 0,
    channelsJoined: 0,
    playsSent: 0,
    lobbiesDetected: 0,
  };

  const toggle = async (): Promise<void> => {
    if (running) await api.stopBot();
    else await api.startBot();
    await qc.invalidateQueries({ queryKey: ['status'] });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Live state of the bot — discovery, lobby detection, and active Marbles timers."
        actions={
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs">
              <StatusDot variant={running ? 'success' : 'muted'} pulse={running} />
              <span className="font-medium tracking-wide">
                {running ? 'Running' : 'Stopped'}
              </span>
            </span>
            <Button
              onClick={toggle}
              variant={running ? 'destructive' : 'success'}
              size="sm"
              className="gap-1.5"
            >
              {running ? (
                <>
                  <Square className="h-3.5 w-3.5" /> Stop bot
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Start bot
                </>
              )}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Plays sent"
          value={formatNumber(counts.playsSent)}
          icon={Send}
          accent="primary"
          hint="Total !play messages issued"
        />
        <MetricTile
          label="Lobbies detected"
          value={formatNumber(counts.lobbiesDetected)}
          icon={Users}
          accent="info"
          hint="Distinct lobby windows observed"
        />
        <MetricTile
          label="Channels joined"
          value={formatNumber(counts.channelsJoined)}
          icon={Tv}
          accent="muted"
          hint="Currently in chat across accounts"
        />
        <MetricTile
          label="Uptime"
          value={formatDuration(status.data?.uptimeSeconds ?? 0)}
          icon={Timer}
          accent={running ? 'primary' : 'muted'}
          hint={running ? 'Since last start' : 'Bot is stopped'}
        />
      </div>

      <MarblesTimersCard timers={status.data?.marblesTimers ?? []} />

      <LiveEventsCard
        events={events}
        avatars={avatars}
        bttvByChannel={bttvByChannel}
        sevenTvByChannel={sevenTvByChannel}
      />
    </div>
  );
};

const LIVE_EVENTS_LIMIT = 300;
const SCROLL_THRESHOLD = 24;

interface LiveEventsCardProps {
  events: ReturnType<typeof useLiveStore.getState>['events'];
  avatars: Map<string, string>;
  bttvByChannel: Map<string, Record<string, NameLookupEntry>>;
  sevenTvByChannel: Map<string, Record<string, NameLookupEntry>>;
}

const LiveEventsCard = ({
  events,
  avatars,
  bttvByChannel,
  sevenTvByChannel,
}: LiveEventsCardProps): JSX.Element => {
  const visible = useMemo(
    () => events.slice(0, LIVE_EVENTS_LIMIT).slice().reverse(),
    [events],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastLengthRef = useRef(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastLengthRef.current;
    lastLengthRef.current = visible.length;
    if (visible.length > prev && atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visible.length, atBottom]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distFromBottom <= SCROLL_THRESHOLD);
  };

  const jumpToBottom = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4 text-primary" />
          Live events
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {atBottom ? 'live' : 'paused — scroll to bottom to resume'} ·{' '}
          {Math.min(events.length, LIVE_EVENTS_LIMIT)} shown
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        {visible.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="Waiting for events…"
            description="As soon as the bot observes lobbies, joins channels, or sends a !play, you'll see it here."
          />
        ) : (
          <div className="relative">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="max-h-[600px] space-y-1 overflow-y-auto pr-1"
            >
              {visible.map((e) =>
                e.event.type === 'chat' ? (
                  <ChatBubble
                    key={e.id}
                    event={e.event}
                    profileImageUrl={avatars.get(e.event.channel)}
                    bttvLookup={bttvByChannel.get(e.event.channel)}
                    sevenTvLookup={sevenTvByChannel.get(e.event.channel)}
                  />
                ) : (
                  <MonoLine key={e.id} event={e.event} />
                ),
              )}
            </div>
            {!atBottom && (
              <button
                type="button"
                onClick={jumpToBottom}
                className="absolute bottom-2 right-3 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-colors hover:bg-primary/90"
              >
                <ArrowDown className="h-3 w-3" />
                Jump to live
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const MonoLine = ({ event }: { event: BotEvent }): JSX.Element => (
  <div className="flex items-center gap-2 whitespace-nowrap rounded px-2 py-1 font-mono text-xs transition-colors hover:bg-muted/30">
    <span className="shrink-0 text-muted-foreground">{formatTimestamp(event.at)}</span>
    <Badge
      variant="outline"
      className="shrink-0 border-border/70 px-1.5 py-0 font-mono text-[10px] uppercase tracking-wide"
    >
      {event.type}
    </Badge>
    <span className="truncate">{summarize(event)}</span>
  </div>
);

const MAX_TIMERS = 3;

const MarblesTimersCard = ({ timers }: { timers: MarblesTimerStatus[] }): JSX.Element => {
  const qc = useQueryClient();
  const [tick, setTick] = useState(Date.now());
  const [skipping, setSkipping] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const active = timers
    .map((t) => ({ ...t, remainingMs: new Date(t.expiresAt).getTime() - tick }))
    .filter((t) => t.remainingMs > 0)
    .sort((a, b) => a.remainingMs - b.remainingMs);

  const slotUsage = active.length;
  const slotColor =
    slotUsage >= MAX_TIMERS ? 'destructive' : slotUsage >= 2 ? 'secondary' : 'success';

  const onSkip = async (account: string, channel: string): Promise<void> => {
    const key = `${account}:${channel}`;
    setSkipping(key);
    try {
      await api.skipMarblesTimer(account, channel);
      await qc.invalidateQueries({ queryKey: ['status'] });
    } catch {
      /* swallow — UI will refresh on next status poll */
    } finally {
      setSkipping(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="h-4 w-4 text-primary" />
            Marbles timers
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            12-minute cooldown per channel · max {MAX_TIMERS} concurrent slots
          </p>
        </div>
        <Badge variant={slotColor} className="font-mono tabular-nums">
          {slotUsage} / {MAX_TIMERS}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length === 0 && (
          <EmptyState
            icon={Hash}
            title="No active timers"
            description={`The bot may send !play in up to ${MAX_TIMERS} new streams whenever a lobby is detected.`}
          />
        )}
        {active.map((t) => {
          const totalSec = Math.max(0, Math.floor(t.remainingMs / 1000));
          const mm = Math.floor(totalSec / 60);
          const ss = (totalSec % 60).toString().padStart(2, '0');
          const totalWindow = 12 * 60;
          const pct = Math.max(0, Math.min(100, (totalSec / totalWindow) * 100));
          const key = `${t.account}:${t.channel}`;
          const isSkipping = skipping === key;
          return (
            <div
              key={key}
              className="space-y-1.5 rounded-md border border-border/50 bg-muted/20 p-3 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-center justify-between gap-3">
                <a
                  href={`https://twitch.tv/${t.channel}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 font-mono text-sm font-medium transition-colors ${
                    t.skipped
                      ? 'text-destructive line-through opacity-70'
                      : 'hover:text-primary'
                  }`}
                >
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  {t.channel}
                </a>
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-sm tabular-nums ${
                      t.skipped ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {mm}:{ss}
                  </span>
                  {!t.skipped && (
                    <button
                      type="button"
                      aria-label={`skip ${t.channel}`}
                      title="Skip this stream and pick another"
                      disabled={isSkipping}
                      onClick={() => void onSkip(t.account, t.channel)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    t.skipped
                      ? 'bg-destructive/70'
                      : 'bg-gradient-to-r from-primary/70 to-primary'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
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

