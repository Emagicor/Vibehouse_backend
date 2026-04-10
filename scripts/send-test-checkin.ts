/**
 * Test script — sends a sample Check-in Confirmation email via AWS SES.
 *
 * Usage:
 *   npx ts-node scripts/send-test-checkin.ts
 *
 * Requires in .env:
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   SES_FROM_EMAIL   (defaults to noreply@thedailysocial.co.in)
 *   TEST_EMAIL       recipient address (must be SES-verified in sandbox mode)
 */
import 'dotenv/config';
import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-ses';

const ses = new SESClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const FROM = process.env.SES_FROM_EMAIL ?? 'noreply@thedailysocial.co.in';
const TO   = process.env.TEST_EMAIL;

if (!TO) {
  console.error('❌  Set TEST_EMAIL in your .env before running this script.');
  process.exit(1);
}

// ── Sample data ───────────────────────────────────────────────────────────────

const opts = {
  firstName: 'Upamanyu',
  toEmail:   TO,
  passkeys: [
    { key: '7823', roomNumber: '101' },
    { key: '9145', roomNumber: '102' },
  ],
  lockerKeys: [
    { key: 'A1234', lockerLabel: 'Locker 1' },
    { key: 'B5678', lockerLabel: 'Locker 2' },
  ],
};

// ── HTML template ─────────────────────────────────────────────────────────────

const passkeyRows = opts.passkeys
  .map(
    (p) => `<tr>
                <td style="padding:10px 0;">
                  <span style="font-size:34px;font-weight:900;color:#C62828;
                               font-family:'Courier New',monospace;letter-spacing:6px;
                               line-height:1;">${p.key}</span>
                  <span style="font-size:15px;font-weight:600;color:#555;
                               margin-left:14px;font-family:'Segoe UI',Arial,sans-serif;">
                    → Room ${p.roomNumber}
                  </span>
                </td>
              </tr>`,
  )
  .join('');

const lockerRows = opts.lockerKeys
  .map(
    (lk, i) => `<tr>
      <td style="${i > 0 ? 'border-top:1px solid #eee;' : ''}padding:8px 0;">
        <span style="font-size:15px;font-weight:700;color:#333;font-family:'Courier New',monospace;">${lk.key}</span>
        <span style="font-size:14px;color:#777;margin-left:12px;">→ ${lk.lockerLabel}</span>
      </td>
    </tr>`,
  )
  .join('');

const lockerSection = opts.lockerKeys.length > 0
  ? `<p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;letter-spacing:2px;text-transform:uppercase;">Locker Keys</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;margin-bottom:28px;">
            <tr><td style="padding:16px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${lockerRows}
              </table>
            </td></tr>
          </table>`
  : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TheDailySocial</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" border="0"
             style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">

        <tr>
          <td style="background:#C62828;padding:24px 36px;">
            <p style="margin:0;font-size:28px;font-weight:900;color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;letter-spacing:-0.5px;">TheDailySocial</p>
          </td>
        </tr>

        <tr><td style="padding:36px 36px 0;">
          <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111;">Hey ${opts.firstName},</p>
          <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">Welcome to TheDailySocial! Hope you have a wonderful stay with us.</p>

          <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;letter-spacing:2px;text-transform:uppercase;">
            Your Room Passkey${opts.passkeys.length > 1 ? 's' : ''}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#fff5f5;border:2.5px solid #C62828;border-radius:8px;margin-bottom:28px;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${passkeyRows}
              </table>
            </td></tr>
          </table>

          ${lockerSection}

          <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">Need anything during your stay? Log in and request services anytime.</p>
          <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
            <tr>
              <td style="background:#C62828;border-radius:8px;">
                <a href="https://thedailysocial.co.in"
                   style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;
                          color:#ffffff;text-decoration:none;font-family:'Segoe UI',Arial,sans-serif;">
                  Go to TheDailySocial →
                </a>
              </td>
            </tr>
          </table>

          <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px;" />
          <p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">Keep this email safe — your passkeys are confidential. Do not share them.</p>
        </td></tr>

        <tr>
          <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:18px 36px;">
            <p style="margin:0;font-size:13px;color:#999;">From the <strong style="color:#C62828;">TheDailySocial</strong> Support Team</p>
            <p style="margin:3px 0 0;font-size:12px;color:#ccc;">noreply@thedailysocial.co.in</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ── Plain text ─────────────────────────────────────────────────────────────────

const textLines = [
  "THEDAILYSOCIAL — You're Checked In!",
  '─'.repeat(40),
  '',
  `Hey ${opts.firstName},`,
  '',
  'Welcome to TheDailySocial! Hope you have a wonderful stay.',
  '',
  `── YOUR ROOM PASSKEY${opts.passkeys.length > 1 ? 'S' : ''} ──`,
];
for (const p of opts.passkeys) {
  textLines.push(`  ${p.key}  →  Room ${p.roomNumber}`);
}
if (opts.lockerKeys.length > 0) {
  textLines.push('', '── LOCKER KEYS ──');
  for (const lk of opts.lockerKeys) {
    textLines.push(`  ${lk.key}  →  ${lk.lockerLabel}`);
  }
}
textLines.push(
  '',
  'Need anything? Log in at https://thedailysocial.co.in',
  '',
  'Keep this email safe — your passkeys are confidential.',
  '',
  '─'.repeat(40),
  'From the TheDailySocial Support Team',
  'noreply@thedailysocial.co.in',
);

// ── Send ───────────────────────────────────────────────────────────────────────

const input: SendEmailCommandInput = {
  Source: `TheDailySocial <${FROM}>`,
  Destination: { ToAddresses: [TO] },
  Message: {
    Subject: { Data: `🔑 You're checked in — welcome to TheDailySocial!`, Charset: 'UTF-8' },
    Body: {
      Html: { Data: html, Charset: 'UTF-8' },
      Text: { Data: textLines.join('\n'), Charset: 'UTF-8' },
    },
  },
};

(async () => {
  try {
    await ses.send(new SendEmailCommand(input));
    console.log(`✅  Check-in confirmation email sent to ${TO}`);
  } catch (err) {
    console.error('❌  Failed to send email:', err);
    process.exit(1);
  }
})();
