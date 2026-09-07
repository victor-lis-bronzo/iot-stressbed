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
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Gerenciamento de Sensores</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Cadastre ou remova sensores para o experimento.
        </p>
      </div>

      <SensorForm onSuccess={fetchSensors} />

      <div className="bg-white dark:bg-zinc-800 shadow rounded-lg overflow-hidden">
        <div className="px-4 py-5 border-b border-gray-200 dark:border-zinc-700 sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">Sensores Cadastrados</h3>
        </div>
        
        {loading ? (
          <div className="p-6 text-center text-gray-500">Carregando...</div>
        ) : sensors.length === 0 ? (
          <div className="p-6 text-center text-gray-500">Nenhum sensor cadastrado.</div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-zinc-700">
            {sensors.map((sensor) => (
              <li key={sensor.id} className="px-4 py-4 sm:px-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400 truncate">{sensor.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{sensor.description || 'Sem descrição'}</p>
                </div>
                <div className="flex items-center">
                  <span className="text-xs text-gray-400 mr-4">
                    Criado em {new Date(sensor.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleDelete(sensor.id)}
                    className="text-red-500 hover:text-red-700 transition-colors"
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
