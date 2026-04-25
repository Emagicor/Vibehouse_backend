import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { EmailService } from '../email/email.service';

// Cache session token with 60s safety margin before true expiry
const SESSION_BUFFER_S = 60;

interface MyGateApiResponse {
  es: 0 | 1 | 2; // 0=success, 1=error, 2=no data
  message: string;
  response?: string | null;
  session_token?: string;
  expires_in?: number;
  errorCode?: number | null;
}

type AuthContext = {
  sessionToken: string;
  partnerId: string;
  adminMobile: string;
  mygatePropertyId: string;
  baseUrl: string;
};

@Injectable()
export class MyGateService {
  private readonly logger = new Logger(MyGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly email: EmailService,
  ) {}

  // ── Credentials ───────────────────────────────────────────────────────────

  private async getConnection(propertyId: string) {
    const conn = await this.prisma.mygate_connection.findFirst({
      where: { property_id: propertyId, is_active: true },
    });
    if (!conn) {
      throw new Error(`No active MyGate connection for property ${propertyId}`);
    }
    const parts = conn.mygate_property_id.split(':');
    return {
      apiKey: conn.api_key,
      partnerId: parts[0],
      adminMobile: conn.admin_phone ?? '',
      mygatePropertyId: parts.length > 1 ? parts[1] : parts[0],
      baseUrl: (conn.api_endpoint ?? 'https://knoxapi.mygate.com/partner-access').replace(/\/+$/, ''),
    };
  }

  // ── Authentication ────────────────────────────────────────────────────────

