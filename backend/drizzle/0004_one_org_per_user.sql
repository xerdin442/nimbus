DROP INDEX "memberships_user_id_organization_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_id_unique" ON "memberships" USING btree ("user_id");