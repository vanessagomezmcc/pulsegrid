import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';

/** Producer used for malformed-event injection and DLQ re-publish. */
@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(KafkaService.name);
  private readonly kafka = new Kafka({
    clientId: 'pulsegrid-api',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:19092').split(','),
  });
  private producer: Producer | null = null;

  async onModuleInit() {
    try {
      this.producer = this.kafka.producer();
      await this.producer.connect();
    } catch (err) {
      // API stays usable for read endpoints even if the broker is down.
      this.log.warn(`Kafka producer unavailable: ${(err as Error).message}`);
      this.producer = null;
    }
  }

  async publish(topic: string, key: string, value: string): Promise<boolean> {
    if (!this.producer) return false;
    try {
      await this.producer.send({ topic, messages: [{ key, value }] });
      return true;
    } catch (err) {
      this.log.warn(`publish to ${topic} failed: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy() {
    await this.producer?.disconnect().catch(() => undefined);
  }
}
