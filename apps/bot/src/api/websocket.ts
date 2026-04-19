import type { FastifyInstance } from 'fastify';
import type { BotEvent } from '@mosbot/shared';
import type { EventBus } from '../events/bus.js';

export interface WsRoutesDeps {
  bus: EventBus;
}

export const registerWebsocket = (app: FastifyInstance, deps: WsRoutesDeps): void => {
  app.get('/api/stream', { websocket: true }, (socket, req) => {
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
