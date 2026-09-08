'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useSession } from 'next-auth/react';
import { API_BASE_URL } from '@/lib/api';

export type Broker = 'plain' | 'secure';

export interface TelemetryData {
  sensorId: string;
  temperature: number | null;
  humidity: number | null;
  broker: Broker;
  receivedAt: string;
  topic: string;
  raw: string;
}

export interface Reading extends TelemetryData {
  seq: number;
}

const MAX_READINGS = 50;

export function useTelemetryStream(broker: Broker) {
  const { data: session } = useSession();
  const accessToken = session?.accessToken;
  const [readings, setReadings] = useState<Reading[]>([]);
  const [connected, setConnected] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!accessToken) return;

    const socket: Socket = io(API_BASE_URL, {
      auth: { token: accessToken },
      transports: ['websocket'],
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on(`telemetry:${broker}`, (payload: TelemetryData) => {
      setReadings((previous) => {
        seqRef.current += 1;
        return [{ ...payload, seq: seqRef.current }, ...previous].slice(0, MAX_READINGS);
      });
    });

    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [broker, accessToken]);

  return { readings, connected };
}
