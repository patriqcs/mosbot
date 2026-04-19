import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export class Metrics {
  readonly registry = new Registry();
  readonly playsSentTotal: Counter;
  readonly lobbiesDetectedTotal: Counter;
  readonly rateLimitedTotal: Counter;
  readonly marblesTimerDropsTotal: Counter;
  readonly channelsJoinedGauge: Gauge;
  readonly discoveryDuration: Histogram;

  constructor() {
    this.registry.setDefaultLabels({ app: 'mosbot' });
    this.playsSentTotal = new Counter({
      name: 'mosbot_plays_sent_total',
      help: 'Number of !play messages sent',
      labelNames: ['account', 'channel'] as const,
      registers: [this.registry],
    });
    this.lobbiesDetectedTotal = new Counter({
      name: 'mosbot_lobbies_detected_total',
      help: 'Number of lobbies heuristically detected',
      labelNames: ['channel'] as const,
      registers: [this.registry],
    });
    this.rateLimitedTotal = new Counter({
      name: 'mosbot_rate_limited_total',
      help: 'Number of times the rate limiter blocked a send',
      labelNames: ['account'] as const,
      registers: [this.registry],
    });
    this.marblesTimerDropsTotal = new Counter({
      name: 'mosbot_marbles_timer_drops_total',
      help: 'Number of !play drops caused by the Marbles 3-stream timer limit',
      labelNames: ['account'] as const,
      registers: [this.registry],
    });
    this.channelsJoinedGauge = new Gauge({
      name: 'mosbot_channels_joined',
      help: 'Current number of joined IRC channels',
      labelNames: ['account'] as const,
      registers: [this.registry],
    });
    this.discoveryDuration = new Histogram({
      name: 'mosbot_discovery_duration_seconds',
      help: 'Duration of a discovery poll',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
