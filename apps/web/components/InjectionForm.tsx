'use client';

import { useForm, useWatch } from 'react-hook-form';
import { describeLaunchError, useActiveRun, useLaunchRun } from '@/hooks/useExperimentRuns';
import { numericParams, toCommand, type AttackMode } from '@/lib/attackParams';

interface InjectionFormFields {
  mode: AttackMode;
  count: string;
  interval: string;
}

const INPUT_CLASS =
  'mt-1 block w-full rounded border border-border bg-base focus:border-secured focus:ring-secured sm:text-sm p-2';

const DEFAULT_VALUES: InjectionFormFields = { mode: 'plain', count: '', interval: '' };

/**
 * Dispara a injeção (Track A) pelo mesmo endpoint do console de ataque (ADR-0012). O
 * broker `plain` aceita a leitura forjada; o `secure` a rejeita (mTLS) — rodar contra
 * `secure` e ver "rejeitado" é o resultado correto, não uma falha.
 */
export default function InjectionForm() {
  const { data: activeRun } = useActiveRun();
  const launch = useLaunchRun();
  const { register, control } = useForm<InjectionFormFields>({ defaultValues: DEFAULT_VALUES });

  // useWatch (e não form.watch()) pelo mesmo motivo do AttackForm: watch() devolve uma
  // função nova a cada render e não pode ser memoizada pelo React Compiler do projeto.
  const fields = { ...DEFAULT_VALUES, ...useWatch({ control }) };
  const params = numericParams([
    ['count', fields.count],
    ['interval', fields.interval],
  ]);
  const disabled = !!activeRun;

  return (
    <div className="bg-panel border border-border rounded p-6 mb-8">
      <h3 className="text-lg font-medium text-primary mb-1">Disparar injeção (Track A)</h3>
      <p className="text-sm text-muted mb-4">
        Publica leituras forjadas no tópico de um sensor legítimo. No broker <code>plain</code> elas
        são aceitas e aparecem abaixo como <em>forjadas</em>; no <code>secure</code> o atacante é
        rejeitado.
      </p>

      {disabled && (
        <div role="alert" className="mb-4 p-3 bg-critical/10 text-critical rounded text-sm">
          Já existe uma run ativa. Aguarde ela terminar (ou pare-a acima) antes de disparar outra.
        </div>
      )}

      <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label htmlFor="injectionMode" className="block text-sm font-medium text-primary">
              Alvo
            </label>
            <select
              id="injectionMode"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register('mode')}
            >
              <option value="plain">plain</option>
              <option value="secure">secure</option>
            </select>
          </div>
          <div>
            <label htmlFor="injectionCount" className="block text-sm font-medium text-primary">
              --count
            </label>
            <input
              id="injectionCount"
              type="number"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register('count')}
            />
          </div>
          <div>
            <label htmlFor="injectionInterval" className="block text-sm font-medium text-primary">
              --interval (s)
            </label>
            <input
              id="injectionInterval"
              type="number"
              step="any"
              disabled={disabled}
              className={INPUT_CLASS}
              {...register('interval')}
            />
          </div>
        </div>

        <p className="font-mono text-xs text-muted">
          {toCommand('injection', fields.mode, params)}
        </p>

        {launch.isError && (
          <div role="alert" className="p-3 bg-critical/10 text-critical rounded text-sm">
            {describeLaunchError(launch.error)}
          </div>
        )}

        <button
          type="button"
          onClick={() => launch.mutate({ mode: fields.mode, attackType: 'injection', params })}
          disabled={disabled || launch.isPending}
          className="rounded border border-transparent bg-critical px-4 py-2 text-sm font-medium text-[#14181F] hover:opacity-90 disabled:opacity-50"
        >
          {launch.isPending ? 'Disparando...' : 'Disparar injeção'}
        </button>
      </form>
    </div>
  );
}
