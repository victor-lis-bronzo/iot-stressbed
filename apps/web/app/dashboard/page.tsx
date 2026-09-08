'use client';

import TelemetryStream from '../../components/TelemetryStream';

export default function DashboardPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Dashboard Ao Vivo</h2>
        <p className="mt-1 text-sm text-muted">
          Acompanhamento em tempo real das mensagens recebidas pelo backend.
        </p>
      </div>

      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="p-4 lg:py-0 lg:px-6 lg:pl-0">
          <TelemetryStream broker="plain" title="Broker Plain (1883)" />
        </div>
        <div className="p-4 lg:py-0 lg:px-6 lg:pr-0">
          <TelemetryStream broker="secure" title="Broker Secure (8883)" />
        </div>
      </div>
    </div>
  );
}
