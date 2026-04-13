/**
 * fix-room-type-ids.ts  (v2 — authoritative, using get_rooms data)
 * ──────────────────────────────────────────────────────────────────
 * Applies confirmed eZee room_ids to all local room_types rows.
 * Uses data from get_rooms (Vacation Rental API) — ground truth.
 *
 * Confirmed mapping from get_rooms output:
 *   6076500000000000001 → 4 Bed Mixed Dormitory  (rate plan ✅)
 *   6076500000000000002 → Deluxe                  (rate plan ✅)
 *   6076500000000000004 → 6 Bed Mixed Dormitory   (NO rate plan ⚠️)
 *   6076500000000000005 → 4 Bed Dormitory Female  (NO rate plan ⚠️)
 *   6076500000000000006 → 6 Bed Dormitory Female  (NO rate plan ⚠️)
 *
 * Run: npx ts-node --project tsconfig.json scripts/fix-room-type-ids.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PROP = 'prop-koramangala-a';

async function main() {
  console.log('\n🔧 Applying confirmed eZee room type IDs...\n');

  // ── 1. Update existing rows with confirmed IDs ────────────────────────────
  const confirmed = [
    {
      id: 'rt-ka-4dorm',
      label: '4 Bed Mixed Dormitory',
      ezeeRoomTypeId: '6076500000000000001',
      ezeeRatePlanId: '6076500000000000001',
      ezeeRateTypeId: '6076500000000000001',
      isActive: true,
    },
    {
      id: 'rt-ka-queen',
      label: 'Queen Size Room (→ Deluxe in eZee)',
      ezeeRoomTypeId: '6076500000000000002',
      ezeeRatePlanId: '6076500000000000002',
      ezeeRateTypeId: '6076500000000000001',
      isActive: true,
    },
    {
      // 6-Bed Mixed Dormitory: ID confirmed, but NO rate plan in eZee yet → inactive
      id: 'rt-ka-6dorm',
      label: '6 Bed Mixed Dormitory (no rate plan yet)',
      ezeeRoomTypeId: '6076500000000000004',
      ezeeRatePlanId: '',
      ezeeRateTypeId: '',
      isActive: false,
    },
    {
      // Female dorm: name match was wrong (detection matched it to 4-bed mixed)
      // Correct ID is 6076500000000000005 from get_rooms
      id: 'rt-ka-4dorm-female',
      label: '4 Bed Dormitory Female (no rate plan yet)',
      ezeeRoomTypeId: '6076500000000000005',
      ezeeRatePlanId: '',
      ezeeRateTypeId: '',
      isActive: false,
    },
    {
      id: 'rt-ka-6dorm-female',
      label: '6 Bed Dormitory Female (no rate plan yet)',
      ezeeRoomTypeId: '6076500000000000006',
      ezeeRatePlanId: '',
      ezeeRateTypeId: '',
      isActive: false,
    },
  ];

  for (const u of confirmed) {
    await prisma.room_types.update({
      where: { id: u.id },
      data: {
        ezee_room_type_id: u.ezeeRoomTypeId,
        ezee_rate_plan_id: u.ezeeRatePlanId || null,
        ezee_rate_type_id: u.ezeeRateTypeId || null,
        is_active: u.isActive,
      },
    });
    const status = u.isActive ? '🟢' : '🔴';
    console.log(`${status} ${u.label} (${u.id})`);
    console.log(`   room_id   : ${u.ezeeRoomTypeId}`);
    console.log(`   rate_plan : ${u.ezeeRatePlanId || '⚠️  empty — set in eZee first'}`);
    console.log(`   is_active : ${u.isActive}`);
    console.log();
  }

  // ── 2. Final state report ─────────────────────────────────────────────────
  const all = await prisma.room_types.findMany({
    where: { property_id: PROP },
    orderBy: { name: 'asc' },
  });

  console.log(`${'─'.repeat(65)}`);
  console.log(`📋 Final room_types state (${PROP}):\n`);
  for (const r of all) {
    const status = r.is_active ? '🟢' : '🔴';
    const ezeeId = r.ezee_room_type_id ? `✅ ${r.ezee_room_type_id}` : '❌ NOT SET';
    const rp = r.ezee_rate_plan_id ? `✅ ${r.ezee_rate_plan_id}` : '⚠️  empty';
    console.log(`${status} ${r.name} (${r.id})`);
    console.log(`   ezee_room_type_id : ${ezeeId}`);
    console.log(`   ezee_rate_plan_id : ${rp}`);
    console.log(`   is_active         : ${r.is_active}`);
    console.log();
  }

  console.log('🎉 Done.\n');
  console.log('Active rooms (ready to book):');
  console.log('  • 4 Bed Mixed Dormitory  — ₹500/night');
  console.log('  • Deluxe (Queen)         — ₹1500/night');
  console.log();
  console.log('Inactive (need rate plan in eZee before activating):');
  console.log('  • 6 Bed Mixed Dormitory  — add rate plan → re-run detect script → set is_active=true');
  console.log('  • 4 Bed Dormitory Female — add rate plan → re-run detect script → set is_active=true');
  console.log('  • 6 Bed Dormitory Female — add rate plan → re-run detect script → set is_active=true\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
