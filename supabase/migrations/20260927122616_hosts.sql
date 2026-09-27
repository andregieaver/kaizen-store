CREATE TABLE "commerce"."hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"commission_bps" integer DEFAULT 1500 NOT NULL,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"invited_by" uuid,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hosts_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "hosts_store_account_key" UNIQUE("store_id","account_id"),
	CONSTRAINT "hosts_name" CHECK (length("commerce"."hosts"."name") between 1 and 120),
	CONSTRAINT "hosts_commission" CHECK ("commerce"."hosts"."commission_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_slug_not_reserved";--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD COLUMN "host_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "host_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."hosts" ADD CONSTRAINT "hosts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."hosts" ADD CONSTRAINT "hosts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."hosts" ADD CONSTRAINT "hosts_invited_by_accounts_id_fk" FOREIGN KEY ("invited_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hosts_account_idx" ON "commerce"."hosts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "hosts_invited_by_idx" ON "commerce"."hosts" USING btree ("invited_by");--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD CONSTRAINT "booking_resources_host_fk" FOREIGN KEY ("store_id","host_id") REFERENCES "commerce"."hosts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_host_fk" FOREIGN KEY ("store_id","host_id") REFERENCES "commerce"."hosts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_resources_host_idx" ON "commerce"."booking_resources" USING btree ("store_id","host_id");--> statement-breakpoint
CREATE INDEX "products_host_idx" ON "commerce"."products" USING btree ("store_id","host_id");--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_slug_not_reserved" CHECK ("commerce"."stores"."slug" not in ('account', 'admin', 'api', 'app', 'auth', 'forgot-password', 'help', 'hosting', 'mail', 'platform', 'setup', 'sign-in', 'sign-up', 'status', 'stores', 'support', 'www'));