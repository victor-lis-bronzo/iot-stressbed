import { act, renderHook } from '@testing-library/react';
import { io } from 'socket.io-client';
import { useSession } from 'next-auth/react';
import { useTelemetryStream } from './useTelemetryStream';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
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

function reading(sensorId: string) {
  return {
    sensorId,
    temperature: 20,
    humidity: 50,
    broker: 'plain' as const,
    receivedAt: new Date().toISOString(),
    topic: `sensors/${sensorId}`,
    raw: '{}',
  };
}

function authenticated(accessToken: string | undefined) {
  (useSession as jest.Mock).mockReturnValue({
    data: accessToken ? { accessToken } : null,
    status: accessToken ? 'authenticated' : 'unauthenticated',
  });
}

describe('useTelemetryStream', () => {
  beforeEach(() => {
    (io as jest.Mock).mockReset();
  });

  it('does not open a socket before the session provides a token', () => {
    authenticated(undefined);

    const { result } = renderHook(() => useTelemetryStream('plain'));

    expect(io).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(false);
  });

  it('authenticates the handshake with the session access token', () => {
    authenticated('fake-token');
    (io as jest.Mock).mockReturnValue(createMockSocket());

    renderHook(() => useTelemetryStream('plain'));

    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { token: 'fake-token' } })
    );
  });

  it('tracks connection state and accumulates newest readings first', () => {
    authenticated('fake-token');
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValue(socket);

    const { result } = renderHook(() => useTelemetryStream('plain'));

    act(() => {
      socket.emit('connect');
      socket.emit('telemetry:plain', reading('sensor-1'));
      socket.emit('telemetry:plain', reading('sensor-2'));
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.readings.map((item) => item.sensorId)).toEqual([
      'sensor-2',
      'sensor-1',
    ]);
  });

  it('caps the buffer at 50 readings', () => {
    authenticated('fake-token');
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValue(socket);

    const { result } = renderHook(() => useTelemetryStream('plain'));

    act(() => {
      for (let i = 0; i < 60; i += 1) {
        socket.emit('telemetry:plain', reading(`sensor-${i}`));
      }
    });

    expect(result.current.readings).toHaveLength(50);
    expect(result.current.readings[0].sensorId).toBe('sensor-59');
  });

  it('disconnects the socket on unmount', () => {
    authenticated('fake-token');
    const socket = createMockSocket();
    (io as jest.Mock).mockReturnValue(socket);

    const { unmount } = renderHook(() => useTelemetryStream('plain'));
    unmount();

    expect(socket.disconnect).toHaveBeenCalled();
  });
});
