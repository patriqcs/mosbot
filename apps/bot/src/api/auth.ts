import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '@mosbot/shared';
import { LoginThrottle, safeStringEqual } from './security.js';

declare module 'fastify' {
  interface Session {
    user?: { username: string };
  }
}

export interface AuthRoutesDeps {
  server: ServerConfig;
}

// A real argon2 hash of a random secret, verified against on every failed
// username so login latency does not reveal whether the username exists
// (user enumeration via timing).
let dummyHashPromise: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => {
  dummyHashPromise ??= argon2.hash(randomBytes(32).toString('hex'));
  return dummyHashPromise;
};

export const registerAuthRoutes = (app: FastifyInstance, deps: AuthRoutesDeps): void => {
  // Throttle brute-force/credential-stuffing on the single admin password.
  const throttle = new LoginThrottle({ maxAttempts: 10, windowMs: 15 * 60 * 1000 });

  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const ip = req.ip;
      if (throttle.isBlocked(ip)) {
        const retryAfter = throttle.retryAfterSeconds(ip);
        return reply
          .code(429)
          .header('Retry-After', String(retryAfter))
          .send({ success: false, data: null, error: 'too many attempts, try again later' });
      }

      const body = req.body ?? { username: '', password: '' };
      const username = typeof body.username === 'string' ? body.username : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!username || !password) {
        return reply.code(400).send({ success: false, data: null, error: 'missing credentials' });
      }

      // Always run a full argon2 verify (against a dummy hash for unknown
      // usernames) and a constant-time username compare, so success and
      // failure take the same time regardless of which field was wrong.
      const userOk = safeStringEqual(username, deps.server.auth.username);
      const hashToVerify = userOk ? deps.server.auth.passwordHash : await getDummyHash();
      const passOk = await argon2.verify(hashToVerify, password).catch(() => false);

      if (!userOk || !passOk) {
        throttle.recordFailure(ip);
        return reply.code(401).send({ success: false, data: null, error: 'invalid credentials' });
      }

      throttle.reset(ip);
      req.session.user = { username };
      return reply.send({ success: true, data: { username }, error: null });
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    await req.session.destroy();
    return reply.send({ success: true, data: null, error: null });
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.session.user) {
      return reply.code(401).send({ success: false, data: null, error: 'unauthenticated' });
    }
    return reply.send({ success: true, data: req.session.user, error: null });
  });
};

export const requireAuth = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (!req.session.user) {
    await reply.code(401).send({ success: false, data: null, error: 'unauthenticated' });
  }
};
