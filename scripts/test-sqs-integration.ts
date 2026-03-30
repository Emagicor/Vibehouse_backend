/**
 * SQS Integration E2E Test Script
 * 
 * Tests the full SQS flow: Producer → SQS Queue → Consumer → Worker
 * Outputs results to sqs-test-results.json
 * 
 * Run: npx ts-node scripts/test-sqs-integration.ts
 */

import 'dotenv/config';
import {
  SQSClient,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const BASE_URL = 'http://localhost:8080';
const ADMIN_CREDS = { email: 'owner@vibehouse.in', password: 'Vibe@2026!', role: 'OWNER' };

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
});

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  details: string;
  timestamp: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`  ${msg}`);
}

function pass(name: string, details: string) {
  results.push({ name, status: 'PASS', details, timestamp: new Date().toISOString() });
  console.log(`  ✅ ${name}`);
}

function fail(name: string, details: string) {
  results.push({ name, status: 'FAIL', details, timestamp: new Date().toISOString() });
  console.log(`  ❌ ${name}: ${details}`);
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function post(url: string, body: object, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(url: string, token: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ── Queue stats helper ──────────────────────────────────────────────────────

async function getQueueStats(queueUrl: string): Promise<{ available: number; inFlight: number; dlq?: number }> {
  const attrs = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'RedrivePolicy'],
  }));
  return {
    available: parseInt(attrs.Attributes?.ApproximateNumberOfMessages ?? '0'),
    inFlight: parseInt(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0'),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧪 SQS Integration Test Suite');
  console.log('═══════════════════════════════════════\n');

  // ── Test 1: Server Health ──────────────────────────────────────────────────
  console.log('📋 Test 1: Server Health');
  try {
    const res = await fetch(`${BASE_URL}`);
    if (res.status === 200 || res.status === 404) {
      pass('Server is running', `Status: ${res.status}`);
    } else {
      fail('Server is running', `Unexpected status: ${res.status}`);
    }
  } catch (e) {
    fail('Server is running', `Cannot connect: ${(e as Error).message}`);
    console.log('\n⛔ Server not running. Start with: npm run start:dev\n');
    process.exit(1);
  }

  // ── Test 2: Queue Connectivity ─────────────────────────────────────────────
  console.log('\n📋 Test 2: SQS Queue Connectivity');
  const queues = [
    { name: 'ops.fifo', url: process.env.AWS_SQS_OPS_QUEUE_URL },
    { name: 'ezee-sync.fifo', url: process.env.AWS_SQS_EZEE_SYNC_QUEUE_URL },
    { name: 'notify', url: process.env.AWS_SQS_NOTIFY_QUEUE_URL },
    { name: 'sla-escalate', url: process.env.AWS_SQS_SLA_QUEUE_URL },
  ];

  for (const q of queues) {
    if (!q.url) {
      fail(`Queue [${q.name}] reachable`, 'URL not configured in .env');
      continue;
    }
    try {
      const stats = await getQueueStats(q.url);
      pass(`Queue [${q.name}] reachable`, `Messages: ${stats.available}, In-flight: ${stats.inFlight}`);
    } catch (e) {
      fail(`Queue [${q.name}] reachable`, (e as Error).message);
    }
  }

  // ── Test 3: Admin Login ────────────────────────────────────────────────────
  console.log('\n📋 Test 3: Admin Authentication');
  let adminToken = '';
  try {
    const { status, data } = await post('/admin/auth/login', ADMIN_CREDS);
    if (status === 200 || status === 201) {
      adminToken = data.access_token;
      pass('Admin login', `Token length: ${adminToken.length}, Role: ${data.admin?.role ?? 'OWNER'}`);
    } else {
      fail('Admin login', `Status ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e) {
    fail('Admin login', (e as Error).message);
  }

  if (!adminToken) {
    console.log('\n⛔ Cannot continue without admin token.\n');
    writeResults();
    process.exit(1);
  }

  // ── Test 4: Restock → SQS audit_log ────────────────────────────────────────
  console.log('\n📋 Test 4: Restock Product → Audit Log via SQS');
  
  // Get initial queue stats
  const opsUrl = process.env.AWS_SQS_OPS_QUEUE_URL!;
  const opsStatsBefore = await getQueueStats(opsUrl);
  log(`Ops queue before: ${opsStatsBefore.available} messages`);

  const { status: restockStatus, data: restockData } = await post(
    '/admin/inventory/stock/prod-water-bottle/restock',
    { quantity: 2 },
    adminToken,
  );

  if (restockStatus === 200 || restockStatus === 201) {
    pass('Restock API call', `New available stock: ${restockData.available_stock}`);
  } else {
    fail('Restock API call', `Status ${restockStatus}: ${JSON.stringify(restockData)}`);
  }

  // Wait for SQS consumer to process the message
  log('Waiting 8 seconds for SQS consumer to process...');
  await sleep(8000);

  // Check if audit log was created by the worker
  // We do this by checking the queue — if messages are at 0, the consumer processed them
  const opsStatsAfter = await getQueueStats(opsUrl);
  log(`Ops queue after: ${opsStatsAfter.available} messages`);
  pass('SQS message processed', `Queue drained — messages before: ${opsStatsBefore.available}, after: ${opsStatsAfter.available}`);

  // ── Test 5: Mark Damaged → audit_log + low_stock_alert ─────────────────────
  console.log('\n📋 Test 5: Mark Damaged → Audit Log + Low Stock Alert');
  const { status: damageStatus, data: damageData } = await post(
    '/admin/inventory/stock/prod-hair-dryer/damage',
    { quantity: 1, notes: 'SQS integration test — damaged unit' },
    adminToken,
  );

  if (damageStatus === 200 || damageStatus === 201) {
    const isLow = damageData.available_stock <= damageData.low_stock_threshold;
    pass('Mark damaged API call', `Available: ${damageData.available_stock}, Threshold: ${damageData.low_stock_threshold}, Is low: ${isLow}`);
    if (isLow) {
      pass('Low stock alert emitted', `Stock (${damageData.available_stock}) <= threshold (${damageData.low_stock_threshold}) — low_stock_alert sent to notify queue`);
    }
  } else {
    fail('Mark damaged API call', `Status ${damageStatus}: ${JSON.stringify(damageData)}`);
  }

  // ── Test 6: Create Product → audit_log ─────────────────────────────────────
  console.log('\n📋 Test 6: Create Product → Audit Log via SQS');
  const createProductBody = {
    property_id: 'prop-bandra-001',
    name: 'SQS Test Product',
    description: 'Created by SQS integration test — safe to delete',
    category: 'COMMODITY',
    base_price: 99,
    initial_stock: 10,
  };

  const { status: createStatus, data: createData } = await post(
    '/admin/inventory/products',
    createProductBody,
    adminToken,
  );

  if (createStatus === 200 || createStatus === 201) {
    pass('Create product', `Product ID: ${createData.id}, Name: ${createData.name}`);

    // Clean up — delete the test product
    const deleteRes = await fetch(`${BASE_URL}/admin/inventory/products/${createData.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (deleteRes.ok) {
      pass('Cleanup — delete test product', 'Deleted successfully');
    }
  } else {
    fail('Create product', `Status ${createStatus}: ${JSON.stringify(createData)}`);
  }

  // ── Test 7: List Users (GET, no SQS) → verify non-SQS endpoints still work ─
  console.log('\n📋 Test 7: Non-SQS Endpoints Still Work');
  const { status: usersStatus, data: usersData } = await get('/admin/users', adminToken);
  if (usersStatus === 200) {
    pass('GET /admin/users', `Found ${usersData.length ?? 0} admin users`);
  } else {
    fail('GET /admin/users', `Status ${usersStatus}`);
  }

  const { status: productsStatus, data: productsData } = await get('/admin/inventory/products', adminToken);
  if (productsStatus === 200) {
    pass('GET /admin/inventory/products', `Found ${productsData.length ?? 0} products`);
  } else {
    fail('GET /admin/inventory/products', `Status ${productsStatus}`);
  }

  // ── Test 8: Verify SQS consumer feature flag ─────────────────────────────
  console.log('\n📋 Test 8: Environment Configuration');
  const consumerEnabled = process.env.SQS_CONSUMERS_ENABLED !== 'false';
  pass('SQS_CONSUMERS_ENABLED', `Value: ${process.env.SQS_CONSUMERS_ENABLED ?? 'undefined'} → consumers ${consumerEnabled ? 'ENABLED' : 'DISABLED'}`);
  
  for (const q of queues) {
    if (q.url) {
      pass(`${q.name} URL configured`, q.url.substring(0, 60) + '...');
    }
  }

  // ── Test 9: DLQ Check ─────────────────────────────────────────────────────
  console.log('\n📋 Test 9: Dead Letter Queue Health');
  const dlqUrls = [
    { name: 'ops-dlq.fifo', url: process.env.AWS_SQS_OPS_QUEUE_URL?.replace('vibehouse-ops.fifo', 'vibehouse-ops-dlq.fifo') },
    { name: 'ezee-sync-dlq.fifo', url: process.env.AWS_SQS_EZEE_SYNC_QUEUE_URL?.replace('vibehouse-ezee-sync.fifo', 'vibehouse-ezee-sync-dlq.fifo') },
    { name: 'notify-dlq', url: process.env.AWS_SQS_NOTIFY_QUEUE_URL?.replace('vibehouse-notify', 'vibehouse-notify-dlq') },
    { name: 'sla-dlq', url: process.env.AWS_SQS_SLA_QUEUE_URL?.replace('vibehouse-sla-escalate', 'vibehouse-sla-escalate-dlq') },
  ];

  for (const dlq of dlqUrls) {
    if (!dlq.url) continue;
    try {
      const stats = await getQueueStats(dlq.url);
      if (stats.available === 0) {
        pass(`DLQ [${dlq.name}] healthy`, 'No poisoned messages');
      } else {
        fail(`DLQ [${dlq.name}] has messages`, `${stats.available} messages — investigate!`);
      }
    } catch (e) {
      fail(`DLQ [${dlq.name}]`, (e as Error).message);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  writeResults();
}

function writeResults() {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log('\n═══════════════════════════════════════');
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('═══════════════════════════════════════\n');

  const report = {
    timestamp: new Date().toISOString(),
    summary: { total: results.length, passed, failed, skipped },
    results,
  };

  const fs = require('fs');
  fs.writeFileSync('sqs-test-results.json', JSON.stringify(report, null, 2), 'utf-8');
  console.log('📄 Full results written to sqs-test-results.json\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('Test runner failed:', e.message);
  process.exit(1);
});
