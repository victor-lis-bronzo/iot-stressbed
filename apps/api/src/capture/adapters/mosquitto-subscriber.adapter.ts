import mqtt, { IClientOptions, MqttClient } from 'mqtt';
import {
  MqttMessageHandler,
  MqttSubscriberPort,
} from '../ports/mqtt-subscriber.port';

export interface MqttConnectionConfig {
  host: string;
  port: number;
  tls: boolean;
  username?: string;
  password?: string;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  rejectUnauthorized?: boolean;
  clientId?: string;
}

export class MosquittoSubscriberAdapter implements MqttSubscriberPort {
  private client?: MqttClient;
  private connectionLostHandler?: (reason: string) => void;
  private closing = false;

  constructor(private readonly config: MqttConnectionConfig) {}

  connect(): Promise<void> {
    const options: IClientOptions = {
      host: this.config.host,
      port: this.config.port,
      protocol: this.config.tls ? 'mqtts' : 'mqtt',
      username: this.config.username,
      password: this.config.password,
      ca: this.config.ca,
      cert: this.config.cert,
      key: this.config.key,
      rejectUnauthorized: this.config.rejectUnauthorized,
      clientId:
        this.config.clientId ??
        `stressbed-capture-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 0,
    };

    return new Promise((resolve, reject) => {
      const client = mqtt.connect(options);
      this.client = client;

      const onError = (err: Error) => {
        client.removeListener('connect', onConnect);
        reject(err);
      };
      const onConnect = () => {
        client.removeListener('error', onError);
        this.attachConnectionLostListeners(client);
        resolve();
      };

      client.once('connect', onConnect);
      client.once('error', onError);
    });
  }

  subscribe(topicFilter: string, onMessage: MqttMessageHandler): Promise<void> {
    const client = this.requireClient();
    client.on('message', (topic, payload) => {
      void onMessage({ topic, payload: payload.toString() });
    });
    return new Promise((resolve, reject) => {
      client.subscribe(topicFilter, { qos: 0 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  onConnectionLost(handler: (reason: string) => void): void {
    this.connectionLostHandler = handler;
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    const client = this.client;
    if (client) {
      await client.endAsync();
    }
  }

  private attachConnectionLostListeners(client: MqttClient): void {
    client.on('close', () => this.reportLost('connection closed'));
    client.on('error', (err) => this.reportLost(err.message));
  }

  private reportLost(reason: string): void {
    if (this.closing) {
      return;
    }
    this.connectionLostHandler?.(reason);
  }

  private requireClient(): MqttClient {
    if (!this.client) {
      throw new Error('MosquittoSubscriberAdapter: connect() not called');
    }
    return this.client;
  }
}
