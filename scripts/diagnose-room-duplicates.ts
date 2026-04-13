import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const rooms = await p.room_types.findMany({
    select: { id: true, property_id: true, name: true, slug: true, is_active: true, ezee_room_type_id: true },
    orderBy: [{ property_id: 'asc' }, { name: 'asc' }]
  });
  console.log('\n=== room_types ===');
  for (const r of rooms) console.log(JSON.stringify(r));

  const props = await p.properties.findMany({ select: { id: true, name: true } });
  console.log('\n=== properties ===');
  for (const p2 of props) console.log(JSON.stringify(p2));

  // Check slug uniqueness per property
  const slugMap = new Map<string, number>();
  for (const r of rooms) {
    const key = `${r.property_id}::${r.slug}`;
    slugMap.set(key, (slugMap.get(key) ?? 0) + 1);
  }
  console.log('\n=== slug duplicates (same property_id + slug) ===');
  let found = false;
  for (const [key, count] of slugMap) {
    if (count > 1) { console.log(`  DUPLICATE (${count}x): ${key}`); found = true; }
  }
  if (!found) console.log('  None');
}
main().catch(console.error).finally(() => p.$disconnect());
