import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { AppConfig } from '@mosbot/shared';

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

export const interpolateEnv = (input: unknown, env: NodeJS.ProcessEnv): unknown => {
  if (typeof input === 'string') {
    return input.replace(ENV_PATTERN, (_, key: string) => env[key] ?? '');
  }
  if (Array.isArray(input)) {
    return input.map((item) => interpolateEnv(item, env));
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = interpolateEnv(v, env);
    }
    return out;
  }
  return input;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const loadConfig = (
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): AppConfig => {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read config at ${path}: ${(err as Error).message}`);
  }

  let yaml: unknown;
  try {
    yaml = loadYaml(raw);
  } catch (err) {
    throw new ConfigError(`invalid YAML in ${path}: ${(err as Error).message}`);
  }

  const interpolated = interpolateEnv(yaml, env);
  const parsed = AppConfig.safeParse(interpolated);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`config validation failed: ${issues}`);
  }
  return parsed.data;
};
