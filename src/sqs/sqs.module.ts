import { Global, Module, OnModuleInit } from '@nestjs/common';
import { SqsProducerService } from './sqs-producer.service';
import { SqsConsumerService } from './sqs-consumer.service';
import { OpsTaskWorker } from './workers/ops-task.worker';
import { EzeeSyncWorker } from './workers/ezee-sync.worker';
import { NotifyWorker } from './workers/notify.worker';
import { SQS_QUEUE_URLS } from './sqs.constants';
import { EzeeModule } from '../ezee/ezee.module';

/**
 * SQS Module — wires producer, consumer, and all workers.
 *
 * Queue architecture (4 queues):
 *   vibehouse-ops.fifo         — Internal DB writes (audit logs), max 10 messages/poll
 *   vibehouse-ezee-sync.fifo  — eZee PMS API calls, max 1 message/poll (rate limit protection)
 *   vibehouse-notify           — Outbound notifications (Wati WhatsApp, email), max 10 messages/poll
 *   vibehouse-sla-escalate     — SLA timer expirations (future)
 *
 * @Global so any module can inject SqsProducerService without importing SqsModule.
 */
@Global()
@Module({
  imports: [EzeeModule],
  providers: [
    SqsProducerService,
    SqsConsumerService,
    OpsTaskWorker,
    EzeeSyncWorker,
    NotifyWorker,
  ],
  exports: [SqsProducerService],
})
export class SqsModule implements OnModuleInit {
  constructor(
    private readonly consumer: SqsConsumerService,
    private readonly opsWorker: OpsTaskWorker,
    private readonly ezeeSyncWorker: EzeeSyncWorker,
    private readonly notifyWorker: NotifyWorker,
  ) {}

  onModuleInit(): void {
    // Register all queue consumers with their workers

    // Ops queue — internal operations (audit logs, payment events)
    // High throughput: 10 messages per poll
    this.consumer.registerConsumer({
      name: 'ops-task',
      queueUrlEnvKey: SQS_QUEUE_URLS.OPS,
      worker: this.opsWorker,
      maxMessages: 10,
      visibilityTimeout: 60,
    });

    // eZee sync queue — rate-limited eZee API calls
    // Single message per poll to respect eZee rate limits
    this.consumer.registerConsumer({
      name: 'ezee-sync',
      queueUrlEnvKey: SQS_QUEUE_URLS.EZEE_SYNC,
      worker: this.ezeeSyncWorker,
      maxMessages: 1,
      visibilityTimeout: 120,      // eZee API can be slow
      emptyPollDelayMs: 2000,       // Less aggressive polling
    });

    // Notify queue — outbound notifications
    this.consumer.registerConsumer({
      name: 'notify',
      queueUrlEnvKey: SQS_QUEUE_URLS.NOTIFY,
      worker: this.notifyWorker,
      maxMessages: 10,
      visibilityTimeout: 30,
    });

    // SLA escalation queue — registered but no worker yet (Phase 2)
    // this.consumer.registerConsumer({
    //   name: 'sla-escalate',
    //   queueUrlEnvKey: SQS_QUEUE_URLS.SLA_ESCALATE,
    //   worker: this.slaWorker,
    //   maxMessages: 10,
    //   visibilityTimeout: 30,
    // });
  }
}
