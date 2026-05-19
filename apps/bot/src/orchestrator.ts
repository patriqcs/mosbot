import type { Logger } from 'pino';
import type { AppConfig, BotStatus } from '@mosbot/shared';
import type { AuthManager, AccountRuntime } from './auth/auth-manager.js';
import { Discovery } from './discovery/discovery.js';
import { ChatManager } from './chat/chat-manager.js';
import { LobbyDetector } from './lobby/lobby-detector.js';
import { PlayScheduler } from './lobby/play-scheduler.js';
import { MarblesTimerGuard, MarblesTimerLimitError } from './lobby/marbles-timer-guard.js';
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
  fillingSlots: boolean;
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
    deps.bus.on('auth', (ev) => {
      if (ev.phase !== 'authorized') return;
      void this.handleAuthorized(ev.account).catch((err) => {
        this.logger.error(
          { err, account: ev.account },
          'failed to bind newly authorized account',
        );
      });
    });
  }

  private async handleAuthorized(name: string): Promise<void> {
    if (this.bundles.has(name)) return;
    const runtime = this.deps.auth.get(name);
    if (!runtime) return;
    if (!this.running) {
      await this.start();
      return;
    }
    await this.bindAccount(runtime);
    await this.runDiscoveryCycle();
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

  updateLobbyConfig(): void {
    const { lobby } = this.deps.config;
    for (const b of this.bundles.values()) {
      b.detector.update({
        windowMs: lobby.windowSeconds * 1000,
        minPlayers: lobby.minPlayers,
        cooldownMs: lobby.cooldownSeconds * 1000,
      });
    }
    this.logger.info({ lobby }, 'lobby config hot-reloaded');
  }

  updateRatelimitConfig(): void {
    const capacity = this.deps.config.ratelimit.verifiedBot
      ? 45
      : this.deps.config.ratelimit.userChatBudgetPer30s;
    for (const b of this.bundles.values()) {
      b.bucket.update({ capacity });
    }
    this.logger.info({ ratelimit: this.deps.config.ratelimit }, 'ratelimit config hot-reloaded');
  }

  updateDiscoveryConfig(): void {
    // Static fields (maxStreams, minViewers, language, sortBy) are read live from
    // deps.config on each cycle — no action needed. The only thing we own here is
    // the setTimeout schedule, which uses intervalMinutes.
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduleNextDiscovery();
    this.logger.info(
      { intervalMinutes: this.deps.config.discovery.intervalMinutes },
      'discovery interval hot-reloaded',
    );
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

  activeMarblesTimers(): Array<{
    account: string;
    channel: string;
    startedAt: string;
    expiresAt: string;
    skipped: boolean;
  }> {
    const out: Array<{
      account: string;
      channel: string;
      startedAt: string;
      expiresAt: string;
      skipped: boolean;
    }> = [];
    for (const b of this.bundles.values()) {
      for (const t of b.timerGuard.active()) {
        out.push({
          account: b.runtime.name,
          channel: t.channel,
          startedAt: new Date(t.startedAt).toISOString(),
          expiresAt: new Date(t.expiresAt).toISOString(),
          skipped: t.skipped,
        });
      }
    }
    return out;
  }

  async skipMarblesTimer(account: string, channel: string): Promise<boolean> {
    const bundle = this.bundles.get(account);
    if (!bundle) return false;
    const ch = channel.toLowerCase();
    const ok = bundle.timerGuard.skip(ch);
    if (!ok) return false;
    this.logger.info(
      { account, channel: ch },
      'marbles timer skipped, slot stays occupied until original 12-min window expires',
    );
    return true;
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
    const stored = this.deps.timerRepo.list(runtime.name, cutoff);
    const initial = stored
      .filter((t) => !t.skipped)
      .map((t) => [t.channel, t.startedAt] as [string, number]);
    const initialSkipped = stored
      .filter((t) => t.skipped)
      .map((t) => [t.channel, t.startedAt] as [string, number]);
    const timerGuard = new MarblesTimerGuard({
      initial,
      initialSkipped,
      onRecord: (channel, startedAt) => {
        this.deps.timerRepo.upsert(runtime.name, channel, startedAt);
      },
      onSkip: (channel) => {
        this.deps.timerRepo.markSkipped(runtime.name, channel);
      },
      onExpire: (channel) => {
        this.deps.timerRepo.delete(runtime.name, channel);
        const b = this.bundles.get(runtime.name);
        if (!b) return;
        queueMicrotask(() => {
          void this.fillFreeSlots(b).catch((err) => {
            this.logger.error(
              { err, account: runtime.name, channel },
              'fillFreeSlots after expire failed',
            );
          });
        });
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
      this.deps.stats.recordLobby(channel, distinctUsers);
      this.deps.metrics.lobbiesDetectedTotal.inc({ channel });
      void scheduler
        .schedule(channel, distinctUsers)
        .then((outcome) => {
          if (outcome === 'sent') {
            this.deps.stats.recordPlay(runtime.name, channel);
            this.deps.metrics.playsSentTotal.inc({ account: runtime.name, channel });
          } else if (outcome === 'throttled') {
            this.deps.metrics.rateLimitedTotal.inc({ account: runtime.name });
          } else if (outcome === 'timer-limit') {
            this.deps.metrics.marblesTimerDropsTotal.inc({ account: runtime.name });
          }
        })
        .catch((err) => {
          this.logger.error(
            { err, channel, account: runtime.name },
            'scheduler.schedule rejected',
          );
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
      fillingSlots: false,
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
    const mainStreams = await primary.discovery.fetchLiveStreams();

    const blacklist = new Set(
      (this.deps.config.channels.blacklist ?? []).map((s) => s.toLowerCase()),
    );
    const preferList = (this.deps.config.channels.prefer ?? []).map((s) => s.toLowerCase());
    const seen = new Set(mainStreams.map((s) => s.userLogin));
    const preferToCheck = preferList.filter((p) => !seen.has(p) && !blacklist.has(p));
    let preferStreams: typeof mainStreams = [];
    if (preferToCheck.length > 0) {
      const marblesGameId = await primary.discovery
        .resolveGameId()
        .catch((err) => {
          this.logger.warn({ err }, 'prefer-live: resolveGameId failed');
          return null;
        });
      if (marblesGameId) {
        preferStreams = await primary.discovery
          .fetchLiveStreamsForLogins(preferToCheck, { requireGameId: marblesGameId })
          .catch((err) => {
            this.logger.warn({ err }, 'prefer-live check failed');
            return [];
          });
      }
    }
    const streams = [...mainStreams, ...preferStreams];

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

    await this.handlePreferOnline();
  }

  private async handlePreferOnline(): Promise<void> {
    const prefer = (this.deps.config.channels.prefer ?? []).map((s) => s.toLowerCase());
    if (prefer.length === 0) return;
    const blacklist = new Set(
      (this.deps.config.channels.blacklist ?? []).map((s) => s.toLowerCase()),
    );
    const preferOnline = prefer
      .filter((p) => this.latestStreams.has(p) && !blacklist.has(p))
      .map((login) => ({
        login,
        viewerCount: this.latestStreams.get(login)?.viewerCount ?? 0,
      }));
    if (preferOnline.length === 0) return;
    const sortBy = this.deps.config.discovery.sortBy;
    preferOnline.sort((a, b) =>
      sortBy === 'least-viewers'
        ? a.viewerCount - b.viewerCount
        : b.viewerCount - a.viewerCount,
    );
    for (const bundle of this.bundles.values()) {
      for (const candidate of preferOnline) {
        if (bundle.timerGuard.isActive(candidate.login)) continue;
        if (bundle.timerGuard.isSkipped(candidate.login)) continue;
        const gate = bundle.timerGuard.canSend(candidate.login);
        if (gate.allowed) {
          await this.forcePlay(bundle, candidate.login, 'prefer-online');
        } else if (gate.reason === 'slot-taken') {
          const victim = bundle.timerGuard.shortestRemaining();
          if (!victim) continue;
          if (prefer.includes(victim.channel)) continue;
          bundle.timerGuard.skip(victim.channel);
          this.logger.info(
            {
              account: bundle.runtime.name,
              evicted: victim.channel,
              prefer: candidate.login,
              expiresAt: new Date(victim.expiresAt).toISOString(),
            },
            'prefer-online: shortest timer marked skipped; prefer-channel will be played when that timer expires',
          );
        }
      }
    }
  }

  private async fillFreeSlots(bundle: AccountBundle): Promise<void> {
    if (bundle.fillingSlots) return;
    if (bundle.timerGuard.slotsFree() === 0) return;
    bundle.fillingSlots = true;
    try {
      const sortBy = this.deps.config.discovery.sortBy;
      const blacklist = new Set(
        (this.deps.config.channels.blacklist ?? []).map((s) => s.toLowerCase()),
      );
      const prefer = new Set(
        (this.deps.config.channels.prefer ?? []).map((s) => s.toLowerCase()),
      );
      const whitelist = new Set(
        (this.deps.config.channels.whitelist ?? []).map((s) => s.toLowerCase()),
      );
      const candidates = [...this.latestStreams.entries()]
        .filter(([login]) => !blacklist.has(login))
        .filter(([login]) =>
          whitelist.size === 0 || whitelist.has(login) || prefer.has(login),
        )
        .filter(([login]) => !bundle.timerGuard.isActive(login))
        .filter(([login]) => !bundle.timerGuard.isSkipped(login))
        .map(([login, v]) => ({ login, viewerCount: v.viewerCount }));
      candidates.sort((a, b) => {
        const aP = prefer.has(a.login) ? 1 : 0;
        const bP = prefer.has(b.login) ? 1 : 0;
        if (aP !== bP) return bP - aP;
        return sortBy === 'least-viewers'
          ? a.viewerCount - b.viewerCount
          : b.viewerCount - a.viewerCount;
      });
      while (bundle.timerGuard.slotsFree() > 0) {
        const next = candidates.shift();
        if (!next) break;
        await this.forcePlay(bundle, next.login, 'replacement');
      }
    } finally {
      bundle.fillingSlots = false;
    }
  }

  private async forcePlay(
    bundle: AccountBundle,
    channel: string,
    reason: string,
  ): Promise<boolean> {
    if (bundle.timerGuard.isActive(channel)) {
      this.logger.debug(
        { channel, reason },
        'force-play: channel already has active timer, skipping to avoid reset',
      );
      return false;
    }
    if (!bundle.detector.hasObservedLobby(channel)) {
      this.logger.debug(
        { channel, reason },
        'force-play: no chat-detected marbles lobby in channel, skipping speculative !play',
      );
      return false;
    }
    if (bundle.detector.isOnCooldown(channel)) {
      this.logger.debug(
        { channel, reason },
        'force-play: detector is in cooldown for channel, skipping',
      );
      return false;
    }
    const gate = bundle.timerGuard.canSend(channel);
    if (!gate.allowed) return false;
    let reservedAt: number;
    try {
      reservedAt = bundle.timerGuard.record(channel);
    } catch (err) {
      if (err instanceof MarblesTimerLimitError) {
        this.logger.warn(
          {
            channel,
            reason,
            activeChannels: bundle.timerGuard.active().map((t) => t.channel),
          },
          'force-play: marbles hard cap reached at record time',
        );
        return false;
      }
      throw err;
    }
    if (!bundle.chat.joinedChannels().includes(channel)) {
      try {
        await bundle.chat.applyDiff([channel], []);
      } catch (err) {
        bundle.timerGuard.release(channel, reservedAt);
        this.logger.warn({ channel, err }, 'force-play: join failed');
        return false;
      }
    }
    if (!bundle.bucket.tryConsume(1)) {
      bundle.timerGuard.release(channel, reservedAt);
      this.logger.warn({ channel, reason }, 'force-play: rate-limited');
      return false;
    }
    try {
      await bundle.chat.send(channel, '!play');
    } catch (err) {
      bundle.timerGuard.release(channel, reservedAt);
      this.logger.error({ channel, reason, err }, 'force-play: send failed');
      return false;
    }
    bundle.detector.markSent(channel);
    this.deps.stats.recordPlay(bundle.runtime.name, channel);
    this.deps.metrics.playsSentTotal.inc({
      account: bundle.runtime.name,
      channel,
    });
    this.logger.info(
      { account: bundle.runtime.name, channel, reason },
      'force-play sent !play',
    );
    this.deps.bus.emit({
      type: 'play-sent',
      at: new Date().toISOString(),
      account: bundle.runtime.name,
      channel,
    });
    return true;
  }
}