  /**
   * Returns a valid session token, using Redis cache to avoid repeated logins.
   * Token is cached for (expires_in - SESSION_BUFFER_S) seconds.
   */
  async authenticate(propertyId: string): Promise<AuthContext> {
    const cacheKey = `mygate:session:${propertyId}`;
    const cached = await this.cache.get<AuthContext>(cacheKey);
    if (cached) return cached;

    const { apiKey, partnerId, adminMobile, mygatePropertyId, baseUrl } =
      await this.getConnection(propertyId);

    const resp = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'partner-id': partnerId,
      },
      body: JSON.stringify({ mobile: adminMobile }),
    });

    const data: MyGateApiResponse = await resp.json();

    if (data.es !== 0 || !data.session_token) {
      throw new Error(`MyGate auth failed: ${data.message}`);
    }

    const ttlMs = data.expires_in
      ? (data.expires_in - SESSION_BUFFER_S) * 1000
      : 55 * 60 * 1000;

    const ctx: AuthContext = { sessionToken: data.session_token, partnerId, adminMobile, mygatePropertyId, baseUrl };
    await this.cache.set(cacheKey, ctx, ttlMs);
    this.logger.log(`MyGate authenticated for property ${propertyId}`);

    return ctx;
  }

  // ── Passcode generation ───────────────────────────────────────────────────

  /**
   * Generates a TIMED PASSCODE for a room and returns the PIN.
   *
   * The API returns response:null — the PIN lives in access_value on the
   * access object. We fetch it immediately after creation by timestamp match.
   * Auto-generated PINs work even when the lock is offline (queued until reconnect);
   * custom passcodes require live lock connectivity so we don't use them.
   */
  async createPasscode(
    auth: AuthContext,
    params: {
      mygateRoomId: string;
      accessName: string;
      checkin: Date;
      checkout: Date;
    },
  ): Promise<string> {
    const startTime = Math.floor(params.checkin.getTime() / 1000);
    const endTime = Math.floor(params.checkout.getTime() / 1000);

    const createResp = await fetch(`${auth.baseUrl}/v1/accesses/generate-access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'partner-id': auth.partnerId,
        'mobile': auth.adminMobile,
        'platform': '3',
        'session-token': auth.sessionToken,
      },
      body: JSON.stringify({
        property_id: auth.mygatePropertyId,
        room_id: params.mygateRoomId,
        access_type: 'PASSCODE',
        validity_type: 'TIMED',
        start_time: startTime,
        end_time: endTime,
        access_name: params.accessName,
      }),
    });

    const createData: MyGateApiResponse = await createResp.json();
    if (createData.es !== 0) {
      throw new Error(`MyGate createPasscode failed: ${createData.message}`);
    }

    // PIN is not in the create response — fetch the access we just created
    const listResp = await fetch(
      `${auth.baseUrl}/v1/rooms/${params.mygateRoomId}/accesses?status=ACTIVE`,
      {
        headers: {
          'partner-id': auth.partnerId,
          'mobile': auth.adminMobile,
          'platform': '3',
          'session-token': auth.sessionToken,
        },
      },
    );

    const listData: any = await listResp.json();
    if (listData.es !== 0) {
      throw new Error(`MyGate fetch accesses failed after PIN creation: ${listData.message}`);
    }

    // Match by start_time — the access we just created
    const match = (listData.accesses ?? []).find(
      (a: any) => a.start_time === startTime && a.access_name === params.accessName,
    );

    if (!match?.access_value) {
      throw new Error(`MyGate PIN not found in accesses after creation (room ${params.mygateRoomId})`);
    }

    this.logger.log(`MyGate PIN created for room ${params.mygateRoomId}: ${match.access_value}`);
    return String(match.access_value);
  }

  // ── Access revocation ─────────────────────────────────────────────────────

  /**
   * Revokes a specific access by its MyGate access ID.
   * The access ID is obtained from the accesses list (GET /v1/rooms/{roomId}/accesses).
   */
  async revokeAccessById(propertyId: string, mygateAccessId: string): Promise<void> {
    const auth = await this.authenticate(propertyId);

    const resp = await fetch(`${auth.baseUrl}/v1/accesses/${mygateAccessId}`, {
      method: 'DELETE',
      headers: {
        'partner-id': auth.partnerId,
        'mobile': auth.adminMobile,
        'platform': '3',
        'session-token': auth.sessionToken,
      },
    });

    const data: MyGateApiResponse = await resp.json();
    if (data.es !== 0) {
      throw new Error(`MyGate revokeAccess failed: ${data.message}`);
    }

    this.logger.log(`MyGate access revoked: ${mygateAccessId}`);
  }

  /**
   * Revokes all ACTIVE accesses for a room whose PIN matches the stored PIN.
   * Used on checkout when we don't have the MyGate access ID stored.
   */
  async revokeAccessByPin(
    propertyId: string,
    mygateRoomId: string,
    pin: string,
  ): Promise<void> {
    const auth = await this.authenticate(propertyId);

    const resp = await fetch(
      `${auth.baseUrl}/v1/rooms/${mygateRoomId}/accesses?status=ACTIVE`,
      {
        method: 'GET',
        headers: {
          'partner-id': auth.partnerId,
          'mobile': auth.adminMobile,
          'platform': '3',
          'session-token': auth.sessionToken,
        },
      },
    );

    const data: any = await resp.json();
    if (data.es !== 0) return;

    const match = (data.accesses ?? []).find((a: any) => a.access_value === pin);
    if (!match) {
      this.logger.warn(`MyGate revokeByPin: no active access found with PIN ${pin} on room ${mygateRoomId}`);
      return;
    }

    await this.revokeAccessById(propertyId, match.id);
  }

  // ── Orchestrator: provision lock access on check-in ───────────────────────

  /**
   * Full PIN provisioning flow triggered when eZee marks a booking as Checked In.
   *
   * Idempotent — skips if an ACTIVE PIN already exists for the ERI.
   * Should be called with .catch() so failures don't block reconciliation.
   */
  async provisionLockAccess(params: {
    eri: string;
    propertyId: string;
    roomNumber: string | null;
    checkin: Date | null;
    checkout: Date | null;
  }): Promise<void> {
    const { eri, propertyId, roomNumber, checkin, checkout } = params;

    if (!roomNumber) {
      this.logger.warn(`MyGate provision skipped for ${eri}: no room number assigned yet`);
      return;
    }
    if (!checkin || !checkout) {
      this.logger.warn(`MyGate provision skipped for ${eri}: missing checkin/checkout dates`);
      return;
    }

    // Idempotency: skip if PIN already active for this booking
    const existing = await this.prisma.smart_lock_access.findFirst({
      where: { ezee_reservation_id: eri, pin_status: 'ACTIVE' },
    });
    if (existing) {
      this.logger.log(`MyGate provision skipped for ${eri}: active PIN already exists`);
      return;
    }

    // Find the physical lock for this room
    const device = await this.prisma.mygate_devices.findFirst({
      where: { property_id: propertyId, room_number: roomNumber, is_active: true },
    });
    if (!device) {
      this.logger.warn(
        `MyGate provision skipped for ${eri}: no lock device for room ${roomNumber} (property ${propertyId})`,
      );
      return;
    }

    // Resolve guest info for the email
    const guestAccess = await this.prisma.booking_guest_access.findFirst({
      where: { ezee_reservation_id: eri, role: 'PRIMARY', status: 'APPROVED' },
      include: {
        guests_booking_guest_access_guest_idToguests: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    let guestId: string | null = null;
    let guestName = 'Guest';
    let guestEmail: string | null = null;

    if (guestAccess) {
      const g = guestAccess.guests_booking_guest_access_guest_idToguests;
      guestId = g.id;
      guestName = g.name;
      guestEmail = g.email;
    } else {
      const booking = await this.prisma.ezee_booking_cache.findUnique({
        where: { ezee_reservation_id: eri },
        select: { booker_email: true, guest_id: true },
      });
      guestId = booking?.guest_id ?? null;
      guestEmail = booking?.booker_email ?? null;
    }

    try {
      const auth = await this.authenticate(propertyId);

      const pin = await this.createPasscode(auth, {
        mygateRoomId: device.mygate_room_id,
        accessName: `${guestName} — Room ${roomNumber}`,
        checkin,
        checkout,
      });

      await this.prisma.smart_lock_access.create({
        data: {
          id: uuidv4(),
          ezee_reservation_id: eri,
          guest_id: guestId ?? 'unknown',
          device_id: device.id,
          room_number: roomNumber,
          mygate_pin: pin,
          pin_type: 'AUTO',
          pin_validity: 'TIMED',
          is_master_pin: false,
          pin_status: 'ACTIVE',
          valid_from: checkin,
          valid_until: checkout,
        },
      });

      this.logger.log(`MyGate PIN provisioned for ${eri}: room ${roomNumber}, PIN ${pin}`);

      if (guestEmail) {
        await this.email.sendCheckinEmail({
          toEmail: guestEmail,
          firstName: guestName.split(' ')[0] ?? 'there',
          passkeys: [{ key: pin, roomNumber }],
        }).catch((e: Error) =>
          this.logger.warn(`Check-in email failed for ${eri}: ${e.message}`),
        );
      }
    } catch (err) {
      this.logger.error(
        `MyGate provision failed for ${eri} (room ${roomNumber}): ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
