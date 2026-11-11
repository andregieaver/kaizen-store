CREATE TABLE "commerce"."recurring_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"match_text" text NOT NULL,
	"kind" text NOT NULL,
	"vat_rate" integer NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"every" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_costs_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "recurring_costs_name" CHECK (char_length(trim("commerce"."recurring_costs"."name")) between 1 and 80),
	CONSTRAINT "recurring_costs_match_text" CHECK (char_length(trim("commerce"."recurring_costs"."match_text")) between 3 and 60),
	CONSTRAINT "recurring_costs_kind" CHECK ("commerce"."recurring_costs"."kind" ~ '^[a-z_]{2,30}$'),
	CONSTRAINT "recurring_costs_vat_rate" CHECK ("commerce"."recurring_costs"."vat_rate" in (0, 12, 15, 25) and (not "commerce"."recurring_costs"."reverse_charge" or "commerce"."recurring_costs"."vat_rate" = 0)),
	CONSTRAINT "recurring_costs_every" CHECK ("commerce"."recurring_costs"."every" in ('month', 'year')),
	CONSTRAINT "recurring_costs_amount" CHECK ("commerce"."recurring_costs"."amount_minor" > 0),
	CONSTRAINT "recurring_costs_days" CHECK ("commerce"."recurring_costs"."ended_on" is null or "commerce"."recurring_costs"."ended_on" >= "commerce"."recurring_costs"."started_on")
);
--> statement-breakpoint
ALTER TABLE "commerce"."recurring_costs" ADD CONSTRAINT "recurring_costs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."recurring_costs" ADD CONSTRAINT "recurring_costs_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_costs_store_idx" ON "commerce"."recurring_costs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "recurring_costs_created_by_idx" ON "commerce"."recurring_costs" USING btree ("created_by");