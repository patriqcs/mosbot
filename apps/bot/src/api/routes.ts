import { readFileSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { StatsRange } from '@mosbot/shared';
import { requireAuth } from './auth.js';
import type { Orchestrator } from '../orchestrator.js';
import type { ScheduleRunner } from '../schedule/schedule-runner.js';
import type { AuthManager } from '../auth/auth-manager.js';
import type { StatsRepo } from '../stats/repo.js';
import type { AppConfig } from '@mosbot/shared';
import type { Metrics } from '../metrics.js';
import type { LoggerConfig } from '../logger.js';
import { setLogLevel } from '../logger.js';
import { ConfigError, parseRawConfig } from '../config/loader.js';
import { diffSections, type SectionDiff } from './config-diff.js';

export interface ApiRoutesDeps {
  orchestrator: Orchestrator;
  scheduleRunner: ScheduleRunner;
  auth: AuthManager;
  stats: StatsRepo;
  config: AppConfig;
  metrics: Metrics;
  configPath: string;
  updateLogLevel: (level: LoggerConfig['level']) => void;
}

export const registerApiRoutes = (app: FastifyInstance, deps: ApiRoutesDeps): void => {
  // Unauthenticated health/liveness probe (Docker healthcheck, restart
  // detection). Deliberately omits account identities and Twitch logins —
  // exposing which accounts a Marbles bot runs is detection-sensitive. The
  // frontend only consumes `uptime`; richer data lives behind requireAuth.
  app.get('/api/health', async () => {
    return {
      ok: true,
      db: 'up',
      uptime: Math.floor(process.uptime()),
    };
  });

  app.get('/api/status', { preHandler: requireAuth }, async () => {
    return { success: true, data: await deps.orchestrator.status(), error: null };
  });

  app.get('/api/streams', { preHandler: requireAuth }, async () => {
    const joined = deps.orchestrator.joinedChannels();
    const wl = new Set(deps.config.channels.whitelist.map((s) => s.toLowerCase()));
    const bl = new Set(deps.config.channels.blacklist.map((s) => s.toLowerCase()));
    const pf = new Set((deps.config.channels.prefer ?? []).map((s) => s.toLowerCase()));
    const streams = deps.orchestrator.latestDiscovered().map((s) => ({
      userId: s.userId,
      userLogin: s.login,
      userName: s.userName,
      gameId: '',
      title: '',
      viewerCount: s.viewerCount,
      language: s.language,
      thumbnailUrl: '',
      startedAt: '',
      profileImageUrl: s.profileImageUrl,
      joined: joined.has(s.login),
      playsSent: deps.stats.playsForChannel(s.login),
      blacklisted: bl.has(s.login),
      whitelisted: wl.has(s.login),
      preferred: pf.has(s.login),
    }));
    return { success: true, data: streams, error: null };
  });

  app.get<{ Querystring: { range?: string } }>(
    '/api/stats',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = StatsRange.safeParse(req.query.range ?? '24h');
      if (!parsed.success) {
        return reply.code(400).send({ success: false, data: null, error: 'invalid range' });
      }
      const stats = deps.stats.aggregate(parsed.data);
      return {
        success: true,
        data: { ...stats, chatLogEnabled: deps.config.logging.chatLog },
        error: null,
      };
    },
  );

  app.post<{ Params: { name: string } }>(
    '/api/accounts/:name/login',
    { preHandler: requireAuth },
    async (req, reply) => {
      const account = deps.config.accounts.find((a) => a.name === req.params.name);
      if (!account) {
        return reply.code(404).send({ success: false, data: null, error: 'unknown account' });
      }
      const res = await deps.auth.beginDeviceLogin(account.name, account.clientId);
      return {
        success: true,
        data: {
          userCode: res.user_code,
          verificationUri: res.verification_uri,
          expiresAt: new Date(Date.now() + res.expires_in * 1000).toISOString(),
          intervalSeconds: res.interval,
        },
        error: null,
      };
    },
  );

  app.post<{ Params: { name: string } }>(
    '/api/accounts/:name/logout',
    { preHandler: requireAuth },
    async (req, reply) => {
      deps.auth.logout(req.params.name);
      return reply.send({ success: true, data: null, error: null });
    },
  );

  app.post<{ Params: { account: string; channel: string } }>(
    '/api/marbles-timers/:account/:channel/skip',
    { preHandler: requireAuth },
    async (req, reply) => {
      const account = req.params.account;
      const channel = req.params.channel;
      if (!account || !channel) {
        return reply.code(400).send({
          success: false,
          data: null,
          error: 'account and channel are required',
        });
      }
      const ok = await deps.orchestrator.skipMarblesTimer(account, channel);
      if (!ok) {
        return reply.code(404).send({
          success: false,
          data: null,
          error: 'no active timer for that account/channel',
        });
      }
      return { success: true, data: { skipped: true }, error: null };
    },
  );

  app.post('/api/bot/start', { preHandler: requireAuth }, async () => {
    await deps.orchestrator.start();
    return { success: true, data: { running: deps.orchestrator.isRunning() }, error: null };
  });

  app.post('/api/bot/stop', { preHandler: requireAuth }, async () => {
    await deps.orchestrator.stop();
    return { success: true, data: { running: deps.orchestrator.isRunning() }, error: null };
  });

  app.post<{ Body: { level: LoggerConfig['level'] } }>(
    '/api/logs/level',
    { preHandler: requireAuth },
    async (req, reply) => {
      const allowed: LoggerConfig['level'][] = ['trace', 'debug', 'info', 'warn', 'error'];
      if (!allowed.includes(req.body.level)) {
        return reply.code(400).send({ success: false, data: null, error: 'invalid level' });
      }
      setLogLevel(req.body.level);
      deps.updateLogLevel(req.body.level);
      return { success: true, data: { level: req.body.level }, error: null };
    },
  );

  app.get('/api/config', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const raw = readFileSync(deps.configPath, 'utf8');
      return { success: true, data: { raw, path: deps.configPath }, error: null };
    } catch (err) {
      return reply.code(500).send({
        success: false,
        data: null,
        error: `cannot read config: ${(err as Error).message}`,
      });
    }
  });

  app.put<{ Body: { raw: string } }>(
    '/api/config',
    { preHandler: requireAuth },
    async (req, reply) => {
      const raw = typeof req.body?.raw === 'string' ? req.body.raw : '';
      if (!raw.trim()) {
        return reply.code(400).send({ success: false, data: null, error: 'empty body' });
      }
      let parsedNext;
      try {
        parsedNext = parseRawConfig(raw);
      } catch (err) {
        const msg = err instanceof ConfigError ? err.message : (err as Error).message;
        return reply.code(400).send({ success: false, data: null, error: msg });
      }
      try {
        writeFileSync(deps.configPath, raw, 'utf8');
      } catch (err) {
        return reply.code(500).send({
          success: false,
          data: null,
          error: `cannot write config: ${(err as Error).message}`,
        });
      }
      const diff = diffSections(deps.config, parsedNext);
      await applyHotReloadChanges(deps, parsedNext, diff);
      return {
        success: true,
        data: {
          restartRequired: diff.restartRequired.length > 0,
          restartRequiredSections: diff.restartRequired,
          appliedSections: diff.hotReloadable,
          path: deps.configPath,
        },
        error: null,
      };
    },
  );

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', deps.metrics.contentType());
    return deps.metrics.render();
  });
};

