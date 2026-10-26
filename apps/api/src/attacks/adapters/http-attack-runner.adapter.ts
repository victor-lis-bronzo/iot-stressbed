import { Logger } from '@nestjs/common';
import {
  AttackRequest,
  AttackResponse,
  AttackRunnerPort,
} from '../ports/attack-runner.port';

export interface HttpAttackRunnerConfig {
  baseUrl: string;
  timeoutMs: number;
}

/**
 * Cliente do runner HTTP do container `attacker` (attacker/python/runner.py),
 * alcançável só pela rede interna do compose. Usa o `fetch` global do Node.
 */
export class HttpAttackRunnerAdapter implements AttackRunnerPort {
  private readonly logger = new Logger(HttpAttackRunnerAdapter.name);

  constructor(private readonly config: HttpAttackRunnerConfig) {}

  async run(request: AttackRequest): Promise<AttackResponse> {
    const response = await fetch(`${this.config.baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const body = (await response.json().catch(() => null)) as
      | (Partial<AttackResponse> & { error?: string })
      | null;

    if (!response.ok) {
      const reason = body?.error ?? `HTTP ${response.status}`;
      this.logger.error(`attacker runner recusou o ataque: ${reason}`);
      throw new Error(`attacker runner: ${reason}`);
    }

    return {
      result: body?.result ?? null,
      exitCode: body?.exitCode ?? -1,
      stderr: body?.stderr ?? '',
    };
  }
}
