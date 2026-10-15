CREATE TYPE "public"."refund_reason" AS ENUM('requested', 'showtime_cancelled', 'payment_conflict', 'duplicate_payment');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processing', 'needs_attention', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"payment_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "refund_status" NOT NULL,
	"reason" "refund_reason" NOT NULL,
	"note" text,
	"provider_refund_id" text,
	"last_error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"event_type" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"reference" text,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_configs" ADD COLUMN "broken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_transaction_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "seat_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_payment_id_unique" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_reservation_id_idx" ON "refunds" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_dedupe_unique" ON "payment_events" USING btree ("organization_id","livemode","provider","event_type","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_organization_id_livemode_reference_unique" ON "payments" USING btree ("organization_id","livemode","reference");