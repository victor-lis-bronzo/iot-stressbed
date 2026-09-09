'use client';

import InjectedPayloads from '@/components/InjectedPayloads';

export default function InjecaoPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Injeção: Integridade Comprometida</h2>
        <p className="mt-1 text-sm text-muted">
          Evidência da vulnerabilidade de integridade/spoofing: o broker plain não autentica quem
          publica em cada tópico, então um atacante pode forjar leituras de um sensor legítimo.
          Cada linha abaixo mostra o payload exatamente como chegou, com a origem (real ou
          forjada) destacada — sem cifra, sem parse, sem transformação.
        </p>
      </div>

      <InjectedPayloads />
    </div>
  );
}
