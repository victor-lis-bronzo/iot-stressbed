'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './useApi';

export interface Sensor {
  id: string;
  name: string;
  location: string | null;
  createdAt: string;
}

export interface CreateSensorInput {
  name: string;
  location?: string;
}

const SENSORS_KEY = ['sensors'];

export function useSensors() {
  const api = useApi();

  return useQuery({
    queryKey: SENSORS_KEY,
    queryFn: async () => {
      const response = await api.get<Sensor[]>('/sensors');
      return response.data;
    },
  });
}

export function useCreateSensor() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSensorInput) => {
      const response = await api.post<Sensor>('/sensors', input);
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SENSORS_KEY }),
  });
}

export function useDeleteSensor() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sensors/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SENSORS_KEY }),
  });
}
