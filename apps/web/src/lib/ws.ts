import type { BotEvent } from '@mosbot/shared';

export type WsListener = (ev: BotEvent) => void;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
// A connection must stay open at least this long to count as successful and
// reset the backoff; shorter than this is treated as a failed attempt.
const STABLE_MS = 10_000;

export class EventStream {
  private socket: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private openedAt: number | null = null;
  private closed = false;

  connect(): void {
    if (this.closed) return;
    if (this.socket) {
      const s = this.socket.readyState;
      if (s === WebSocket.OPEN || s === WebSocket.CONNECTING) return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/api/stream`;
    const sock = new WebSocket(url);
    sock.onopen = () => {
      // Record when the handshake completed. The backoff is only reset once the
      // connection proves STABLE (see onclose) — resetting here would let a
      // server that accepts then immediately closes (4401 expired session /
      // 4403 forbidden origin) loop-reconnect every base interval forever.
      this.openedAt = Date.now();
    };
    sock.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as BotEvent;
        for (const l of this.listeners) l(parsed);
      } catch {
        /* ignore malformed */
      }
    };
    sock.onclose = () => {
      this.socket = null;
      if (this.closed) return;
      // Only a connection that stayed open a while counts as "successful" and
      // resets the backoff; an accept-then-instant-close keeps backing off so a
      // reachable-but-rejecting server is retried calmly, not every 2s forever.
      const stable = this.openedAt !== null && Date.now() - this.openedAt >= STABLE_MS;
      this.openedAt = null;
      const delay = stable ? RECONNECT_BASE_MS : this.reconnectDelay;
      this.reconnectDelay = stable
        ? RECONNECT_BASE_MS
        : Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    this.socket = sock;
  }

  on(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

export const eventStream = new EventStream();
