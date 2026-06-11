import type { BotEvent } from '@mosbot/shared';

export type WsListener = (ev: BotEvent) => void;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export class EventStream {
  private socket: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
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
      // Connection succeeded: reset the backoff for the next disconnect.
      this.reconnectDelay = RECONNECT_BASE_MS;
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
      if (!this.closed) {
        const delay = this.reconnectDelay;
        // Exponential backoff capped at RECONNECT_MAX_MS so an unreachable
        // server is retried calmly instead of every 2s forever.
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
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
