CREATE TABLE "commerce"."extension_bundle_members" (
	"bundle_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	CONSTRAINT "extension_bundle_members_bundle_id_extension_id_pk" PRIMARY KEY("bundle_id","extension_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."extension_bundle_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"interval" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_bundle_prices_interval" CHECK ("commerce"."extension_bundle_prices"."interval" in ('month', 'year')),
	CONSTRAINT "extension_bundle_prices_amount" CHECK ("commerce"."extension_bundle_prices"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."extension_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "extension_bundles_name_present" CHECK (length(trim("commerce"."extension_bundles"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."extension_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"size_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"interval" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_prices_interval" CHECK ("commerce"."extension_prices"."interval" in ('month', 'year')),
	CONSTRAINT "extension_prices_amount" CHECK ("commerce"."extension_prices"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."extension_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extension_id" text NOT NULL,
	"label" text NOT NULL,
	"allowances" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "extension_sizes_extension_id" UNIQUE("extension_id","id"),
	CONSTRAINT "extension_sizes_label_present" CHECK (length(trim("commerce"."extension_sizes"."label")) > 0),
	CONSTRAINT "extension_sizes_allowances" CHECK (jsonb_typeof("commerce"."extension_sizes"."allowances") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commerce"."extensions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"standalone" boolean DEFAULT false NOT NULL,
	"store_only" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "extensions_known" CHECK ("commerce"."extensions"."id" in ('ab_testing', 'support_desk', 'email_automation', 'work', 'deals')),
	CONSTRAINT "extensions_name_present" CHECK (length(trim("commerce"."extensions"."name")) > 0),
	CONSTRAINT "extensions_standalone_needs_no_store" CHECK (not ("commerce"."extensions"."standalone" and "commerce"."extensions"."store_only"))
);
--> statement-breakpoint
CREATE TABLE "commerce"."organisation_extensions" (
	"organisation_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"source" text NOT NULL,
	"size_id" uuid,
	"bundle_id" uuid,
	"trial_ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_extensions_organisation_id_extension_id_pk" PRIMARY KEY("organisation_id","extension_id"),
	CONSTRAINT "organisation_extensions_source" CHECK ("commerce"."organisation_extensions"."source" in ('bought', 'bundle', 'trial')),
	CONSTRAINT "organisation_extensions_trial" CHECK (("commerce"."organisation_extensions"."source" = 'trial') = ("commerce"."organisation_extensions"."trial_ends_at" is not null)),
	CONSTRAINT "organisation_extensions_bundle" CHECK (("commerce"."organisation_extensions"."source" = 'bundle') = ("commerce"."organisation_extensions"."bundle_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."plan_extension_grants" (
	"plan_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"size_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_extension_grants_plan_id_extension_id_pk" PRIMARY KEY("plan_id","extension_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "extensions_launched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."extension_bundle_members" ADD CONSTRAINT "extension_bundle_members_bundle_id_extension_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "commerce"."extension_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_bundle_members" ADD CONSTRAINT "extension_bundle_members_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "commerce"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_bundle_prices" ADD CONSTRAINT "extension_bundle_prices_bundle_id_extension_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "commerce"."extension_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_bundles" ADD CONSTRAINT "extension_bundles_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_prices" ADD CONSTRAINT "extension_prices_size_id_extension_sizes_id_fk" FOREIGN KEY ("size_id") REFERENCES "commerce"."extension_sizes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_sizes" ADD CONSTRAINT "extension_sizes_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "commerce"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_sizes" ADD CONSTRAINT "extension_sizes_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extensions" ADD CONSTRAINT "extensions_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_extensions" ADD CONSTRAINT "organisation_extensions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "commerce"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_extensions" ADD CONSTRAINT "organisation_extensions_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "commerce"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_extensions" ADD CONSTRAINT "organisation_extensions_bundle_id_extension_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "commerce"."extension_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_extensions" ADD CONSTRAINT "organisation_extensions_size_fk" FOREIGN KEY ("extension_id","size_id") REFERENCES "commerce"."extension_sizes"("extension_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_extension_grants" ADD CONSTRAINT "plan_extension_grants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_extension_grants" ADD CONSTRAINT "plan_extension_grants_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "commerce"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_extension_grants" ADD CONSTRAINT "plan_extension_grants_size_fk" FOREIGN KEY ("extension_id","size_id") REFERENCES "commerce"."extension_sizes"("extension_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_bundle_members_extension_idx" ON "commerce"."extension_bundle_members" USING btree ("extension_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_bundle_prices_one_active" ON "commerce"."extension_bundle_prices" USING btree ("bundle_id","currency","interval") WHERE "commerce"."extension_bundle_prices"."active";--> statement-breakpoint
CREATE INDEX "extension_bundle_prices_bundle_idx" ON "commerce"."extension_bundle_prices" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "extension_bundles_updated_by_idx" ON "commerce"."extension_bundles" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_prices_one_active" ON "commerce"."extension_prices" USING btree ("size_id","currency","interval") WHERE "commerce"."extension_prices"."active";--> statement-breakpoint
CREATE INDEX "extension_prices_size_idx" ON "commerce"."extension_prices" USING btree ("size_id");--> statement-breakpoint
CREATE INDEX "extension_sizes_updated_by_idx" ON "commerce"."extension_sizes" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "extensions_updated_by_idx" ON "commerce"."extensions" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "organisation_extensions_extension_idx" ON "commerce"."organisation_extensions" USING btree ("extension_id","size_id");--> statement-breakpoint
CREATE INDEX "organisation_extensions_bundle_idx" ON "commerce"."organisation_extensions" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "plan_extension_grants_extension_idx" ON "commerce"."plan_extension_grants" USING btree ("extension_id","size_id");