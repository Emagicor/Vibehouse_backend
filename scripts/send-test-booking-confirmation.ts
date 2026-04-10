/**
 * Test script — sends a sample Booking Confirmation email via AWS SES.
 *
 * Usage:
 *   npx ts-node scripts/send-test-booking-confirmation.ts
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
  firstName:    'Upamanyu',
  fullName:     'Upamanyu Chatterjee',
  gender:       'Male',
  toEmail:      TO,
  phone:        '+91 98765 43210',
  bookingId:    'EZR-2026-0042',
  propertyName: 'Vibe House Bandra',
  roomType:     'Dorm 6-Bed',
  roomNumber:   'Bed A',
  checkinDate:  'Mon, 30 Mar 2026',
  checkoutDate: 'Thu, 03 Apr 2026',
  noOfGuests:   2,
};

// ── HTML template ─────────────────────────────────────────────────────────────

const phoneRow = opts.phone
  ? `<tr>
              <td style="padding:8px 0;border-top:1px solid #eee;">
                <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Phone</span>
                <span style="font-size:15px;color:#111;">${opts.phone}</span>
              </td>
            </tr>`
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
          <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">Thanks for your booking! Here are your booking details.</p>

          <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;letter-spacing:2px;text-transform:uppercase;">Guest Information</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:16px 20px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:0 0 8px;">
                  <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Name</span>
                  <span style="font-size:15px;color:#111;">${opts.fullName}</span>
                </td></tr>
                <tr><td style="padding:8px 0;border-top:1px solid #eee;">
                  <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Gender</span>
                  <span style="font-size:15px;color:#111;">${opts.gender ?? '—'}</span>
                </td></tr>
                <tr><td style="padding:8px 0;border-top:1px solid #eee;">
                  <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Email</span>
                  <span style="font-size:15px;color:#111;">${opts.toEmail}</span>
                </td></tr>
                ${phoneRow}
              </table>
            </td></tr>
            <tr><td style="padding:0 0 4px;"></td></tr>
          </table>

          <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;letter-spacing:2px;text-transform:uppercase;">Booking Details</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#fff5f5;border:2px solid #C62828;border-radius:8px;margin-bottom:28px;">
            <tr><td style="padding:16px 20px 12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40%" style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;">Booking ID</td>
                  <td style="padding:5px 0;font-size:14px;font-weight:700;color:#C62828;font-family:'Courier New',monospace;">${opts.bookingId}</td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Property</td>
                  <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.propertyName}</td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Room / Bed</td>
                  <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.roomType} — ${opts.roomNumber}</td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Check-in</td>
                  <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.checkinDate}</td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Check-out</td>
                  <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.checkoutDate}</td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Guests</td>
                  <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.noOfGuests}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px;" />
          <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#999;letter-spacing:2px;text-transform:uppercase;">The Essentials</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:4px 0;font-size:14px;color:#555;">📎&nbsp; Carry a valid government-issued photo ID</td></tr>
            <tr><td style="padding:4px 0;font-size:14px;color:#555;">🕑&nbsp; Check-in time: <strong style="color:#333;">2:00 PM</strong> onwards</td></tr>
            <tr><td style="padding:4px 0;font-size:14px;color:#555;">⏳&nbsp; Early check-in subject to availability — reach out to us</td></tr>
            <tr><td style="padding:4px 0;font-size:14px;color:#555;">📶&nbsp; Wi-Fi details will be shared at the property</td></tr>
            <tr><td style="padding:4px 0;font-size:14px;color:#555;">📱&nbsp; Manage your stay at <a href="https://thedailysocial.co.in" style="color:#C62828;text-decoration:none;font-weight:600;">thedailysocial.co.in</a></td></tr>
          </table>
        </td></tr>

        <tr>
          <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:18px 36px;margin-top:28px;">
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

const text = [
  'THEDAILYSOCIAL — Booking Confirmed',
  '─'.repeat(40),
  '',
  `Hey ${opts.firstName},`,
  '',
  'Thanks for your booking! Here are your details.',
  '',
  '── GUEST INFORMATION ──',
  `  Name    : ${opts.fullName}`,
  `  Gender  : ${opts.gender ?? '—'}`,
  `  Email   : ${opts.toEmail}`,
  `  Phone   : ${opts.phone ?? '—'}`,
  '',
  '── BOOKING DETAILS ──',
  `  Booking ID  : ${opts.bookingId}`,
  `  Property    : ${opts.propertyName}`,
  `  Room / Bed  : ${opts.roomType} — ${opts.roomNumber}`,
  `  Check-in    : ${opts.checkinDate}`,
  `  Check-out   : ${opts.checkoutDate}`,
  `  Guests      : ${opts.noOfGuests}`,
  '',
  '── THE ESSENTIALS ──',
  '  • Carry a valid government-issued photo ID',
  '  • Check-in time: 2:00 PM onwards',
  '  • Early check-in subject to availability',
  '  • Wi-Fi details shared at the property',
  '  • Manage your stay: https://thedailysocial.co.in',
  '',
  '─'.repeat(40),
  'From the TheDailySocial Support Team',
  'noreply@thedailysocial.co.in',
].join('\n');

// ── Send ───────────────────────────────────────────────────────────────────────

const input: SendEmailCommandInput = {
  Source: `TheDailySocial <${FROM}>`,
  Destination: { ToAddresses: [TO] },
  Message: {
    Subject: { Data: `🏠 Booking confirmed — ${opts.propertyName}`, Charset: 'UTF-8' },
    Body: {
      Html: { Data: html, Charset: 'UTF-8' },
      Text: { Data: text, Charset: 'UTF-8' },
    },
  },
};

(async () => {
  try {
    await ses.send(new SendEmailCommand(input));
    console.log(`✅  Booking confirmation email sent to ${TO}`);
  } catch (err) {
    console.error('❌  Failed to send email:', err);
    process.exit(1);
  }
})();
