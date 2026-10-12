ALTER TABLE "showtime_seats" DROP CONSTRAINT "showtime_seats_showtime_id_showtimes_id_fk";
--> statement-breakpoint
ALTER TABLE "showtimes" DROP CONSTRAINT "showtimes_movie_id_movies_id_fk";
--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_showtime_id_showtimes_id_fk";
--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "livemode" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "showtimes" ADD COLUMN "livemode" boolean NOT NULL;--> statement-breakpoint
-- The composite foreign keys below need these unique targets to exist first.
ALTER TABLE "movies" ADD CONSTRAINT "movies_id_livemode_unique" UNIQUE("id","livemode");--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_id_livemode_unique" UNIQUE("id","livemode");--> statement-breakpoint
ALTER TABLE "showtime_seats" ADD CONSTRAINT "showtime_seats_showtime_id_livemode_showtimes_fk" FOREIGN KEY ("showtime_id","livemode") REFERENCES "public"."showtimes"("id","livemode") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_movie_id_livemode_movies_fk" FOREIGN KEY ("movie_id","livemode") REFERENCES "public"."movies"("id","livemode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_showtime_id_livemode_showtimes_fk" FOREIGN KEY ("showtime_id","livemode") REFERENCES "public"."showtimes"("id","livemode") ON DELETE cascade ON UPDATE no action;
