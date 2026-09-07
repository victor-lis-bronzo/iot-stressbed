import { act, render, screen } from '@testing-library/react';
import { io } from 'socket.io-client';
import TelemetryStream from './TelemetryStream';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

jest.mock('../lib/auth', () => ({
  getToken: () => 'fake-token',
}));

function createMockSocket() {
  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  return {
    on: jest.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    disconnect: jest.fn(),
    emit(event: string, payload?: unknown) {
      (handlers[event] || []).forEach((handler) => handler(payload));
    },
  };
}

describe('TelemetryStream', () => {
  it('only shows readings from telemetry:plain in the plain stream', () => {
    const plainSocket = createMockSocket();
    const secureSocket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(plainSocket).mockReturnValueOnce(secureSocket);

    render(
      <>
        <TelemetryStream broker="plain" title="Broker Plain" />
        <TelemetryStream broker="secure" title="Broker Secure" />
      </>
    );

    act(() => {
      plainSocket.emit('telemetry:plain', {
        sensorId: 'sensor-1',
        temperature: 21.5,
        humidity: 40,
        broker: 'plain',
        receivedAt: new Date().toISOString(),
        topic: 'sensors/sensor-1',
        raw: '{}',
      });

      secureSocket.emit('telemetry:secure', {
        sensorId: 'sensor-2',
        temperature: 30.2,
        humidity: 55,
        broker: 'secure',
        receivedAt: new Date().toISOString(),
        topic: 'sensors/sensor-2',
        raw: '{}',
      });
    });

    expect(screen.getByText('sensors/sensor-1')).toBeInTheDocument();
    expect(screen.getByText('sensors/sensor-2')).toBeInTheDocument();
    expect(screen.getByText(/21\.5/)).toBeInTheDocument();
    expect(screen.getByText(/30\.2/)).toBeInTheDocument();
  });

  it('does not leak secure readings into the plain stream', () => {
    const plainSocket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(plainSocket);

    render(<TelemetryStream broker="plain" title="Broker Plain" />);

    act(() => {
      plainSocket.emit('telemetry:secure', {
        sensorId: 'sensor-3',
        temperature: 99,
        humidity: 10,
        broker: 'secure',
        receivedAt: new Date().toISOString(),
        topic: 'sensors/sensor-3',
        raw: '{}',
      });
    });

    expect(screen.queryByText('sensors/sensor-3')).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando dados...')).toBeInTheDocument();
  });
});
