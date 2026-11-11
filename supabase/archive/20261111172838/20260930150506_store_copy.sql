CREATE TABLE "commerce"."store_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_store_id" uuid NOT NULL,
	"new_store_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"options" jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"phase" text DEFAULT 'queued' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"media_left_out" integer DEFAULT 0 NOT NULL,
	"problem" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "store_copies_status" CHECK ("commerce"."store_copies"."status" in ('running', 'done', 'failed')),
	CONSTRAINT "store_copies_phase" CHECK ("commerce"."store_copies"."phase" in ('queued', 'content', 'media', 'people', 'orders', 'finishing', 'done')),
	CONSTRAINT "store_copies_different" CHECK ("commerce"."store_copies"."source_store_id" <> "commerce"."store_copies"."new_store_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_copy_files" (
	"copy_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"new_url" text,
	"main" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_copy_files_copy_id_source_url_pk" PRIMARY KEY("copy_id","source_url")
);
--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "copied_from" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "copied_from" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_copies" ADD CONSTRAINT "store_copies_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_copies" ADD CONSTRAINT "store_copies_new_store_id_stores_id_fk" FOREIGN KEY ("new_store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_copies" ADD CONSTRAINT "store_copies_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_copy_files" ADD CONSTRAINT "store_copy_files_copy_id_store_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "commerce"."store_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_copies_source_idx" ON "commerce"."store_copies" USING btree ("source_store_id");--> statement-breakpoint
CREATE INDEX "store_copies_new_idx" ON "commerce"."store_copies" USING btree ("new_store_id");--> statement-breakpoint
CREATE INDEX "store_copies_requested_by_idx" ON "commerce"."store_copies" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "store_copies_open_idx" ON "commerce"."store_copies" USING btree ("status","claimed_until");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_copied_from_key" ON "commerce"."customers" USING btree ("store_id","copied_from") WHERE "commerce"."customers"."copied_from" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_copied_from_key" ON "commerce"."orders" USING btree ("store_id","copied_from") WHERE "commerce"."orders"."copied_from" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_copied_number" CHECK ("commerce"."orders"."copied_from" is null or "commerce"."orders"."number" like 'C-%');