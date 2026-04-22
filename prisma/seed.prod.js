/**
 * Production seed — minimal bootstrap for a fresh Aurora database.
 *
 * Plain JavaScript (not TypeScript) so it runs with `node prisma/seed.prod.js`
 * in the production container without ts-node / tsc / module-resolution risk.
 *
 * Seeds:
 *   1. The Daily Social property row
 *   2. eZee connection record
 *   3. All 5 admin roles
 *   4. Owner admin: owner@tds.com / TDS@2026!
 *   5. 2 bookable room types (4-bed dorm @ ₹500, Deluxe @ ₹1500)
 */

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding production database...');

  const propertyId = process.env.DEFAULT_PROPERTY_ID || '60765';

  // ── 1. Property ──────────────────────────────────────────────────────────────
  await prisma.properties.upsert({
    where: { id: propertyId },
    update: {},
    create: {
      id: propertyId,
      name: 'The Daily Social - Koramangala A',
      address: '100 Feet Road, Koramangala 4th Block',
      city: 'Bangalore',
      branding_config: {
        primary_color: '#7C3AED',
        logo_url: 'https://assets.thedailysocial.in/logo.png',
        property_code: 'TDS-KA',
      },
    },
  });
  console.log('Property seeded');

  // ── 2. eZee connection ───────────────────────────────────────────────────────
  await prisma.ezee_connection.upsert({
    where: { id: 'ezee-conn-ka-001' },
    update: {},
    create: {
      id: 'ezee-conn-ka-001',
      property_id: propertyId,
      hotel_code: process.env.HOTEL_CODE || '60765',
      api_key: process.env.AUTH_CODE || '5119488337db81be25-26ab-11f1-9',
      api_endpoint: 'https://live.ipms247.com/',
      is_active: true,
    },
  });
  console.log('eZee connection seeded');

  // ── 3. Admin roles (all 5) ───────────────────────────────────────────────────
  const roles = [
    {
      id: 'role-owner',
      name: 'OWNER',
      display_name: 'Owner / Director',
      permissions: [
        'dashboard.view', 'dashboard.analytics',
        'inventory.view', 'inventory.edit',
        'sla.config', 'sla.override',
        'staff.manage', 'staff.create', 'staff.deactivate',
        'orders.view', 'orders.refund',
        'devices.view', 'devices.manage',
        'admin.manage', 'admin.create',
        'financial.view', 'financial.export',
        'checkin.override', 'borrowable.manage', 'borrowable.return_verify',
        'returnable.manage', 'returnable.return_verify',
        'maintenance.tickets',
        'bookings.view', 'bookings.create',
        'events.view', 'events.edit',
        'kyc.view', 'kyc.delete',
      ],
    },
    {
      id: 'role-manager',
      name: 'MANAGER',
      display_name: 'Property Manager',
      permissions: [
        'dashboard.view', 'dashboard.analytics',
        'inventory.view', 'inventory.edit',
        'sla.config',
        'staff.manage',
        'orders.view', 'orders.refund',
        'devices.view', 'devices.manage',
        'admin.manage', 'admin.create',
        'returnable.manage', 'returnable.return_verify',
        'bookings.view', 'bookings.create',
        'events.view', 'events.edit',
        'kyc.view', 'kyc.delete',
      ],
    },
    {
      id: 'role-reception',
      name: 'RECEPTION',
      display_name: 'Front Desk / Receptionist',
      permissions: [
        'dashboard.view',
        'inventory.view',
        'orders.view',
        'checkin.override',
        'borrowable.manage',
        'returnable.manage', 'returnable.return_verify',
        'bookings.view', 'bookings.create',
        'events.view',
        'kyc.view', 'kyc.delete',
      ],
    },
    {
      id: 'role-housekeeping-lead',
      name: 'HOUSEKEEPING_LEAD',
      display_name: 'Housekeeping Supervisor',
      permissions: [
        'dashboard.view',
        'inventory.view', 'inventory.edit',
        'borrowable.manage',
        'borrowable.return_verify',
        'returnable.manage', 'returnable.return_verify',
      ],
    },
    {
      id: 'role-maintenance-lead',
      name: 'MAINTENANCE_LEAD',
      display_name: 'Maintenance Supervisor',
      permissions: [
        'dashboard.view',
        'devices.view', 'devices.manage',
        'maintenance.tickets',
      ],
    },
  ];

  for (const role of roles) {
    await prisma.admin_roles.upsert({
      where: { id: role.id },
      update: { permissions: role.permissions, display_name: role.display_name },
      create: role,
    });
  }
  console.log('All 5 admin roles seeded');

  // ── 4. Owner admin ───────────────────────────────────────────────────────────
  const ownerHash = await bcrypt.hash('TDS@2026!', 12);

  await prisma.admin_users.upsert({
    where: { email: 'owner@tds.com' },
    update: {},
    create: {
      id: 'admin-owner-001',
      email: 'owner@tds.com',
      name: 'TDS Owner',
      password_hash: ownerHash,
      role_id: 'role-owner',
      property_id: propertyId,
      is_active: true,
    },
  });
  console.log('Owner admin seeded: owner@tds.com');

  // ── 5. Room types ────────────────────────────────────────────────────────────
  const EZEE_RATE_PLAN_ID = '6076500000000000001';
  const EZEE_RATE_TYPE_ID = '6076500000000000001';

  const roomTypes = [
    {
      id: 'rt-ka-4dorm',
      property_id: propertyId,
      name: '4 Bed Mixed Dormitory',
      slug: '4-bed-mixed-dorm',
      type: 'DORM',
      total_rooms: 15,
      beds_per_room: 4,
      total_beds: 60,
      base_price_per_night: 500,
      floor_range: '1-4',
      amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
      ezee_room_type_id: '6076500000000000001',
      ezee_rate_plan_id: EZEE_RATE_PLAN_ID,
      ezee_rate_type_id: EZEE_RATE_TYPE_ID,
    },
    {
      id: 'rt-ka-deluxe',
      property_id: propertyId,
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
      ezee_rate_plan_id: EZEE_RATE_PLAN_ID,
      ezee_rate_type_id: EZEE_RATE_TYPE_ID,
    },
  ];

  for (const rt of roomTypes) {
    await prisma.room_types.upsert({
      where: { id: rt.id },
      update: {
        ezee_room_type_id: rt.ezee_room_type_id,
        ezee_rate_plan_id: rt.ezee_rate_plan_id,
        ezee_rate_type_id: rt.ezee_rate_type_id,
        base_price_per_night: rt.base_price_per_night,
      },
      create: rt,
    });
  }
  console.log('2 room types seeded (4-bed dorm @ ₹500, Deluxe @ ₹1500)');

  console.log('Production seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
