'use client';

import InterceptedPayloads from '@/components/InterceptedPayloads';

export default function InterceptacaoPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Interceptação: a Telemetria Exposta</h2>
        <p className="mt-1 text-sm text-muted">
          Evidência da vulnerabilidade A1: um subscriber sem qualquer autorização assina o
          broker plain e lê toda a telemetria em texto puro. Cada linha abaixo é o payload
          exatamente como trafegou na rede — sem cifra, sem parse, sem transformação.
        </p>
      </div>

      <InterceptedPayloads />
    </div>
  );
}
