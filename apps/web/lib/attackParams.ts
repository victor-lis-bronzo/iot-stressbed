import type { TrackBAttackType } from '@/hooks/useDosMetrics';

export type AttackType = 'injection' | TrackBAttackType;
export type AttackMode = 'plain' | 'secure';

/** Flags do ataque como objeto {flag: valor}: o mesmo formato gravado em `experiment_runs.params`. */
export type AttackParams = Record<string, number | string>;

/**
 * Monta `params` só com os campos numéricos preenchidos (um campo vazio fica de fora:
 * os scripts do attacker já têm defaults para tudo que for omitido). A ordem dos
 * pares é a ordem das flags no comando.
 */
export function numericParams(pairs: [flag: string, raw: string | undefined][]): AttackParams {
  const params: AttackParams = {};
  for (const [flag, raw] of pairs) {
    if (raw === undefined || raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) params[flag] = value;
  }
  return params;
}

/**
 * Comando equivalente do `scripts/run-experiment.sh` — para quem prefere o terminal
 * ou quer reproduzir a run. Sai dos mesmos `params` que o botão envia ao api.
 */
export function toCommand(attackType: AttackType, mode: AttackMode, params: AttackParams): string {
  const flags = Object.entries(params).map(([flag, value]) => `--${flag} ${value}`);
  const base = `./scripts/run-experiment.sh ${attackType} ${mode}`;
  return flags.length > 0 ? `${base} -- ${flags.join(' ')}` : base;
}
