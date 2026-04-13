/**
 * detect-ezee-room-types.ts
 * ─────────────────────────
 * Step 1: Call the Vacation Rental get_rooms API — returns ALL room types
 *         unconditionally (no date, no availability filter). This is the ground truth.
 *
 * Step 2: Call RoomList API (1-night window) to get live rates.
 *         Merged together: catalog from Step 1, rates from Step 2.
 *
 * Step 3: Compare against local room_types table. Output UPDATE SQL.
 *
 * Run: npx ts-node --project tsconfig.json scripts/detect-ezee-room-types.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function fetchPhysicalRooms(baseUrl: string, hotelCode: string, authCode: string) {
  const url = `${baseUrl.replace(/\/+$/, '')}/channelbookings/vacation_rental.php`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'AUTH_CODE': authCode,
    },
    body: JSON.stringify({
      request_type: 'get_rooms',
      body: { hotel_id: hotelCode },
    }),
  });
  const data = await resp.json();
  if (data.status !== 'success') {
    throw new Error(
      `get_rooms error ${data.error_code}: ${data.error_message ?? JSON.stringify(data)}`,
    );
  }
  return (data.data?.rooms ?? []) as any[];
}

async function fetchRoomRates(
  baseUrl: string,
  hotelCode: string,
  apiKey: string,
  checkin: string,
  checkout: string,
): Promise<Map<string, { ratePerNight: number; ratePlanId: string; rateTypeId: string; availability: number }>> {
  const url =
    `${baseUrl.replace(/\/+$/, '')}/booking/reservation_api/listing.php` +
    `?request_type=RoomList&HotelCode=${hotelCode}&APIKey=${apiKey}` +
    `&check_in_date=${checkin}&check_out_date=${checkout}&RoomType=all`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!Array.isArray(data) || data[0]?.['Error Details']) return new Map();

    const map = new Map<string, { ratePerNight: number; ratePlanId: string; rateTypeId: string; availability: number }>();
    for (const r of data) {
      map.set(String(r.roomtypeunkid), {
        ratePerNight: Number(r.room_rates_info?.avg_per_night_without_tax ?? 0),
        ratePlanId: String(r.roomrateunkid ?? ''),
        rateTypeId: String(r.ratetypeunkid ?? ''),
        availability: Number(r.min_ava_rooms ?? 0),
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function main() {
  const checkin  = offsetDate(1);
  const checkout = offsetDate(2);

  console.log(`\n🔍 eZee Room Type Detection`);
  console.log(`   Catalog source : Vacation Rental get_rooms (all rooms, no date filter)`);
  console.log(`   Rates source   : RoomList ${checkin} → ${checkout} (availability + rates)`);
  console.log();

  const connections = await prisma.ezee_connection.findMany({
    where: { is_active: true },
    include: { properties: { select: { id: true, name: true } } },
  });

  if (connections.length === 0) {
    console.log('⚠️  No active eZee connections found.');
    return;
  }

  for (const conn of connections) {
    const propName = conn.properties?.name ?? conn.property_id;
    console.log(`${'═'.repeat(65)}`);
    console.log(`Property  : ${propName}`);
    console.log(`PropID    : ${conn.property_id}`);
    console.log(`HotelCode : ${conn.hotel_code}`);
    console.log(`${'═'.repeat(65)}\n`);

    // ── Step 1: All rooms from get_rooms ──────────────────────────────────
    let rawRooms: any[] = [];
    try {
      rawRooms = await fetchPhysicalRooms(conn.api_endpoint, conn.hotel_code, conn.api_key);
      console.log(`📡 get_rooms: ${rawRooms.length} room type(s) found (this is ALL rooms regardless of availability)\n`);
    } catch (err) {
      console.log(`❌ get_rooms failed: ${(err as Error).message}`);
      console.log(`   Falling back to RoomList scan-only mode...\n`);
    }

    // ── Step 2: Rates from RoomList ───────────────────────────────────────
    const rateMap = await fetchRoomRates(conn.api_endpoint, conn.hotel_code, conn.api_key, checkin, checkout);
    console.log(`📈 RoomList: ${rateMap.size} room type(s) have availability/rates for ${checkin}\n`);

    // ── Merge ─────────────────────────────────────────────────────────────
    const ezeeRooms = rawRooms.map((r: any) => {
      const id = String(r.room_id);
      const rates = rateMap.get(id);
      return {
        roomId: id,
        roomName: String(r.room_name),
        physicalNos: r.rooms ? String(r.rooms).split(',').map((s: string) => s.trim()) : [],
        ratePerNight: rates?.ratePerNight ?? null,
        ratePlanId: rates?.ratePlanId ?? null,
        rateTypeId: rates?.rateTypeId ?? null,
        availability: rates?.availability ?? 0,
        hasRatePlan: !!rates,
      };
    });

    // Print full catalog
    for (const r of ezeeRooms) {
      const rateInfo = r.hasRatePlan
        ? `₹${r.ratePerNight}/night  |  avail: ${r.availability}`
        : `⚠️  NO RATE PLAN — won't appear in RoomList`;
      console.log(`  • ${r.roomName}`);
      console.log(`    room_id       : ${r.roomId}`);
      console.log(`    rate_plan_id  : ${r.ratePlanId ?? '—'}  |  rate_type_id: ${r.rateTypeId ?? '—'}`);
      console.log(`    physical rooms: ${r.physicalNos.join(', ') || '—'}`);
      console.log(`    pricing       : ${rateInfo}`);
      console.log();
    }

    // ── Compare local DB ───────────────────────────────────────────────────
    const localRooms = await prisma.room_types.findMany({
      where: { property_id: conn.property_id },
      orderBy: { name: 'asc' },
    });

    console.log(`📦 Local DB comparison (${localRooms.length} rows):\n`);
    const sqlLines: string[] = [];

    for (const lr of localRooms) {
      const idMatch = lr.ezee_room_type_id
        ? ezeeRooms.find((r) => r.roomId === lr.ezee_room_type_id)
        : undefined;
      const nameMatch = !idMatch
        ? ezeeRooms.find((r) =>
            r.roomName.toLowerCase() === lr.name.toLowerCase() ||
            r.roomName.toLowerCase().includes(lr.name.toLowerCase().split(' ')[0]) ||
            lr.name.toLowerCase().includes(r.roomName.toLowerCase().split(' ')[0]),
          )
        : undefined;

      const match = idMatch ?? nameMatch;
      const active = lr.is_active ? '🟢' : '🔴';

      if (!lr.ezee_room_type_id) {
        if (match) {
          const rateInfo = match.hasRatePlan
            ? `rate_plan: ${match.ratePlanId}  rate_type: ${match.rateTypeId}`
            : `⚠️  No rate plan — set one up in eZee first`;
          console.log(`  ${active} ${lr.name} (${lr.id})`);
          console.log(`     DB ezee_room_type_id : EMPTY`);
          console.log(`     🔧 Match found       : "${match.roomName}" → ${match.roomId}`);
          console.log(`     🔧 ${rateInfo}`);
          if (match.hasRatePlan) {
            sqlLines.push(
              `UPDATE room_types SET ` +
              `ezee_room_type_id='${match.roomId}', ` +
              `ezee_rate_plan_id='${match.ratePlanId}', ` +
              `ezee_rate_type_id='${match.rateTypeId}', ` +
              `is_active=true ` +
              `WHERE id='${lr.id}';`,
            );
          }
        } else {
          console.log(`  ${active} ${lr.name} (${lr.id})`);
          console.log(`     DB ezee_room_type_id : EMPTY — no eZee match found`);
        }
      } else if (idMatch) {
        const rateOk = idMatch.hasRatePlan ? '✅ has rate plan' : '⚠️  no rate plan in eZee';
        console.log(`  ${active} ${lr.name} (${lr.id})`);
        console.log(`     ID match: ✅ "${idMatch.roomName}"  |  ${rateOk}`);
        if (!idMatch.hasRatePlan) {
          console.log(`     Action : Configure rate plan in eZee → set is_active=true`);
        }
      } else {
        console.log(`  ${active} ${lr.name} (${lr.id})`);
        console.log(`     ezee_room_type_id ${lr.ezee_room_type_id} → ❌ NOT in eZee`);
        if (match) {
          console.log(`     🔧 Closest match: "${match.roomName}" → ${match.roomId}`);
          sqlLines.push(
            `UPDATE room_types SET ` +
            `ezee_room_type_id='${match.roomId}', ` +
            `ezee_rate_plan_id='${match.ratePlanId ?? ''}', ` +
            `ezee_rate_type_id='${match.rateTypeId ?? ''}' ` +
            `WHERE id='${lr.id}';`,
          );
        }
      }
      console.log();
    }

    // ── Rooms in eZee but not in local DB ──────────────────────────────────
    const localEzeeIds = new Set(localRooms.map((r) => r.ezee_room_type_id).filter(Boolean));
    const missing = ezeeRooms.filter((r) => !localEzeeIds.has(r.roomId));
    if (missing.length > 0) {
      console.log(`🆕 In eZee but NOT in local DB (${missing.length}):\n`);
      for (const m of missing) {
        console.log(`  + ${m.roomName} (${m.roomId}) — add to room_types table`);
        if (m.hasRatePlan) {
          sqlLines.push(
            `-- NEW: ${m.roomName}\n` +
            `INSERT INTO room_types (id, property_id, name, slug, type, total_rooms, beds_per_room, total_beds, base_price_per_night, amenities, is_active, ezee_room_type_id, ezee_rate_plan_id, ezee_rate_type_id) VALUES ` +
            `('rt-new-${m.roomId.slice(-4)}', '${conn.property_id}', '${m.roomName}', '${m.roomName.toLowerCase().replace(/\s+/g, '-')}', 'DORM', 10, 4, 40, ${m.ratePerNight ?? 0}, '["AC","WiFi"]', true, '${m.roomId}', '${m.ratePlanId}', '${m.rateTypeId}') ON CONFLICT DO NOTHING;`,
          );
        }
      }
      console.log();
    }

    // ── Output SQL ─────────────────────────────────────────────────────────
    if (sqlLines.length > 0) {
      console.log(`${'─'.repeat(65)}`);
      console.log(`📋 SQL to apply:\n`);
      for (const s of sqlLines) console.log(s + '\n');
    } else {
      console.log(`✅ All local rooms match eZee — nothing to update.\n`);
    }
  }

  console.log('Done.\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
