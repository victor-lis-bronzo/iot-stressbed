'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useActiveRun } from '@/hooks/useExperimentRuns';
import type { TrackBAttackType } from '@/hooks/useDosMetrics';

type MalformedMode = 'giant' | 'invalid-utf8' | 'invalid-json' | 'null-bytes';

interface AttackFormFields {
  attackType: TrackBAttackType;
  mode: 'plain' | 'secure';
  connections: string;
  holdSeconds: string;
  connectTimeout: string;
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
 * Monta o comando do run-experiment.sh a partir dos campos preenchidos. Só
 * inclui flags com valor não vazio — os scripts do attacker já têm defaults
 * sensatos para tudo que for omitido (attacker/python/args_*.py).
 */
function buildCommand(fields: AttackFormFields): string {
  const flags: string[] = [];

  if (fields.attackType === 'connection-flood') {
    if (fields.connections) flags.push(`--connections ${fields.connections}`);
    if (fields.holdSeconds) flags.push(`--hold-seconds ${fields.holdSeconds}`);
    if (fields.connectTimeout) flags.push(`--connect-timeout ${fields.connectTimeout}`);
  } else if (fields.attackType === 'message-flood') {
    if (fields.rate) flags.push(`--rate ${fields.rate}`);
    if (fields.durationSeconds) flags.push(`--duration-seconds ${fields.durationSeconds}`);
    if (fields.payloadSizeBytes) flags.push(`--payload-size-bytes ${fields.payloadSizeBytes}`);
  } else if (fields.attackType === 'malformed-payload') {
    flags.push(`--mode ${fields.malformedMode}`);
    if (fields.malformedMode === 'giant' && fields.sizeBytes) {
      flags.push(`--size-bytes ${fields.sizeBytes}`);
    }
    if (fields.count) flags.push(`--count ${fields.count}`);
  }

  const base = `./scripts/run-experiment.sh ${fields.attackType} ${fields.mode}`;
  return flags.length > 0 ? `${base} -- ${flags.join(' ')}` : base;
}

const DEFAULT_VALUES: AttackFormFields = {
  attackType: 'connection-flood',
  mode: 'plain',
  connections: '',
  holdSeconds: '',
  connectTimeout: '',
  rate: '',
  durationSeconds: '',
  payloadSizeBytes: '',
  malformedMode: 'giant',
  sizeBytes: '',
  count: '',
};

export default function AttackForm() {
  const { data: activeRun } = useActiveRun();
  const [copied, setCopied] = useState(false);
  const { register, control } = useForm<AttackFormFields>({
    defaultValues: DEFAULT_VALUES,
  });

  // useWatch (em vez de form.watch()) porque watch() retorna uma função nova a
  // cada render e não pode ser memoizada pelo React Compiler deste projeto.
  const fields = { ...DEFAULT_VALUES, ...useWatch({ control }) };
  const command = buildCommand(fields);
  const disabled = !!activeRun;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-panel border border-border rounded p-6 mb-8">
      <h3 className="text-lg font-medium text-primary mb-1">Disparar ataque (Track B)</h3>
      <p className="text-sm text-muted mb-4">
        O disparo continua via CLI — não existe hoje um caminho seguro para o NestJS executar o
        container <code>attacker</code> sem arriscar duas fontes disputando a mesma run ativa
        (ADR-0006). Monte o comando abaixo, copie e rode no terminal; esta tela acompanha o
        resultado automaticamente assim que a run terminar.
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
          <div className="grid grid-cols-3 gap-4">
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
            <div>
              <label htmlFor="connectTimeout" className="block text-sm font-medium text-primary">
                --connect-timeout (default 10.0)
              </label>
              <input
                id="connectTimeout"
                type="number"
                disabled={disabled}
                className={INPUT_CLASS}
                {...register('connectTimeout')}
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
          <label htmlFor="command" className="block text-sm font-medium text-primary">
            Comando
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="command"
              readOnly
              value={command}
              className="flex-1 rounded border border-border bg-base p-2 font-mono text-xs text-primary"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-transparent bg-secured px-3 py-1.5 text-sm font-medium text-[#14181F] hover:opacity-90"
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
