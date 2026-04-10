import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // ─── 1. PROPERTY ────────────────────────────────────────────────────────────
  const propertyId = 'prop-bandra-001';
  await prisma.properties.upsert({
    where: { id: propertyId },
    update: {},
    create: {
      id: propertyId,
      name: 'Vibe House Bandra',
      address: '12, Hill Road, Bandra West',
      city: 'Mumbai',
      branding_config: {
        primary_color: '#FF6B35',
        logo_url: 'https://assets.vibehouse.in/logo.png',
      },
    },
  });
  console.log('✅ Property seeded');

  // ─── 1b. EZEE CONNECTION ────────────────────────────────────────────────────
  await prisma.ezee_connection.upsert({
    where: { id: 'ezee-conn-bandra-001' },
    update: {},
    create: {
      id: 'ezee-conn-bandra-001',
      property_id: propertyId,
      hotel_code: process.env.HOTEL_CODE ?? '60765',
      api_key: process.env.AUTH_CODE ?? '5119488337db81be25-26ab-11f1-9',
      api_endpoint: 'https://live.ipms247.com/',
      is_active: true,
    },
  });
  console.log('✅ eZee connection seeded');

  // ─── 2. ADMIN ROLES ─────────────────────────────────────────────────────────
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
  console.log('✅ Admin roles seeded (5 roles)');

  // ─── 3. ADMIN USERS ─────────────────────────────────────────────────────────
  const defaultPassword = 'Vibe@2026!';
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  const adminUsers = [
    {
      id: uuidv4(),
      name: 'Upamanyu (Owner)',
      email: 'owner@vibehouse.in',
      phone: '+919876543210',
      role_id: 'role-owner',
      property_id: null, // super admin — all properties
    },
    {
      id: uuidv4(),
      name: 'Priya Sharma',
      email: 'manager@vibehouse.in',
      phone: '+919876543211',
      role_id: 'role-manager',
      property_id: propertyId,
    },
    {
      id: uuidv4(),
      name: 'Rohit Nair',
      email: 'reception@vibehouse.in',
      phone: '+919876543212',
      role_id: 'role-reception',
      property_id: propertyId,
    },
    {
      id: uuidv4(),
      name: 'Sunita Patil',
      email: 'housekeeping@vibehouse.in',
      phone: '+919876543213',
      role_id: 'role-housekeeping-lead',
      property_id: propertyId,
    },
    {
      id: uuidv4(),
      name: 'Ravi Kumar',
      email: 'maintenance@vibehouse.in',
      phone: '+919876543214',
      role_id: 'role-maintenance-lead',
      property_id: propertyId,
    },
  ];

  for (const user of adminUsers) {
    const existing = await prisma.admin_users.findUnique({
      where: { email: user.email },
    });
    if (!existing) {
      await prisma.admin_users.create({
        data: { ...user, password_hash: passwordHash },
      });
    }
  }
  console.log('✅ Admin users seeded (5 users)');
  console.log('\n📋 Dev credentials (all share same password):');
  console.log('   Password: Vibe@2026!');
  adminUsers.forEach((u) => {
    const roleName = roles.find((r) => r.id === u.role_id)?.name ?? '';
    console.log(`   ${u.email}  →  role: ${roleName}`);
  });
  console.log('\n📋 Guest credentials (all share same password: Vibe@2026!)');

  // ─── 4. GUESTS ──────────────────────────────────────────────────────────────
  const guestPasswordHash = await bcrypt.hash('Vibe@2026!', 12);

  const guestArjunId   = 'guest-arjun-001';
  const guestNehaId    = 'guest-neha-002';
  const guestPreethiId = 'guest-preethi-003';
  const guestSamirId   = 'guest-samir-004';
  const guestAishaId   = 'guest-aisha-005';
  const guestVikramId  = 'guest-vikram-006';
  const guestMeeraId   = 'guest-meera-007';
  const guestRahulId   = 'guest-rahul-008';

  const guests = [
    {
      id: guestArjunId,
      name: 'Arjun Mehta',
      email: 'arjun@vibehouse.in',
      phone: '+919000000001',
      email_verified: true,
      phone_verified: false,
    },
    {
      id: guestNehaId,
      name: 'Neha Kapoor',
      email: 'neha@vibehouse.in',
      phone: '+919000000002',
      email_verified: true,
      phone_verified: false,
    },
    {
      id: guestPreethiId,
      name: 'Preethi Iyer',
      email: 'preethi@vibehouse.in',
      phone: '+919000000003',
      email_verified: false,
      phone_verified: false,
    },
    {
      id: guestSamirId,
      name: 'Samir Desai',
      email: 'samir@gmail.com',
      phone: '+919000000004',
      email_verified: true,
      phone_verified: true,
    },
    {
      id: guestAishaId,
      name: 'Aisha Khan',
      email: 'aisha.khan@outlook.com',
      phone: '+919000000005',
      email_verified: true,
      phone_verified: false,
    },
    {
      id: guestVikramId,
      name: 'Vikram Singh',
      email: 'vikram.singh@yahoo.com',
      phone: '+919000000006',
      email_verified: true,
      phone_verified: true,
    },
    {
      id: guestMeeraId,
      name: 'Meera Joshi',
      email: 'meera.joshi@gmail.com',
      phone: '+919000000007',
      email_verified: true,
      phone_verified: false,
    },
    {
      id: guestRahulId,
      name: 'Rahul Verma',
      email: 'rahul.verma@protonmail.com',
      phone: '+919000000008',
      email_verified: false,
      phone_verified: true,
    },
  ];

  for (const g of guests) {
    const exists = await prisma.guests.findUnique({ where: { email: g.email } });
    if (!exists) {
      await prisma.guests.create({ data: { ...g, password_hash: guestPasswordHash } });
      await prisma.auth_providers.create({
        data: {
          id: uuidv4(),
          guest_id: g.id,
          provider: 'email',
          provider_uid: g.email,
        },
      });
    }
  }
  console.log(`✅ Guests seeded (${guests.length} guests)`);

  // ─── 5. BOOKING CACHE ───────────────────────────────────────────────────────
  const bookings = [
    {
      ezee_reservation_id: 'EZEE-BND-2026-001',
      property_id: propertyId,
      guest_id: guestArjunId,
      booker_email: 'arjun@vibehouse.in',
      booker_phone: '+919000000001',
      room_type_name: 'Mixed Dorm 6-Bed',
      room_number: 'D-101',
      unit_code: 'BED-D101-A',
      checkin_date: new Date('2026-03-13'),
      checkout_date: new Date('2026-03-17'),
      no_of_guests: 2,
      source: 'MakeMyTrip',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
    {
      ezee_reservation_id: 'EZEE-BND-2026-002',
      property_id: propertyId,
      guest_id: guestArjunId,
      booker_email: 'arjun@vibehouse.in',
      booker_phone: '+919000000001',
      room_type_name: 'Private Room',
      room_number: 'P-205',
      unit_code: 'PR-205',
      checkin_date: new Date('2026-04-05'),
      checkout_date: new Date('2026-04-08'),
      no_of_guests: 1,
      source: 'Direct',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
    {
      ezee_reservation_id: 'EZEE-BND-2026-003',
      property_id: propertyId,
      guest_id: guestSamirId,
      booker_email: 'samir@gmail.com',
      booker_phone: '+919000000004',
      room_type_name: 'Mixed Dorm 6-Bed',
      room_number: 'D-102',
      unit_code: 'BED-D102-B',
      checkin_date: new Date('2026-03-12'),
      checkout_date: new Date('2026-03-18'),
      no_of_guests: 1,
      source: 'Hostelworld',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
    {
      ezee_reservation_id: 'EZEE-BND-2026-004',
      property_id: propertyId,
      guest_id: guestAishaId,
      booker_email: 'aisha.khan@outlook.com',
      booker_phone: '+919000000005',
      room_type_name: 'Female Dorm 4-Bed',
      room_number: 'FD-201',
      unit_code: 'BED-FD201-A',
      checkin_date: new Date('2026-03-11'),
      checkout_date: new Date('2026-03-16'),
      no_of_guests: 2,
      source: 'Booking.com',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
    {
      ezee_reservation_id: 'EZEE-BND-2026-005',
      property_id: propertyId,
      guest_id: guestVikramId,
      booker_email: 'vikram.singh@yahoo.com',
      booker_phone: '+919000000006',
      room_type_name: 'Private Room',
      room_number: 'P-301',
      unit_code: 'PR-301',
      checkin_date: new Date('2026-03-13'),
      checkout_date: new Date('2026-03-20'),
      no_of_guests: 1,
      source: 'Direct',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
    {
      ezee_reservation_id: 'EZEE-BND-2026-006',
      property_id: propertyId,
      guest_id: guestMeeraId,
      booker_email: 'meera.joshi@gmail.com',
      booker_phone: '+919000000007',
      room_type_name: 'Female Dorm 4-Bed',
      room_number: 'FD-201',
      unit_code: 'BED-FD201-B',
      checkin_date: new Date('2026-03-10'),
      checkout_date: new Date('2026-03-15'),
      no_of_guests: 1,
      source: 'MakeMyTrip',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
    {
      ezee_reservation_id: 'EZEE-BND-2026-007',
      property_id: propertyId,
      guest_id: guestRahulId,
      booker_email: 'rahul.verma@protonmail.com',
      booker_phone: '+919000000008',
      room_type_name: 'Mixed Dorm 6-Bed',
      room_number: 'D-101',
      unit_code: 'BED-D101-C',
      checkin_date: new Date('2026-03-13'),
      checkout_date: new Date('2026-03-19'),
      no_of_guests: 1,
      source: 'Hostelworld',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
    {
      // Preethi now has a booking too
      ezee_reservation_id: 'EZEE-BND-2026-008',
      property_id: propertyId,
      guest_id: guestPreethiId,
      booker_email: 'preethi@vibehouse.in',
      booker_phone: '+919000000003',
      room_type_name: 'Mixed Dorm 6-Bed',
      room_number: 'D-102',
      unit_code: 'BED-D102-A',
      checkin_date: new Date('2026-03-14'),
      checkout_date: new Date('2026-03-18'),
      no_of_guests: 1,
      source: 'Direct',
      status: 'CONFIRMED',
      fetched_at: new Date(),
    },
  ];

  for (const b of bookings) {
    const exists = await prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: b.ezee_reservation_id },
    });
    if (!exists) {
      await prisma.ezee_booking_cache.create({ data: b });
    }
  }
  console.log(`✅ Booking cache seeded (${bookings.length} bookings)`);

  // ─── 6. BOOKING GUEST ACCESS ────────────────────────────────────────────────
  const accesses = [
    // Arjun = PRIMARY on booking 001
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-001',
      guest_id: guestArjunId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestArjunId,
      approved_at: new Date(),
    },
    // Neha = SECONDARY on booking 001, approved by Arjun
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-001',
      guest_id: guestNehaId,
      role: 'SECONDARY',
      status: 'APPROVED',
      approved_by_guest_id: guestArjunId,
      approved_at: new Date(),
    },
    // Arjun = PRIMARY on booking 002 (his solo trip)
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-002',
      guest_id: guestArjunId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestArjunId,
      approved_at: new Date(),
    },
    // Samir = PRIMARY on booking 003
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-003',
      guest_id: guestSamirId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestSamirId,
      approved_at: new Date(),
    },
    // Aisha = PRIMARY on booking 004
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-004',
      guest_id: guestAishaId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestAishaId,
      approved_at: new Date(),
    },
    // Meera = SECONDARY on booking 004 (Aisha's co-guest)
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-004',
      guest_id: guestMeeraId,
      role: 'SECONDARY',
      status: 'APPROVED',
      approved_by_guest_id: guestAishaId,
      approved_at: new Date(),
    },
    // Vikram = PRIMARY on booking 005
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-005',
      guest_id: guestVikramId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestVikramId,
      approved_at: new Date(),
    },
    // Meera = PRIMARY on booking 006
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-006',
      guest_id: guestMeeraId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestMeeraId,
      approved_at: new Date(),
    },
    // Rahul = PRIMARY on booking 007
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-007',
      guest_id: guestRahulId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestRahulId,
      approved_at: new Date(),
    },
    // Preethi = PRIMARY on booking 008
    {
      id: uuidv4(),
      ezee_reservation_id: 'EZEE-BND-2026-008',
      guest_id: guestPreethiId,
      role: 'PRIMARY',
      status: 'APPROVED',
      approved_by_guest_id: guestPreethiId,
      approved_at: new Date(),
    },
  ];

  for (const a of accesses) {
    const exists = await prisma.booking_guest_access.findFirst({
      where: {
        ezee_reservation_id: a.ezee_reservation_id,
        guest_id: a.guest_id,
      },
    });
    if (!exists) {
      await prisma.booking_guest_access.create({ data: a });
    }
  }
  console.log(`✅ Booking guest access seeded (${accesses.length} access rows)`);
  console.log('\n   Guest → Booking mapping:');
  console.log('   arjun@vibehouse.in        → PRIMARY D-101 (001), PRIMARY P-205 (002)');
  console.log('   neha@vibehouse.in         → SECONDARY D-101 (001)');
  console.log('   samir@gmail.com           → PRIMARY D-102 (003)');
  console.log('   aisha.khan@outlook.com    → PRIMARY FD-201 (004)');
  console.log('   vikram.singh@yahoo.com    → PRIMARY P-301 (005)');
  console.log('   meera.joshi@gmail.com     → PRIMARY FD-201 (006), SECONDARY FD-201 (004)');
  console.log('   rahul.verma@protonmail.com → PRIMARY D-101 (007)');
  console.log('   preethi@vibehouse.in      → PRIMARY D-102 (008)');

  // ─── 7. ROOM TYPES ──────────────────────────────────────────────────────
  const roomTypes = [
    {
      id: 'rt-queen',
      property_id: propertyId,
      name: 'Queen Size Room',
      slug: 'queen-size-room',
      type: 'PRIVATE',
      total_rooms: 15,
      beds_per_room: 1,
      total_beds: 15,
      base_price_per_night: 1999,
      floor_range: '1-5',
      amenities: ['AC', 'Attached Bathroom', 'WiFi', 'TV', 'Wardrobe'],
    },
    {
      id: 'rt-4dorm',
      property_id: propertyId,
      name: '4 Bed Mixed Dormitory',
      slug: '4-bed-mixed-dorm',
      type: 'DORM',
      total_rooms: 20,
      beds_per_room: 4,
      total_beds: 80,
      base_price_per_night: 599,
      floor_range: '1-5',
      amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    },
    {
      id: 'rt-6dorm',
      property_id: propertyId,
      name: '6 Bed Mixed Dormitory',
      slug: '6-bed-mixed-dorm',
      type: 'DORM',
      total_rooms: 4,
      beds_per_room: 6,
      total_beds: 24,
      base_price_per_night: 449,
      floor_range: '1-2',
      amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    },
  ];

  for (const rt of roomTypes) {
    const exists = await prisma.room_types.findUnique({ where: { id: rt.id } });
    if (!exists) {
      await prisma.room_types.create({ data: rt });
    }
  }
  console.log(`✅ Room types seeded (${roomTypes.length} types, 119 total beds)`);
  console.log('   Queen Size Room:       15 rooms × 1 bed  = 15 beds  @ ₹1,999/night');
  console.log('   4 Bed Mixed Dormitory: 20 rooms × 4 beds = 80 beds  @ ₹599/night');
  console.log('   6 Bed Mixed Dormitory: 4 rooms  × 6 beds = 24 beds  @ ₹449/night');

  // ─── 8. PRODUCT CATALOG ──────────────────────────────────────────────────
  const products = [
    // ── COMMODITIES (physical, chargeable) ──
    { id: 'prod-water-bottle',  name: 'Water Bottle',  category: 'COMMODITY',  price: 100, desc: 'Sealed 1L drinking water bottle' },
    { id: 'prod-bath-towel',    name: 'Bath Towel',    category: 'RETURNABLE', price: 200, desc: 'Full-size bath towel (returned at checkout)' },
    { id: 'prod-safe-lock',     name: 'Safe Lock',     category: 'COMMODITY',  price: 150, desc: 'Combination lock for under-bed locker' },
    { id: 'prod-toilet-kit',    name: 'Toilet Kit',    category: 'COMMODITY',  price: 150, desc: 'Soap, shampoo, toothpaste, toothbrush' },
    { id: 'prod-blanket',       name: 'Blanket',       category: 'RETURNABLE', price: 300, desc: 'Extra blanket for cold nights (returned at checkout)' },
    { id: 'prod-locker',        name: 'Locker',        category: 'COMMODITY',  price: 150, desc: 'Personal locker rental' },

    // ── SERVICES (time-based / non-physical) ──
    { id: 'prod-laundry',       name: 'Laundry',        category: 'SERVICE', price: 150, desc: 'Pickup laundry — washed & folded' },
    { id: 'prod-early-checkin', name: 'Early Check-in', category: 'SERVICE', price: 250, desc: 'Check in before standard time' },
    { id: 'prod-late-checkout', name: 'Late Checkout',  category: 'SERVICE', price: 250, desc: 'Check out after standard time (pre-booked rate)' },

    // ── FREE SERVICES (₹0 — just trigger SLA ticket) ──
    { id: 'prod-room-cleaning',     name: 'Room Cleaning',      category: 'SERVICE', price: 0, desc: 'On-demand room cleaning' },
    { id: 'prod-washroom-cleaning', name: 'Washroom Cleaning',  category: 'SERVICE', price: 0, desc: 'On-demand washroom cleaning' },
    { id: 'prod-garbage-clearance', name: 'Garbage Clearance',  category: 'SERVICE', price: 0, desc: 'Garbage pickup from room' },
    { id: 'prod-linen-change',      name: 'Linen Change',       category: 'SERVICE', price: 0, desc: 'Fresh bed linen replacement' },
    { id: 'prod-wifi-support',      name: 'WiFi Support',       category: 'SERVICE', price: 0, desc: 'WiFi connectivity issues' },
    { id: 'prod-hot-water',         name: 'Hot Water Support',  category: 'SERVICE', price: 0, desc: 'Hot water not working' },
    { id: 'prod-ac-support',        name: 'AC Support',         category: 'SERVICE', price: 0, desc: 'Air conditioning issues' },
    { id: 'prod-other-maintenance', name: 'Other Maintenance',  category: 'SERVICE', price: 0, desc: 'Miscellaneous maintenance request' },
    { id: 'prod-first-aid',         name: 'First Aid',          category: 'SERVICE', price: 0, desc: 'First aid assistance' },
    { id: 'prod-staff-assist',      name: 'Staff Assistance',   category: 'SERVICE', price: 0, desc: 'General staff help' },
    { id: 'prod-lost-found',        name: 'Lost & Found',       category: 'SERVICE', price: 0, desc: 'Report or claim lost items' },

    // ── BORROWABLES (free, stock-limited, must return) ──
    { id: 'prod-iron',       name: 'Iron',       category: 'BORROWABLE', price: 0, desc: 'Clothes iron — subject to availability' },
    { id: 'prod-hair-dryer', name: 'Hair Dryer', category: 'BORROWABLE', price: 0, desc: 'Hair dryer — subject to availability' },
    { id: 'prod-umbrella',   name: 'Umbrella',   category: 'BORROWABLE', price: 0, desc: 'Umbrella — subject to availability' },
  ];

  for (const p of products) {
    const exists = await prisma.product_catalog.findUnique({ where: { id: p.id } });
    if (!exists) {
      await prisma.product_catalog.create({
        data: {
          id: p.id,
          property_id: propertyId,
          name: p.name,
          description: p.desc,
          category: p.category,
          base_price: p.price,
        },
      });
    }
  }
  console.log(`✅ Product catalog seeded (${products.length} products)`);

  // ─── 8. INVENTORY STOCK ──────────────────────────────────────────────────
  // Only COMMODITY and BORROWABLE items get inventory rows (SERVICE is non-physical)
  const stockItems = [
    // Commodities
    { productId: 'prod-water-bottle',  total: 50, threshold: 10 },
    { productId: 'prod-bath-towel',    total: 30, threshold: 5 },
    { productId: 'prod-safe-lock',     total: 20, threshold: 5 },
    { productId: 'prod-toilet-kit',    total: 40, threshold: 10 },
    { productId: 'prod-blanket',       total: 15, threshold: 3 },
    { productId: 'prod-locker',        total: 25, threshold: 5 },
    // Borrowables (small unit counts — tracked closely)
    { productId: 'prod-iron',       total: 3, threshold: 1 },
    { productId: 'prod-hair-dryer', total: 2, threshold: 1 },
    { productId: 'prod-umbrella',   total: 5, threshold: 2 },
  ];

  for (const s of stockItems) {
    const exists = await prisma.inventory.findFirst({
      where: { product_id: s.productId, property_id: propertyId },
    });
    if (!exists) {
      await prisma.inventory.create({
        data: {
          id: uuidv4(),
          property_id: propertyId,
          product_id: s.productId,
          total_stock: s.total,
          available_stock: s.total,
          low_stock_threshold: s.threshold,
        },
      });
    }
  }
  console.log(`✅ Inventory stock seeded (${stockItems.length} entries)`);

  // ─── 9. BORROWABLE CHECKOUTS ────────────────────────────────────────────
  // Simulate some active borrowable checkouts so the UI has data to show

  // Look up inventory IDs for borrowable items
  const ironInventory = await prisma.inventory.findFirst({ where: { product_id: 'prod-iron', property_id: propertyId } });
  const dryerInventory = await prisma.inventory.findFirst({ where: { product_id: 'prod-hair-dryer', property_id: propertyId } });
  const umbrellaInventory = await prisma.inventory.findFirst({ where: { product_id: 'prod-umbrella', property_id: propertyId } });

  // Look up an admin to use as issued_by
  const receptionAdmin = await prisma.admin_users.findFirst({ where: { email: 'reception@vibehouse.in' } });

  if (ironInventory && dryerInventory && umbrellaInventory && receptionAdmin) {
    const borrowableCheckouts = [
      {
        id: 'borrow-001',
        inventory_id: ironInventory.id,
        ezee_reservation_id: 'EZEE-BND-2026-001',
        guest_id: guestArjunId,
        unit_code: 'IRN-01',
        checked_out_at: new Date('2026-03-13T10:00:00'),
        status: 'CHECKED_OUT',
        issued_by_admin_id: receptionAdmin.id,
      },
      {
        id: 'borrow-002',
        inventory_id: dryerInventory.id,
        ezee_reservation_id: 'EZEE-BND-2026-004',
        guest_id: guestAishaId,
        unit_code: 'DRY-01',
        checked_out_at: new Date('2026-03-12T14:30:00'),
        status: 'CHECKED_OUT',
        issued_by_admin_id: receptionAdmin.id,
      },
      {
        id: 'borrow-003',
        inventory_id: umbrellaInventory.id,
        ezee_reservation_id: 'EZEE-BND-2026-005',
        guest_id: guestVikramId,
        unit_code: 'UMB-01',
        checked_out_at: new Date('2026-03-13T09:15:00'),
        status: 'CHECKED_OUT',
        issued_by_admin_id: receptionAdmin.id,
      },
      {
        id: 'borrow-004',
        inventory_id: ironInventory.id,
        ezee_reservation_id: 'EZEE-BND-2026-006',
        guest_id: guestMeeraId,
        unit_code: 'IRN-02',
        checked_out_at: new Date('2026-03-11T16:00:00'),
        status: 'CHECKED_OUT',
        issued_by_admin_id: receptionAdmin.id,
      },
      {
        id: 'borrow-005',
        inventory_id: umbrellaInventory.id,
        ezee_reservation_id: 'EZEE-BND-2026-003',
        guest_id: guestSamirId,
        unit_code: 'UMB-02',
        checked_out_at: new Date('2026-03-12T18:45:00'),
        status: 'CHECKED_OUT',
        issued_by_admin_id: receptionAdmin.id,
      },
    ];

    for (const bc of borrowableCheckouts) {
      const exists = await prisma.borrowable_checkouts.findUnique({ where: { id: bc.id } });
      if (!exists) {
        await prisma.borrowable_checkouts.create({ data: bc });
      }
    }

    // Update inventory counts to reflect checkouts: iron -2, dryer -1, umbrella -2
    await prisma.inventory.update({
      where: { id: ironInventory.id },
      data: { available_stock: ironInventory.total_stock - 2, borrowed_out_count: 2 },
    });
    await prisma.inventory.update({
      where: { id: dryerInventory.id },
      data: { available_stock: dryerInventory.total_stock - 1, borrowed_out_count: 1 },
    });
    await prisma.inventory.update({
      where: { id: umbrellaInventory.id },
      data: { available_stock: umbrellaInventory.total_stock - 2, borrowed_out_count: 2 },
    });

    console.log('✅ Borrowable checkouts seeded (5 active checkouts)');
    console.log('   Iron: Arjun (D-101), Meera (FD-201)');
    console.log('   Hair Dryer: Aisha (FD-201)');
    console.log('   Umbrella: Vikram (P-301), Samir (D-102)');
  }

  // ─── 10. SAMPLE EVENTS ──────────────────────────────────────────────────────
  const today = new Date();
  const sampleEvents = [
    {
      id: 'evt-dj-night',
      property_id: 'prop-bandra-001',
      title: 'Neon DJ Night',
      description: 'Dance the night away under neon lights with our resident DJ spinning the best tracks from around the world.',
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      time: '21:00',
      location: 'Rooftop Terrace',
      capacity: 50,
      price_text: 'Free for Guests',
      contact_link: null,
      poster_url: null,
      badge_label: 'Tonight',
      badge_color: '#ff2e62',
      is_active: true,
      created_by: null,
    },
    {
      id: 'evt-pub-crawl',
      property_id: 'prop-bandra-001',
      title: 'Old City Pub Crawl',
      description: 'Explore the best bars in the neighborhood with fellow travelers. Includes welcome drink at each stop.',
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
      time: '20:30',
      location: 'Meet at Lobby',
      capacity: 30,
      price_text: 'Rs. 599',
      contact_link: 'https://wa.me/919876543210',
      poster_url: null,
      badge_label: 'Popular',
      badge_color: '#facc15',
      is_active: true,
      created_by: null,
    },
    {
      id: 'evt-live-music',
      property_id: 'prop-bandra-001',
      title: 'Live Local Music',
      description: 'Enjoy an evening of live acoustic performances by local artists in our cozy common area.',
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2),
      time: '19:00',
      location: 'Common Area',
      capacity: 40,
      price_text: 'Free for Guests',
      contact_link: null,
      poster_url: null,
      badge_label: 'Live',
      badge_color: '#00d1ff',
      is_active: true,
      created_by: null,
    },
    {
      id: 'evt-yoga-past',
      property_id: 'prop-bandra-001',
      title: 'Sunset Yoga',
      description: 'Start your evening with a relaxing rooftop yoga session overlooking the city skyline.',
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5),
      time: '17:30',
      location: 'Rooftop Terrace',
      capacity: 20,
      price_text: 'Free for Guests',
      contact_link: null,
      poster_url: null,
      badge_label: null,
      badge_color: null,
      is_active: true,
      created_by: null,
    },
  ];

  for (const evt of sampleEvents) {
    await prisma.events.upsert({
      where: { id: evt.id },
      update: {},
      create: evt,
    });
  }
  console.log(`✅ Events seeded (${sampleEvents.length} events)`);

  console.log('\n🎉 Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
