'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../lib/auth';

interface TelemetryData {
  sensorId: string;
  temperature: number | null;
  humidity: number | null;
  broker: 'plain' | 'secure';
  receivedAt: string;
  topic: string;
  raw: string;
}

interface Props {
  broker: 'plain' | 'secure';
  title: string;
}

export default function TelemetryStream({ broker, title }: Props) {
  const [data, setData] = useState<TelemetryData[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = getToken();
    const socket: Socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('telemetry', (payload: TelemetryData) => {
      if (payload.broker === broker) {
        setData((prev) => {
          const newData = [payload, ...prev];
          if (newData.length > 50) return newData.slice(0, 50);
          return newData;
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [broker]);

  return (
    <div className={`flex flex-col h-[600px] rounded-lg border ${broker === 'secure' ? 'border-green-500/50' : 'border-blue-500/50'} bg-white dark:bg-zinc-800 overflow-hidden`}>
      <div className={`px-4 py-3 border-b flex items-center justify-between ${broker === 'secure' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'}`}>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
          {title}
          <span className={`ml-3 w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} title={connected ? 'Conectado' : 'Desconectado'} />
        </h3>
        <span className="text-xs font-mono text-gray-500">
          WS: {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-zinc-900 font-mono text-xs">
        {data.length === 0 ? (
          <div className="text-center text-gray-400 mt-10">
            Aguardando dados...
          </div>
        ) : (
          <div className="space-y-2">
            {data.map((item, i) => (
              <div key={i} className="p-2 bg-white dark:bg-zinc-800 rounded border border-gray-200 dark:border-zinc-700 shadow-sm">
                <div className="flex justify-between text-gray-500 mb-1">
                  <span>{new Date(item.receivedAt).toLocaleTimeString()}</span>
                  <span>{item.topic}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-gray-800 dark:text-gray-200">
                  <div>
                    <span className="text-gray-400">T:</span> {item.temperature !== null ? `${item.temperature.toFixed(1)}°C` : 'N/A'}
                  </div>
                  <div>
                    <span className="text-gray-400">H:</span> {item.humidity !== null ? `${item.humidity.toFixed(1)}%` : 'N/A'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
