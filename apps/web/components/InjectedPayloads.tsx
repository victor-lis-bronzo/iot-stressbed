'use client';

import { useTelemetryStream, type Reading } from '@/hooks/useTelemetryStream';
import PayloadRow from '@/components/PayloadRow';

/**
 * Badge de origem da leitura. Distingue visualmente telemetria legítima de
 * telemetria forjada por um atacante que publica no mesmo tópico do broker
 * plain (spoofing de origem, sem autenticação de payload).
 */
function SourceBadge({ source }: { source: Reading['source'] }) {
  const isInjected = source === 'injected';
  return (
    <span
      data-testid="payload-source-badge"
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isInjected ? 'border-critical text-critical' : 'border-border text-muted'
      }`}
    >
      {isInjected ? 'Forjado' : 'Real'}
    </span>
  );
}

/**
 * Evidencia do Track A: sem autenticação de origem no broker plain, qualquer
 * cliente pode publicar telemetria forjada no mesmo tópico de um sensor
 * legítimo. Esta view escuta SOMENTE o broker plain e destaca cada payload
 * conforme sua origem (`source: 'legit' | 'injected'`), sem transformar o
 * conteúdo cru.
 */
export default function InjectedPayloads() {
  const { readings, connected } = useTelemetryStream('plain');

  return (
    <div className="flex flex-col h-[600px] border border-exposed bg-panel overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-exposed/10">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-exposed">
          Payloads recebidos no broker plain (1883)
        </h3>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-1.5 w-4 ${connected ? 'bg-exposed' : 'bg-muted'}`}
          />
          <span
            className={`text-xs font-mono uppercase tracking-wide ${
              connected ? 'text-exposed' : 'text-muted'
            }`}
          >
            {connected ? 'Link ativo' : 'Sem conexão'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-base font-mono text-xs">
        {readings.length === 0 ? (
          <div className="text-center text-muted mt-10">Aguardando dados...</div>
        ) : (
          <div>
            {readings.map((item) => (
              <PayloadRow key={item.seq} item={item} badge={<SourceBadge source={item.source} />} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
