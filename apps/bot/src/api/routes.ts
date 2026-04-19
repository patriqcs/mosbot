import { readFileSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { StatsRange } from '@mosbot/shared';
import { requireAuth } from './auth.js';
import type { Orchestrator } from '../orchestrator.js';
import type { AuthManager } from '../auth/auth-manager.js';
import type { StatsRepo } from '../stats/repo.js';
import type { AppConfig } from '@mosbot/shared';
import type { Metrics } from '../metrics.js';
import type { LoggerConfig } from '../logger.js';
import { setLogLevel } from '../logger.js';
import { ConfigError, parseRawConfig } from '../config/loader.js';

export interface ApiRoutesDeps {
  orchestrator: Orchestrator;
  auth: AuthManager;
  stats: StatsRepo;
  config: AppConfig;
  metrics: Metrics;
  configPath: string;
  updateLogLevel: (level: LoggerConfig['level']) => void;
}

export const registerApiRoutes = (app: FastifyInstance, deps: ApiRoutesDeps): void => {
  app.get('/api/health', async () => {
    const counts = deps.stats.counts();
    return {
      ok: true,
      db: 'up',
      accounts: deps.auth.all().map((a) => ({ name: a.name, user: a.userLogin })),
      uptime: Math.floor(process.uptime()),
      counts: { ...counts, channelsJoined: deps.orchestrator.joinedChannels().size },
    };
  });

  app.get('/api/status', { preHandler: requireAuth }, async () => {
    return { success: true, data: await deps.orchestrator.status(), error: null };
  });

  app.get('/api/streams', { preHandler: requireAuth }, async () => {
    const joined = deps.orchestrator.joinedChannels();
    const wl = new Set(deps.config.channels.whitelist.map((s) => s.toLowerCase()));
    const bl = new Set(deps.config.channels.blacklist.map((s) => s.toLowerCase()));
    const streams = deps.orchestrator.latestDiscovered().map((s) => ({
      userId: '',
      userLogin: s.login,
      userName: s.userName,
      gameId: '',
      title: '',
      viewerCount: s.viewerCount,
      language: s.language,
      thumbnailUrl: '',
      startedAt: '',
      joined: joined.has(s.login),
      playsSent: deps.stats.playsForChannel(s.login),
      blacklisted: bl.has(s.login),
      whitelisted: wl.has(s.login),
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
      return { success: true, data: deps.stats.aggregate(parsed.data), error: null };
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
      try {
        parseRawConfig(raw);
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
      return {
        success: true,
        data: { restartRequired: true, path: deps.configPath },
        error: null,
      };
    },
  );

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', deps.metrics.contentType());
    return deps.metrics.render();
  });
};
