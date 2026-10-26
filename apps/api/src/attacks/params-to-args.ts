import { BadRequestException } from '@nestjs/common';

const FLAG_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Converte os `params` da run (`{connections: 200}`, o mesmo objeto gravado em
 * `experiment_runs.params`) nos args do script do ataque
 * (`['--connections', '200']`). O inverso do que o antigo run-experiment.sh fazia
 * com `params_json`.
 *
 * - `true` vira a flag sozinha; `false`/`null` são omitidos.
 * - Só escalares: um valor objeto/array é rejeitado, não serializado às cegas.
 * - O nome da flag é validado aqui; quem decide quais flags valem para cada
 *   ataque é o runner (allowlist), não o api.
 */
export function paramsToArgs(
  params: Record<string, unknown> | null | undefined,
): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!FLAG_NAME.test(key)) {
      throw new BadRequestException(`parâmetro inválido: ${key}`);
    }
    if (value === null || value === false) {
      continue;
    }
    if (value === true) {
      args.push(`--${key}`);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      args.push(`--${key}`, String(value));
      continue;
    }
    if (typeof value === 'string') {
      args.push(`--${key}`, value);
      continue;
    }
    throw new BadRequestException(
      `valor inválido para o parâmetro ${key} (use número, texto ou booleano)`,
    );
  }
  return args;
}
