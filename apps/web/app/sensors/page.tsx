'use client';

import { Trash2 } from 'lucide-react';
import SensorForm from '@/components/SensorForm';
import { useDeleteSensor, useSensors } from '@/hooks/useSensors';

export default function SensorsPage() {
  const { data: sensors, isPending } = useSensors();
  const deleteSensor = useDeleteSensor();

  const handleDelete = (id: string) => {
    if (!confirm('Deseja realmente remover este sensor?')) return;
    deleteSensor.mutate(id);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Gerenciamento de Sensores</h2>
        <p className="mt-1 text-sm text-muted">
          Cadastre ou remova sensores para o experimento.
        </p>
      </div>

      <SensorForm />

      <div className="bg-panel border border-border rounded overflow-hidden">
        <div className="px-4 py-5 border-b border-border sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-primary">Sensores Cadastrados</h3>
        </div>

        {isPending ? (
          <div className="p-6 text-center text-muted">Carregando...</div>
        ) : !sensors || sensors.length === 0 ? (
          <div className="p-6 text-center text-muted">Nenhum sensor cadastrado.</div>
        ) : (
          <ul className="divide-y divide-border">
            {sensors.map((sensor) => (
              <li key={sensor.id} className="px-4 py-4 sm:px-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-secured truncate">{sensor.name}</p>
                  <p className="text-sm text-muted mt-1">{sensor.location || 'Sem localização'}</p>
                </div>
                <div className="flex items-center">
                  <span className="text-xs text-muted mr-4">
                    Criado em {new Date(sensor.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleDelete(sensor.id)}
                    className="text-critical hover:opacity-80 transition-opacity"
                    title="Remover"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
