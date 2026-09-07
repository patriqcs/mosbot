import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import pino from 'pino';
import type { AppConfig } from '@mosbot/shared';
import { fastifyOptions } from './server.js';

// Regression for the v0.1.31 outage: with Fastify 5 a ready pino instance must
// be passed as `loggerInstance`; `logger` only accepts a config object and the
// process died at startup with FST_ERR_LOG_INVALID_LOGGER_CONFIG.
describe('fastifyOptions', () => {
  const logger = pino({ level: 'silent' });
  const config = { server: { trustProxy: false } } as unknown as AppConfig;

  it('passes the pino instance as loggerInstance, not as logger', () => {
    const opts = fastifyOptions({ logger, config });
    expect(opts.loggerInstance).toBe(logger);
    expect('logger' in opts).toBe(false);
  });

  it('lets Fastify 5 construct an instance with these options', async () => {
    const app = Fastify(fastifyOptions({ logger, config }));
    expect(app.log).toBeDefined();
    await app.close();
  });
});
