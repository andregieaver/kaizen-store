CREATE TABLE "commerce"."api_app_idempotency_keys" (
	"grant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_app_idempotency_keys_grant_id_key_pk" PRIMARY KEY("grant_id","key"),
	CONSTRAINT "api_app_idempotency_keys_key" CHECK (char_length("commerce"."api_app_idempotency_keys"."key") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "commerce"."apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"developer_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"homepage_url" text,
	"privacy_url" text,
	"support_email" text,
	"scopes" text[] NOT NULL,
	"webhook_url_encrypted" text,
	"webhook_hint" text,
	"webhook_secret_encrypted" text,
	"webhook_topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"distribution" text DEFAULT 'private' NOT NULL,
	"listing" text,
	"listing_note" text,
	"listing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_client_key" UNIQUE("client_id"),
	CONSTRAINT "apps_description" CHECK (char_length("commerce"."apps"."description") <= 500),
	CONSTRAINT "apps_scopes" CHECK (cardinality("commerce"."apps"."scopes") between 1 and 40),
	CONSTRAINT "apps_topics" CHECK (cardinality("commerce"."apps"."webhook_topics") <= 40),
	CONSTRAINT "apps_distribution" CHECK ("commerce"."apps"."distribution" in ('private', 'unlisted', 'listed')),
	CONSTRAINT "apps_listing" CHECK ("commerce"."apps"."listing" is null or "commerce"."apps"."listing" in ('requested', 'approved', 'declined')),
	CONSTRAINT "apps_webhook" CHECK (("commerce"."apps"."webhook_url_encrypted" is null) = ("commerce"."apps"."webhook_hint" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."developers" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" DROP CONSTRAINT "oauth_grants_resource";--> statement-breakpoint
ALTER TABLE "commerce"."webhook_endpoints" DROP CONSTRAINT "webhook_endpoints_reason";--> statement-breakpoint
DROP INDEX "commerce"."oauth_grants_live_key";--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" ADD COLUMN "store_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."webhook_endpoints" ADD COLUMN "app_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."api_app_idempotency_keys" ADD CONSTRAINT "api_app_idempotency_keys_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "commerce"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."apps" ADD CONSTRAINT "apps_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "commerce"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."apps" ADD CONSTRAINT "apps_developer_id_accounts_id_fk" FOREIGN KEY ("developer_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."developers" ADD CONSTRAINT "developers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_app_idempotency_keys_created_idx" ON "commerce"."api_app_idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "apps_developer_idx" ON "commerce"."apps" USING btree ("developer_id");--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" ADD CONSTRAINT "oauth_grants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_app_grant_id_oauth_grants_id_fk" FOREIGN KEY ("app_grant_id") REFERENCES "commerce"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_app_store_key" ON "commerce"."oauth_grants" USING btree ("client_id","store_id") WHERE "commerce"."oauth_grants"."revoked_at" is null and "commerce"."oauth_grants"."resource" = 'admin';--> statement-breakpoint
CREATE INDEX "oauth_grants_store_idx" ON "commerce"."oauth_grants" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_app_grant_key" ON "commerce"."webhook_endpoints" USING btree ("app_grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_live_key" ON "commerce"."oauth_grants" USING btree ("account_id","client_id","resource") WHERE "commerce"."oauth_grants"."revoked_at" is null and "commerce"."oauth_grants"."resource" = 'mcp';--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" ADD CONSTRAINT "oauth_grants_installation" CHECK (("commerce"."oauth_grants"."resource" = 'admin') = ("commerce"."oauth_grants"."store_id" is not null) and ("commerce"."oauth_grants"."store_id" is null or "commerce"."oauth_grants"."store_ids" = array["commerce"."oauth_grants"."store_id"]));--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" ADD CONSTRAINT "oauth_grants_resource" CHECK ("commerce"."oauth_grants"."resource" in ('mcp', 'admin'));--> statement-breakpoint
ALTER TABLE "commerce"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_reason" CHECK ("commerce"."webhook_endpoints"."disabled_reason" is null or "commerce"."webhook_endpoints"."disabled_reason" in ('failing', 'owner', 'uninstalled'));--> statement-breakpoint
-- Apps for many stores (wave 14 unit D, D441): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."developers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."apps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."api_app_idempotency_keys" ENABLE ROW LEVEL SECURITY;
