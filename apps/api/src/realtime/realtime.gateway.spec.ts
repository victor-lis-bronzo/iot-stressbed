import { JwtService } from '@nestjs/jwt';
import { Server } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway';
import { BrokerLabel, TelemetryPoint } from '../capture/ports/telemetry';

function pointFrom(broker: BrokerLabel, sensorId: string): TelemetryPoint {
  return {
    sensorId,
    temperature: 21,
    humidity: 50,
    receivedAt: new Date(),
    broker,
    runId: 'run-1',
    source: 'legit',
    topic: `sensors/${sensorId}/telemetry`,
    raw: '{}',
  };
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let emitted: Array<[string, TelemetryPoint]>;

  beforeEach(() => {
    gateway = new RealtimeGateway({} as JwtService);
    emitted = [];
    gateway.server = {
      emit: (event: string, payload: TelemetryPoint) => {
        emitted.push([event, payload]);
      },
    } as unknown as Server;
  });

  it('broadcasts each capture stream on its own event', () => {
    gateway.broadcastTelemetry(pointFrom('plain', 'esp32-01'));
    gateway.broadcastTelemetry(pointFrom('secure', 'esp32-02'));

    expect(emitted.map(([event]) => event)).toEqual([
      'telemetry:plain',
      'telemetry:secure',
    ]);
    expect(emitted.map(([, payload]) => payload.sensorId)).toEqual([
      'esp32-01',
      'esp32-02',
    ]);
  });
});
