CREATE TABLE "commerce"."guide_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"store_id" uuid,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_progress_key" UNIQUE NULLS NOT DISTINCT("account_id","store_id"),
	CONSTRAINT "guide_progress_state" CHECK (jsonb_typeof("commerce"."guide_progress"."state") = 'object' and pg_column_size("commerce"."guide_progress"."state") < 16384)
);
--> statement-breakpoint
ALTER TABLE "commerce"."guide_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "guide_level" text;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "guide_off" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."guide_progress" ADD CONSTRAINT "guide_progress_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."guide_progress" ADD CONSTRAINT "guide_progress_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guide_progress_store_idx" ON "commerce"."guide_progress" USING btree ("store_id");--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD CONSTRAINT "accounts_guide_level" CHECK ("commerce"."accounts"."guide_level" in ('quiet', 'balanced', 'handson'));--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD CONSTRAINT "accounts_guide_off" CHECK ("commerce"."accounts"."guide_off" <@ array['spotlight', 'beacon', 'hint']::text[]);