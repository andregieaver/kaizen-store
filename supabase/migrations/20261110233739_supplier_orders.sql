CREATE TABLE "commerce"."supplier_order_lines" (
	"store_id" uuid NOT NULL,
	"supplier_order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "supplier_order_lines_supplier_order_id_order_line_id_pk" PRIMARY KEY("supplier_order_id","order_line_id"),
	CONSTRAINT "supplier_order_lines_quantity" CHECK ("commerce"."supplier_order_lines"."quantity" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."supplier_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"shipment_id" uuid,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"problem" text,
	"problem_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_orders_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "supplier_orders_state" CHECK ("commerce"."supplier_orders"."state" in ('waiting', 'sent', 'shipped', 'problem', 'cancelled')),
	CONSTRAINT "supplier_orders_token" CHECK (("commerce"."supplier_orders"."token_hash" is null) = ("commerce"."supplier_orders"."token_expires_at" is null) and ("commerce"."supplier_orders"."token_hash" is null or "commerce"."supplier_orders"."token_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "supplier_orders_problem" CHECK ("commerce"."supplier_orders"."problem" is null or length("commerce"."supplier_orders"."problem") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD COLUMN "drop_ship_wait_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_order_fk" FOREIGN KEY ("store_id","supplier_order_id") REFERENCES "commerce"."supplier_orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_line_fk" FOREIGN KEY ("store_id","order_line_id") REFERENCES "commerce"."order_lines"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_orders" ADD CONSTRAINT "supplier_orders_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_orders" ADD CONSTRAINT "supplier_orders_supplier_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "commerce"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_order_lines_line_idx" ON "commerce"."supplier_order_lines" USING btree ("store_id","order_line_id");--> statement-breakpoint
CREATE INDEX "supplier_order_lines_order_idx" ON "commerce"."supplier_order_lines" USING btree ("store_id","supplier_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_order_supplier_key" ON "commerce"."supplier_orders" USING btree ("store_id","order_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_token_key" ON "commerce"."supplier_orders" USING btree ("token_hash") WHERE "commerce"."supplier_orders"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "supplier_orders_due_idx" ON "commerce"."supplier_orders" USING btree ("send_after") WHERE "commerce"."supplier_orders"."state" = 'waiting';--> statement-breakpoint
CREATE INDEX "supplier_orders_supplier_idx" ON "commerce"."supplier_orders" USING btree ("store_id","supplier_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD CONSTRAINT "order_settings_drop_ship_wait" CHECK ("commerce"."order_settings"."drop_ship_wait_minutes" between 0 and 1440);--> statement-breakpoint
ALTER TABLE "commerce"."supplier_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_order_lines" ENABLE ROW LEVEL SECURITY;
