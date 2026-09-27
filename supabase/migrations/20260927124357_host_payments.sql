CREATE TABLE "commerce"."host_commissions" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"mode" "commerce"."payment_mode" NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reversed_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transfer_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_commissions_status" CHECK ("commerce"."host_commissions"."status" in ('pending', 'paid')),
	CONSTRAINT "host_commissions_amounts" CHECK ("commerce"."host_commissions"."amount_minor" >= 0 and "commerce"."host_commissions"."reversed_minor" between 0 and "commerce"."host_commissions"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "commerce"."host_stripe_accounts" (
	"host_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"mode" "commerce"."payment_mode" NOT NULL,
	"account_id" text NOT NULL,
	"card_payments" text DEFAULT 'inactive' NOT NULL,
	"requirements_due" boolean DEFAULT true NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"managed_by_kaizen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_stripe_accounts_host_id_mode_pk" PRIMARY KEY("host_id","mode"),
	CONSTRAINT "host_stripe_accounts_account_key" UNIQUE("mode","account_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "host_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "commission_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD CONSTRAINT "host_commissions_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."host_commissions" ADD CONSTRAINT "host_commissions_host_fk" FOREIGN KEY ("store_id","host_id") REFERENCES "commerce"."hosts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."host_stripe_accounts" ADD CONSTRAINT "host_stripe_accounts_host_fk" FOREIGN KEY ("store_id","host_id") REFERENCES "commerce"."hosts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_commissions_host_idx" ON "commerce"."host_commissions" USING btree ("store_id","host_id");--> statement-breakpoint
CREATE INDEX "host_commissions_due_idx" ON "commerce"."host_commissions" USING btree ("status") WHERE "commerce"."host_commissions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "host_stripe_accounts_store_idx" ON "commerce"."host_stripe_accounts" USING btree ("store_id","host_id");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_host_fk" FOREIGN KEY ("store_id","host_id") REFERENCES "commerce"."hosts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_host_idx" ON "commerce"."orders" USING btree ("store_id","host_id");