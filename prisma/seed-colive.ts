/**
 * Colive Seed Script
 * Adds seed data for the colive long-stay module.
 * Safe to re-run — uses upsert throughout.
 *
 * Run: npx ts-node --project tsconfig.json prisma/seed-colive.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// These IDs come from the main seed.ts
const PROPERTY_ID = process.env.DEFAULT_PROPERTY_ID ?? '60765';

async function main() {
  console.log('🌱 Starting colive seed...');

  // ── Fetch existing room_type IDs from DB ──────────────────────────────────
  const roomTypes = await prisma.room_types.findMany({
    where: { property_id: PROPERTY_ID, is_active: true },
    select: { id: true, name: true, slug: true, ezee_room_type_id: true },
  });

  if (roomTypes.length === 0) {
    throw new Error(`No room types found for property ${PROPERTY_ID}. Run the main seed first.`);
  }

  console.log(`Found room types: ${roomTypes.map((r) => r.name).join(', ')}`);

  // Try to find queen/private and dorm types by slug or name (flexible matching)
  const queenType = roomTypes.find(
    (r) => r.slug?.toLowerCase().includes('queen') || r.name?.toLowerCase().includes('queen') || r.name?.toLowerCase().includes('private'),
  );
  const dorm4Type = roomTypes.find(
    (r) => r.slug?.toLowerCase().includes('4') || r.name?.toLowerCase().includes('4-bed') || r.name?.toLowerCase().includes('female'),
  );
  const dorm6Type = roomTypes.find(
    (r) => r.slug?.toLowerCase().includes('6') || r.name?.toLowerCase().includes('6-bed') || r.name?.toLowerCase().includes('mixed'),
  );

  // Fall back to first 3 room types if specific matches not found
  const rt1 = queenType ?? roomTypes[0];
  const rt2 = dorm4Type ?? roomTypes[1] ?? roomTypes[0];
  const rt3 = dorm6Type ?? roomTypes[2] ?? roomTypes[0];

  console.log(`Using room types: ${rt1.name} | ${rt2.name} | ${rt3.name}`);

  // ── 1. LOCATIONS ─────────────────────────────────────────────────────────────
  console.log('\n📍 Seeding colive locations...');

  await prisma.colive_locations.upsert({
    where: { slug: 'mumbai' },
    update: {},
    create: {
      id: 'cloc-mumbai-001',
      slug: 'mumbai',
      label: 'Mumbai',
      is_active: true,
    },
  });

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

  console.log('✅ Locations seeded (Mumbai, Bangalore)');

  // ── 2. PLANS ─────────────────────────────────────────────────────────────────
  console.log('\n🎯 Seeding colive plans...');

  const plans = [
    {
      id: 'cplan-workation-001',
      slug: 'workation',
      title: 'Workation',
      description: 'Perfect for remote workers who want a productive + social environment.',
      recommended_stay_type: 'remote',
      accent_hex: '#FF6B35',
      badge_copy: '🔥 Most Popular',
      sort_order: 1,
    },
    {
      id: 'cplan-budget-001',
      slug: 'budget',
      title: 'Budget Stay',
      description: 'Affordable long-stay with all the essentials in a vibrant community.',
      recommended_stay_type: 'solo',
      accent_hex: '#4ECDC4',
      badge_copy: '💰 Best Value',
      sort_order: 2,
    },
    {
      id: 'cplan-private-001',
      slug: 'private',
      title: 'Private Room',
      description: 'Your own personal space within the Vibe House community.',
      recommended_stay_type: 'couple',
      accent_hex: '#845EC2',
      badge_copy: '🌟 Premium',
      sort_order: 3,
    },
  ];

  for (const plan of plans) {
    await prisma.colive_plans.upsert({
      where: { slug: plan.slug },
      update: {},
      create: { ...plan, is_active: true },
    });
  }

  console.log('✅ Plans seeded (workation, budget, private)');

  // ── 3. PROPERTY CONTENT ───────────────────────────────────────────────────────
  console.log('\n🏠 Seeding colive property content...');

  await prisma.colive_property_content.upsert({
    where: { slug: 'vibe-house-bandra' },
    update: {},
    create: {
      id: 'cprop-bandra-001',
      property_id: PROPERTY_ID,
      location_id: 'cloc-mumbai-001',
      slug: 'vibe-house-bandra',
      headline: 'Live, Work & Thrive in Bandra',
      subheadline: 'Where long-stay meets community. Flexible monthly living in the heart of Mumbai.',
      description:
        'Vibe House Bandra is a premium co-living space designed for digital nomads, young professionals, and solo travelers. With high-speed WiFi, weekly housekeeping, community events, and curated amenities — everything you need for a focused, connected life.',
      microcopy: 'Your home base in Mumbai',
      hero_image_url: 'https://assets.vibehouse.in/colive/bandra-hero.jpg',
      secondary_image_url: 'https://assets.vibehouse.in/colive/bandra-lounge.jpg',
      supporting_image_urls: [
        'https://assets.vibehouse.in/colive/bandra-workspace.jpg',
        'https://assets.vibehouse.in/colive/bandra-kitchen.jpg',
        'https://assets.vibehouse.in/colive/bandra-room.jpg',
      ],
      gallery_count: 14,
      primary_tag: 'Remote Ready',
      secondary_tag: 'Social Vibe',
      rating: 4.8,
      rating_label: 'Excellent',
      amenities: [
        'High-Speed WiFi',
        'Dedicated Coworking Desk',
        'Air Conditioning',
        'Weekly Housekeeping',
        'Shared Kitchen',
        'Rooftop Terrace',
        'Smart Locks',
        '24/7 Staff',
      ],
      benefits: [
        { id: 'b1', icon: 'wifi', title: 'Blazing WiFi', description: '1Gbps fibre, zero downtime' },
        { id: 'b2', icon: 'users', title: 'Built-in Community', description: 'Weekly events, curated co-livers' },
        { id: 'b3', icon: 'shield', title: 'Zero Deposit', description: 'No upfront security deposit required' },
        { id: 'b4', icon: 'zap', title: 'Flexible Terms', description: 'Month-to-month — no long lock-ins' },
      ],
      stories: [
        {
          id: 's1',
          name: 'Arjun M.',
          occupation: 'Product Designer',
          image_url: 'https://assets.vibehouse.in/colive/story-arjun.jpg',
          quote: 'Moved in for a month, stayed for six. The community here is unlike anything else.',
          duration: '6 months',
          stay_type: 'remote',
        },
        {
          id: 's2',
          name: 'Aisha K.',
          occupation: 'Startup Founder',
          image_url: 'https://assets.vibehouse.in/colive/story-aisha.jpg',
          quote: 'Got more done in 30 days here than in 3 months working from home.',
          duration: '2 months',
          stay_type: 'solo',
        },
      ],
      checkout_notes: [
        'Check-out by 11:00 AM on the last day of your stay',
        'Room inspection will be done by our team',
        'Smart lock access will be revoked automatically at checkout',
        'Security deposit (if applicable) refunded within 7 working days',
      ],
      recommended_for: ['remote', 'solo', 'couple'],
      is_active: true,
    },
  });

  console.log('✅ Property content seeded (Bandra)');

  // ── 4. ROOM OPTIONS ───────────────────────────────────────────────────────────
  console.log('\n🛏  Seeding colive room options...');

  const roomOptions = [
    {
      id: 'croom-bandra-private-001',
      property_id: PROPERTY_ID,
      room_type_id: rt1.id,
      slug: 'private-room',
      name: 'Private Room',
      description:
        'Your own private room with en-suite bathroom, blackout curtains, and dedicated work desk. Perfect for couples or those who need their own space.',
      feature_points: [
        'Queen-size bed',
        'En-suite bathroom',
        'Work desk + ergonomic chair',
        'Blackout curtains',
        'AC + smart lock access',
      ],
      max_guests: 2,
      recommended_for: ['couple', 'remote'],
      thumbnail_url: 'https://assets.vibehouse.in/colive/room-private.jpg',
      sort_order: 1,
    },
    {
      id: 'croom-bandra-4dorm-001',
      property_id: PROPERTY_ID,
      room_type_id: rt2.id,
      slug: '4-bed-dorm',
      name: '4-Bed Dorm (Female Only)',
      description:
        'A comfortable female-only dorm with individual lockers, privacy curtains, and shared bathrooms. Best value for solo female travelers.',
      feature_points: [
        'Individual privacy curtains',
        'Personal locker',
        'Dedicated reading light',
        'Shared bathroom (1:4 ratio)',
        'AC + smart lock access',
      ],
      max_guests: 1,
      recommended_for: ['solo', 'remote'],
      thumbnail_url: 'https://assets.vibehouse.in/colive/room-4bed.jpg',
      sort_order: 2,
    },
    {
      id: 'croom-bandra-6dorm-001',
      property_id: PROPERTY_ID,
      room_type_id: rt3.id,
      slug: '6-bed-dorm',
      name: '6-Bed Mixed Dorm',
      description:
        'A lively mixed dorm perfect for budget-conscious travelers who love meeting new people. Great community vibes.',
      feature_points: [
        'Individual privacy curtains',
        'Personal locker',
        'Shared bathroom (1:6 ratio)',
        'Social lounge access',
        'AC + smart lock access',
      ],
      max_guests: 1,
      recommended_for: ['solo', 'remote'],
      thumbnail_url: 'https://assets.vibehouse.in/colive/room-6bed.jpg',
      sort_order: 3,
    },
  ];

  for (const opt of roomOptions) {
    await prisma.colive_room_options.upsert({
      where: { property_id_slug: { property_id: opt.property_id, slug: opt.slug } },
      update: {},
      create: { ...opt, is_active: true },
    });
  }

  console.log('✅ Room options seeded (private, 4-dorm, 6-dorm)');

  // ── 5. ADDONS ─────────────────────────────────────────────────────────────────
  console.log('\n🍽  Seeding colive addons...');

  const addons = [
    {
      id: 'cadd-bandra-meals-001',
      property_id: PROPERTY_ID,
      slug: 'meals-3x-day',
      name: 'Meals Plan (3x/day)',
      description: 'Breakfast, lunch, and dinner prepared by our in-house chef. Includes tea/coffee.',
      pricing_model: 'per_month',
      unit_price: 6000,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'meals',
      icon_hint: 'utensils',
      is_available: true,
      sort_order: 1,
    },
    {
      id: 'cadd-bandra-laundry-001',
      property_id: PROPERTY_ID,
      slug: 'laundry-plan',
      name: 'Laundry Plan',
      description: 'Unlimited laundry washes per month. Drop & collect from your room.',
      pricing_model: 'per_month',
      unit_price: 1200,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'laundry',
      icon_hint: 'shirt',
      is_available: true,
      sort_order: 2,
    },
    {
      id: 'cadd-bandra-cowork-001',
      property_id: PROPERTY_ID,
      slug: 'dedicated-desk',
      name: 'Dedicated Coworking Desk',
      description:
        'Reserve your own permanent desk in the coworking space. Includes locker + 2nd monitor.',
      pricing_model: 'per_month',
      unit_price: 2000,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'workspace',
      icon_hint: 'monitor',
      is_available: true,
      sort_order: 3,
    },
    {
      id: 'cadd-bandra-pickup-001',
      property_id: PROPERTY_ID,
      slug: 'airport-pickup',
      name: 'Airport Pickup',
      description: 'One-way cab from BOM airport to Vibe House. Chana and welcome kit included.',
      pricing_model: 'one_time',
      unit_price: 800,
      currency: 'INR',
      max_quantity: 1,
      default_quantity: 0,
      category: 'pickup',
      icon_hint: 'car',
      is_available: true,
      sort_order: 4,
    },
    {
      id: 'cadd-bandra-bike-001',
      property_id: PROPERTY_ID,
      slug: 'bike-rental',
      name: 'Bike Rental',
      description: 'Electric scooter rental for the month. Helmet + lock provided.',
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

  for (const addon of addons) {
    await prisma.colive_addons.upsert({
      where: { property_id_slug: { property_id: addon.property_id, slug: addon.slug } },
      update: {},
      create: { ...addon, is_active: true },
    });
  }

  console.log('✅ Addons seeded (5 addons)');

  console.log('\n🎉 Colive seed complete!');
  console.log('\n📋 Summary:');
  console.log('   Locations  : Mumbai, Bangalore');
  console.log('   Plans      : workation, budget, private');
  console.log('   Properties : Vibe House Bandra (prop-bandra-001)');
  console.log('   Room opts  : private-room, 4-bed-dorm, 6-bed-dorm');
  console.log('   Addons     : meals, laundry, coworking desk, airport pickup, bike rental');
  console.log('\n🔍 Test search:');
  console.log('   POST /guest/colive/search');
  console.log('   { "location_id": "cloc-mumbai-001", "location_slug": "mumbai",');
  console.log('     "move_in_date": "2026-05-01", "duration_months": 3, "stay_type": "solo" }');
}

main()
  .catch((e) => {
    console.error('❌ Colive seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
