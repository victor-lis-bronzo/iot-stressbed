import { act, render, screen } from '@testing-library/react';
import { io } from 'socket.io-client';
import InterceptedPayloads from './InterceptedPayloads';

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

// Espacamento irregular e chaves fora de ordem canonica: qualquer parse +
// re-serializacao mudaria esta string, entao a assercao exata prova que o
// payload chega intacto a tela.
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
    ...overrides,
  };
}

describe('InterceptedPayloads', () => {
  it('shows the raw payload byte-for-byte as received', () => {
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(socket);

    render(<InterceptedPayloads />);

    act(() => {
      socket.emit('telemetry:plain', plainPayload());
    });

    const row = screen.getByTestId('raw-payload');
    expect(row.textContent).toBe(RAW);
  });

  it('shows the topic and reflects the connection state', () => {
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(socket);

    render(<InterceptedPayloads />);

    expect(screen.getByText('Sem conexão')).toBeInTheDocument();

    act(() => {
      socket.emit('connect');
      socket.emit('telemetry:plain', plainPayload({ topic: 'sensors/leaky' }));
    });

    expect(screen.getByText('Link ativo')).toBeInTheDocument();
    expect(screen.getByText('sensors/leaky')).toBeInTheDocument();
  });

  it('ignores secure broker telemetry', () => {
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValueOnce(socket);

    render(<InterceptedPayloads />);

    act(() => {
      socket.emit('telemetry:secure', {
        sensorId: 'sensor-9',
        temperature: 99,
        humidity: 10,
        broker: 'secure',
        receivedAt: new Date().toISOString(),
        topic: 'sensors/sensor-9',
        raw: 'segredo-que-nao-deveria-aparecer',
      });
    });

    expect(screen.queryByTestId('raw-payload')).not.toBeInTheDocument();
    expect(screen.queryByText('sensors/sensor-9')).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando dados interceptados...')).toBeInTheDocument();
  });
});
