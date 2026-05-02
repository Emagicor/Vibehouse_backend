import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-ses';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly ses: SESClient;
  private readonly fromAddress = process.env.SES_FROM_EMAIL ?? 'noreply@thedailysocial.co.in';

  constructor() {
    this.ses = new SESClient({
      region: process.env.AWS_REGION ?? 'ap-south-1',
    });
  }

  // ─── PUBLIC ───────────────────────────────────────────────────────────────

  async sendOtpEmail(opts: {
    toEmail: string;
    toName: string;
    otp: string;
    expiresAt: Date;
    purpose?: 'email_verification' | 'password_reset' | 'two_fa';
  }): Promise<void> {
    const { toEmail, toName, otp, expiresAt, purpose = 'email_verification' } = opts;

    const expiresFormatted = expiresAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const copy =
      purpose === 'password_reset'
        ? {
            subject: '🔑 TheDailySocial — Password reset code',
            heading: 'We received a request to reset your password.',
            label: 'Password reset code',
          }
        : purpose === 'two_fa'
          ? {
              subject: '🔐 TheDailySocial — Login verification code',
              heading: 'Enter this code to complete your login.',
              label: 'Login verification code',
            }
          : {
              subject: '🔐 Your TheDailySocial verification code',
              heading: 'Use the code below to verify your email address.',
              label: 'Your verification code',
            };

    const html = this.buildOtpHtml(toName, otp, expiresFormatted, copy.heading, copy.label);
    const text = this.buildOtpText(toName, otp, expiresFormatted, copy.heading);

    // In local dev, skip SES and log the OTP so the flow is testable without AWS config
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        `[DEV] OTP email NOT sent via SES. ` +
        `to=${toEmail} purpose=${purpose} otp=${otp} expires=${expiresFormatted}`,
      );
      return;
    }

    const input: SendEmailCommandInput = {
      Source: `TheDailySocial <${this.fromAddress}>`,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: copy.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    };

    const command = new SendEmailCommand(input);
    try {
      await this.ses.send(command);
      this.logger.log(`${purpose} OTP email sent to ${toEmail}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log the full SES error (visible in CloudWatch) so we can diagnose
      // sandbox-mode rejections, missing IAM permissions, or unverified domains.
      this.logger.error(`SES send failed to=${toEmail} purpose=${purpose} error=${msg}`);
      throw new ServiceUnavailableException(
        'Could not send OTP email. Please try again in a moment.',
      );
    }
  }

  // ─── PRIVATE: HTML TEMPLATE ───────────────────────────────────────────────

  private buildOtpHtml(
    name: string,
    otp: string,
    expiresAt: string,
    heading: string,
    label: string,
  ): string {
    const firstName = name?.trim()?.split(' ')[0] || 'there';

    return `<!DOCTYPE html>
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
              <p style="margin:0 0 28px;font-size:28px;font-weight:900;color:#C62828;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:-0.5px;">
                TheDailySocial
              </p>

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111;">
                Hey ${firstName},
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#555;line-height:1.6;">
                ${heading}
              </p>

              <!-- OTP — single line, bold, black -->
              <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                ${label}
              </p>
              <p style="margin:0 0 32px;font-size:36px;font-weight:900;color:#111;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:6px;
                         line-height:1;">
                ${otp}
              </p>

              <!-- Expiry -->
              <p style="margin:0 0 28px;font-size:14px;color:#888;">
                Valid until <strong style="color:#333;">${expiresAt} IST</strong>
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
                From the <strong style="color:#C62828;">TheDailySocial</strong> Support Team
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
  }

  // ─── OTA BOOKING LINKED ──────────────────────────────────────────────────

  async sendOtaBookingLinkedEmail(opts: {
    toEmail: string;
    firstName: string;
    bookingId: string;
    propertyName: string;
    roomTypeName: string;
    checkinDate: string;
    checkoutDate: string;
    source: string;
  }): Promise<void> {
    const html = this.buildOtaLinkedHtml(opts);
    const text = this.buildOtaLinkedText(opts);

    const input: SendEmailCommandInput = {
      Source: `TheDailySocial <${this.fromAddress}>`,
      Destination: { ToAddresses: [opts.toEmail] },
      Message: {
        Subject: {
          Data: `Your ${opts.propertyName} booking is linked — complete pre-checkin`,
          Charset: 'UTF-8',
        },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    };

    await this.ses.send(new SendEmailCommand(input));
    this.logger.log(`OTA booking linked email sent to ${opts.toEmail} for booking ${opts.bookingId}`);
  }

  private buildOtaLinkedHtml(opts: {
    firstName: string;
    bookingId: string;
    propertyName: string;
    roomTypeName: string;
    checkinDate: string;
    checkoutDate: string;
    source: string;
  }): string {
    return `<!DOCTYPE html>
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
               style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#C62828;padding:24px 36px;">
              <p style="margin:0;font-size:28px;font-weight:900;color:#ffffff;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:-0.5px;">
                TheDailySocial
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 36px 0;">

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111;">
                Hey ${opts.firstName},
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                We spotted your booking from <strong style="color:#333;">${opts.source}</strong>.
                It's now linked to your TheDailySocial account — your pre-checkin is ready to complete.
              </p>

              <!-- Booking Details -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                Booking Details
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#fff5f5;border:2px solid #C62828;border-radius:8px;
                            margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px 12px;">
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
                        <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Room</td>
                        <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.roomTypeName}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Check-in</td>
                        <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.checkinDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;font-size:12px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #fcc;">Check-out</td>
                        <td style="padding:5px 0;font-size:15px;color:#111;border-top:1px solid #fcc;">${opts.checkoutDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
                Save time at check-in — complete your pre-checkin now and upload your ID in advance.
              </p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#C62828;border-radius:8px;">
                    <a href="https://thedailysocial.co.in/pre-checkin"
                       style="display:inline-block;padding:13px 28px;font-size:15px;
                              font-weight:700;color:#ffffff;text-decoration:none;
                              font-family:'Segoe UI',Arial,sans-serif;">
                      Complete Pre-Checkin →
                    </a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px;" />
              <p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
                Not your booking? You can safely ignore this email.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:18px 36px;">
              <p style="margin:0;font-size:13px;color:#999;">
                From the <strong style="color:#C62828;">TheDailySocial</strong> Support Team
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
  }

  private buildOtaLinkedText(opts: {
    firstName: string;
    bookingId: string;
    propertyName: string;
    roomTypeName: string;
    checkinDate: string;
    checkoutDate: string;
    source: string;
  }): string {
    return [
      'THEDAILYSOCIAL — Your booking is linked',
      '─'.repeat(40),
      '',
      `Hey ${opts.firstName},`,
      '',
      `We spotted your booking from ${opts.source}.`,
      "It's now linked to your TheDailySocial account.",
      '',
      '── BOOKING DETAILS ──',
      `  Booking ID  : ${opts.bookingId}`,
      `  Property    : ${opts.propertyName}`,
      `  Room        : ${opts.roomTypeName}`,
      `  Check-in    : ${opts.checkinDate}`,
      `  Check-out   : ${opts.checkoutDate}`,
      '',
      'Complete your pre-checkin at:',
      '  https://thedailysocial.co.in/pre-checkin',
      '',
      'Not your booking? You can safely ignore this email.',
      '',
      '─'.repeat(40),
      'From the TheDailySocial Support Team',
      'noreply@thedailysocial.co.in',
    ].join('\n');
  }

  // ─── BOOKING CONFIRMATION ────────────────────────────────────────────────

  async sendBookingConfirmationEmail(opts: {
    toEmail: string;
    firstName: string;
    fullName: string;
    gender?: string;
    phone?: string;
    bookingId: string;
    propertyName: string;
    roomType: string;
    roomNumber: string;
    checkinDate: string;
    checkoutDate: string;
    noOfGuests: number;
  }): Promise<void> {
    const { toEmail, propertyName, bookingId } = opts;

    const html = this.buildBookingHtml(opts);
    const text = this.buildBookingText(opts);

    const input: SendEmailCommandInput = {
      Source: `TheDailySocial <${this.fromAddress}>`,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Data: `🏠 Booking confirmed — ${propertyName}`, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    };

    await this.ses.send(new SendEmailCommand(input));
    this.logger.log(`Booking confirmation email sent to ${toEmail} for booking ${bookingId}`);
  }

  private buildBookingHtml(opts: {
    firstName: string;
    fullName: string;
    gender?: string;
    toEmail: string;
    phone?: string;
    bookingId: string;
    propertyName: string;
    roomType: string;
    roomNumber: string;
    checkinDate: string;
    checkoutDate: string;
    noOfGuests: number;
  }): string {
    const phoneRow = opts.phone
      ? `<tr>
              <td style="padding:8px 0;border-top:1px solid #eee;">
                <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Phone</span>
                <span style="font-size:15px;color:#111;">${opts.phone}</span>
              </td>
            </tr>`
      : '';

    return `<!DOCTYPE html>
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
               style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#C62828;padding:24px 36px;">
              <p style="margin:0;font-size:28px;font-weight:900;color:#ffffff;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:-0.5px;">
                TheDailySocial
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 36px 0;">

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111;">
                Hey ${opts.firstName},
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                Thanks for your booking! Here are your booking details.
              </p>

              <!-- Guest Information -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                Guest Information
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;
                            margin-bottom:24px;padding:0;">
                <tr>
                  <td style="padding:16px 20px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:0 0 8px;">
                          <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Name</span>
                          <span style="font-size:15px;color:#111;">${opts.fullName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #eee;">
                          <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Gender</span>
                          <span style="font-size:15px;color:#111;">${opts.gender ?? '—'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #eee;">
                          <span style="font-size:11px;font-weight:600;color:#999;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:3px;">Email</span>
                          <span style="font-size:15px;color:#111;">${opts.toEmail}</span>
                        </td>
                      </tr>
                      ${phoneRow}
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 0 4px;"></td></tr>
              </table>

              <!-- Booking Details -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                Booking Details
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#fff5f5;border:2px solid #C62828;border-radius:8px;
                            margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px 12px;">
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
                  </td>
                </tr>
              </table>

              <!-- The Essentials -->
              <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px;" />
              <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                The Essentials
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:4px 0;font-size:14px;color:#555;">📎&nbsp; Carry a valid government-issued photo ID</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#555;">🕑&nbsp; Check-in time: <strong style="color:#333;">2:00 PM</strong> onwards</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#555;">⏳&nbsp; Early check-in subject to availability — reach out to us</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#555;">📶&nbsp; Wi-Fi details will be shared at the property</td></tr>
                <tr><td style="padding:4px 0;font-size:14px;color:#555;">📱&nbsp; Manage your stay at <a href="https://thedailysocial.co.in" style="color:#C62828;text-decoration:none;font-weight:600;">thedailysocial.co.in</a></td></tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:18px 36px;margin-top:28px;">
              <p style="margin:0;font-size:13px;color:#999;">
                From the <strong style="color:#C62828;">TheDailySocial</strong> Support Team
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
  }

  private buildBookingText(opts: {
    firstName: string;
    fullName: string;
    gender?: string;
    toEmail: string;
    phone?: string;
    bookingId: string;
    propertyName: string;
    roomType: string;
    roomNumber: string;
    checkinDate: string;
    checkoutDate: string;
    noOfGuests: number;
  }): string {
    const lines = [
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
    ];
    if (opts.phone) lines.push(`  Phone   : ${opts.phone}`);
    lines.push(
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
    );
    return lines.join('\n');
  }

  // ─── CHECK-IN CONFIRMATION ────────────────────────────────────────────────

  async sendCheckinEmail(opts: {
    toEmail: string;
    firstName: string;
    passkeys: Array<{ key: string; roomNumber: string }>;
    lockerKeys?: Array<{ key: string; lockerLabel: string }>;
  }): Promise<void> {
    const html = this.buildCheckinHtml(opts);
    const text = this.buildCheckinText(opts);

    const input: SendEmailCommandInput = {
      Source: `TheDailySocial <${this.fromAddress}>`,
      Destination: { ToAddresses: [opts.toEmail] },
      Message: {
        Subject: { Data: `🔑 You're checked in — welcome to TheDailySocial!`, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    };

    await this.ses.send(new SendEmailCommand(input));
    this.logger.log(`Check-in confirmation email sent to ${opts.toEmail}`);
  }

  private buildCheckinHtml(opts: {
    firstName: string;
    passkeys: Array<{ key: string; roomNumber: string }>;
    lockerKeys?: Array<{ key: string; lockerLabel: string }>;
  }): string {
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

    const lockerSection =
      opts.lockerKeys && opts.lockerKeys.length > 0
        ? `<!-- Locker Keys -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                Locker Keys
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;
                            margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${opts.lockerKeys
                        .map(
                          (lk, i) => `<tr>
                        <td style="${i > 0 ? 'border-top:1px solid #eee;' : ''}padding:8px 0;">
                          <span style="font-size:15px;font-weight:700;color:#333;
                                       font-family:'Courier New',monospace;">${lk.key}</span>
                          <span style="font-size:14px;color:#777;margin-left:12px;">→ ${lk.lockerLabel}</span>
                        </td>
                      </tr>`,
                        )
                        .join('')}
                    </table>
                  </td>
                </tr>
              </table>`
        : '';

    return `<!DOCTYPE html>
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
               style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#C62828;padding:24px 36px;">
              <p style="margin:0;font-size:28px;font-weight:900;color:#ffffff;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:-0.5px;">
                TheDailySocial
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 36px 0;">

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111;">
                Hey ${opts.firstName},
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                Welcome to TheDailySocial! Hope you have a wonderful stay with us.
              </p>

              <!-- Passkeys -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#999;
                         letter-spacing:2px;text-transform:uppercase;">
                Your Room Passkey${opts.passkeys.length > 1 ? 's' : ''}
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#fff5f5;border:2.5px solid #C62828;border-radius:8px;
                            margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${passkeyRows}
                    </table>
                  </td>
                </tr>
              </table>

              ${lockerSection}

              <!-- CTA -->
              <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
                Need anything during your stay? Log in and request services anytime.
              </p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#C62828;border-radius:8px;">
                    <a href="https://thedailysocial.co.in"
                       style="display:inline-block;padding:13px 28px;font-size:15px;
                              font-weight:700;color:#ffffff;text-decoration:none;
                              font-family:'Segoe UI',Arial,sans-serif;">
                      Go to TheDailySocial →
                    </a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #eee;margin:0 0 20px;" />
              <p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
                Keep this email safe — your passkeys are confidential. Do not share them.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #f0f0f0;padding:18px 36px;">
              <p style="margin:0;font-size:13px;color:#999;">
                From the <strong style="color:#C62828;">TheDailySocial</strong> Support Team
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
  }

  private buildCheckinText(opts: {
    firstName: string;
    passkeys: Array<{ key: string; roomNumber: string }>;
    lockerKeys?: Array<{ key: string; lockerLabel: string }>;
  }): string {
    const lines = [
      'THEDAILYSOCIAL — You\'re Checked In!',
      '─'.repeat(40),
      '',
      `Hey ${opts.firstName},`,
      '',
      'Welcome to TheDailySocial! Hope you have a wonderful stay.',
      '',
      '── YOUR ROOM PASSKEY/S ──',
    ];
    for (const p of opts.passkeys) {
      lines.push(`  ${p.key}  →  Room ${p.roomNumber}`);
    }
    if (opts.lockerKeys && opts.lockerKeys.length > 0) {
      lines.push('', '── LOCKER KEYS ──');
      for (const lk of opts.lockerKeys) {
        lines.push(`  ${lk.key}  →  ${lk.lockerLabel}`);
      }
    }
    lines.push(
      '',
      'Need anything? Log in at https://thedailysocial.co.in',
      '',
      'Keep this email safe — your passkeys are confidential.',
      '',
      '─'.repeat(40),
      'From the TheDailySocial Support Team',
      'noreply@thedailysocial.co.in',
    );
    return lines.join('\n');
  }

  private buildOtpText(name: string, otp: string, expiresAt: string, heading: string): string {
    const firstName = name?.trim()?.split(' ')[0] || 'there';
    return [
      'THEDAILYSOCIAL',
      '─'.repeat(40),
      '',
      `Hey ${firstName},`,
      '',
      heading,
      '',
      `  ${otp}`,
      '',
      `Valid until: ${expiresAt} IST`,
      '',
      'If you didn\'t request this, please ignore this email.',
      '',
      '─'.repeat(40),
      'From the TheDailySocial Support Team',
      'noreply@thedailysocial.co.in',
    ].join('\n');
  }
}
