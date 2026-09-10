'use client';

import AttackConsole from '@/components/AttackConsole';

export default function AtaquesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Console de Ataque</h2>
        <p className="mt-1 text-sm text-muted">
          Track B — disponibilidade. O disparo continua via CLI (
          <code>scripts/run-experiment.sh</code>); esta tela monta o comando, acompanha a run
          ativa e mostra o resultado/histórico assim que o ataque termina.
        </p>
      </div>

      <AttackConsole />
    </div>
  );
}
