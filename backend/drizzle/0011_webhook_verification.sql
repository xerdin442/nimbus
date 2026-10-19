ALTER TYPE "public"."payment_method" ADD VALUE 'verification';--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "reservation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_configs" ADD COLUMN "is_webhook_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_configs" ADD COLUMN "webhook_verified_at" timestamp with time zone;