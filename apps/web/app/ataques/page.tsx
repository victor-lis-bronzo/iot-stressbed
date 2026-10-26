'use client';

import AttackConsole from '@/components/AttackConsole';

export default function AtaquesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Console de Ataque</h2>
        <p className="mt-1 text-sm text-muted">
          Track B — disponibilidade. Escolha o ataque e clique em Disparar: o backend executa a run
          de ponta a ponta, e esta tela acompanha a run ativa e mostra o resultado/histórico assim
          que o ataque termina. O mesmo ataque também roda pelo terminal (
          <code>scripts/run-experiment.sh</code>).
        </p>
      </div>

      <AttackConsole />
    </div>
  );
}
