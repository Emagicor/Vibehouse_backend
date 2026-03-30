import { Injectable, Logger } from '@nestjs/common';
import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-ses';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly ses: SESClient;
  private readonly fromAddress = process.env.SES_FROM_EMAIL ?? 'help@vibehouse.in';

  constructor() {
    this.ses = new SESClient({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  // ─── PUBLIC ───────────────────────────────────────────────────────────────

  async sendOtpEmail(opts: {
    toEmail: string;
    toName: string;
    otp: string;
    expiresAt: Date;
    purpose?: 'email_verification' | 'password_reset';
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

    const copy = purpose === 'password_reset'
      ? {
          subject: '🔑 VibeHouse — Password reset code',
          heading: 'We received a request to reset your password.',
          label: 'Password reset code',
        }
      : {
          subject: '🔐 Your VibeHouse verification code',
          heading: 'Use the code below to verify your email address.',
          label: 'Your verification code',
        };

    const html = this.buildOtpHtml(toName, otp, expiresFormatted, copy.heading, copy.label);
    const text = this.buildOtpText(toName, otp, expiresFormatted, copy.heading);

    const input: SendEmailCommandInput = {
      Source: `VibeHouse <${this.fromAddress}>`,
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
    await this.ses.send(command);
    this.logger.log(`${purpose} OTP email sent to ${toEmail}`);
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
  <title>VibeHouse</title>
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

              <!-- VibeHouse logo text -->
              <p style="margin:0 0 28px;font-size:28px;font-weight:900;color:#C62828;
                         font-family:'Segoe UI',Arial,sans-serif;letter-spacing:-0.5px;">
                VibeHouse
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
                From the <strong style="color:#C62828;">VibeHouse</strong> Support Team
              </p>
              <p style="margin:3px 0 0;font-size:12px;color:#ccc;">
                help@vibehouse.in
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

  private buildOtpText(name: string, otp: string, expiresAt: string, heading: string): string {
    const firstName = name?.trim()?.split(' ')[0] || 'there';
    return [
      'VIBEHOUSE',
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
      'From the VibeHouse Support Team',
      'help@vibehouse.in',
    ].join('\n');
  }
}
