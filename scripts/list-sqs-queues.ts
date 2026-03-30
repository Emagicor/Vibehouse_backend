import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
});

async function main() {
  const result = await sqs.send(new ListQueuesCommand({ QueueNamePrefix: 'vibehouse' }));
  const urls = result.QueueUrls ?? [];

  const envMap: Record<string, string> = {};

  for (const url of urls) {
    const name = url.split('/').pop()!;
    if (name.includes('-dlq')) continue;

    if (name === 'vibehouse-ops.fifo') envMap['AWS_SQS_OPS_QUEUE_URL'] = url;
    else if (name === 'vibehouse-ezee-sync.fifo') envMap['AWS_SQS_EZEE_SYNC_QUEUE_URL'] = url;
    else if (name === 'vibehouse-notify') envMap['AWS_SQS_NOTIFY_QUEUE_URL'] = url;
    else if (name === 'vibehouse-sla-escalate') envMap['AWS_SQS_SLA_QUEUE_URL'] = url;
  }

  // Append to .env
  let envContent = fs.readFileSync('.env', 'utf-8');

  // Check if already added
  if (envContent.includes('AWS_SQS_OPS_QUEUE_URL')) {
    console.log('SQS env vars already in .env — skipping');
    return;
  }

  const newVars = [
    '',
    '# AWS SQS Queue URLs',
    ...Object.entries(envMap).map(([k, v]) => `${k}=${v}`),
    'SQS_CONSUMERS_ENABLED=true',
  ].join('\n');

  envContent += newVars + '\n';
  fs.writeFileSync('.env', envContent, 'utf-8');

  console.log('Appended SQS env vars to .env');
  console.log(`Queues configured: ${Object.keys(envMap).length}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
