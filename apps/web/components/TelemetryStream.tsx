'use client';

import { useEffect, useRef, useState } from 'react';
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

interface Reading extends TelemetryData {
  seq: number;
}

interface Props {
  broker: 'plain' | 'secure';
  title: string;
}

const ACCENT = {
  plain: {
    border: 'border-exposed',
    headerBg: 'bg-exposed/10',
    text: 'text-exposed',
    bar: 'bg-exposed',
  },
  secure: {
    border: 'border-secured',
    headerBg: 'bg-secured/10',
    text: 'text-secured',
    bar: 'bg-secured',
  },
} as const;

/**
 * Uma linha de leitura. Monta com opacidade 0 e sobe para 1 no primeiro frame,
 * de modo que apenas a leitura recem-chegada (a unica que monta) faz o fade.
 * As linhas anteriores mantem chaves estaveis, nao remontam e nao reanimam.
 */
function ReadingRow({ item }: { item: Reading }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`border-b border-border px-3 py-1.5 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="flex justify-between text-muted">
        <span>{new Date(item.receivedAt).toLocaleTimeString()}</span>
        <span>{item.topic}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-primary">
        <div>
          <span className="text-muted">T:</span>{' '}
          {item.temperature !== null ? `${item.temperature.toFixed(1)}°C` : 'N/A'}
        </div>
        <div>
          <span className="text-muted">H:</span>{' '}
          {item.humidity !== null ? `${item.humidity.toFixed(1)}%` : 'N/A'}
        </div>
      </div>
    </div>
  );
}

export default function TelemetryStream({ broker, title }: Props) {
  const [data, setData] = useState<Reading[]>([]);
  const [connected, setConnected] = useState(false);
  const seqRef = useRef(0);

  const accent = ACCENT[broker];

  useEffect(() => {
    const token = getToken();
    const socket: Socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000', {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on(`telemetry:${broker}`, (payload: TelemetryData) => {
      setData((prev) => {
        seqRef.current += 1;
        const newData = [{ ...payload, seq: seqRef.current }, ...prev];
        if (newData.length > 50) return newData.slice(0, 50);
        return newData;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [broker]);

  return (
    <div className={`flex flex-col h-[600px] border ${accent.border} bg-panel overflow-hidden`}>
      <div
        className={`px-4 py-3 border-b border-border flex items-center justify-between ${accent.headerBg}`}
      >
        <h3 className={`text-sm font-semibold uppercase tracking-wider ${accent.text}`}>{title}</h3>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-1.5 w-4 ${connected ? accent.bar : 'bg-muted'}`}
          />
          <span
            className={`text-xs font-mono uppercase tracking-wide ${
              connected ? accent.text : 'text-muted'
            }`}
          >
            {connected ? 'Link ativo' : 'Sem conexão'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-base font-mono text-xs">
        {data.length === 0 ? (
          <div className="text-center text-muted mt-10">Aguardando dados...</div>
        ) : (
          <div>
            {data.map((item) => (
              <ReadingRow key={item.seq} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
