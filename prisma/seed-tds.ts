/**
 * TDS (The Daily Social) Properties Seed
 * ────────────────────────────────────────
 * Creates the single active launch property:
 *   - TDS-Koramangla-A  (eZee hotel code: DEFAULT_PROPERTY_ID / HOTEL_CODE)
 *
 * Koramangala B will be added when its eZee hotel code is confirmed.
 * Fully idempotent — safe to re-run.
 *
 * Run: npx ts-node --project tsconfig.json prisma/seed-tds.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

const PROP_A = process.env.DEFAULT_PROPERTY_ID ?? process.env.HOTEL_CODE ?? '60765';
// PROP_B: add when eZee hotel code for Koramangala B is confirmed
//   const PROP_B = process.env.TDS_KB_HOTEL_CODE ?? 'TDS_KB_PLACEHOLDER';

// ── Env vars ──────────────────────────────────────────────────────────────────
// KA: uses existing HOTEL_CODE / AUTH_CODE (already live in your .env)
// KB: not yet configured — add TDS_KB_HOTEL_CODE + TDS_KB_AUTH_CODE when ready
const KA_HOTEL_CODE = process.env.TDS_KA_HOTEL_CODE ?? process.env.HOTEL_CODE  ?? '60765';
const KA_API_KEY    = process.env.TDS_KA_AUTH_CODE  ?? process.env.AUTH_CODE   ?? '5119488337db81be25-26ab-11f1-9';

async function main() {
  console.log('🌱 Starting TDS property seed...\n');

  // ── 1. PROPERTIES ──────────────────────────────────────────────────────────
  console.log('🏢 Seeding properties...');

  await prisma.properties.upsert({
    where: { id: PROP_A },
    update: {},
    create: {
      id: PROP_A,
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

  console.log('✅ Property seeded: TDS-Koramangala-A');

  // ── 2. eZee CONNECTIONS ────────────────────────────────────────────────────
  console.log('\n🔌 Seeding eZee connections...');

  await prisma.ezee_connection.upsert({
    where: { id: 'ezee-conn-tds-ka-001' },
    update: {},
    create: {
      id: 'ezee-conn-tds-ka-001',
      property_id: PROP_A,
      hotel_code: KA_HOTEL_CODE,
      api_key: KA_API_KEY,
      api_endpoint: 'https://live.ipms247.com/',
      is_active: true,
    },
  });

  console.log('✅ eZee connection seeded (KA: active)');

  // ── 3. ADMIN USERS ─────────────────────────────────────────────────────────
  console.log('\n👤 Seeding admin users...');

  const passwordHash = await bcrypt.hash('TDS@2026!', 12);

  const adminUsers = [
    // ── Koramangala A ──
    {
      email: 'manager.ka@thedailysocial.in',
      name: 'Arjun Sharma (KA Manager)',
      phone: '+919811000001',
      role_id: 'role-manager',
      property_id: PROP_A,
    },
    {
      email: 'reception.ka@thedailysocial.in',
      name: 'Kavya Reddy (KA Reception)',
      phone: '+919811000002',
      role_id: 'role-reception',
      property_id: PROP_A,
    },
    {
      email: 'housekeeping.ka@thedailysocial.in',
      name: 'Ramesh B (KA Housekeeping)',
      phone: '+919811000003',
      role_id: 'role-housekeeping-lead',
      property_id: PROP_A,
    },
    {
      email: 'maintenance.ka@thedailysocial.in',
      name: 'Suresh K (KA Maintenance)',
      phone: '+919811000004',
      role_id: 'role-maintenance-lead',
      property_id: PROP_A,
    },
  ];

  for (const u of adminUsers) {
    const existing = await prisma.admin_users.findUnique({ where: { email: u.email } });
    if (!existing) {
      await prisma.admin_users.create({
        data: {
          id: uuidv4(),
          ...u,
          password_hash: passwordHash,
        },
      });
    }
  }

  console.log(`✅ Admin users seeded (${adminUsers.length} KA users, password: TDS@2026!)`);
  adminUsers.forEach((u) => console.log(`   ${u.email}  →  ${u.name}`));

  // ── 4. ROOM TYPES ──────────────────────────────────────────────────────────
  console.log('\n🛏  Seeding room types...');

  const roomTypeTemplate = [
    {
      suffix: 'queen',
      name: 'Queen Size Room',
      slug: 'queen-size-room',
      type: 'PRIVATE',
      total_rooms: 12,
      beds_per_room: 1,
      total_beds: 12,
      base_price_per_night: 2499,
      floor_range: '1-4',
      amenities: ['AC', 'Attached Bathroom', 'WiFi', 'Work Desk', 'Smart Lock'],
    },
    {
      suffix: '4dorm',
      name: '4 Bed Mixed Dormitory',
      slug: '4-bed-mixed-dorm',
      type: 'DORM',
      total_rooms: 15,
      beds_per_room: 4,
      total_beds: 60,
      base_price_per_night: 699,
      floor_range: '1-4',
      amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    },
    {
      suffix: '6dorm',
      name: '6 Bed Mixed Dormitory',
      slug: '6-bed-mixed-dorm',
      type: 'DORM',
      total_rooms: 5,
      beds_per_room: 6,
      total_beds: 30,
      base_price_per_night: 549,
      floor_range: '1-2',
      amenities: ['AC', 'Shared Bathroom', 'WiFi', 'Personal Locker', 'Reading Light'],
    },
  ];

  for (const prop of [PROP_A]) {
    const abbr = 'ka';
    for (const rt of roomTypeTemplate) {
      const id = `rt-${abbr}-${rt.suffix}`;
      const exists = await prisma.room_types.findUnique({ where: { id } });
      if (!exists) {
        await prisma.room_types.create({
          data: {
            id,
            property_id: prop,
            name: rt.name,
            slug: rt.slug,
            type: rt.type,
            total_rooms: rt.total_rooms,
            beds_per_room: rt.beds_per_room,
            total_beds: rt.total_beds,
            base_price_per_night: rt.base_price_per_night,
            floor_range: rt.floor_range,
            amenities: rt.amenities,
            is_active: true,
            // ezee_room_type_id, ezee_rate_plan_id, ezee_rate_type_id
            // — to be filled in once IDs are retrieved from eZee dashboard
          },
        });
      }
    }
  }

  console.log('✅ Room types seeded (3 types for KA)');
  console.log('   ⚠️  NOTE: ezee_room_type_id fields are empty. Fill them from eZee dashboard.');

  // ── 5. PRODUCT CATALOG (shared across properties) ─────────────────────────
  console.log('\n🛒 Seeding product catalog for TDS properties...');

  const sharedProducts = [
    { id: 'prod-water-bottle',  name: 'Water Bottle',       category: 'COMMODITY',  price: 100, desc: 'Sealed 1L drinking water bottle' },
    { id: 'prod-bath-towel',    name: 'Bath Towel',         category: 'RETURNABLE', price: 200, desc: 'Full-size bath towel (returned at checkout)' },
    { id: 'prod-safe-lock',     name: 'Safe Lock',          category: 'COMMODITY',  price: 150, desc: 'Combination lock for under-bed locker' },
    { id: 'prod-toilet-kit',    name: 'Toilet Kit',         category: 'COMMODITY',  price: 150, desc: 'Soap, shampoo, toothpaste, toothbrush' },
    { id: 'prod-blanket',       name: 'Blanket',            category: 'RETURNABLE', price: 300, desc: 'Extra blanket (returned at checkout)' },
    { id: 'prod-locker',        name: 'Locker',             category: 'COMMODITY',  price: 150, desc: 'Personal locker rental' },
    { id: 'prod-laundry',       name: 'Laundry',            category: 'SERVICE',    price: 150, desc: 'Pickup laundry — washed & folded' },
    { id: 'prod-early-checkin', name: 'Early Check-in',     category: 'SERVICE',    price: 250, desc: 'Check in before standard time' },
    { id: 'prod-late-checkout', name: 'Late Checkout',      category: 'SERVICE',    price: 250, desc: 'Check out after standard time' },
    { id: 'prod-room-cleaning',     name: 'Room Cleaning',     category: 'SERVICE', price: 0, desc: 'On-demand room cleaning' },
    { id: 'prod-washroom-cleaning', name: 'Washroom Cleaning', category: 'SERVICE', price: 0, desc: 'On-demand washroom cleaning' },
    { id: 'prod-garbage-clearance', name: 'Garbage Clearance', category: 'SERVICE', price: 0, desc: 'Garbage pickup from room' },
    { id: 'prod-linen-change',      name: 'Linen Change',      category: 'SERVICE', price: 0, desc: 'Fresh bed linen replacement' },
    { id: 'prod-wifi-support',      name: 'WiFi Support',      category: 'SERVICE', price: 0, desc: 'WiFi connectivity issues' },
    { id: 'prod-hot-water',         name: 'Hot Water Support', category: 'SERVICE', price: 0, desc: 'Hot water not working' },
    { id: 'prod-ac-support',        name: 'AC Support',        category: 'SERVICE', price: 0, desc: 'Air conditioning issues' },
    { id: 'prod-other-maintenance', name: 'Other Maintenance', category: 'SERVICE', price: 0, desc: 'Miscellaneous maintenance request' },
    { id: 'prod-first-aid',         name: 'First Aid',         category: 'SERVICE', price: 0, desc: 'First aid assistance' },
    { id: 'prod-staff-assist',      name: 'Staff Assistance',  category: 'SERVICE', price: 0, desc: 'General staff help' },
    { id: 'prod-lost-found',        name: 'Lost & Found',      category: 'SERVICE', price: 0, desc: 'Report or claim lost items' },
    { id: 'prod-iron',       name: 'Iron',       category: 'BORROWABLE', price: 0, desc: 'Clothes iron' },
    { id: 'prod-hair-dryer', name: 'Hair Dryer', category: 'BORROWABLE', price: 0, desc: 'Hair dryer' },
    { id: 'prod-umbrella',   name: 'Umbrella',   category: 'BORROWABLE', price: 0, desc: 'Umbrella' },
  ];

  // Products are global (not per-property) — only add if they don't exist yet
  for (const p of sharedProducts) {
    const existing = await prisma.product_catalog.findUnique({ where: { id: p.id } });
    if (!existing) {
      await prisma.product_catalog.create({
        data: {
          id: p.id,
          property_id: PROP_A, // default property for shared products
          name: p.name,
          description: p.desc,
          category: p.category,
          base_price: p.price,
        },
      });
    }
  }

  console.log(`✅ Product catalog: ${sharedProducts.length} products (skipped if already exist)`);

  // ── 6. INVENTORY STOCK ─────────────────────────────────────────────────────
  console.log('\n📦 Seeding inventory stock for both TDS properties...');

  const stockItems = [
    { productId: 'prod-water-bottle',  total: 60, threshold: 10 },
    { productId: 'prod-bath-towel',    total: 40, threshold: 8 },
    { productId: 'prod-safe-lock',     total: 25, threshold: 5 },
    { productId: 'prod-toilet-kit',    total: 50, threshold: 10 },
    { productId: 'prod-blanket',       total: 20, threshold: 4 },
    { productId: 'prod-locker',        total: 30, threshold: 5 },
    { productId: 'prod-iron',          total: 4,  threshold: 1 },
    { productId: 'prod-hair-dryer',    total: 3,  threshold: 1 },
    { productId: 'prod-umbrella',      total: 6,  threshold: 2 },
  ];

  for (const prop of [PROP_A]) {
    for (const s of stockItems) {
      const exists = await prisma.inventory.findFirst({
        where: { product_id: s.productId, property_id: prop },
      });
      if (!exists) {
        await prisma.inventory.create({
          data: {
            id: uuidv4(),
            property_id: prop,
            product_id: s.productId,
            total_stock: s.total,
            available_stock: s.total,
            low_stock_threshold: s.threshold,
          },
        });
      }
    }
  }

  console.log(`✅ Inventory stock seeded (${stockItems.length} items for KA)`);

  // ── 7. COLIVE PROPERTY CONTENT ─────────────────────────────────────────────
  console.log('\n🏠 Seeding colive property content...');

  // Ensure Bangalore location exists
  await prisma.colive_locations.upsert({
    where: { slug: 'bangalore' },
    update: {},
    create: {
      id: 'cloc-bangalore-001',
      slug: 'bangalore',
      label: 'Bangalore',
      is_active: true,
    },
  });

  // ── Property A content ──
  await prisma.colive_property_content.upsert({
    where: { slug: 'tds-koramangala-a' },
    update: {},
    create: {
      id: 'cprop-tds-ka-001',
      property_id: PROP_A,
      location_id: 'cloc-bangalore-001',
      slug: 'tds-koramangala-a',
      headline: 'Live in the heart of Koramangala',
      subheadline: 'Where Bangalore\'s startup energy meets a home you\'ll love.',
      description:
        'The Daily Social Koramangala A is a premium co-living space in the middle of Bangalore\'s most vibrant neighbourhood. With high-speed WiFi, curated community events, a dedicated coworking space, and ₹0 deposit — built for founders, makers, and remote workers.',
      microcopy: 'Your Bangalore base camp',
      hero_image_url: 'https://assets.thedailysocial.in/colive/ka-hero.jpg',
      secondary_image_url: 'https://assets.thedailysocial.in/colive/ka-lounge.jpg',
      supporting_image_urls: [
        'https://assets.thedailysocial.in/colive/ka-cowork.jpg',
        'https://assets.thedailysocial.in/colive/ka-kitchen.jpg',
        'https://assets.thedailysocial.in/colive/ka-room.jpg',
      ],
      gallery_count: 18,
      primary_tag: 'Startup Hub',
      secondary_tag: 'Remote Ready',
      rating: 4.9,
      rating_label: 'Exceptional',
      amenities: [
        '1Gbps WiFi',
        'Dedicated Coworking',
        'AC Rooms',
        'Weekly Housekeeping',
        'Shared Kitchen',
        'Terrace & Lounge',
        'Smart Locks',
        '24/7 Security',
        'EV Charging',
      ],
      benefits: [
        { id: 'b1', icon: 'wifi',    title: '1Gbps Fibre',       description: 'Zero downtime, Zoom-ready' },
        { id: 'b2', icon: 'users',   title: 'Curated Community', description: 'Founders, engineers, creatives' },
        { id: 'b3', icon: 'shield',  title: 'Zero Deposit',      description: 'No upfront security deposit' },
        { id: 'b4', icon: 'zap',     title: 'Month-to-Month',    description: 'No long-term lock-in' },
        { id: 'b5', icon: 'coffee',  title: 'Koramangala Location', description: 'Walk to 100+ restaurants & cafes' },
      ],
      stories: [
        {
          id: 's1',
          name: 'Rohan M.',
          occupation: 'SDE-2 @ Swiggy',
          image_url: 'https://assets.thedailysocial.in/colive/story-rohan.jpg',
          quote: 'Best flat-hunting decision of my life. The network I built here is priceless.',
          duration: '4 months',
          stay_type: 'solo',
        },
        {
          id: 's2',
          name: 'Ananya & Kiri',
          occupation: 'Co-founders',
          image_url: 'https://assets.thedailysocial.in/colive/story-ananya.jpg',
          quote: 'We closed our seed round while living here. The energy is unmatched.',
          duration: '6 months',
          stay_type: 'couple',
        },
      ],
      checkout_notes: [
        'Check-out by 11:00 AM on the last day of your stay',
        'Room inspection conducted by our team',
        'Smart lock access revoked automatically at checkout',
        'No security deposit to worry about',
      ],
      recommended_for: ['remote', 'solo', 'couple'],
      is_active: true,
    },
  });

  console.log('✅ Colive property content seeded (KA)');

  // ── 8. COLIVE ROOM OPTIONS ─────────────────────────────────────────────────
  console.log('\n🛏  Seeding colive room options...');

  type RoomOptionInput = {
    id: string;
    property_id: string;
    room_type_id: string;
    slug: string;
    name: string;
    description: string;
    feature_points: string[];
    max_guests: number;
    recommended_for: string[];
    thumbnail_url: string;
    sort_order: number;
  };

  const roomOptionsByProp: RoomOptionInput[] = [
    // ── KA ──
    {
      id: 'croom-tds-ka-private',
      property_id: PROP_A,
      room_type_id: 'rt-ka-queen',
      slug: 'private-room',
      name: 'Private Room',
      description: 'A fully private room with en-suite bathroom, work desk, and blackout curtains. Ideal for couples and remote workers needing privacy.',
      feature_points: ['Queen-size bed', 'En-suite bathroom', 'Work desk + chair', 'Blackout curtains', 'AC + smart lock'],
      max_guests: 2,
      recommended_for: ['couple', 'remote'],
      thumbnail_url: 'https://assets.thedailysocial.in/colive/ka-room-private.jpg',
      sort_order: 1,
    },
    {
      id: 'croom-tds-ka-4dorm',
      property_id: PROP_A,
      room_type_id: 'rt-ka-4dorm',
      slug: '4-bed-dorm',
      name: '4-Bed Mixed Dorm',
      description: 'An energetic mixed dorm perfect for social co-livers. Each bed has a privacy curtain, personal locker, and reading light.',
      feature_points: ['Privacy curtain', 'Personal locker', 'Reading light', 'Shared bathroom (1:4)', 'AC + smart lock'],
      max_guests: 1,
      recommended_for: ['solo', 'remote'],
      thumbnail_url: 'https://assets.thedailysocial.in/colive/ka-room-4dorm.jpg',
      sort_order: 2,
    },
    {
      id: 'croom-tds-ka-6dorm',
      property_id: PROP_A,
      room_type_id: 'rt-ka-6dorm',
      slug: '6-bed-dorm',
      name: '6-Bed Mixed Dorm',
      description: 'Best-value bed in Koramangala. Great for budget-conscious travellers who love meeting new people.',
      feature_points: ['Privacy curtain', 'Personal locker', 'Shared bathroom (1:6)', 'Lounge access', 'AC + smart lock'],
      max_guests: 1,
      recommended_for: ['solo'],
      thumbnail_url: 'https://assets.thedailysocial.in/colive/ka-room-6dorm.jpg',
      sort_order: 3,
    },
  ];

  for (const opt of roomOptionsByProp) {
    await prisma.colive_room_options.upsert({
      where: { property_id_slug: { property_id: opt.property_id, slug: opt.slug } },
      update: {},
      create: { ...opt, is_active: true },
    });
  }

  console.log('✅ Colive room options seeded (3 for KA)');

  // ── 9. COLIVE ADDONS ───────────────────────────────────────────────────────
  console.log('\n🍽  Seeding colive addons...');

  type AddonInput = {
    id: string;
    property_id: string;
    slug: string;
    name: string;
    description: string;
    pricing_model: string;
    unit_price: number;
    currency: string;
    max_quantity: number;
    default_quantity: number;
    category: string;
    icon_hint: string;
    is_available: boolean;
    availability_message?: string;
    sort_order: number;
  };

  const addonTemplate: Omit<AddonInput, 'id' | 'property_id'>[] = [
    {
      slug: 'meals-3x-day',
      name: 'Meals Plan (3x/day)',
      description: 'Breakfast, lunch, and dinner from our in-house chef. Includes unlimited tea & coffee.',
      pricing_model: 'per_month',
      unit_price: 7000,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'meals',
      icon_hint: 'utensils',
      is_available: true,
      sort_order: 1,
    },
    {
      slug: 'laundry-plan',
      name: 'Laundry Plan',
      description: 'Unlimited laundry washes per month. Drop-off & collect from your room.',
      pricing_model: 'per_month',
      unit_price: 1500,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'laundry',
      icon_hint: 'shirt',
      is_available: true,
      sort_order: 2,
    },
    {
      slug: 'dedicated-desk',
      name: 'Dedicated Coworking Desk',
      description: 'Reserve your own permanent desk. Includes locker + second monitor access.',
      pricing_model: 'per_month',
      unit_price: 2500,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'workspace',
      icon_hint: 'monitor',
      is_available: true,
      sort_order: 3,
    },
    {
      slug: 'airport-pickup',
      name: 'Airport Pickup (BLR)',
      description: 'One-way cab from Kempegowda International Airport to The Daily Social. Welcome kit included.',
      pricing_model: 'one_time',
      unit_price: 900,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'pickup',
      icon_hint: 'car',
      is_available: true,
      sort_order: 4,
    },
    {
      slug: 'bike-rental',
      name: 'Bike Rental (E-Scooter)',
      description: 'Electric scooter rental for the month. Helmet + lock provided. Perfect for Koramangala.',
      pricing_model: 'per_month',
      unit_price: 3500,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'transport',
      icon_hint: 'zap',
      is_available: false,
      availability_message: 'Coming soon — join the waitlist',
      sort_order: 5,
    },
  ];

  for (const prop of [PROP_A]) {
    const abbr = 'ka';
    for (const a of addonTemplate) {
      const addonInput: AddonInput = {
        ...a,
        id: `cadd-tds-${abbr}-${a.slug.replace(/-/g, '')}`,
        property_id: prop,
      };
      await prisma.colive_addons.upsert({
        where: { property_id_slug: { property_id: addonInput.property_id, slug: addonInput.slug } },
        update: {},
        create: { ...addonInput, is_active: true },
      });
    }
  }

  console.log(`✅ Colive addons seeded (${addonTemplate.length} addons for KA)`);

  // ── DONE ──────────────────────────────────────────────────────────────────
  console.log('\n🎉 TDS seed complete!');
  console.log('\n📋 Summary:');
  console.log(`   Property    : ${PROP_A} (The Daily Social - Koramangala A)`);
  console.log('   eZee KA     : active (using HOTEL_CODE / AUTH_CODE env vars)');
  console.log('   Admin users : 4 (password: TDS@2026!)');
  console.log('   Room types  : 3 (ezee_room_type_id = empty — fill from eZee dashboard)');
  console.log('   Inventory   : 9 stock items');
  console.log('   Colive      : full content, room options, addons for KA');
  console.log('\n🔍 Test colive search for Bangalore:');
  console.log('   POST /guest/colive/search');
  console.log('   { "location_id": "cloc-bangalore-001", "location_slug": "bangalore",');
  console.log('     "move_in_date": "2026-05-01", "duration_months": 3, "stay_type": "solo" }');
  console.log('\n⚠️  NEXT STEPS:');
  console.log('   1. Fill ezee_room_type_id, ezee_rate_plan_id, ezee_rate_type_id from the eZee PMS dashboard');
  console.log('   2. Update admin user names/phones to real staff details');
  console.log('   3. Add KB property when TDS_KB_HOTEL_CODE is confirmed');
}

main()
  .catch((e) => {
    console.error('❌ TDS seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
