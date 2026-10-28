CREATE TABLE "commerce"."custom_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"endpoint_encrypted" text NOT NULL,
	"endpoint_hint" text NOT NULL,
	"token_encrypted" text,
	"token_hint" text,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"switched" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"last_called_at" timestamp with time zone,
	"listed_at" timestamp with time zone,
	"problem" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_apps_store_key" UNIQUE("store_id","key"),
	CONSTRAINT "custom_apps_name" CHECK (length(btrim("commerce"."custom_apps"."name")) between 1 and 60),
	CONSTRAINT "custom_apps_key" CHECK ("commerce"."custom_apps"."key" ~ '^[a-z0-9][a-z0-9-]{0,15}$'),
	CONSTRAINT "custom_apps_counts" CHECK ("commerce"."custom_apps"."calls" >= 0 and "commerce"."custom_apps"."failed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."custom_apps" ADD CONSTRAINT "custom_apps_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."custom_apps" ADD CONSTRAINT "custom_apps_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_apps_created_by_idx" ON "commerce"."custom_apps" USING btree ("created_by");
-- An owner's own apps for the AI manager (wave 9 unit J, D363): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."custom_apps" ENABLE ROW LEVEL SECURITY;