/**
 * Applies the hot-reloadable parts of a new config in-place. Sections in
 * `diff.restartRequired` are intentionally NOT mutated in memory — the YAML
 * file already contains the new values, which take effect on the next boot.
 * Object.assign on sub-objects preserves the existing references that
 * components (Discovery, ChatManager, etc.) captured at startup.
 */
const applyHotReloadChanges = async (
  deps: ApiRoutesDeps,
  next: AppConfig,
  diff: SectionDiff,
): Promise<void> => {
  for (const section of diff.hotReloadable) {
    switch (section) {
      case 'discovery':
        Object.assign(deps.config.discovery, next.discovery);
        deps.orchestrator.updateDiscoveryConfig();
        break;
      case 'lobby':
        Object.assign(deps.config.lobby, next.lobby);
        deps.orchestrator.updateLobbyConfig();
        break;
      case 'ratelimit':
        Object.assign(deps.config.ratelimit, next.ratelimit);
        deps.orchestrator.updateRatelimitConfig();
        break;
      case 'channels':
        Object.assign(deps.config.channels, next.channels);
        break;
      case 'schedule':
        Object.assign(deps.config.schedule, next.schedule);
        await deps.scheduleRunner.update(deps.config.schedule);
        break;
      case 'server.auth':
        Object.assign(deps.config.server.auth, next.server.auth);
        break;
      case 'safety':
        Object.assign(deps.config.safety, next.safety);
        deps.orchestrator.updateSafetyConfig();
        break;
      case 'logging': {
        // rotateDays is intentionally NOT applied live (restart-required).
        const chatLogDisabled =
          deps.config.logging.chatLog && !next.logging.chatLog;
        deps.config.logging.level = next.logging.level;
        deps.config.logging.chatLog = next.logging.chatLog;
        deps.config.logging.chatLogRetentionDays = next.logging.chatLogRetentionDays;
        deps.updateLogLevel(next.logging.level);
        if (chatLogDisabled) {
          deps.stats.deleteAllChat();
        }
        break;
      }
    }
  }
};
