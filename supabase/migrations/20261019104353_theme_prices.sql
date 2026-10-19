CREATE TABLE "commerce"."theme_prices" (
	"preset_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "theme_prices_preset_id_currency_pk" PRIMARY KEY("preset_id","currency"),
	CONSTRAINT "theme_prices_currency" CHECK ("commerce"."theme_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "theme_prices_amount" CHECK ("commerce"."theme_prices"."amount_minor" between 1 and 100000000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."theme_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"preset_id" uuid NOT NULL,
	"status" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"mode" text,
	"stripe_invoice_id" text,
	"invoice_number" text,
	"invoice_url" text,
	"collection" text,
	"problem" text,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"chosen_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"invoiced_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_purchases_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id"),
	CONSTRAINT "theme_purchases_status" CHECK ("commerce"."theme_purchases"."status" in ('owed', 'due', 'invoiced', 'paid', 'granted', 'cancelled', 'void')),
	CONSTRAINT "theme_purchases_currency" CHECK ("commerce"."theme_purchases"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "theme_purchases_amount" CHECK ("commerce"."theme_purchases"."amount_minor" >= 0 and ("commerce"."theme_purchases"."amount_minor" > 0 or "commerce"."theme_purchases"."status" in ('granted', 'cancelled'))),
	CONSTRAINT "theme_purchases_mode" CHECK ("commerce"."theme_purchases"."mode" is null or "commerce"."theme_purchases"."mode" in ('test', 'live')),
	CONSTRAINT "theme_purchases_collection" CHECK ("commerce"."theme_purchases"."collection" is null or "commerce"."theme_purchases"."collection" in ('card', 'invoice')),
	CONSTRAINT "theme_purchases_invoiced" CHECK (("commerce"."theme_purchases"."status" in ('invoiced', 'paid', 'void')) = ("commerce"."theme_purchases"."stripe_invoice_id" is not null) or "commerce"."theme_purchases"."status" = 'due'),
	CONSTRAINT "theme_purchases_problem" CHECK ("commerce"."theme_purchases"."problem" is null or length("commerce"."theme_purchases"."problem") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."theme_prices" ADD CONSTRAINT "theme_prices_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_prices" ADD CONSTRAINT "theme_prices_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_purchases" ADD CONSTRAINT "theme_purchases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_purchases" ADD CONSTRAINT "theme_purchases_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."theme_purchases" ADD CONSTRAINT "theme_purchases_chosen_by_accounts_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theme_prices_updated_by_idx" ON "commerce"."theme_prices" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "theme_purchases_one_idx" ON "commerce"."theme_purchases" USING btree ("store_id","preset_id") WHERE "commerce"."theme_purchases"."status" in ('owed', 'due', 'invoiced', 'paid', 'granted');--> statement-breakpoint
CREATE INDEX "theme_purchases_store_idx" ON "commerce"."theme_purchases" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "theme_purchases_preset_idx" ON "commerce"."theme_purchases" USING btree ("preset_id");--> statement-breakpoint
CREATE INDEX "theme_purchases_due_idx" ON "commerce"."theme_purchases" USING btree ("due_at") WHERE "commerce"."theme_purchases"."status" = 'due';--> statement-breakpoint
CREATE INDEX "theme_purchases_chosen_by_idx" ON "commerce"."theme_purchases" USING btree ("chosen_by");