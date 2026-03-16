/**
 * Bootstrap CLI — creates the first OWNER admin when the DB is fresh.
 * Run with: npm run create-admin
 *
 * Exits immediately if an OWNER account already exists.
 */
import 'dotenv/config';
import * as readline from 'readline';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OWNER_ROLE_ID = 'role-owner';

const OWNER_PERMISSIONS = [
  'dashboard.view', 'dashboard.analytics',
  'inventory.view', 'inventory.edit',
  'sla.config', 'sla.override',
  'staff.manage', 'staff.create', 'staff.deactivate',
  'orders.view', 'orders.refund',
  'devices.view', 'devices.manage',
  'admin.manage', 'admin.create',
  'financial.view', 'financial.export',
  'checkin.override', 'borrowable.manage', 'borrowable.return_verify',
  'maintenance.tickets',
];

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let password = '';
    stdin.on('data', function handler(char: string) {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(0);
      } else if (char === '\u007f') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Vibe House — Admin Bootstrap CLI     ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Guard: check if any OWNER already exists
  const existingOwner = await prisma.admin_users.findFirst({
    where: {
      admin_roles: { name: 'OWNER' },
      is_active: true,
    },
    include: { admin_roles: true },
  });

  if (existingOwner) {
    console.log(`✋ An OWNER account already exists: ${existingOwner.email}`);
    console.log('   Use that account to create additional admins via the API.');
    console.log('   If you need to reset, deactivate the existing owner first.\n');
    await prisma.$disconnect();
    process.exit(0);
  }

  // Ensure OWNER role row exists (upsert it)
  await prisma.admin_roles.upsert({
    where: { id: OWNER_ROLE_ID },
    update: {},
    create: {
      id: OWNER_ROLE_ID,
      name: 'OWNER',
      display_name: 'Owner / Director',
      permissions: OWNER_PERMISSIONS,
    },
  });

  console.log('No OWNER account found. Let\'s create one.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const name = (await prompt(rl, 'Full name:        ')).trim();
  const email = (await prompt(rl, 'Email:            ')).trim().toLowerCase();
  rl.close();

  if (!name || !email) {
    console.error('\n✗ Name and email are required.');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('\n✗ Invalid email format.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const existing = await prisma.admin_users.findUnique({ where: { email } });
  if (existing) {
    console.error(`\n✗ An admin with email "${email}" already exists.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const password = await promptHidden('Password (min 8): ');
  const confirm  = await promptHidden('Confirm password: ');

  if (password !== confirm) {
    console.error('\n✗ Passwords do not match.');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('\n✗ Password must be at least 8 characters.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 12);
  const id = uuidv4();

  await prisma.admin_users.create({
    data: {
      id,
      name,
      email,
      password_hash,
      role_id: OWNER_ROLE_ID,
      property_id: null, // super admin — all properties
    },
  });

  console.log('\n✓ OWNER account created successfully!');
  console.log(`  Name:  ${name}`);
  console.log(`  Email: ${email}`);
  console.log(`  Role:  OWNER (all properties)\n`);
  console.log('  Log in at POST /admin/auth/login with role: "OWNER"\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\n✗ Error:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});