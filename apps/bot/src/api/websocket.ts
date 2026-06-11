import type { FastifyInstance } from 'fastify';
import type { BotEvent } from '@mosbot/shared';
import type { EventBus } from '../events/bus.js';
import { isAllowedOrigin } from './security.js';

export interface WsRoutesDeps {
  bus: EventBus;
  /** Extra origins allowed to open the event stream (besides same-host). */
  allowedOrigins?: readonly string[];
}

export const registerWebsocket = (app: FastifyInstance, deps: WsRoutesDeps): void => {
  app.get('/api/stream', { websocket: true }, (socket, req) => {
    // Reject cross-site WebSocket hijacking: a browser will send an Origin
    // header on the upgrade, and the SameSite cookie does not protect WS.
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, deps.allowedOrigins)) {
      socket.close(4403, 'forbidden origin');
      return;
    }
    if (!req.session.user) {
      socket.close(4401, 'unauthenticated');
      return;
    }
    const send = (event: BotEvent): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    };
    const unsubscribe = deps.bus.onAny(send);
    socket.on('close', () => unsubscribe());
  });
};
