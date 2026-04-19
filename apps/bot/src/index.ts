import { loadConfig } from './config/loader.js';
import { createLogger } from './logger.js';
import { openDb } from './db/client.js';
import { loadKey } from './auth/encryption.js';
import { TokenStore } from './auth/token-store.js';
import { AuthManager } from './auth/auth-manager.js';
import { EventBus } from './events/bus.js';
import { StatsRepo } from './stats/repo.js';
import { MarblesTimerRepo } from './lobby/marbles-timer-repo.js';
import { Metrics } from './metrics.js';
import { Orchestrator } from './orchestrator.js';
import { createApiServer } from './api/server.js';
import { getOrCreateSessionSecret } from './api/session.js';

const CONFIG_PATH = process.env['CONFIG_PATH'] ?? '/config/config.yaml';

const main = async (): Promise<void> => {
  const config = loadConfig(CONFIG_PATH);
  const logger = createLogger({
    level: (process.env['LOG_LEVEL'] as never) ?? config.logging.level,
    rotate: { file: '/logs/mosbot.log', days: config.logging.rotateDays },
  });
  logger.info({ path: CONFIG_PATH }, 'config loaded');

  const { sqlite } = openDb(config.database.path);
  const key = loadKey(process.env['ENCRYPTION_KEY']);
  const tokenStore = new TokenStore(sqlite, key);
  const bus = new EventBus();
  const auth = new AuthManager({ store: tokenStore, bus, logger });
  const stats = new StatsRepo(sqlite);
  bus.on('auth', (ev) => stats.recordAuth(ev.account, ev.phase, ev.message));
  const timerRepo = new MarblesTimerRepo(sqlite);
  timerRepo.pruneBefore(Date.now() - 12 * 60 * 1000);
  const metrics = new Metrics();

  for (const acc of config.accounts) {
    if (!acc.enabled) continue;
    await auth.tryRestore(acc.name, acc.clientId);
  }

  const orchestrator = new Orchestrator({
    config,
    auth,
    bus,
    logger,
    stats,
    metrics,
    timerRepo,
  });

  const sessionSecret = getOrCreateSessionSecret(sqlite);

  const app = await createApiServer({
    orchestrator,
    auth,
    stats,
    bus,
    config,
    metrics,
    sessionSecret,
    logger,
    configPath: CONFIG_PATH,
    updateLogLevel: (level) => {
      config.logging.level = level;
    },
  });

  await app.listen({ host: config.server.host, port: config.server.port });
  logger.info({ host: config.server.host, port: config.server.port }, 'API listening');

  if (auth.all().length > 0) {
    await orchestrator.start();
  } else {
    logger.warn('no authorized accounts — waiting for dashboard login');
  }

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  const runPrune = (): void => {
    try {
      const cutoff = Date.now() - config.logging.chatLogRetentionDays * DAY_MS;
      const removed = stats.pruneChatBefore(cutoff);
      if (removed > 0) {
        logger.info(
          { removed, retentionDays: config.logging.chatLogRetentionDays },
          'chat messages pruned',
        );
      }
    } catch (err) {
      logger.warn({ err }, 'chat prune failed');
    }
  };
  runPrune();
  const pruneTimer = setInterval(runPrune, HOUR_MS);
  pruneTimer.unref();

  const vacuumTimer = setInterval(() => {
    try {
      stats.vacuum();
      logger.info('database vacuumed');
    } catch (err) {
      logger.warn({ err }, 'vacuum failed');
    }
  }, DAY_MS);
  vacuumTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown initiated');
    const timer = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    try {
      clearInterval(pruneTimer);
      clearInterval(vacuumTimer);
      await orchestrator.stop();
      await app.close();
      sqlite.close();
    } catch (err) {
      logger.error({ err }, 'shutdown error');
    } finally {
      clearTimeout(timer);
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
