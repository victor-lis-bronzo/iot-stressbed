import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TELEMETRY_CAPTURED } from '../capture/capture.tokens';
import { TelemetryPoint } from '../capture/ports/telemetry';

@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      client.handshake.auth?.token ??
      (client.handshake.query?.token as string | undefined);
    try {
      await this.jwtService.verifyAsync(token);
    } catch {
      this.logger.warn(`rejected unauthenticated socket ${client.id}`);
      client.disconnect(true);
    }
  }

  @OnEvent(TELEMETRY_CAPTURED)
  broadcastTelemetry(point: TelemetryPoint): void {
    this.server?.emit('telemetry', point);
  }
}
