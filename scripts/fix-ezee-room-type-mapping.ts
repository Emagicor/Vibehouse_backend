/**
 * fix-ezee-room-type-mapping.ts
 *
 * One-shot script to create/update room_types in the DB with the correct
 * eZee room type IDs (confirmed via live RoomList + get_rooms API, 2026-04-20).
 *
 * eZee has 5 room types for HotelCode 60765:
 *   ID 6076500000000000001 → 4 Bed Mixed Dormitory    (rate plan: 001) ← bookable
 *   ID 6076500000000000002 → Deluxe                   (rate plan: 002) ← bookable
 *   ID 6076500000000000004 → 6 Bed Mixed Dormitory    (no rate plan)   ← not bookable online
 *   ID 6076500000000000005 → 4 Bed Dormitory Female   (no rate plan)   ← not bookable online
 *   ID 6076500000000000006 → 6 Bed Dormitory Female   (no rate plan)   ← not bookable online
 *
 * Without DB records, the backend serves all rooms with base_price_per_night=null
 * (eZee catalog doesn't carry prices). Creating these DB records gives the frontend
 * real prices from the catalog endpoint before dates are selected.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/fix-ezee-room-type-mapping.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PROPERTY_ID = process.env.DEFAULT_PROPERTY_ID ?? process.env.HOTEL_CODE ?? '60765';

const RATE_TYPE_ID = '6076500000000000001'; // same for all room types

interface RoomTypeSeed {
  id: string;
  name: string;
  slug: string;
  type: 'DORM' | 'PRIVATE';
  total_rooms: number;
  beds_per_room: number;
  total_beds: number;
  base_price_per_night: number;
  floor_range: string | null;
  amenities: string[];
  ezee_room_type_id: string;
  ezee_rate_plan_id: string | null;
  ezee_rate_type_id: string | null;
}

const roomTypes: RoomTypeSeed[] = [
  // ── Bookable rooms (have rate plans in eZee) ──────────────────────────────
  {
    id: 'rt-ka-4dorm',
    name: '4 Bed Mixed Dormitory',
    slug: '4-bed-mixed-dormitory',
    type: 'DORM',
    total_rooms: 16,
    beds_per_room: 4,
    total_beds: 64,
    base_price_per_night: 500,
    floor_range: '1-4',
    amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    ezee_room_type_id: '6076500000000000001',
    ezee_rate_plan_id: '6076500000000000001',
    ezee_rate_type_id: RATE_TYPE_ID,
  },
  {
    id: 'rt-ka-deluxe',
    name: 'Deluxe',
    slug: 'deluxe',
    type: 'PRIVATE',
    total_rooms: 14,
    beds_per_room: 1,
    total_beds: 14,
    base_price_per_night: 1500,
    floor_range: '1-4',
    amenities: ['AC', 'Attached Bathroom', 'WiFi', 'Work Desk', 'Smart Lock'],
    ezee_room_type_id: '6076500000000000002',
    ezee_rate_plan_id: '6076500000000000002',   // ← different from 4dorm
    ezee_rate_type_id: RATE_TYPE_ID,
  },
  // ── Non-bookable rooms (no rate plan in eZee — visible but not bookable online) ─
  {
    id: 'rt-ka-6dorm',
    name: '6 Bed Mixed Dormitory',
    slug: '6-bed-mixed-dormitory',
    type: 'DORM',
    total_rooms: 4,
    beds_per_room: 6,
    total_beds: 24,
    base_price_per_night: 0,  // no rate plan in eZee — contact property
    floor_range: '1-2',
    amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    ezee_room_type_id: '6076500000000000004',
    ezee_rate_plan_id: null,
    ezee_rate_type_id: null,
  },
  {
    id: 'rt-ka-4dorm-female',
    name: '4 Bed Dormitory Female',
    slug: '4-bed-dormitory-female',
    type: 'DORM',
    total_rooms: 4,
    beds_per_room: 4,
    total_beds: 16,
    base_price_per_night: 0,
    floor_range: '1-4',
    amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    ezee_room_type_id: '6076500000000000005',
    ezee_rate_plan_id: null,
    ezee_rate_type_id: null,
  },
  {
    id: 'rt-ka-6dorm-female',
    name: '6 Bed Dormitory Female',
    slug: '6-bed-dormitory-female',
    type: 'DORM',
    total_rooms: 1,
    beds_per_room: 6,
    total_beds: 6,
    base_price_per_night: 0,
    floor_range: '1-2',
    amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    ezee_room_type_id: '6076500000000000006',
    ezee_rate_plan_id: null,
    ezee_rate_type_id: null,
  },
];

async function main() {
  console.log(`eZee room-type mapping fix for property: ${PROPERTY_ID}\n`);

  for (const rt of roomTypes) {
    await prisma.room_types.upsert({
      where: { id: rt.id },
      update: {
        name: rt.name,
        slug: rt.slug,
        ezee_room_type_id: rt.ezee_room_type_id,
        ezee_rate_plan_id: rt.ezee_rate_plan_id,
        ezee_rate_type_id: rt.ezee_rate_type_id,
        base_price_per_night: rt.base_price_per_night,
        total_rooms: rt.total_rooms,
        total_beds: rt.total_beds,
        is_active: true,
      },
      create: {
        ...rt,
        property_id: PROPERTY_ID,
      },
    });
    console.log(`  ✅ ${rt.id.padEnd(22)} "${rt.name}"  ezee=${rt.ezee_room_type_id}  price=₹${rt.base_price_per_night}`);
  }

  // Deactivate obsolete IDs that don't match any of the above
  const validIds = roomTypes.map((r) => r.id);
  const obsolete = await prisma.room_types.updateMany({
    where: {
      property_id: PROPERTY_ID,
      id: { notIn: validIds },
    },
    data: { is_active: false },
  });
  if (obsolete.count > 0) {
    console.log(`\n  ⚠️  Deactivated ${obsolete.count} obsolete room type(s) not in eZee`);
  }

  // Final state
  const active = await prisma.room_types.findMany({
    where: { property_id: PROPERTY_ID, is_active: true },
    select: { id: true, name: true, ezee_room_type_id: true, base_price_per_night: true, ezee_rate_plan_id: true },
    orderBy: { base_price_per_night: 'asc' },
  });

  console.log('\nActive room types after fix:');
  for (const rt of active) {
    const bookable = rt.ezee_rate_plan_id ? '(bookable)' : '(view only)';
    console.log(`  ${rt.id.padEnd(22)} ezee=${rt.ezee_room_type_id}  ₹${rt.base_price_per_night}  ${bookable}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
