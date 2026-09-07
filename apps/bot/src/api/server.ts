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

// Exported so the boot options can be unit-tested without the full dependency
// graph: Fastify 5 only accepts a ready logger via `loggerInstance`; passing it
// as `logger` throws FST_ERR_LOG_INVALID_LOGGER_CONFIG at startup (caught in
// production with v0.1.31, the bot never came up).
export const fastifyOptions = (deps: Pick<ApiServerDeps, 'logger' | 'config'>) => ({
  loggerInstance: deps.logger,
  bodyLimit: 1_048_576,
  // Only trust X-Forwarded-* when the operator opts in (behind a reverse
  // proxy). Default false so req.ip is the real socket peer and the login
  // throttle can't be bypassed by spoofing X-Forwarded-For.
  trustProxy: deps.config.server.trustProxy,
});

export const createApiServer = async (deps: ApiServerDeps): Promise<FastifyInstance> => {
  const app = Fastify(fastifyOptions(deps));

  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: deps.sessionSecret,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 'auto' sets Secure only when the request is HTTPS. With trustProxy on,
      // this honours X-Forwarded-Proto so the cookie is Secure behind a TLS
      // reverse proxy, yet still works on a plain-HTTP LAN deployment.
      secure: 'auto',
      maxAge: 24 * 60 * 60 * 1000,
    },
    saveUninitialized: false,
  });
  await app.register(fastifyWebsocket);

  registerAuthRoutes(app, { server: deps.config.server });
  registerApiRoutes(app, deps);
  registerWebsocket(app, { bus: deps.bus, allowedOrigins: deps.config.server.allowedOrigins });

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

export const publicDirPath = (): string => resolve(__dirname, '..', '..', 'public');

export const viteIndexPath = (): string => join(publicDirPath(), 'index.html');
