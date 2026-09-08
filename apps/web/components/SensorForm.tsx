'use client';

import { useForm } from 'react-hook-form';
import { useCreateSensor } from '@/hooks/useSensors';

interface SensorFields {
  name: string;
  location: string;
}

const INPUT_CLASS =
  'mt-1 block w-full rounded border border-border bg-base focus:border-secured focus:ring-secured sm:text-sm p-2';

export default function SensorForm() {
  const createSensor = useCreateSensor();
  const { register, handleSubmit, reset } = useForm<SensorFields>();

  const onSubmit = ({ name, location }: SensorFields) => {
    createSensor.mutate({ name, location: location || undefined }, { onSuccess: () => reset() });
  };

  return (
    <div className="bg-panel border border-border rounded p-6 mb-8">
      <h3 className="text-lg font-medium text-primary mb-4">Registrar Novo Sensor</h3>

      {createSensor.isError && (
        <div role="alert" className="mb-4 p-3 bg-critical/10 text-critical rounded text-sm">
          Erro ao registrar sensor
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-primary">
            Nome do Sensor (ID MQTT)
          </label>
          <input
            id="name"
            type="text"
            placeholder="Ex: dht11-sala"
            className={INPUT_CLASS}
            {...register('name', { required: true, minLength: 1 })}
          />
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-primary">
            Localização (Opcional)
          </label>
          <input
            id="location"
            type="text"
            placeholder="Ex: Sala principal"
            className={INPUT_CLASS}
            {...register('location')}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={createSensor.isPending}
            className="inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded text-[#14181F] bg-secured hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secured disabled:opacity-50"
          >
            {createSensor.isPending ? 'Registrando...' : 'Registrar Sensor'}
          </button>
        </div>
      </form>
    </div>
  );
}
