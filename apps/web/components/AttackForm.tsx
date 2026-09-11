'use client';

import { isAxiosError } from 'axios';
import { useForm, useWatch } from 'react-hook-form';
import { useActiveRun, useStartAttack, useStopRun } from '@/hooks/useExperimentRuns';
import type { TrackBAttackType } from '@/hooks/useDosMetrics';

// O NestJS devolve o texto do ConflictException (ex.: "An attack is already
// running") em `response.data.message` — `error.message` do próprio Axios é
// só um genérico tipo "Request failed with status code 409".
function extractErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  return error instanceof Error ? error.message : 'Falha ao processar o pedido.';
}

type MalformedMode = 'giant' | 'invalid-utf8' | 'invalid-json' | 'null-bytes';

interface AttackFormFields {
  attackType: TrackBAttackType;
  mode: 'plain' | 'secure';
  connections: string;
  holdSeconds: string;
  rate: string;
  durationSeconds: string;
  payloadSizeBytes: string;
  malformedMode: MalformedMode;
  sizeBytes: string;
  count: string;
}

const INPUT_CLASS =
  'mt-1 block w-full rounded border border-border bg-base focus:border-secured focus:ring-secured sm:text-sm p-2';

/**
 * Monta os flags/valores para o endpoint /experiments/attacks/start a partir
 * dos campos preenchidos, como array (sem shell envolvido). Só inclui flags
 * com valor não vazio — os scripts do attacker já têm defaults sensatos para
 * tudo que for omitido (attacker/python/args_*.py).
 */
function buildArgs(fields: AttackFormFields): string[] {
  const args: string[] = [];

  if (fields.attackType === 'connection-flood') {
    if (fields.connections) args.push('--connections', fields.connections);
    if (fields.holdSeconds) args.push('--hold-seconds', fields.holdSeconds);
  } else if (fields.attackType === 'message-flood') {
    if (fields.rate) args.push('--rate', fields.rate);
    if (fields.durationSeconds) args.push('--duration-seconds', fields.durationSeconds);
    if (fields.payloadSizeBytes) args.push('--payload-size-bytes', fields.payloadSizeBytes);
  } else if (fields.attackType === 'malformed-payload') {
    args.push('--mode', fields.malformedMode);
    if (fields.malformedMode === 'giant' && fields.sizeBytes) {
      args.push('--size-bytes', fields.sizeBytes);
    }
    if (fields.count) args.push('--count', fields.count);
  }

  return args;
}

const DEFAULT_VALUES: AttackFormFields = {
  attackType: 'connection-flood',
  mode: 'plain',
  connections: '',
  holdSeconds: '',
  rate: '',
  durationSeconds: '',
  payloadSizeBytes: '',
  malformedMode: 'giant',
  sizeBytes: '',
  count: '',
};

