'use client';

import { useTelemetryStream } from '@/hooks/useTelemetryStream';
import PayloadRow from '@/components/PayloadRow';

/**
 * Evidencia do Track A: qualquer terceiro conectado ao broker plain le toda a
 * telemetria em texto puro. Por isso esta view escuta SOMENTE o broker plain e
 * exibe o payload cru, sem transformacao alguma.
 */
export default function InterceptedPayloads() {
  const { readings, connected } = useTelemetryStream('plain');

  return (
    <div className="flex flex-col h-[600px] border border-exposed bg-panel overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-exposed/10">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-exposed">
          Payloads capturados no broker plain (1883)
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
          <div className="text-center text-muted mt-10">Aguardando dados interceptados...</div>
        ) : (
          <div>
            {readings.map((item) => (
              <PayloadRow key={item.seq} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
