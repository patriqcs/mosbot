import type { Logger } from 'pino';
import type { AppConfig, BotStatus } from '@mosbot/shared';
import type { AuthManager, AccountRuntime } from './auth/auth-manager.js';
import { Discovery } from './discovery/discovery.js';
import { ChatManager } from './chat/chat-manager.js';
import { LobbyDetector } from './lobby/lobby-detector.js';
import { PlayScheduler } from './lobby/play-scheduler.js';
import { MarblesTimerGuard } from './lobby/marbles-timer-guard.js';
import type { MarblesTimerRepo } from './lobby/marbles-timer-repo.js';
import { TokenBucket } from './ratelimit/bucket.js';
import { applyFilter, diffChannels } from './chat/channel-differ.js';
import type { EventBus } from './events/bus.js';
import type { StatsRepo } from './stats/repo.js';
import type { Metrics } from './metrics.js';

export interface OrchestratorDeps {
  config: AppConfig;
  auth: AuthManager;
  bus: EventBus;
  logger: Logger;
  stats: StatsRepo;
  metrics: Metrics;
  timerRepo: MarblesTimerRepo;
}

const MARBLES_WINDOW_MS = 12 * 60 * 1000;

interface AccountBundle {
  runtime: AccountRuntime;
  chat: ChatManager;
  bucket: TokenBucket;
  detector: LobbyDetector;
  timerGuard: MarblesTimerGuard;
  scheduler: PlayScheduler;
  discovery: Discovery;
}

export class Orchestrator {
  private readonly logger: Logger;
  private readonly bundles = new Map<string, AccountBundle>();
  private running = false;
  private startedAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private latestStreams: Map<string, { userName: string; viewerCount: number; language: string }> = new Map();

  constructor(private readonly deps: OrchestratorDeps) {
    this.logger = deps.logger.child({ module: 'orchestrator' });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    for (const acc of this.deps.config.accounts) {
      if (!acc.enabled) continue;
      const runtime = this.deps.auth.get(acc.name);
      if (!runtime) {
        this.logger.warn({ account: acc.name }, 'account not authorized yet — skipping');
        continue;
      }
      await this.bindAccount(runtime);
    }
    await this.runDiscoveryCycle();
    this.scheduleNextDiscovery();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const b of this.bundles.values()) {
      await b.chat.disconnect().catch(() => undefined);
    }
    this.bundles.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  async status(): Promise<BotStatus> {
    const accounts = await Promise.all(
      this.deps.config.accounts.map(async (a) => {
        const rt = this.deps.auth.get(a.name);
        const tokenExpiresAt = null;
        return {
          name: a.name,
          enabled: a.enabled,
          loggedIn: !!rt,
          username: rt?.userLogin ?? null,
          tokenExpiresAt,
          lastRefreshAt: null,
        };
      }),
    );
    const counts = this.deps.stats.counts();
    return {
      running: this.running,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      accounts,
      counts: { ...counts, channelsJoined: this.joinedChannels().size },
      marblesTimers: this.activeMarblesTimers(),
    };
  }

  activeMarblesTimers(): Array<{ account: string; channel: string; startedAt: string; expiresAt: string }> {
    const out: Array<{ account: string; channel: string; startedAt: string; expiresAt: string }> = [];
    for (const b of this.bundles.values()) {
      for (const t of b.timerGuard.active()) {
        out.push({
          account: b.runtime.name,
          channel: t.channel,
          startedAt: new Date(t.startedAt).toISOString(),
          expiresAt: new Date(t.expiresAt).toISOString(),
        });
      }
    }
    return out;
  }

  latestDiscovered(): Array<{ login: string; userName: string; viewerCount: number; language: string }> {
    return [...this.latestStreams.entries()].map(([login, v]) => ({ login, ...v }));
  }

  joinedChannels(): Set<string> {
    const all = new Set<string>();
    for (const b of this.bundles.values()) {
      for (const ch of b.chat.joinedChannels()) all.add(ch);
    }
    return all;
  }

