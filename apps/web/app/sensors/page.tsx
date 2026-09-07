'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '../../lib/api';
import SensorForm from '../../components/SensorForm';
import { Trash2 } from 'lucide-react';

interface Sensor {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export default function SensorsPage() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSensors = useCallback(async () => {
    try {
      const response = await api.get('/sensors');
      setSensors(response.data);
    } catch (err) {
      console.error('Failed to fetch sensors', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSensors();
  }, [fetchSensors]);

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente remover este sensor?')) return;
    try {
      await api.delete(`/sensors/${id}`);
      fetchSensors();
    } catch (err) {
      console.error('Failed to delete sensor', err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-primary">Gerenciamento de Sensores</h2>
        <p className="mt-1 text-sm text-muted">
          Cadastre ou remova sensores para o experimento.
        </p>
      </div>

      <SensorForm onSuccess={fetchSensors} />

      <div className="bg-panel border border-border rounded overflow-hidden">
        <div className="px-4 py-5 border-b border-border sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-primary">Sensores Cadastrados</h3>
        </div>

        {loading ? (
          <div className="p-6 text-center text-muted">Carregando...</div>
        ) : sensors.length === 0 ? (
          <div className="p-6 text-center text-muted">Nenhum sensor cadastrado.</div>
        ) : (
          <ul className="divide-y divide-border">
            {sensors.map((sensor) => (
              <li key={sensor.id} className="px-4 py-4 sm:px-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-secured truncate">{sensor.name}</p>
                  <p className="text-sm text-muted mt-1">{sensor.description || 'Sem descrição'}</p>
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
