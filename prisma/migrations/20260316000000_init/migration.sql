-- CreateTable
CREATE TABLE "addon_order_items" (
    "id" VARCHAR(36) NOT NULL,
    "addon_order_id" VARCHAR(36) NOT NULL,
    "product_id" VARCHAR(36) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "unit_code" VARCHAR(20),

    CONSTRAINT "addon_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_orders" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "payment_id" VARCHAR(36),
    "phase" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "ezee_sync_status" VARCHAR(20) NOT NULL DEFAULT 'NOT_SYNCED',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addon_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_activity_log" (
    "id" VARCHAR(36) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(36) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "permissions" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "password_hash" VARCHAR(255) NOT NULL,
    "role_id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "two_fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_fa_secret" VARCHAR(255),
    "last_login_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_providers" (
    "id" VARCHAR(36) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "provider_uid" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_guest_access" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approved_by_guest_id" VARCHAR(36),
    "approved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_guest_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borrowable_checkouts" (
    "id" VARCHAR(36) NOT NULL,
    "inventory_id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "unit_code" VARCHAR(20) NOT NULL,
    "checked_out_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_at" TIMESTAMP(6),
    "returned_verified_by_zoho_staff_id" VARCHAR(100),
    "status" VARCHAR(15) NOT NULL DEFAULT 'CHECKED_OUT',
    "issued_by_admin_id" VARCHAR(255),

    CONSTRAINT "borrowable_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_records" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "selfie_url" VARCHAR(500),
    "face_match_score" DECIMAL(4,3),
    "face_match_status" VARCHAR(10),
    "onsite_scan_url" VARCHAR(500),
    "ssim_score" DECIMAL(4,3),
    "doc_match_status" VARCHAR(10),
    "gcard_pdf_url" VARCHAR(500),
    "signature_png_url" VARCHAR(500),
    "manual_override" BOOLEAN NOT NULL DEFAULT false,
    "override_by_zoho_staff_id" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "checked_in_at" TIMESTAMP(6),

    CONSTRAINT "checkin_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ezee_booking_cache" (
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "guest_id" VARCHAR(36),
    "booker_email" VARCHAR(255),
    "booker_phone" VARCHAR(20),
    "room_type_name" VARCHAR(100),
    "room_number" VARCHAR(20),
    "unit_code" VARCHAR(20),
    "checkin_date" DATE,
    "checkout_date" DATE,
    "no_of_guests" INTEGER DEFAULT 1,
    "source" VARCHAR(50),
    "status" VARCHAR(30),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "fetched_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ezee_booking_cache_pkey" PRIMARY KEY ("ezee_reservation_id")
);

-- CreateTable
CREATE TABLE "ezee_connection" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "hotel_code" VARCHAR(100) NOT NULL,
    "api_key" VARCHAR(255) NOT NULL,
    "api_endpoint" VARCHAR(500) NOT NULL,
    "channel_manager_id" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ezee_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ezee_sync_log" (
    "id" VARCHAR(36) NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" VARCHAR(36) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempted_at" TIMESTAMP(6),
    "next_retry_at" TIMESTAMP(6),
    "error_message" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ezee_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "password_hash" VARCHAR(255),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "profile_photo_url" VARCHAR(500),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "product_id" VARCHAR(36) NOT NULL,
    "total_stock" INTEGER NOT NULL,
    "available_stock" INTEGER NOT NULL,
    "reserved_stock" INTEGER NOT NULL DEFAULT 0,
    "sold_count" INTEGER NOT NULL DEFAULT 0,
    "damaged_count" INTEGER NOT NULL DEFAULT 0,
    "borrowed_out_count" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_submissions" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "nationality_type" VARCHAR(20) NOT NULL,
    "id_type" VARCHAR(20) NOT NULL,
    "front_image_url" VARCHAR(500) NOT NULL,
    "back_image_url" VARCHAR(500),
    "ocr_name" VARCHAR(255),
    "ocr_dob" VARCHAR(20),
    "ocr_id_number" VARCHAR(100),
    "ocr_address" TEXT,
    "coming_from" VARCHAR(255),
    "going_to" VARCHAR(255),
    "purpose" VARCHAR(255),
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mygate_connection" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "mygate_property_id" VARCHAR(100) NOT NULL,
    "api_key" VARCHAR(255) NOT NULL,
    "api_endpoint" VARCHAR(500) NOT NULL,
    "admin_phone" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mygate_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mygate_devices" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "room_number" VARCHAR(20) NOT NULL,
    "mygate_room_id" VARCHAR(100) NOT NULL,
    "lock_serial" VARCHAR(100) NOT NULL,
    "lock_type" VARCHAR(20) NOT NULL,
    "battery_pct" INTEGER,
    "battery_status" VARCHAR(10) NOT NULL DEFAULT 'OK',
    "last_health_at" TIMESTAMP(6),
    "has_manual_key" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mygate_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" VARCHAR(36) NOT NULL,
    "recipient_guest_id" VARCHAR(36),
    "recipient_zoho_staff_id" VARCHAR(100),
    "channel" VARCHAR(20) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "payload" JSONB,
    "status" VARCHAR(10) NOT NULL DEFAULT 'SENT',
    "sent_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_logs" (
    "id" VARCHAR(36) NOT NULL,
    "guest_id" VARCHAR(36),
    "recipient" VARCHAR(255) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "purpose" VARCHAR(50) NOT NULL,
    "otp_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "used_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "razorpay_order_id" VARCHAR(100),
    "razorpay_payment_id" VARCHAR(100),
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(5) NOT NULL DEFAULT 'INR',
    "purpose" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_catalog" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(20) NOT NULL,
    "base_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "branding_config" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_config" (
    "id" VARCHAR(36) NOT NULL,
    "property_id" VARCHAR(36) NOT NULL,
    "task_category" VARCHAR(20) NOT NULL,
    "department" VARCHAR(30) NOT NULL,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    "sla_minutes" INTEGER NOT NULL,
    "l0_timeout_min" INTEGER NOT NULL,
    "l1_timeout_min" INTEGER NOT NULL,
    "l2_timeout_min" INTEGER NOT NULL,
    "l3_timeout_min" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_lock_access" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "device_id" VARCHAR(36) NOT NULL,
    "room_number" VARCHAR(20) NOT NULL,
    "mygate_pin" VARCHAR(20) NOT NULL,
    "pin_type" VARCHAR(10) NOT NULL DEFAULT 'AUTO',
    "pin_validity" VARCHAR(10) NOT NULL DEFAULT 'TIMED',
    "is_master_pin" BOOLEAN NOT NULL DEFAULT false,
    "pin_status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "valid_from" TIMESTAMP(6) NOT NULL,
    "valid_until" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(6),

    CONSTRAINT "smart_lock_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_lock_access_log" (
    "id" VARCHAR(36) NOT NULL,
    "device_id" VARCHAR(36) NOT NULL,
    "pin_id" VARCHAR(36),
    "event_type" VARCHAR(20) NOT NULL,
    "event_source" VARCHAR(20) NOT NULL,
    "event_at" TIMESTAMP(6) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_lock_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_extensions" (
    "id" VARCHAR(36) NOT NULL,
    "ezee_reservation_id" VARCHAR(100) NOT NULL,
    "guest_id" VARCHAR(36) NOT NULL,
    "payment_id" VARCHAR(36),
    "old_checkout_date" DATE NOT NULL,
    "new_checkout_date" DATE NOT NULL,
    "rate_per_night" DECIMAL(10,2) NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "same_bed_available" BOOLEAN NOT NULL,
    "disclaimer_accepted" BOOLEAN NOT NULL DEFAULT false,
    "ezee_sync_status" VARCHAR(20) NOT NULL DEFAULT 'NOT_SYNCED',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stay_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zoho_ticket_ref" (
    "id" VARCHAR(36) NOT NULL,
    "zoho_ticket_id" VARCHAR(100) NOT NULL,
    "ezee_reservation_id" VARCHAR(100),
    "guest_id" VARCHAR(36),
    "addon_order_id" VARCHAR(36),
    "ticket_type" VARCHAR(20) NOT NULL,
    "department" VARCHAR(30) NOT NULL,
    "room_number" VARCHAR(20),
    "unit_code" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "synced_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zoho_ticket_ref_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_addon_orders_reservation" ON "addon_orders"("ezee_reservation_id");

-- CreateIndex
CREATE INDEX "idx_admin_log_actor" ON "admin_activity_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_admin_log_entity" ON "admin_activity_log"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_name_key" ON "admin_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "idx_admin_users_email_active" ON "admin_users"("email", "is_active");

-- CreateIndex
CREATE INDEX "idx_admin_users_role" ON "admin_users"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_providers_provider_provider_uid_key" ON "auth_providers"("provider", "provider_uid");

-- CreateIndex
CREATE INDEX "idx_booking_access_guest" ON "booking_guest_access"("guest_id");

-- CreateIndex
CREATE INDEX "idx_booking_access_reservation" ON "booking_guest_access"("ezee_reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_guest_access_ezee_reservation_id_guest_id_key" ON "booking_guest_access"("ezee_reservation_id", "guest_id");

-- CreateIndex
CREATE INDEX "idx_borrowable_guest_status" ON "borrowable_checkouts"("guest_id", "status");

-- CreateIndex
CREATE INDEX "idx_checkin_reservation" ON "checkin_records"("ezee_reservation_id");

-- CreateIndex
CREATE INDEX "idx_ezee_cache_guest" ON "ezee_booking_cache"("guest_id");

-- CreateIndex
CREATE INDEX "idx_ezee_cache_property" ON "ezee_booking_cache"("property_id", "status");

-- CreateIndex
CREATE INDEX "idx_ezee_sync_status_retry" ON "ezee_sync_log"("status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "guests_email_key" ON "guests"("email");

-- CreateIndex
CREATE UNIQUE INDEX "guests_phone_key" ON "guests"("phone");

-- CreateIndex
CREATE INDEX "idx_inventory_product" ON "inventory"("property_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_property_id_product_id_key" ON "inventory"("property_id", "product_id");

-- CreateIndex
CREATE INDEX "idx_kyc_reservation" ON "kyc_submissions"("ezee_reservation_id", "guest_id");

-- CreateIndex
CREATE INDEX "idx_device_property" ON "mygate_devices"("property_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_order_id_key" ON "payments"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_payment_id_key" ON "payments"("razorpay_payment_id");

-- CreateIndex
CREATE INDEX "idx_payments_reservation" ON "payments"("ezee_reservation_id");

-- CreateIndex
CREATE INDEX "idx_payments_status_expires" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "idx_sla_config_lookup" ON "sla_config"("property_id", "task_category", "department", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "sla_config_property_id_task_category_department_priority_key" ON "sla_config"("property_id", "task_category", "department", "priority");

-- CreateIndex
CREATE INDEX "idx_lock_access_device" ON "smart_lock_access"("device_id", "pin_status");

-- CreateIndex
CREATE INDEX "idx_lock_access_reservation" ON "smart_lock_access"("ezee_reservation_id", "pin_status");

-- CreateIndex
CREATE INDEX "idx_lock_log_device" ON "smart_lock_access_log"("device_id", "event_at");

-- CreateIndex
CREATE INDEX "idx_lock_log_pin" ON "smart_lock_access_log"("pin_id");

-- CreateIndex
CREATE UNIQUE INDEX "zoho_ticket_ref_zoho_ticket_id_key" ON "zoho_ticket_ref"("zoho_ticket_id");

-- CreateIndex
CREATE INDEX "idx_zoho_ticket_reservation" ON "zoho_ticket_ref"("ezee_reservation_id");

-- CreateIndex
CREATE INDEX "idx_zoho_ticket_status" ON "zoho_ticket_ref"("status");

-- AddForeignKey
ALTER TABLE "addon_order_items" ADD CONSTRAINT "addon_order_items_addon_order_id_fkey" FOREIGN KEY ("addon_order_id") REFERENCES "addon_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "addon_order_items" ADD CONSTRAINT "addon_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product_catalog"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "addon_orders" ADD CONSTRAINT "addon_orders_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "addon_orders" ADD CONSTRAINT "addon_orders_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "addon_orders" ADD CONSTRAINT "addon_orders_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_providers" ADD CONSTRAINT "auth_providers_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_guest_access" ADD CONSTRAINT "booking_guest_access_approved_by_guest_id_fkey" FOREIGN KEY ("approved_by_guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_guest_access" ADD CONSTRAINT "booking_guest_access_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_guest_access" ADD CONSTRAINT "booking_guest_access_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "borrowable_checkouts" ADD CONSTRAINT "borrowable_checkouts_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "borrowable_checkouts" ADD CONSTRAINT "borrowable_checkouts_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "borrowable_checkouts" ADD CONSTRAINT "borrowable_checkouts_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "borrowable_checkouts" ADD CONSTRAINT "fk_borrowable_issued_by" FOREIGN KEY ("issued_by_admin_id") REFERENCES "admin_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ezee_booking_cache" ADD CONSTRAINT "ezee_booking_cache_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ezee_booking_cache" ADD CONSTRAINT "ezee_booking_cache_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ezee_connection" ADD CONSTRAINT "ezee_connection_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product_catalog"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "mygate_connection" ADD CONSTRAINT "mygate_connection_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "mygate_devices" ADD CONSTRAINT "mygate_devices_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_recipient_guest_id_fkey" FOREIGN KEY ("recipient_guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "otp_logs" ADD CONSTRAINT "otp_logs_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sla_config" ADD CONSTRAINT "sla_config_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_lock_access" ADD CONSTRAINT "smart_lock_access_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "mygate_devices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_lock_access" ADD CONSTRAINT "smart_lock_access_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_lock_access" ADD CONSTRAINT "smart_lock_access_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_lock_access_log" ADD CONSTRAINT "smart_lock_access_log_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "mygate_devices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "smart_lock_access_log" ADD CONSTRAINT "smart_lock_access_log_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "smart_lock_access"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stay_extensions" ADD CONSTRAINT "stay_extensions_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stay_extensions" ADD CONSTRAINT "stay_extensions_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stay_extensions" ADD CONSTRAINT "stay_extensions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "zoho_ticket_ref" ADD CONSTRAINT "zoho_ticket_ref_addon_order_id_fkey" FOREIGN KEY ("addon_order_id") REFERENCES "addon_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "zoho_ticket_ref" ADD CONSTRAINT "zoho_ticket_ref_ezee_reservation_id_fkey" FOREIGN KEY ("ezee_reservation_id") REFERENCES "ezee_booking_cache"("ezee_reservation_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "zoho_ticket_ref" ADD CONSTRAINT "zoho_ticket_ref_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