  private async bindAccount(runtime: AccountRuntime): Promise<void> {
    const chat = new ChatManager({
      name: runtime.name,
      authProvider: runtime.provider,
      logger: this.logger,
      bus: this.deps.bus,
    });
    await chat.connect();
    const bucket = new TokenBucket({
      capacity: this.deps.config.ratelimit.verifiedBot
        ? 45
        : this.deps.config.ratelimit.userChatBudgetPer30s,
      refillWindowMs: 30_000,
    });
    const detector = new LobbyDetector({
      windowMs: this.deps.config.lobby.windowSeconds * 1000,
      minPlayers: this.deps.config.lobby.minPlayers,
      cooldownMs: this.deps.config.lobby.cooldownSeconds * 1000,
    });
    const cutoff = Date.now() - MARBLES_WINDOW_MS;
    const initial = this.deps.timerRepo
      .list(runtime.name, cutoff)
      .map((t) => [t.channel, t.startedAt] as [string, number]);
    const timerGuard = new MarblesTimerGuard({
      initial,
      onRecord: (channel, startedAt) => {
        this.deps.timerRepo.upsert(runtime.name, channel, startedAt);
      },
      onExpire: (channel) => {
        this.deps.timerRepo.delete(runtime.name, channel);
      },
    });
    const scheduler = new PlayScheduler({
      chat,
      bucket,
      detector,
      timerGuard,
      bus: this.deps.bus,
      logger: this.logger,
      accountName: runtime.name,
    });
    const discovery = new Discovery({
      clientId: runtime.clientId,
      getAccessToken: async () => {
        const tok = await runtime.provider.getAccessTokenForUser(runtime.userId);
        if (!tok) throw new Error(`no access token for ${runtime.name}`);
        return tok.accessToken;
      },
      config: this.deps.config.discovery,
      logger: this.logger,
    });
    chat.onMessage((channel, user, text) => {
      const trimmed = text.trim().toLowerCase();
      if (!/^!play(\s|$)/.test(trimmed)) return;
      if (user === runtime.userLogin.toLowerCase()) return;
      const { triggered, distinctUsers } = detector.observe(channel, user);
      if (this.deps.config.logging.chatLog) {
        this.deps.stats.recordChat(channel, user, text);
      }
      if (!triggered) return;
      void scheduler.schedule(channel, distinctUsers).then((outcome) => {
        if (outcome === 'sent') {
          this.deps.stats.recordPlay(runtime.name, channel);
          this.deps.stats.recordLobby(channel, distinctUsers);
          this.deps.metrics.playsSentTotal.inc({ account: runtime.name, channel });
          this.deps.metrics.lobbiesDetectedTotal.inc({ channel });
        } else if (outcome === 'throttled') {
          this.deps.metrics.rateLimitedTotal.inc({ account: runtime.name });
        } else if (outcome === 'timer-limit') {
          this.deps.metrics.marblesTimerDropsTotal.inc({ account: runtime.name });
        }
      });
    });
    this.bundles.set(runtime.name, {
      runtime,
      chat,
      bucket,
      detector,
      timerGuard,
      scheduler,
      discovery,
    });
  }

  private scheduleNextDiscovery(): void {
    if (!this.running) return;
    const ms = this.deps.config.discovery.intervalMinutes * 60_000;
    this.timer = setTimeout(() => {
      void this.runDiscoveryCycle().catch((err) => {
        this.logger.error({ err }, 'discovery cycle failed');
      });
      this.scheduleNextDiscovery();
    }, ms);
  }

  private async runDiscoveryCycle(): Promise<void> {
    const primary = this.bundles.values().next().value;
    if (!primary) return;
    const start = Date.now();
    const streams = await primary.discovery.fetchLiveStreams();
    const elapsed = (Date.now() - start) / 1000;
    this.deps.metrics.discoveryDuration.observe(elapsed);

    this.latestStreams = new Map(
      streams.map((s) => [
        s.userLogin,
        { userName: s.userName, viewerCount: s.viewerCount, language: s.language },
      ]),
    );
    for (const s of streams) this.deps.stats.recordStreamSeen(s);

    const desired = applyFilter(
      streams.map((s) => s.userLogin),
      this.deps.config.channels,
    );
    for (const b of this.bundles.values()) {
      const diff = diffChannels(b.chat.joinedChannels(), desired);
      for (const ch of diff.join) {
        this.deps.stats.recordChannelAction(b.runtime.name, ch, 'join');
      }
      for (const ch of diff.part) {
        this.deps.stats.recordChannelAction(b.runtime.name, ch, 'part');
      }
      await b.chat.applyDiff(diff.join, diff.part);
      this.deps.metrics.channelsJoinedGauge.set(
        { account: b.runtime.name },
        b.chat.joinedChannels().length,
      );
    }
    this.deps.bus.emit({
      type: 'discovery',
      at: new Date().toISOString(),
      streams,
      joined: [...this.joinedChannels()],
      parted: [],
    });
  }
}
