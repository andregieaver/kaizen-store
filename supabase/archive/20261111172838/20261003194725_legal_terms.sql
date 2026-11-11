CREATE TABLE "commerce"."accessibility_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'not_assessed' NOT NULL,
	"assessed_by" text,
	"assessed_on" date,
	"report_url" text,
	"assessment_note" text,
	"microenterprise" boolean DEFAULT false NOT NULL,
	"known_issues" text DEFAULT '' NOT NULL,
	"contact_email" text,
	"prepared_on" date,
	"reviewed_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "accessibility_settings_status" CHECK ("commerce"."accessibility_settings"."status" in ('not_assessed', 'partial', 'full')),
	CONSTRAINT "accessibility_settings_full" CHECK ("commerce"."accessibility_settings"."status" <> 'full' or (nullif(btrim("commerce"."accessibility_settings"."assessed_by"), '') is not null and "commerce"."accessibility_settings"."assessed_on" is not null)),
	CONSTRAINT "accessibility_settings_known_issues" CHECK (length("commerce"."accessibility_settings"."known_issues") <= 4000),
	CONSTRAINT "accessibility_settings_note" CHECK ("commerce"."accessibility_settings"."assessment_note" is null or length("commerce"."accessibility_settings"."assessment_note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."legal_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"role" text NOT NULL,
	"locale" text NOT NULL,
	"page_id" uuid,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_snapshots_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "legal_snapshots_text_key" UNIQUE("store_id","role","locale","content_hash"),
	CONSTRAINT "legal_snapshots_role" CHECK ("commerce"."legal_snapshots"."role" in ('terms', 'privacy', 'returns_policy', 'shipping_policy', 'withdrawal_info', 'imprint', 'accessibility')),
	CONSTRAINT "legal_snapshots_hash" CHECK ("commerce"."legal_snapshots"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_terms" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locale" text NOT NULL,
	"snapshots" jsonb NOT NULL,
	CONSTRAINT "order_terms_mode" CHECK ("commerce"."order_terms"."mode" in ('link', 'checkbox')),
	CONSTRAINT "order_terms_snapshots" CHECK (jsonb_typeof("commerce"."order_terms"."snapshots") = 'array' and jsonb_array_length("commerce"."order_terms"."snapshots") between 1 and 2)
);
--> statement-breakpoint
ALTER TABLE "commerce"."page_roles" DROP CONSTRAINT "page_roles_role";--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "terms_at_checkout" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."accessibility_settings" ADD CONSTRAINT "accessibility_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."accessibility_settings" ADD CONSTRAINT "accessibility_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."legal_snapshots" ADD CONSTRAINT "legal_snapshots_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_terms" ADD CONSTRAINT "order_terms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_terms" ADD CONSTRAINT "order_terms_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accessibility_settings_updated_by_idx" ON "commerce"."accessibility_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "legal_snapshots_store_idx" ON "commerce"."legal_snapshots" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "order_terms_store_idx" ON "commerce"."order_terms" USING btree ("store_id","accepted_at");--> statement-breakpoint
ALTER TABLE "commerce"."page_roles" ADD CONSTRAINT "page_roles_role" CHECK ("commerce"."page_roles"."role" in ('blog', 'search', 'not_found', 'cart', 'checkout', 'order', 'account', 'sign_in', 'wishlist', 'subscription', 'deliveries', 'cookies', 'category', 'tag', 'terms', 'privacy', 'returns_policy', 'shipping_policy', 'withdrawal_info', 'imprint', 'accessibility'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_terms_at_checkout" CHECK ("commerce"."stores"."terms_at_checkout" in ('link', 'checkbox', 'off'));