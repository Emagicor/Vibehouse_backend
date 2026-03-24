-- AlterTable
ALTER TABLE "kyc_submissions" ADD COLUMN     "contact_number" VARCHAR(20),
ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "full_name" VARCHAR(255),
ADD COLUMN     "id_number" VARCHAR(100),
ADD COLUMN     "permanent_address" TEXT,
ADD COLUMN     "slot_id" VARCHAR(36),
ADD COLUMN     "submitted_by_guest_id" VARCHAR(36),
ALTER COLUMN "front_image_url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "booking_slots" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "slot_number" INTEGER NOT NULL,
    "guest_id" VARCHAR(36),
    "label" VARCHAR(50) NOT NULL,
    "kyc_status" VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "time" VARCHAR(10),
    "location" VARCHAR(200),
    "capacity" INTEGER,
    "price_text" VARCHAR(100),
    "contact_link" VARCHAR(500),
    "poster_url" VARCHAR(500),
    "badge_label" VARCHAR(30),
    "badge_color" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returnable_checkouts" (
    "id" VARCHAR(36) NOT NULL,
    "inventory_id" VARCHAR(36) NOT NULL,
    "addon_order_item_id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "unit_code" VARCHAR(20),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "issued_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_at" TIMESTAMP(6),
    "returned_verified_by_admin_id" VARCHAR(36),
    "condition_on_return" VARCHAR(15),
    "status" VARCHAR(15) NOT NULL DEFAULT 'ISSUED',
    "issued_by_admin_id" VARCHAR(36),
    "notes" TEXT,

    CONSTRAINT "returnable_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "total_rooms" INTEGER NOT NULL,
    "beds_per_room" INTEGER NOT NULL DEFAULT 1,
    "total_beds" INTEGER NOT NULL,
    "base_price_per_night" DECIMAL(10,2) NOT NULL,
    "floor_range" VARCHAR(20),
    "amenities" JSONB DEFAULT '[]',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_booking_slots_eri" ON "booking_slots"("ezee_reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_slots_ezee_reservation_id_slot_number_key" ON "booking_slots"("ezee_reservation_id", "slot_number");

-- CreateIndex
CREATE INDEX "idx_events_property_date" ON "events"("property_id", "date");

-- CreateIndex
CREATE INDEX "idx_ret_guest_status" ON "returnable_checkouts"("guest_id", "status");

-- CreateIndex
CREATE INDEX "idx_ret_order_item" ON "returnable_checkouts"("addon_order_item_id");

-- CreateIndex
CREATE INDEX "idx_ret_reservation" ON "returnable_checkouts"("ezee_reservation_id", "status");

-- CreateIndex
CREATE INDEX "idx_room_types_property" ON "room_types"("property_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_property_id_slug_key" ON "room_types"("property_id", "slug");

-- CreateIndex
CREATE INDEX "idx_kyc_slot" ON "kyc_submissions"("slot_id");

-- AddForeignKey
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "booking_slots"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_submitted_by_guest_id_fkey" FOREIGN KEY ("submitted_by_guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returnable_checkouts" ADD CONSTRAINT "returnable_checkouts_addon_order_item_id_fkey" FOREIGN KEY ("addon_order_item_id") REFERENCES "addon_order_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returnable_checkouts" ADD CONSTRAINT "returnable_checkouts_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returnable_checkouts" ADD CONSTRAINT "returnable_checkouts_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returnable_checkouts" ADD CONSTRAINT "returnable_checkouts_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returnable_checkouts" ADD CONSTRAINT "returnable_checkouts_issued_by_admin_id_fkey" FOREIGN KEY ("issued_by_admin_id") REFERENCES "admin_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "returnable_checkouts" ADD CONSTRAINT "returnable_checkouts_returned_verified_by_admin_id_fkey" FOREIGN KEY ("returned_verified_by_admin_id") REFERENCES "admin_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
