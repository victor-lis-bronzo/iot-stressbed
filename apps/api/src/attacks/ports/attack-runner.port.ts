export type AttackType =
  | 'injection'
  | 'connection-flood'
  | 'message-flood'
  | 'malformed-payload';

export const ATTACK_TYPES: readonly AttackType[] = [
  'injection',
  'connection-flood',
  'message-flood',
  'malformed-payload',
];

export interface AttackRequest {
  attackType: AttackType;
  mode: 'plain' | 'secure';
  /** Já separados em argv (`['--connections', '200']`): nunca passam por shell. */
  args: string[];
}

export interface AttackResponse {
  /** JSON que o script do ataque imprimiu em stdout (null se não era JSON). */
  result: Record<string, unknown> | null;
  exitCode: number;
  stderr: string;
}

/**
 * Executa um ataque no container `attacker` (ADR-0012). Seam para o orquestrador
 * não depender de HTTP nos testes.
 */
export interface AttackRunnerPort {
  run(request: AttackRequest): Promise<AttackResponse>;
}
