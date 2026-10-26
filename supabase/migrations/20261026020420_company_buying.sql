CREATE TABLE "commerce"."company_location_buyers" (
	"store_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_location_buyers_pk" PRIMARY KEY("location_id","customer_id"),
	CONSTRAINT "company_location_buyers_role" CHECK ("commerce"."company_location_buyers"."role" in ('orderer', 'approver'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."company_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"billing_address" jsonb,
	"shipping_address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_locations_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "company_locations_name" CHECK (char_length("commerce"."company_locations"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "company_location_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD COLUMN "po_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD COLUMN "approval_limit_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD COLUMN "approval_currency" char(3);--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "company_location_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "approval" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "approval_decided_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "approval_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."company_location_buyers" ADD CONSTRAINT "company_location_buyers_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."company_locations"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."company_location_buyers" ADD CONSTRAINT "company_location_buyers_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."company_locations" ADD CONSTRAINT "company_locations_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_location_buyers_customer_idx" ON "commerce"."company_location_buyers" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_locations_name_idx" ON "commerce"."company_locations" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE INDEX "orders_approval_idx" ON "commerce"."orders" USING btree ("store_id","approval") WHERE "commerce"."orders"."approval" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_po_number" CHECK ("commerce"."carts"."po_number" is null or char_length("commerce"."carts"."po_number") between 1 and 40);--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD CONSTRAINT "customer_companies_approval" CHECK (("commerce"."customer_companies"."approval_limit_minor" is null) = ("commerce"."customer_companies"."approval_currency" is null) and ("commerce"."customer_companies"."approval_limit_minor" is null or "commerce"."customer_companies"."approval_limit_minor" > 0));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_po_number" CHECK ("commerce"."orders"."po_number" is null or char_length("commerce"."orders"."po_number") between 1 and 40);--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_approval" CHECK ("commerce"."orders"."approval" is null or "commerce"."orders"."approval" in ('waiting', 'approved', 'declined'));