CREATE TABLE "commerce"."email_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"link" text NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_clicks_link" CHECK ("commerce"."email_clicks"."link" ~ '^[a-z]{2}(-[A-Z]{2})?[.][0-9]{1,2}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."email_clicks" ADD CONSTRAINT "email_clicks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."email_clicks" ADD CONSTRAINT "email_clicks_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."marketing_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."email_clicks" ADD CONSTRAINT "email_clicks_broadcast_fk" FOREIGN KEY ("store_id","broadcast_id") REFERENCES "commerce"."broadcasts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_clicks_subscriber_idx" ON "commerce"."email_clicks" USING btree ("store_id","subscriber_id","clicked_at");--> statement-breakpoint
CREATE INDEX "email_clicks_broadcast_idx" ON "commerce"."email_clicks" USING btree ("broadcast_id","link");--> statement-breakpoint
CREATE INDEX "email_clicks_clicked_idx" ON "commerce"."email_clicks" USING btree ("clicked_at");