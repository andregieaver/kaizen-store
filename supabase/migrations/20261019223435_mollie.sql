CREATE TABLE "commerce"."checkout_providers" (
	"store_id" uuid NOT NULL,
	"mode" "commerce"."payment_mode" NOT NULL,
	"provider" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "checkout_providers_store_id_mode_pk" PRIMARY KEY("store_id","mode"),
	CONSTRAINT "checkout_providers_provider" CHECK ("commerce"."checkout_providers"."provider" in ('stripe', 'mollie'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."mollie_connections" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"organization_name" text,
	"profile_id" text NOT NULL,
	"profile_name" text,
	"scopes" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"access_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by" uuid,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mollie_connections_ids" CHECK ("commerce"."mollie_connections"."organization_id" ~ '^org_[A-Za-z0-9]+$' and "commerce"."mollie_connections"."profile_id" ~ '^pfl_[A-Za-z0-9]+$'),
	CONSTRAINT "mollie_connections_names" CHECK (("commerce"."mollie_connections"."organization_name" is null or length("commerce"."mollie_connections"."organization_name") <= 200) and ("commerce"."mollie_connections"."profile_name" is null or length("commerce"."mollie_connections"."profile_name") <= 200))
);
--> statement-breakpoint
ALTER TABLE "commerce"."payment_disputes" DROP CONSTRAINT "payment_disputes_provider";--> statement-breakpoint
ALTER TABLE "commerce"."checkout_providers" ADD CONSTRAINT "checkout_providers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_providers" ADD CONSTRAINT "checkout_providers_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."mollie_connections" ADD CONSTRAINT "mollie_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."mollie_connections" ADD CONSTRAINT "mollie_connections_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_providers_updated_by_idx" ON "commerce"."checkout_providers" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "mollie_connections_connected_by_idx" ON "commerce"."mollie_connections" USING btree ("connected_by");--> statement-breakpoint
ALTER TABLE "commerce"."payment_disputes" ADD CONSTRAINT "payment_disputes_provider" CHECK ("commerce"."payment_disputes"."provider" in ('stripe', 'mollie'));