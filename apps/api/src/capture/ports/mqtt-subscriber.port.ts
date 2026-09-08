export interface RawMqttMessage {
  topic: string;
  payload: string;
}

export type MqttMessageHandler = (message: RawMqttMessage) => void | Promise<void>;

export interface MqttSubscriberPort {
  connect(): Promise<void>;
  subscribe(topicFilter: string, onMessage: MqttMessageHandler): Promise<void>;
  onConnectionLost(handler: (reason: string) => void): void;
  disconnect(): Promise<void>;
}