export default function AttackForm() {
  const { data: activeRun } = useActiveRun();
  const startAttack = useStartAttack();
  const stopRun = useStopRun();
  const { register, control } = useForm<AttackFormFields>({
    defaultValues: DEFAULT_VALUES,
  });

  // useWatch (em vez de form.watch()) porque watch() retorna uma função nova a
  // cada render e não pode ser memoizada pelo React Compiler deste projeto.
  const fields = { ...DEFAULT_VALUES, ...useWatch({ control }) };
  const disabled = !!activeRun;
  const toggleError = activeRun ? stopRun.error : startAttack.error;

  const handleToggle = () => {
    if (activeRun) {
      stopRun.mutate();
    } else {
      startAttack.mutate({ track: fields.attackType, mode: fields.mode, args: buildArgs(fields) });
    }
  };

  return (
    <div className="bg-panel border border-border rounded p-6 mb-8">
      <h3 className="text-lg font-medium text-primary mb-1">Disparar ataque (Track B)</h3>
      <p className="text-sm text-muted mb-4">
        O disparo é feito diretamente por esta tela — o NestJS executa e interrompe o script no
        container <code>attacker</code> em nome da run ativa, sem arriscar duas fontes disputando a
        mesma run (ADR-0006, agora resolvido por esse caminho gerenciado). O
        <code> scripts/run-experiment.sh</code> continua disponível como via avançada/offline, para
        quando a API não estiver acessível.
      </p>

      {disabled && (
        <div role="alert" className="mb-4 p-3 bg-critical/10 text-critical rounded text-sm">
          Já existe uma run ativa. Aguarde ela terminar (ou pare-a acima) antes de disparar outra.
        </div>
      )}

      <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="attackType" className="block text-sm font-medium text-primary">
              Ataque
            </label>
            <select
              id="attackType"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register('attackType')}
            >
              <option value="connection-flood">connection-flood</option>
              <option value="message-flood">message-flood</option>
              <option value="malformed-payload">malformed-payload</option>
            </select>
          </div>

          <div>
            <label htmlFor="mode" className="block text-sm font-medium text-primary">
              Alvo
            </label>
            <select id="mode" disabled={disabled} className={INPUT_CLASS} {...register('mode')}>
              <option value="plain">plain</option>
              <option value="secure">secure</option>
            </select>
          </div>
        </div>

        {fields.attackType === 'connection-flood' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="connections" className="block text-sm font-medium text-primary">
                --connections (default 100)
              </label>
              <input
                id="connections"
                type="number"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('connections')}
              />
            </div>
            <div>
              <label htmlFor="holdSeconds" className="block text-sm font-medium text-primary">
                --hold-seconds (default 5.0)
              </label>
              <input
                id="holdSeconds"
                type="number"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('holdSeconds')}
              />
            </div>
          </div>
        )}

        {fields.attackType === 'message-flood' && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="rate" className="block text-sm font-medium text-primary">
                --rate (default 100)
              </label>
              <input
                id="rate"
                type="number"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('rate')}
              />
            </div>
            <div>
              <label htmlFor="durationSeconds" className="block text-sm font-medium text-primary">
                --duration-seconds (default 30)
              </label>
              <input
                id="durationSeconds"
                type="number"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('durationSeconds')}
              />
            </div>
            <div>
              <label htmlFor="payloadSizeBytes" className="block text-sm font-medium text-primary">
                --payload-size-bytes (default 64)
              </label>
              <input
                id="payloadSizeBytes"
                type="number"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('payloadSizeBytes')}
              />
            </div>
          </div>
        )}

        {fields.attackType === 'malformed-payload' && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="malformedMode" className="block text-sm font-medium text-primary">
                --mode
              </label>
              <select
                id="malformedMode"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('malformedMode')}
              >
                <option value="giant">giant</option>
                <option value="invalid-utf8">invalid-utf8</option>
                <option value="invalid-json">invalid-json</option>
                <option value="null-bytes">null-bytes</option>
              </select>
            </div>
            {fields.malformedMode === 'giant' && (
              <div>
                <label htmlFor="sizeBytes" className="block text-sm font-medium text-primary">
                  --size-bytes (default 10000000)
                </label>
                <input
                  id="sizeBytes"
                  type="number"
                  disabled={disabled}
                  className={INPUT_CLASS}
                  {...register('sizeBytes')}
                />
              </div>
            )}
            <div>
              <label htmlFor="count" className="block text-sm font-medium text-primary">
                --count (default 1)
              </label>
              <input
                id="count"
                type="number"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('count')}
              />
            </div>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={activeRun ? stopRun.isPending : startAttack.isPending}
            className="rounded border border-transparent bg-secured px-3 py-1.5 text-sm font-medium text-[#14181F] hover:opacity-90 disabled:opacity-50"
          >
            {activeRun
              ? stopRun.isPending
                ? 'Parando...'
                : 'Parar ataque'
              : startAttack.isPending
                ? 'Iniciando...'
                : 'Iniciar ataque'}
          </button>
          {toggleError && (
            <p className="mt-2 text-sm text-critical">{extractErrorMessage(toggleError)}</p>
          )}
        </div>
      </form>
    </div>
  );
}
