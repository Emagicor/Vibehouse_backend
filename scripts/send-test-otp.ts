C/**
 * Test script — sends a sample OTP Verification email via AWS SES.
 *
 * Usage:
 *   npx ts-node scripts/send-test-otp.ts
 *
 * Requires in .env:
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   SES_FROM_EMAIL   (defaults to noreply@thedailysocial.co.in)
 *   TEST_EMAIL       recipient address (must be SES-verified in sandbox mode)
 *
 * Set PURPOSE=password_reset to test the password reset variant.
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

const FROM    = process.env.SES_FROM_EMAIL ?? 'noreply@thedailysocial.co.in';
const TO      = process.env.TEST_EMAIL;
const purpose = (process.env.PURPOSE ?? 'email_verification') as
  'email_verification' | 'password_reset';

if (!TO) {
  console.error('❌  Set TEST_EMAIL in your .env before running this script.');
  process.exit(1);
}

// ── Sample data ───────────────────────────────────────────────────────────────

const firstName = 'Upamanyu';
const otp       = '482917';
const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now

const expiresFormatted = expiresAt.toLocaleString('en-IN', {
  timeZone:  'Asia/Kolkata',
  day:       '2-digit',
  month:     'short',
  year:      'numeric',
  hour:      '2-digit',
  minute:    '2-digit',
  hour12:    true,
});

const copy = purpose === 'password_reset'
  ? {
      subject: '🔑 TheDailySocial — Password reset code',
      heading: 'We received a request to reset your password.',
      label:   'Password reset code',
    }
  : {
      subject: '🔐 Your TheDailySocial verification code',
      heading: 'Use the code below to verify your email address.',
      label:   'Your verification code',
    };

// ── HTML template ─────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TheDailySocial</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">

        <table width="480" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      max-width:480px;width:100%;">

          <tr>
            <td style="padding:36px 36px 32px;">

              <!-- TheDailySocial logo text -->
              <p style="margin:0 0 28px;font-size:28px;font-weight:900;color:#ff2e62;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:-0.5px;">
                TheDailySocial
              </p>

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111;">
                Hey ${firstName},
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#555;line-height:1.6;">
                ${copy.heading}
              </p>

              <!-- OTP -->
              <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                ${copy.label}
              </p>
              <p style="margin:0 0 32px;font-size:36px;font-weight:900;color:#111;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:6px;
                         line-height:1;">
                ${otp}
              </p>

              <!-- Expiry -->
              <p style="margin:0 0 28px;font-size:14px;color:#888;">
                Valid until <strong style="color:#333;">${expiresFormatted} IST</strong>
              </p>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px;" />

              <p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:18px 36px;">
              <p style="margin:0;font-size:13px;color:#999;">
                From the <strong style="color:#ff2e62;">TheDailySocial</strong> Support Team
              </p>
              <p style="margin:3px 0 0;font-size:12px;color:#ccc;">
                noreply@thedailysocial.co.in
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

// ── Plain text ─────────────────────────────────────────────────────────────────

const text = [
  'THEDAILYSOCIAL',
  '─'.repeat(40),
  '',
  `Hey ${firstName},`,
  '',
  copy.heading,
  '',
  `  ${otp}`,
  '',
  `Valid until: ${expiresFormatted} IST`,
  '',
  "If you didn't request this, please ignore this email.",
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
    Subject: { Data: copy.subject, Charset: 'UTF-8' },
    Body: {
      Html: { Data: html, Charset: 'UTF-8' },
      Text: { Data: text, Charset: 'UTF-8' },
    },
  },
};

(async () => {
  try {
    await ses.send(new SendEmailCommand(input));
    console.log(`✅  OTP email (${purpose}) sent to ${TO}`);
  } catch (err) {
    console.error('❌  Failed to send email:', err);
    process.exit(1);
  }
})();
