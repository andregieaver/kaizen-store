CREATE TABLE "commerce"."feed_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token" text NOT NULL,
	"on" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_settings_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "feed_settings_hash" CHECK ("commerce"."feed_settings"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."feed_settings" ADD CONSTRAINT "feed_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;