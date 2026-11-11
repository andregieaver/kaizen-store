CREATE TABLE "commerce"."account_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"batch" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "account_recovery_codes_hash_key" UNIQUE("account_id","code_hash"),
	CONSTRAINT "account_recovery_codes_hash" CHECK ("commerce"."account_recovery_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_roles" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "store_roles_store_id_id_pk" PRIMARY KEY("store_id","id"),
	CONSTRAINT "store_roles_name" CHECK (length(btrim("commerce"."store_roles"."name")) between 1 and 60),
	CONSTRAINT "store_roles_template" CHECK ("commerce"."store_roles"."template" is null or "commerce"."store_roles"."template" in ('orders', 'products', 'marketing', 'content', 'analytics', 'read_only')),
	CONSTRAINT "store_roles_permissions" CHECK ("commerce"."store_roles"."permissions" <@ array['orders:read', 'orders:write', 'products:read', 'products:write', 'customers:read', 'customers:write', 'marketing:read', 'marketing:write', 'analytics:read', 'analytics:write', 'website:read', 'website:write', 'bookings:read', 'bookings:write', 'settings:read', 'settings:write', 'billing:read', 'staff:read']::text[])
);
--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "two_step_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "two_step_reenrol_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD COLUMN "target_type" text;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD COLUMN "target_id" text;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD COLUMN "changes" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD COLUMN "kind" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "require_two_step" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."account_recovery_codes" ADD CONSTRAINT "account_recovery_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_roles" ADD CONSTRAINT "store_roles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_roles" ADD CONSTRAINT "store_roles_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_recovery_codes_account_idx" ON "commerce"."account_recovery_codes" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_roles_name_key" ON "commerce"."store_roles" USING btree ("store_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "store_roles_template_key" ON "commerce"."store_roles" USING btree ("store_id","template") WHERE "commerce"."store_roles"."template" is not null;--> statement-breakpoint
CREATE INDEX "store_roles_created_by_idx" ON "commerce"."store_roles" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD CONSTRAINT "store_members_role_fk" FOREIGN KEY ("store_id","role_id") REFERENCES "commerce"."store_roles"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_store_area_idx" ON "commerce"."audit_log" USING btree ("store_id","area","id" desc);--> statement-breakpoint
CREATE INDEX "audit_log_store_account_idx" ON "commerce"."audit_log" USING btree ("store_id","account_id","id" desc);--> statement-breakpoint
CREATE INDEX "store_members_role_idx" ON "commerce"."store_members" USING btree ("store_id","role_id");--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD CONSTRAINT "audit_log_area" CHECK ("commerce"."audit_log"."area" is null or "commerce"."audit_log"."area" in ('orders', 'products', 'customers', 'marketing', 'analytics', 'website', 'bookings', 'settings', 'billing', 'staff', 'platform', 'account'));--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD CONSTRAINT "store_members_role_id" CHECK ("commerce"."store_members"."role_id" is null or "commerce"."store_members"."role" = 'admin');--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD CONSTRAINT "store_members_kind" CHECK ("commerce"."store_members"."kind" in ('staff', 'collaborator'));--> statement-breakpoint
ALTER TABLE "commerce"."store_members" ADD CONSTRAINT "store_members_collaborator" CHECK ("commerce"."store_members"."kind" <> 'collaborator' or ("commerce"."store_members"."role" = 'admin' and "commerce"."store_members"."expires_at" is not null));