CREATE TABLE "commerce"."shipping_carriers" (
	"store_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"environment" text DEFAULT 'test' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_encrypted" text,
	"secret_hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "shipping_carriers_store_id_carrier_pk" PRIMARY KEY("store_id","carrier"),
	CONSTRAINT "shipping_carriers_carrier" CHECK ("commerce"."shipping_carriers"."carrier" in ('bring', 'postnord', 'porterbuddy', 'helthjem')),
	CONSTRAINT "shipping_carriers_environment" CHECK ("commerce"."shipping_carriers"."environment" in ('test', 'live'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD CONSTRAINT "shipping_carriers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD CONSTRAINT "shipping_carriers_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipping_carriers_updated_by_idx" ON "commerce"."shipping_carriers" USING btree ("updated_by");