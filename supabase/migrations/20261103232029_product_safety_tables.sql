CREATE TABLE "commerce"."country_memberships" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"eu" boolean NOT NULL,
	"eea" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "country_memberships_code_upper" CHECK ("commerce"."country_memberships"."code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_safety_rules" (
	"destination" char(2) PRIMARY KEY NOT NULL,
	"responsible_person" text NOT NULL,
	"status" text NOT NULL,
	"legal_basis" text NOT NULL,
	"source" text NOT NULL,
	"reviewed_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_safety_rules_destination_upper" CHECK ("commerce"."product_safety_rules"."destination" ~ '^[A-Z]{2}$'),
	CONSTRAINT "product_safety_rules_responsible_person" CHECK ("commerce"."product_safety_rules"."responsible_person" in ('eu', 'eea', 'none')),
	CONSTRAINT "product_safety_rules_status" CHECK ("commerce"."product_safety_rules"."status" in ('in_force', 'not_incorporated', 'incorporated_not_in_force')),
	CONSTRAINT "product_safety_rules_status_none" CHECK ("commerce"."product_safety_rules"."status" = 'in_force' or "commerce"."product_safety_rules"."responsible_person" = 'none')
);

--> statement-breakpoint
ALTER TABLE "commerce"."country_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."product_safety_rules" ENABLE ROW LEVEL SECURITY;
