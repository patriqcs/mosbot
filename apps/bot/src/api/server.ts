import { join, dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { AppConfig } from '@mosbot/shared';
import { registerAuthRoutes } from './auth.js';
import { registerApiRoutes, type ApiRoutesDeps } from './routes.js';
import { registerWebsocket, type WsRoutesDeps } from './websocket.js';

export interface ApiServerDeps extends ApiRoutesDeps, WsRoutesDeps {
  config: AppConfig;
  sessionSecret: string;
  logger: FastifyBaseLogger;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const createApiServer = async (deps: ApiServerDeps): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: deps.logger,
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: deps.sessionSecret,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    },
    saveUninitialized: false,
  });
  await app.register(fastifyWebsocket);

  registerAuthRoutes(app, { server: deps.config.server });
  registerApiRoutes(app, deps);
  registerWebsocket(app, deps);

  const publicDir = resolve(__dirname, '..', '..', 'public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/metrics')) {
        return reply.code(404).send({ success: false, data: null, error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
};

export const publicDirPath = (): string =>
  resolve(__dirname, '..', '..', 'public');

export const viteIndexPath = (): string => join(publicDirPath(), 'index.html');
