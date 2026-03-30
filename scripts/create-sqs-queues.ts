/**
 * Creates all SQS queues for VibeHouse.
 *
 * Run once: npx ts-node scripts/create-sqs-queues.ts
 *
 * Creates 4 main queues + 4 DLQs:
 *   vibehouse-ops-dlq.fifo         (DLQ)
 *   vibehouse-ops.fifo             → ops DLQ after 3 failures
 *   vibehouse-ezee-sync-dlq.fifo  (DLQ)
 *   vibehouse-ezee-sync.fifo      → ezee DLQ after 3 failures
 *   vibehouse-notify-dlq           (DLQ)
 *   vibehouse-notify               → notify DLQ after 3 failures
 *   vibehouse-sla-escalate-dlq     (DLQ)
 *   vibehouse-sla-escalate         → sla DLQ after 3 failures
 */

import * as dotenv from 'dotenv';
dotenv.config();

import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
});

interface QueueDef {
  name: string;
  fifo: boolean;
  dlqName: string;
  visibilityTimeout: number;
  messageRetention: number;   // seconds
  maxReceiveCount: number;    // before DLQ
}

const QUEUES: QueueDef[] = [
  {
    name: 'vibehouse-ops',
    fifo: true,
    dlqName: 'vibehouse-ops-dlq',
    visibilityTimeout: 60,
    messageRetention: 345600,     // 4 days
    maxReceiveCount: 3,
  },
  {
    name: 'vibehouse-ezee-sync',
    fifo: true,
    dlqName: 'vibehouse-ezee-sync-dlq',
    visibilityTimeout: 120,
    messageRetention: 345600,     // 4 days
    maxReceiveCount: 3,
  },
  {
    name: 'vibehouse-notify',
    fifo: false,
    dlqName: 'vibehouse-notify-dlq',
    visibilityTimeout: 30,
    messageRetention: 172800,     // 2 days
    maxReceiveCount: 3,
  },
  {
    name: 'vibehouse-sla-escalate',
    fifo: false,
    dlqName: 'vibehouse-sla-escalate-dlq',
    visibilityTimeout: 30,
    messageRetention: 86400,      // 1 day
    maxReceiveCount: 3,
  },
];

async function createQueue(
  name: string,
  fifo: boolean,
  attributes: Record<string, string>,
): Promise<string> {
  const fullName = fifo ? `${name}.fifo` : name;

  const queueAttributes: Record<string, string> = {
    ...attributes,
  };

  if (fifo) {
    queueAttributes['FifoQueue'] = 'true';
    queueAttributes['ContentBasedDeduplication'] = 'false';
  }

  const result = await sqs.send(
    new CreateQueueCommand({
      QueueName: fullName,
      Attributes: queueAttributes,
    }),
  );

  console.log(`✅ Created: ${fullName} → ${result.QueueUrl}`);
  return result.QueueUrl!;
}

async function getQueueArn(queueUrl: string): Promise<string> {
  const attrs = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  return attrs.Attributes!['QueueArn']!;
}

async function main() {
  console.log('\n🚀 Creating VibeHouse SQS queues...\n');
  console.log('Add these to your .env:\n');

  const envLines: string[] = ['# AWS SQS Queue URLs'];

  for (const q of QUEUES) {
    // 1. Create DLQ first
    const dlqUrl = await createQueue(q.dlqName, q.fifo, {
      MessageRetentionPeriod: '1209600',  // 14 days for DLQ
      VisibilityTimeout: q.visibilityTimeout.toString(),
    });

    // 2. Get DLQ ARN
    const dlqArn = await getQueueArn(dlqUrl);

    // 3. Create main queue with RedrivePolicy pointing to DLQ
    const mainUrl = await createQueue(q.name, q.fifo, {
      VisibilityTimeout: q.visibilityTimeout.toString(),
      MessageRetentionPeriod: q.messageRetention.toString(),
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: q.maxReceiveCount,
      }),
    });

    // Map queue name to env var key
    const envKey = q.name
      .replace('vibehouse-', 'AWS_SQS_')
      .replace(/-/g, '_')
      .toUpperCase() + '_QUEUE_URL';

    envLines.push(`${envKey}=${mainUrl}`);
  }

  console.log('\n────────────────────────────────────────');
  console.log(envLines.join('\n'));
  console.log('────────────────────────────────────────\n');
  console.log('Done! Copy the above into your .env file.\n');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
