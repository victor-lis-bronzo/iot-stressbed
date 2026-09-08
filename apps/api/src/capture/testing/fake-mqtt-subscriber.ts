import {
  MqttMessageHandler,
  MqttSubscriberPort,
  RawMqttMessage,
} from '../ports/mqtt-subscriber.port';

export class FakeMqttSubscriber implements MqttSubscriberPort {
  connected = false;
  private handlers = new Map<string, MqttMessageHandler>();
  private connectionLostHandler?: (reason: string) => void;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async subscribe(
    topicFilter: string,
    onMessage: MqttMessageHandler,
  ): Promise<void> {
    this.handlers.set(topicFilter, onMessage);
  }

  onConnectionLost(handler: (reason: string) => void): void {
    this.connectionLostHandler = handler;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async publish(message: RawMqttMessage): Promise<void> {
    for (const handler of this.handlers.values()) {
      await handler(message);
    }
  }

  dropConnection(reason: string): void {
    this.connected = false;
    this.connectionLostHandler?.(reason);
  }
}
