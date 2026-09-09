'use client';

import { useEffect, useState } from 'react';
import type { Reading } from '@/hooks/useTelemetryStream';

/**
 * Uma linha de payload capturado, compartilhada entre as telas de
 * Interceptação e Injeção. Monta com opacidade 0 e sobe para 1 no primeiro
 * frame, de modo que apenas o payload recem-chegado (o unico que monta) faz o
 * fade. As linhas anteriores mantem chaves estaveis e nao reanimam.
 *
 * `badge` é opcional: quando presente, é renderizado ao lado do topico (usado
 * pela tela de Injeção para distinguir telemetria real de telemetria forjada).
 */
export default function PayloadRow({
  item,
  badge,
}: {
  item: Reading;
  badge?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`border-b border-border px-3 py-2 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="flex justify-between gap-2 text-muted">
        <span>{new Date(item.receivedAt).toLocaleTimeString()}</span>
        <span className="truncate">{item.topic}</span>
        {badge}
      </div>
      {/* Payload exatamente como chegou do broker: sem parse, sem reformatacao. */}
      <div data-testid="raw-payload" className="mt-1 whitespace-pre-wrap break-all text-primary">
        {item.raw}
      </div>
    </div>
  );
}
