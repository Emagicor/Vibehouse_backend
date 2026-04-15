import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import type { SqsMessageEnvelope } from './types/messages';

export interface SqsWorker {
  /** Process a single message. Throw to signal failure (message returns to queue). */
  process(message: SqsMessageEnvelope): Promise<void>;
}

interface QueueConsumerConfig {
  name: string;
  queueUrlEnvKey: string;
  worker: SqsWorker;
  /** Max messages per poll (1-10). Lower = less concurrency for rate-limited APIs. */
  maxMessages?: number;
  /** How long to wait for messages before returning empty (long polling). */
  waitTimeSeconds?: number;
  /** How long a message is hidden after being received. */
  visibilityTimeout?: number;
  /** Delay between polls when no messages are found (ms). */
  emptyPollDelayMs?: number;
}

@Injectable()
export class SqsConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly sqs: SQSClient;
  private running = false;
  private readonly consumers: QueueConsumerConfig[] = [];
  private readonly pollingPromises: Promise<void>[] = [];

  constructor() {
    this.sqs = new SQSClient({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  /**
   * Register a queue consumer. Call this before onModuleInit.
   */
  registerConsumer(config: QueueConsumerConfig): void {
    this.consumers.push(config);
  }

  async onApplicationBootstrap(): Promise<void> {
    const enabled = process.env.SQS_CONSUMERS_ENABLED !== 'false';
    if (!enabled) {
      this.logger.warn('SQS consumers DISABLED (SQS_CONSUMERS_ENABLED=false)');
      return;
    }

    this.running = true;

    for (const config of this.consumers) {
      const queueUrl = process.env[config.queueUrlEnvKey];
      if (!queueUrl) {
        this.logger.warn(`SQS consumer [${config.name}] skipped — ${config.queueUrlEnvKey} not set`);
        continue;
      }

      this.logger.log(`SQS consumer [${config.name}] starting → ${config.queueUrlEnvKey}`);
      const promise = this.pollLoop(queueUrl, config);
      this.pollingPromises.push(promise);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('SQS consumers shutting down...');
    this.running = false;
    // Wait for all polling loops to finish their current iteration
    await Promise.allSettled(this.pollingPromises);
    this.logger.log('SQS consumers stopped');
  }

  // ── Polling loop ──────────────────────────────────────────────────────────

  private async pollLoop(queueUrl: string, config: QueueConsumerConfig): Promise<void> {
    const maxMessages = config.maxMessages ?? 10;
    const waitTime = config.waitTimeSeconds ?? 20;
    const visTimeout = config.visibilityTimeout ?? 60;
    const emptyDelay = config.emptyPollDelayMs ?? 1000;

    while (this.running) {
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: maxMessages,
            WaitTimeSeconds: waitTime,
            VisibilityTimeout: visTimeout,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
        );

        const messages = response.Messages ?? [];

        if (messages.length === 0) {
          // Short delay to avoid tight loop when queue is empty
          await this.sleep(emptyDelay);
          continue;
        }

        for (const msg of messages) {
          try {
            const envelope: SqsMessageEnvelope = JSON.parse(msg.Body ?? '{}');

            this.logger.debug(
              `[${config.name}] Processing: ${envelope.type} (attempt: ${msg.Attributes?.ApproximateReceiveCount ?? '?'})`,
            );

            await config.worker.process(envelope);

            // Success — delete from queue
            await this.sqs.send(
              new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: msg.ReceiptHandle!,
              }),
            );
          } catch (err) {
            // Don't delete — SQS will make the message visible again after visibilityTimeout.
            // After maxReceiveCount attempts, it moves to DLQ.
            const attempt = msg.Attributes?.ApproximateReceiveCount ?? '?';
            if (this.isDeadlock(err)) {
              // Postgres deadlock (40P01): two concurrent writers collided on the same row.
              // Make the message visible immediately (2 s backoff) so it retries fast
              // instead of sitting hidden for the full visibilityTimeout window.
              this.logger.warn(
                `[${config.name}] DEADLOCK on attempt ${attempt} — requeueing in 2 s: ${(err as Error).message}`,
              );
              await this.resetVisibility(queueUrl, msg.ReceiptHandle!, 2);
            } else {
              this.logger.error(
                `[${config.name}] Worker failed (attempt ${attempt}): ${(err as Error).message}`,
                (err as Error).stack,
              );
            }
          }
        }
      } catch (err) {
        // SQS connection error — wait before retrying
        this.logger.error(`[${config.name}] Poll error: ${(err as Error).message}`);
        await this.sleep(5000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Detects a PostgreSQL deadlock error (code 40P01).
   * Prisma wraps PG errors — check both the Prisma error meta and the raw message.
   */
  private isDeadlock(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as Record<string, unknown>;
    // Prisma wraps PG error code in e.meta.code or exposes it on e.code directly
    const code = (e['code'] as string) ?? ((e['meta'] as Record<string, unknown>)?.['code'] as string);
    if (code === '40P01') return true;
    // Fallback: check the raw error message
    const msg = (e['message'] as string) ?? '';
    return msg.toLowerCase().includes('deadlock');
  }

  /**
   * Resets a message's visibility timeout so it becomes available again
   * after `delaySeconds` instead of waiting the original visibilityTimeout.
   * Used for deadlock retries to avoid unnecessary delay.
   */
  private async resetVisibility(queueUrl: string, receiptHandle: string, delaySeconds: number): Promise<void> {
    try {
      await this.sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: delaySeconds,
        }),
      );
    } catch (err) {
      // Non-fatal — message will become visible after original timeout anyway
      this.logger.warn(`Failed to reset visibility timeout: ${(err as Error).message}`);
    }
  }
}
