CREATE TYPE "commerce"."payment_mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "commerce"."staff_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TABLE "commerce"."payment_credentials" (
	"provider" text NOT NULL,
	"mode" "commerce"."payment_mode" NOT NULL,
	"publishable_key" text,
	"secret_key_ciphertext" text,
	"secret_key_hint" text,
	"webhook_secret_ciphertext" text,
	"webhook_secret_hint" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "payment_credentials_provider_mode_pk" PRIMARY KEY("provider","mode")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payment_methods" (
	"market_code" char(2) NOT NULL,
	"method" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "payment_methods_market_code_method_pk" PRIMARY KEY("market_code","method")
);
--> statement-breakpoint
CREATE TABLE "commerce"."payment_providers" (
	"provider" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"active_mode" "commerce"."payment_mode" DEFAULT 'test' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "commerce"."settings_audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."settings_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"auth_user_id" uuid,
	"role" "commerce"."staff_role" DEFAULT 'admin' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "staff_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."payment_credentials" ADD CONSTRAINT "payment_credentials_provider_payment_providers_provider_fk" FOREIGN KEY ("provider") REFERENCES "commerce"."payment_providers"("provider") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_credentials" ADD CONSTRAINT "payment_credentials_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_methods" ADD CONSTRAINT "payment_methods_market_code_markets_code_fk" FOREIGN KEY ("market_code") REFERENCES "commerce"."markets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_methods" ADD CONSTRAINT "payment_methods_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_providers" ADD CONSTRAINT "payment_providers_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."settings_audit_log" ADD CONSTRAINT "settings_audit_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "commerce"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."staff" ADD CONSTRAINT "staff_invited_by_fk" FOREIGN KEY ("invited_by") REFERENCES "commerce"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_credentials_updated_by_idx" ON "commerce"."payment_credentials" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "payment_methods_updated_by_idx" ON "commerce"."payment_methods" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "payment_providers_updated_by_idx" ON "commerce"."payment_providers" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "settings_audit_log_created_idx" ON "commerce"."settings_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "settings_audit_log_staff_idx" ON "commerce"."settings_audit_log" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_idx" ON "commerce"."staff" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "staff_invited_by_idx" ON "commerce"."staff" USING btree ("invited_by");