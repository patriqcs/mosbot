import { access, constants } from 'node:fs/promises';
import { request } from 'node:http';
import type { CoexistenceConfig } from '@mosbot/shared';

const DOCKER_SOCKET = '/var/run/docker.sock';

export interface CoexistenceReport {
  minerDetected: boolean;
  minerRecentChatSends: number;
}

interface DockerContainer {
  Id: string;
  Names: string[];
  State: string;
}

export class MinerProbe {
  constructor(private readonly cfg: CoexistenceConfig) {}

  async probe(): Promise<CoexistenceReport> {
    if (!this.cfg.pointsMiner.enabled) {
      return { minerDetected: false, minerRecentChatSends: 0 };
    }
    const byDocker = await this.probeDocker();
    if (byDocker !== null) {
      return { minerDetected: byDocker, minerRecentChatSends: 0 };
    }
    const byPath = await this.probePath();
    return { minerDetected: byPath, minerRecentChatSends: 0 };
  }

  private async probeDocker(): Promise<boolean | null> {
    try {
      await access(DOCKER_SOCKET, constants.R_OK);
    } catch {
      return null;
    }
    const target = this.cfg.pointsMiner.dockerContainerName.toLowerCase();
    try {
      const containers = await dockerGet<DockerContainer[]>('/containers/json?all=false');
      const match = containers.find((c) =>
        c.Names.some((n) => n.replace(/^\//, '').toLowerCase() === target),
      );
      if (!match) return false;
      return match.State === 'running';
    } catch {
      return null;
    }
  }

  private async probePath(): Promise<boolean> {
    try {
      await access(this.cfg.pointsMiner.appdataPath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}

const dockerGet = <T>(path: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method: 'GET',
        timeout: 2_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body) as T);
            } catch (err) {
              reject(err as Error);
            }
          } else {
            reject(new Error(`docker api ${res.statusCode ?? '?'}: ${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('docker api timeout'));
    });
    req.end();
  });
