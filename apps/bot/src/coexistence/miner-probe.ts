import { access, constants } from 'node:fs/promises';
import type { CoexistenceConfig } from '@mosbot/shared';

export interface CoexistenceReport {
  minerDetected: boolean;
  minerRecentChatSends: number;
}

export class MinerProbe {
  constructor(private readonly cfg: CoexistenceConfig) {}

  async probe(): Promise<CoexistenceReport> {
    if (!this.cfg.pointsMiner.enabled) {
      return { minerDetected: false, minerRecentChatSends: 0 };
    }
    let detected = false;
    try {
      await access(this.cfg.pointsMiner.appdataPath, constants.R_OK);
      detected = true;
    } catch {
      detected = false;
    }
    return { minerDetected: detected, minerRecentChatSends: 0 };
  }
}
