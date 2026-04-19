import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '@mosbot/shared';

declare module 'fastify' {
  interface Session {
    user?: { username: string };
  }
}

export interface AuthRoutesDeps {
  server: ServerConfig;
}

export const registerAuthRoutes = (app: FastifyInstance, deps: AuthRoutesDeps): void => {
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const { username, password } = req.body ?? { username: '', password: '' };
      if (!username || !password) {
        return reply.code(400).send({ success: false, data: null, error: 'missing credentials' });
      }
      if (username !== deps.server.auth.username) {
        return reply.code(401).send({ success: false, data: null, error: 'invalid credentials' });
      }
      const ok = await argon2.verify(deps.server.auth.passwordHash, password).catch(() => false);
      if (!ok) {
        return reply.code(401).send({ success: false, data: null, error: 'invalid credentials' });
      }
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
