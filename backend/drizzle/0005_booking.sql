CREATE TYPE "public"."payment_method" AS ENUM('online', 'cash', 'pos');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reservation_channel" AS ENUM('api', 'box_office');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('pending', 'confirmed', 'expired', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."showtime_seat_status" AS ENUM('available', 'held', 'sold');--> statement-breakpoint
CREATE TYPE "public"."showtime_status" AS ENUM('draft', 'published', 'cancelled');--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ads_minutes" integer DEFAULT 15 NOT NULL,
	"cleanup_minutes" integer DEFAULT 15 NOT NULL,
	"hold_minutes" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "showtime_seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"showtime_id" uuid NOT NULL,
	"seat_id" uuid NOT NULL,
	"status" "showtime_seat_status" DEFAULT 'available' NOT NULL,
	"reservation_id" uuid,
	"held_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "showtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"screen_id" uuid NOT NULL,
	"movie_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cleanup_ends_at" timestamp with time zone NOT NULL,
	"status" "showtime_status" DEFAULT 'draft' NOT NULL,
	"prices" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"reservation_id" uuid NOT NULL,
	"provider" "payment_provider",
	"method" "payment_method" NOT NULL,
	"reference" text,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payment_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"code" text NOT NULL,
	"showtime_id" uuid NOT NULL,
	"status" "reservation_status" DEFAULT 'pending' NOT NULL,
	"channel" "reservation_channel" NOT NULL,
	"customer_name" text,
	"customer_email" text,
	"customer_phone" text,
	"external_customer_id" text,
	"total" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"reservation_id" uuid NOT NULL,
	"showtime_seat_id" uuid NOT NULL,
	"code" text NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_in_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtime_seats" ADD CONSTRAINT "showtime_seats_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtime_seats" ADD CONSTRAINT "showtime_seats_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtime_seats" ADD CONSTRAINT "showtime_seats_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtime_seats" ADD CONSTRAINT "showtime_seats_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_layout_id_seat_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."seat_layouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_showtime_seat_id_showtime_seats_id_fk" FOREIGN KEY ("showtime_seat_id") REFERENCES "public"."showtime_seats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checked_in_by_user_id_users_id_fk" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "showtime_seats_showtime_id_seat_id_livemode_unique" ON "showtime_seats" USING btree ("showtime_id","seat_id","livemode");--> statement-breakpoint
CREATE INDEX "showtime_seats_reservation_id_idx" ON "showtime_seats" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "showtimes_location_id_starts_at_idx" ON "showtimes" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "showtimes_screen_id_idx" ON "showtimes" USING btree ("screen_id");--> statement-breakpoint
CREATE INDEX "payments_reservation_id_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_organization_id_code_unique" ON "reservations" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "reservations_showtime_id_idx" ON "reservations" USING btree ("showtime_id");--> statement-breakpoint
CREATE INDEX "reservations_customer_email_idx" ON "reservations" USING btree ("customer_email");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_organization_id_code_unique" ON "tickets" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "tickets_reservation_id_idx" ON "tickets" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "tickets_showtime_seat_id_idx" ON "tickets" USING btree ("showtime_seat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_organization_id_livemode_key_unique" ON "idempotency_keys" USING btree ("organization_id","livemode","key");