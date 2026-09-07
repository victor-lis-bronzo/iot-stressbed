'use client';

import { useState } from 'react';
import api from '../lib/api';

export default function SensorForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      await api.post('/sensors', { name, description });
      setName('');
      setDescription('');
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao registrar sensor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-panel border border-border rounded p-6 mb-8">
      <h3 className="text-lg font-medium text-primary mb-4">Registrar Novo Sensor</h3>

      {error && (
        <div className="mb-4 p-3 bg-critical/10 text-critical rounded text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-primary">
            Nome do Sensor (ID MQTT)
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-border bg-base focus:border-secured focus:ring-secured sm:text-sm p-2"
            placeholder="Ex: dht11-sala"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-primary">
            Descrição (Opcional)
          </label>
          <input
            type="text"
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 block w-full rounded border border-border bg-base focus:border-secured focus:ring-secured sm:text-sm p-2"
            placeholder="Ex: Sensor de temperatura e umidade da sala principal"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded text-[#14181F] bg-secured hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secured disabled:opacity-50"
          >
            {loading ? 'Registrando...' : 'Registrar Sensor'}
          </button>
        </div>
      </form>
    </div>
  );
}
