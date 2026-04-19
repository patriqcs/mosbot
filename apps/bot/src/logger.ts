import pino, { type Logger, type LoggerOptions } from 'pino';

const redactPaths = [
  'accessToken',
  'refreshToken',
  'token',
  'password',
  'authorization',
  'cookie',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
  'req.headers.authorization',
  'req.headers.cookie',
];

export interface LoggerConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  rotate?: {
    file: string;
    days: number;
  };
  pretty?: boolean;
}

let root: Logger | null = null;

export const createLogger = (cfg: LoggerConfig): Logger => {
  const opts: LoggerOptions = {
    level: cfg.level,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    base: { service: 'mosbot' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (cfg.rotate) {
    const transport = pino.transport({
      target: 'pino-roll',
      options: {
        file: cfg.rotate.file,
        frequency: 'daily',
        mkdir: true,
        size: '50M',
        limit: { count: cfg.rotate.days },
      },
    });
    root = pino(opts, transport);
  } else if (cfg.pretty) {
    const transport = pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    });
    root = pino(opts, transport);
  } else {
    root = pino(opts);
  }
  return root;
};

export const getLogger = (): Logger => {
  if (!root) {
    root = pino({
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: { paths: redactPaths, censor: '[REDACTED]' },
    });
  }
  return root;
};

export const setLogLevel = (level: LoggerConfig['level']): void => {
  getLogger().level = level;
};
