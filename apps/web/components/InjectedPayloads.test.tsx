import { act, render, screen } from '@testing-library/react';
import { io } from 'socket.io-client';
import InjectedPayloads from './InjectedPayloads';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'fake-token' }, status: 'authenticated' }),
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

const RAW = '{ "humidity":40 ,"temperature":  21.5 }';

function plainPayload(overrides: Record<string, unknown> = {}) {
  return {
    sensorId: 'sensor-1',
    temperature: 21.5,
    humidity: 40,
    broker: 'plain',
    receivedAt: new Date().toISOString(),
    topic: 'sensors/sensor-1',
    raw: RAW,
    source: 'legit',
    ...overrides,
  };
}

describe('InjectedPayloads', () => {
  it('does not mark a legit reading as forged', () => {
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(socket);

    render(<InjectedPayloads />);

    act(() => {
      socket.emit('telemetry:plain', plainPayload({ source: 'legit' }));
    });

    expect(screen.getByTestId('raw-payload').textContent).toBe(RAW);
    const badge = screen.getByTestId('payload-source-badge');
    expect(badge.textContent).toBe('Real');
    expect(badge.className).not.toContain('text-critical');
  });

  it('marks an injected reading as forged', () => {
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(socket);

    render(<InjectedPayloads />);

    act(() => {
      socket.emit('telemetry:plain', plainPayload({ source: 'injected' }));
    });

    const badge = screen.getByTestId('payload-source-badge');
    expect(badge.textContent).toBe('Forjado');
    expect(badge.className).toContain('text-critical');
  });

  it('ignores secure broker telemetry', () => {
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(socket);

    render(<InjectedPayloads />);

    act(() => {
      socket.emit('telemetry:secure', {
        sensorId: 'sensor-9',
        temperature: 99,
        humidity: 10,
        broker: 'secure',
        receivedAt: new Date().toISOString(),
        topic: 'sensors/sensor-9',
        raw: 'segredo-que-nao-deveria-aparecer',
        source: 'injected',
      });
    });

    expect(screen.queryByTestId('raw-payload')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payload-source-badge')).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando dados...')).toBeInTheDocument();
  });
});
