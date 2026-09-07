'use client';

import TelemetryStream from '../../components/TelemetryStream';

export default function DashboardPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard Ao Vivo</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Acompanhamento em tempo real das mensagens recebidas pelo backend.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TelemetryStream broker="plain" title="Broker Plain (1883)" />
        <TelemetryStream broker="secure" title="Broker Secure (8883)" />
      </div>
    </div>
  );
}
