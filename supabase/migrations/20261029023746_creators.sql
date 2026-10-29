CREATE TABLE "commerce"."creator_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_attributions_order_key" UNIQUE("store_id","order_id"),
	CONSTRAINT "creator_attributions_status" CHECK ("commerce"."creator_attributions"."status" in ('pending', 'earned', 'reversed', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."creator_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_commissions_key" UNIQUE("store_id","idempotency_key"),
	CONSTRAINT "creator_commissions_kind" CHECK ("commerce"."creator_commissions"."kind" in ('earned', 'reversed')),
	CONSTRAINT "creator_commissions_amount" CHECK ("commerce"."creator_commissions"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."creator_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_payouts_amount" CHECK ("commerce"."creator_payouts"."amount_minor" > 0),
	CONSTRAINT "creator_payouts_reference" CHECK (char_length("commerce"."creator_payouts"."reference") <= 120)
);
--> statement-breakpoint
CREATE TABLE "commerce"."creator_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"commission_bps" integer DEFAULT 1000 NOT NULL,
	"category_bps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cookie_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "creator_settings_commission" CHECK ("commerce"."creator_settings"."commission_bps" between 0 and 5000),
	CONSTRAINT "creator_settings_categories" CHECK (jsonb_typeof("commerce"."creator_settings"."category_bps") = 'object'),
	CONSTRAINT "creator_settings_cookie" CHECK ("commerce"."creator_settings"."cookie_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "commerce"."creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"name" text NOT NULL,
	"channel_url" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"code" text,
	"commission_bps" integer,
	"consent_text" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creators_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "creators_customer_key" UNIQUE("store_id","customer_id"),
	CONSTRAINT "creators_code_key" UNIQUE("store_id","code"),
	CONSTRAINT "creators_status" CHECK ("commerce"."creators"."status" in ('applied', 'approved', 'declined', 'stopped')),
	CONSTRAINT "creators_code" CHECK ("commerce"."creators"."code" is null or "commerce"."creators"."code" ~ '^[a-z0-9]{6,16}$'),
	CONSTRAINT "creators_approved_code" CHECK ("commerce"."creators"."status" <> 'approved' or "commerce"."creators"."code" is not null),
	CONSTRAINT "creators_commission" CHECK ("commerce"."creators"."commission_bps" is null or "commerce"."creators"."commission_bps" between 0 and 5000),
	CONSTRAINT "creators_name" CHECK (char_length("commerce"."creators"."name") <= 80),
	CONSTRAINT "creators_channel" CHECK (char_length("commerce"."creators"."channel_url") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."creator_attributions" ADD CONSTRAINT "creator_attributions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_attributions" ADD CONSTRAINT "creator_attributions_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_attributions" ADD CONSTRAINT "creator_attributions_creator_fk" FOREIGN KEY ("store_id","creator_id") REFERENCES "commerce"."creators"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_commissions" ADD CONSTRAINT "creator_commissions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_commissions" ADD CONSTRAINT "creator_commissions_creator_fk" FOREIGN KEY ("store_id","creator_id") REFERENCES "commerce"."creators"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_commissions" ADD CONSTRAINT "creator_commissions_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_payouts" ADD CONSTRAINT "creator_payouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_payouts" ADD CONSTRAINT "creator_payouts_recorded_by_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_payouts" ADD CONSTRAINT "creator_payouts_creator_fk" FOREIGN KEY ("store_id","creator_id") REFERENCES "commerce"."creators"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_settings" ADD CONSTRAINT "creator_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creator_settings" ADD CONSTRAINT "creator_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creators" ADD CONSTRAINT "creators_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creators" ADD CONSTRAINT "creators_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."creators" ADD CONSTRAINT "creators_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_attributions_creator_idx" ON "commerce"."creator_attributions" USING btree ("store_id","creator_id","created_at");--> statement-breakpoint
CREATE INDEX "creator_commissions_creator_idx" ON "commerce"."creator_commissions" USING btree ("store_id","creator_id","created_at");--> statement-breakpoint
CREATE INDEX "creator_commissions_order_idx" ON "commerce"."creator_commissions" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "creator_payouts_creator_idx" ON "commerce"."creator_payouts" USING btree ("store_id","creator_id","paid_on");--> statement-breakpoint
CREATE INDEX "creator_payouts_recorded_by_idx" ON "commerce"."creator_payouts" USING btree ("recorded_by");--> statement-breakpoint
CREATE INDEX "creator_settings_updated_by_idx" ON "commerce"."creator_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "creators_decided_by_idx" ON "commerce"."creators" USING btree ("decided_by");