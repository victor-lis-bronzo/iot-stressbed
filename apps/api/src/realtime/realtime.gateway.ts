import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TELEMETRY_CAPTURED } from '../capture/capture.tokens';
import { TelemetryPoint } from '../capture/ports/telemetry';

@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Server): void {
    server.use((socket: Socket, next: (err?: Error) => void) => {
      const token =
        socket.handshake.auth?.token ??
        (socket.handshake.query?.token as string | undefined);
      this.jwtService
        .verifyAsync(token)
        .then((payload) => {
          socket.data.user = payload;
          next();
        })
        .catch(() => {
          this.logger.warn(`rejected unauthenticated socket ${socket.id}`);
          next(new Error('Unauthorized'));
        });
    });
  }

  @OnEvent(TELEMETRY_CAPTURED)
  broadcastTelemetry(point: TelemetryPoint): void {
    this.server?.emit(`telemetry:${point.broker}`, point);
  }
}
