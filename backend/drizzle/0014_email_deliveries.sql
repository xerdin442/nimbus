CREATE TYPE "public"."email_delivery_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."email_failure_reason" AS ENUM('provider_auth', 'provider_broken', 'provider_unavailable', 'invalid_recipient', 'test_mode', 'no_longer_relevant');--> statement-breakpoint
CREATE TYPE "public"."email_type" AS ENUM('confirmation', 'cancellation', 'refund');--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"livemode" boolean NOT NULL,
	"reservation_id" uuid NOT NULL,
	"type" "email_type" NOT NULL,
	"to" text NOT NULL,
	"provider" "mail_provider",
	"provider_message_id" text,
	"status" "email_delivery_status" DEFAULT 'queued' NOT NULL,
	"failure_reason" "email_failure_reason",
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "send_test_emails_to_me" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_reservation_type_unique" ON "email_deliveries" USING btree ("reservation_id","type");--> statement-breakpoint
CREATE INDEX "email_deliveries_recent_idx" ON "email_deliveries" USING btree ("organization_id","created_at");