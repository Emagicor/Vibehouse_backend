import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function fix() {
  // Deactivate all eZee connections that are NOT the TDS KA one
  // (they all share the same hotel_code / creds which belong only to KA)
  const stale = await prisma.ezee_connection.findMany({
    where: {
      id: { not: 'ezee-conn-tds-ka-001' },
      is_active: true,
    },
  });

  console.log(`Found ${stale.length} stale active connection(s):`);
  for (const c of stale) {
    await prisma.ezee_connection.update({
      where: { id: c.id },
      data: {
        is_active: false,
        hotel_code: 'PLACEHOLDER_NOT_ACTIVE',
        api_key: 'PLACEHOLDER_NOT_ACTIVE',
      },
    });
    console.log(`   ✅ Deactivated & cleared: ${c.id}`);
  }

  // Final state
  const active = await prisma.ezee_connection.findMany({ where: { is_active: true } });
  console.log(`\n📋 Active eZee connections: ${active.length}`);
  for (const c of active) {
    const prop = await prisma.properties.findUnique({ where: { id: c.property_id }, select: { name: true } });
    console.log(`   ${c.id} → ${prop?.name} | hotel_code: ${c.hotel_code}`);
  }
}

fix()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
