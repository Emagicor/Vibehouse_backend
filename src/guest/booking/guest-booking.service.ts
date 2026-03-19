import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class GuestBookingService {
  private readonly logger = new Logger(GuestBookingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Link a guest to a booking (ERI).
   * - Matches booker email/phone → PRIMARY
   * - Otherwise → SECONDARY (auto-approved for now, 2FA later)
   * - Auto-creates booking slots if they don't exist
   * - Assigns guest to first available slot
   */
  async linkBooking(guestId: string, ezeeReservationId: string) {
    // 1. Look up the booking in cache
    const booking = await this.prisma.ezee_booking_cache.findUnique({
      where: { ezee_reservation_id: ezeeReservationId },
    });

    if (!booking) {
      throw new NotFoundException(
        `Booking "${ezeeReservationId}" not found. Please verify the reservation ID.`,
      );
    }

    // 2. Check if already linked
    const existingAccess = await this.prisma.booking_guest_access.findFirst({
      where: {
        ezee_reservation_id: ezeeReservationId,
        guest_id: guestId,
      },
    });

    if (existingAccess) {
      // Already linked — return existing, but ensure slots exist
      let slots = await this.prisma.booking_slots.findMany({
        where: { ezee_reservation_id: ezeeReservationId },
        orderBy: { slot_number: 'asc' },
      });

      // Create slots if missing (e.g. pre-seeded booking_guest_access without slots)
      if (slots.length === 0) {
        const numGuests = booking.no_of_guests ?? 1;
        const newSlots: { id: string; ezee_reservation_id: string; slot_number: number; guest_id: string | null; label: string; kyc_status: string }[] = [];
        for (let i = 1; i <= numGuests; i++) {
          newSlots.push({
            id: uuidv4(),
            ezee_reservation_id: ezeeReservationId,
            slot_number: i,
            guest_id: i === 1 ? guestId : null,
            label: `Guest ${i}`,
            kyc_status: 'NOT_STARTED',
          });
        }
        await this.prisma.booking_slots.createMany({ data: newSlots });
        slots = await this.prisma.booking_slots.findMany({
          where: { ezee_reservation_id: ezeeReservationId },
          orderBy: { slot_number: 'asc' },
        });
        this.logger.log(`Created ${numGuests} slots for pre-seeded booking ${ezeeReservationId}`);
      }

      return {
        message: 'Already linked to this booking',
        access: {
          role: existingAccess.role,
          status: existingAccess.status,
        },
        booking: this.formatBooking(booking),
        slots: slots.map(this.formatSlot),
      };
    }

    // 3. Get guest details for role matching
    const guest = await this.prisma.guests.findUnique({
      where: { id: guestId },
      select: { email: true, phone: true },
    });

    // 4. Determine role — match against booker details
    const isBokerMatch =
      (guest?.email && guest.email === booking.booker_email) ||
      (guest?.phone && guest.phone === booking.booker_phone);

    const role = isBokerMatch ? 'PRIMARY' : 'SECONDARY';

    // 5. Create booking_guest_access row
    const access = await this.prisma.booking_guest_access.create({
      data: {
        id: uuidv4(),
        ezee_reservation_id: ezeeReservationId,
        guest_id: guestId,
        role,
        status: 'APPROVED', // auto-approve for now (2FA later)
        approved_by_guest_id: guestId,
        approved_at: new Date(),
      },
    });

    this.logger.log(
      `Guest ${guestId} linked to ${ezeeReservationId} as ${role}`,
    );

    // 6. Auto-create slots if they don't exist yet for this ERI
    const existingSlots = await this.prisma.booking_slots.findMany({
      where: { ezee_reservation_id: ezeeReservationId },
      orderBy: { slot_number: 'asc' },
    });

    let slots = existingSlots;
    if (existingSlots.length === 0) {
      const numGuests = booking.no_of_guests ?? 1;
      const newSlots: { id: string; ezee_reservation_id: string; slot_number: number; guest_id: string | null; label: string; kyc_status: string }[] = [];
      for (let i = 1; i <= numGuests; i++) {
        newSlots.push({
          id: uuidv4(),
          ezee_reservation_id: ezeeReservationId,
          slot_number: i,
          guest_id: null as string | null,
          label: `Guest ${i}`,
          kyc_status: 'NOT_STARTED',
        });
      }

      await this.prisma.booking_slots.createMany({ data: newSlots });

      slots = await this.prisma.booking_slots.findMany({
        where: { ezee_reservation_id: ezeeReservationId },
        orderBy: { slot_number: 'asc' },
      });

      this.logger.log(
        `Created ${numGuests} slots for ${ezeeReservationId}`,
      );
    }

    // 7. Assign guest to first unassigned slot
    const unassignedSlot = slots.find((s) => s.guest_id === null);
    if (unassignedSlot) {
      await this.prisma.booking_slots.update({
        where: { id: unassignedSlot.id },
        data: { guest_id: guestId },
      });
      unassignedSlot.guest_id = guestId;

      this.logger.log(
        `Assigned guest ${guestId} to slot ${unassignedSlot.slot_number}`,
      );
    }

    // Re-fetch slots after assignment
    const updatedSlots = await this.prisma.booking_slots.findMany({
      where: { ezee_reservation_id: ezeeReservationId },
      orderBy: { slot_number: 'asc' },
    });

    return {
      message: `Successfully linked as ${role}`,
      access: {
        role: access.role,
        status: access.status,
      },
      booking: this.formatBooking(booking),
      slots: updatedSlots.map(this.formatSlot),
    };
  }

  /**
   * List all bookings linked to a guest.
   */
  async getMyBookings(guestId: string) {
    const accesses = await this.prisma.booking_guest_access.findMany({
      where: {
        guest_id: guestId,
        status: 'APPROVED',
      },
      include: {
        ezee_booking_cache: true,
      },
      orderBy: { created_at: 'desc' },
    });

    const result: Record<string, unknown>[] = [];

    for (const access of accesses) {
      const booking = access.ezee_booking_cache;

      // Count slots and KYC completion
      const slots = await this.prisma.booking_slots.findMany({
        where: { ezee_reservation_id: access.ezee_reservation_id },
      });

      const totalSlots = slots.length;
      const kycCompletedSlots = slots.filter(
        (s) => s.kyc_status === 'PRE_VERIFIED' || s.kyc_status === 'VERIFIED',
      ).length;

      result.push({
        ezee_reservation_id: access.ezee_reservation_id,
        role: access.role,
        status: access.status,
        room_type_name: booking.room_type_name,
        room_number: booking.room_number,
        checkin_date: booking.checkin_date,
        checkout_date: booking.checkout_date,
        property_id: booking.property_id,
        source: booking.source,
        total_slots: totalSlots,
        kyc_completed_slots: kycCompletedSlots,
      });
    }

    return result;
  }

  private formatBooking(booking: any) {
    return {
      ezee_reservation_id: booking.ezee_reservation_id,
      property_id: booking.property_id,
      room_type_name: booking.room_type_name,
      room_number: booking.room_number,
      checkin_date: booking.checkin_date,
      checkout_date: booking.checkout_date,
      no_of_guests: booking.no_of_guests,
      source: booking.source,
      status: booking.status,
    };
  }

  private formatSlot(slot: any) {
    return {
      slot_id: slot.id,
      slot_number: slot.slot_number,
      label: slot.label,
      guest_id: slot.guest_id,
      kyc_status: slot.kyc_status,
    };
  }
}
