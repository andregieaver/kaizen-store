CREATE TABLE "commerce"."abandoned_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"order_id" uuid,
	"email" text,
	"market_code" char(2) NOT NULL,
	"locale" text NOT NULL,
	"currency" char(3) NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"token" text NOT NULL,
	"captured_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_delay_minutes" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"recovered_at" timestamp with time zone,
	"recovered_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abandoned_checkouts_token_unique" UNIQUE("token"),
	CONSTRAINT "abandoned_checkouts_cart_key" UNIQUE("store_id","cart_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."cart_reminder_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"delay_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"discount_code_id" uuid,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_reminder_steps_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "cart_reminder_steps_delay" CHECK ("commerce"."cart_reminder_steps"."delay_minutes" between 30 and 43200)
);
--> statement-breakpoint
CREATE TABLE "commerce"."email_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "cart_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."abandoned_checkouts" ADD CONSTRAINT "abandoned_checkouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cart_reminder_steps" ADD CONSTRAINT "cart_reminder_steps_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."email_opt_outs" ADD CONSTRAINT "email_opt_outs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abandoned_checkouts_due_idx" ON "commerce"."abandoned_checkouts" USING btree ("captured_at") WHERE "commerce"."abandoned_checkouts"."recovered_at" is null and "commerce"."abandoned_checkouts"."opted_out_at" is null and "commerce"."abandoned_checkouts"."email" is not null;--> statement-breakpoint
CREATE INDEX "abandoned_checkouts_email_idx" ON "commerce"."abandoned_checkouts" USING btree ("store_id",lower("email"));--> statement-breakpoint
CREATE INDEX "abandoned_checkouts_store_idx" ON "commerce"."abandoned_checkouts" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "cart_reminder_steps_store_idx" ON "commerce"."cart_reminder_steps" USING btree ("store_id","delay_minutes");--> statement-breakpoint
CREATE UNIQUE INDEX "email_opt_outs_email_idx" ON "commerce"."email_opt_outs" USING btree ("store_id",lower("email"));