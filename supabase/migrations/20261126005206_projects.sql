CREATE TABLE "commerce"."checklist_folds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"section_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_folds_key" UNIQUE NULLS NOT DISTINCT("store_id","checklist_id","account_id","section_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_folds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"done_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status_id" uuid,
	"assigned_to" uuid,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"all_day" boolean,
	"priority" text,
	"recurrence" jsonb,
	"next_due_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"streak" integer DEFAULT 0 NOT NULL,
	"skipped_at" timestamp with time zone,
	"blocked_reason" text,
	"blocked_by_item_id" uuid,
	"cost_minor" bigint,
	"cost_currency" char(3),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_items_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "checklist_items_title" CHECK ("commerce"."checklist_items"."title" = btrim("commerce"."checklist_items"."title") and char_length("commerce"."checklist_items"."title") between 1 and 500),
	CONSTRAINT "checklist_items_texts" CHECK (("commerce"."checklist_items"."description" is null or char_length("commerce"."checklist_items"."description") <= 10000) and ("commerce"."checklist_items"."blocked_reason" is null or char_length("commerce"."checklist_items"."blocked_reason") <= 500)),
	CONSTRAINT "checklist_items_priority" CHECK ("commerce"."checklist_items"."priority" is null or "commerce"."checklist_items"."priority" in ('low', 'medium', 'high')),
	CONSTRAINT "checklist_items_dates" CHECK ("commerce"."checklist_items"."start_at" is null or "commerce"."checklist_items"."due_at" is null or "commerce"."checklist_items"."start_at" <= "commerce"."checklist_items"."due_at"),
	CONSTRAINT "checklist_items_recurrence" CHECK ("commerce"."checklist_items"."recurrence" is null or jsonb_typeof("commerce"."checklist_items"."recurrence") = 'object'),
	CONSTRAINT "checklist_items_streak" CHECK ("commerce"."checklist_items"."streak" >= 0),
	CONSTRAINT "checklist_items_cost" CHECK (("commerce"."checklist_items"."cost_minor" is null) = ("commerce"."checklist_items"."cost_currency" is null) and ("commerce"."checklist_items"."cost_minor" is null or "commerce"."checklist_items"."cost_minor" between -100000000000 and 100000000000) and ("commerce"."checklist_items"."cost_currency" is null or "commerce"."checklist_items"."cost_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "checklist_items_not_self_blocked" CHECK ("commerce"."checklist_items"."blocked_by_item_id" is null or "commerce"."checklist_items"."blocked_by_item_id" <> "commerce"."checklist_items"."id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."checklist_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_sections_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "checklist_sections_checklist_key" UNIQUE("store_id","checklist_id","id"),
	CONSTRAINT "checklist_sections_title" CHECK ("commerce"."checklist_sections"."title" = btrim("commerce"."checklist_sections"."title") and char_length("commerce"."checklist_sections"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."checklist_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"checklist_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"colour" text DEFAULT 'neutral' NOT NULL,
	"bucket" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_statuses_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "checklist_statuses_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","checklist_id","slug"),
	CONSTRAINT "checklist_statuses_name" CHECK ("commerce"."checklist_statuses"."name" = btrim("commerce"."checklist_statuses"."name") and char_length("commerce"."checklist_statuses"."name") between 1 and 40),
	CONSTRAINT "checklist_statuses_slug" CHECK ("commerce"."checklist_statuses"."slug" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
	CONSTRAINT "checklist_statuses_colour" CHECK ("commerce"."checklist_statuses"."colour" in ('neutral', 'insight', 'positive', 'warning', 'danger', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6')),
	CONSTRAINT "checklist_statuses_bucket" CHECK ("commerce"."checklist_statuses"."bucket" in ('active', 'done', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."checklist_subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done_at" timestamp with time zone,
	"is_goal" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"all_day" boolean,
	"assigned_to" uuid,
	"status_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_subtasks_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "checklist_subtasks_title" CHECK ("commerce"."checklist_subtasks"."title" = btrim("commerce"."checklist_subtasks"."title") and char_length("commerce"."checklist_subtasks"."title") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_subtasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"all_day" boolean,
	"assigned_to" uuid,
	"primary_project_id" uuid,
	"is_routine" boolean DEFAULT false NOT NULL,
	"is_advanced" boolean DEFAULT false NOT NULL,
	"advanced_features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"goal" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklists_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "checklists_title" CHECK ("commerce"."checklists"."title" = btrim("commerce"."checklists"."title") and char_length("commerce"."checklists"."title") between 1 and 200),
	CONSTRAINT "checklists_texts" CHECK (("commerce"."checklists"."description" is null or char_length("commerce"."checklists"."description") <= 5000) and ("commerce"."checklists"."goal" is null or char_length("commerce"."checklists"."goal") <= 2000)),
	CONSTRAINT "checklists_status" CHECK ("commerce"."checklists"."status" in ('open', 'done', 'archived')),
	CONSTRAINT "checklists_features" CHECK (jsonb_typeof("commerce"."checklists"."advanced_features") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."project_checklists" (
	"store_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_checklists_store_id_project_id_checklist_id_pk" PRIMARY KEY("store_id","project_id","checklist_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."project_checklists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."project_item_stages" (
	"store_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_item_stages_store_id_project_id_item_id_pk" PRIMARY KEY("store_id","project_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."project_item_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."project_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"colour" text DEFAULT 'neutral' NOT NULL,
	"bucket" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_statuses_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "project_statuses_slug_key" UNIQUE NULLS NOT DISTINCT("store_id","project_id","slug"),
	CONSTRAINT "project_statuses_name" CHECK ("commerce"."project_statuses"."name" = btrim("commerce"."project_statuses"."name") and char_length("commerce"."project_statuses"."name") between 1 and 40),
	CONSTRAINT "project_statuses_slug" CHECK ("commerce"."project_statuses"."slug" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
	CONSTRAINT "project_statuses_colour" CHECK ("commerce"."project_statuses"."colour" in ('neutral', 'insight', 'positive', 'warning', 'danger', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6')),
	CONSTRAINT "project_statuses_bucket" CHECK ("commerce"."project_statuses"."bucket" in ('active', 'done', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."project_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"colour" text DEFAULT 'chart-1' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"health" text DEFAULT 'green' NOT NULL,
	"next_action" text,
	"target_date" date,
	"status_reviewed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "projects_name" CHECK ("commerce"."projects"."name" = btrim("commerce"."projects"."name") and char_length("commerce"."projects"."name") between 1 and 160),
	CONSTRAINT "projects_texts" CHECK (("commerce"."projects"."description" is null or char_length("commerce"."projects"."description") <= 5000) and ("commerce"."projects"."next_action" is null or char_length("commerce"."projects"."next_action") <= 500)),
	CONSTRAINT "projects_colour" CHECK ("commerce"."projects"."colour" in ('neutral', 'insight', 'positive', 'warning', 'danger', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6')),
	CONSTRAINT "projects_status" CHECK ("commerce"."projects"."status" in ('planning', 'active', 'blocked', 'done', 'archived')),
	CONSTRAINT "projects_health" CHECK ("commerce"."projects"."health" in ('green', 'amber', 'red'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" DROP CONSTRAINT "audit_log_area";--> statement-breakpoint
ALTER TABLE "commerce"."store_roles" DROP CONSTRAINT "store_roles_permissions";--> statement-breakpoint
ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_features";--> statement-breakpoint
ALTER TABLE "commerce"."checklist_folds" ADD CONSTRAINT "checklist_folds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_folds" ADD CONSTRAINT "checklist_folds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_folds" ADD CONSTRAINT "checklist_folds_checklist_fk" FOREIGN KEY ("store_id","checklist_id") REFERENCES "commerce"."checklists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_folds" ADD CONSTRAINT "checklist_folds_section_fk" FOREIGN KEY ("store_id","checklist_id","section_id") REFERENCES "commerce"."checklist_sections"("store_id","checklist_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD CONSTRAINT "checklist_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD CONSTRAINT "checklist_items_assigned_to_accounts_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD CONSTRAINT "checklist_items_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_items" ADD CONSTRAINT "checklist_items_checklist_fk" FOREIGN KEY ("store_id","checklist_id") REFERENCES "commerce"."checklists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_sections" ADD CONSTRAINT "checklist_sections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_sections" ADD CONSTRAINT "checklist_sections_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_sections" ADD CONSTRAINT "checklist_sections_checklist_fk" FOREIGN KEY ("store_id","checklist_id") REFERENCES "commerce"."checklists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_statuses" ADD CONSTRAINT "checklist_statuses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_statuses" ADD CONSTRAINT "checklist_statuses_checklist_fk" FOREIGN KEY ("store_id","checklist_id") REFERENCES "commerce"."checklists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_subtasks" ADD CONSTRAINT "checklist_subtasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_subtasks" ADD CONSTRAINT "checklist_subtasks_assigned_to_accounts_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_subtasks" ADD CONSTRAINT "checklist_subtasks_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_subtasks" ADD CONSTRAINT "checklist_subtasks_item_fk" FOREIGN KEY ("store_id","item_id") REFERENCES "commerce"."checklist_items"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklists" ADD CONSTRAINT "checklists_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklists" ADD CONSTRAINT "checklists_assigned_to_accounts_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklists" ADD CONSTRAINT "checklists_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_checklists" ADD CONSTRAINT "project_checklists_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_checklists" ADD CONSTRAINT "project_checklists_project_fk" FOREIGN KEY ("store_id","project_id") REFERENCES "commerce"."projects"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_checklists" ADD CONSTRAINT "project_checklists_checklist_fk" FOREIGN KEY ("store_id","checklist_id") REFERENCES "commerce"."checklists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_item_stages" ADD CONSTRAINT "project_item_stages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_item_stages" ADD CONSTRAINT "project_item_stages_project_fk" FOREIGN KEY ("store_id","project_id") REFERENCES "commerce"."projects"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_item_stages" ADD CONSTRAINT "project_item_stages_item_fk" FOREIGN KEY ("store_id","item_id") REFERENCES "commerce"."checklist_items"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_statuses" ADD CONSTRAINT "project_statuses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."project_statuses" ADD CONSTRAINT "project_statuses_project_fk" FOREIGN KEY ("store_id","project_id") REFERENCES "commerce"."projects"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."projects" ADD CONSTRAINT "projects_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."projects" ADD CONSTRAINT "projects_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_folds_account_idx" ON "commerce"."checklist_folds" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "checklist_items_order_idx" ON "commerce"."checklist_items" USING btree ("store_id","checklist_id","sort_order");--> statement-breakpoint
CREATE INDEX "checklist_items_status_idx" ON "commerce"."checklist_items" USING btree ("store_id","status_id") WHERE "commerce"."checklist_items"."status_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_items_blocked_by_idx" ON "commerce"."checklist_items" USING btree ("store_id","blocked_by_item_id") WHERE "commerce"."checklist_items"."blocked_by_item_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_items_due_idx" ON "commerce"."checklist_items" USING btree ("store_id","due_at") WHERE "commerce"."checklist_items"."due_at" is not null and "commerce"."checklist_items"."done_at" is null and "commerce"."checklist_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "checklist_items_next_due_idx" ON "commerce"."checklist_items" USING btree ("next_due_at") WHERE "commerce"."checklist_items"."recurrence" is not null and "commerce"."checklist_items"."next_due_at" is not null;--> statement-breakpoint
CREATE INDEX "checklist_items_assigned_idx" ON "commerce"."checklist_items" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "checklist_items_created_by_idx" ON "commerce"."checklist_items" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "checklist_sections_order_idx" ON "commerce"."checklist_sections" USING btree ("store_id","checklist_id","sort_order");--> statement-breakpoint
CREATE INDEX "checklist_sections_created_by_idx" ON "commerce"."checklist_sections" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "checklist_statuses_order_idx" ON "commerce"."checklist_statuses" USING btree ("store_id","checklist_id","sort_order");--> statement-breakpoint
CREATE INDEX "checklist_subtasks_order_idx" ON "commerce"."checklist_subtasks" USING btree ("store_id","item_id","sort_order");--> statement-breakpoint
CREATE INDEX "checklist_subtasks_status_idx" ON "commerce"."checklist_subtasks" USING btree ("store_id","status_id") WHERE "commerce"."checklist_subtasks"."status_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_subtasks_assigned_idx" ON "commerce"."checklist_subtasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "checklist_subtasks_created_by_idx" ON "commerce"."checklist_subtasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "checklists_sort_idx" ON "commerce"."checklists" USING btree ("store_id","status","sort_order");--> statement-breakpoint
CREATE INDEX "checklists_primary_project_idx" ON "commerce"."checklists" USING btree ("store_id","primary_project_id") WHERE "commerce"."checklists"."primary_project_id" is not null;--> statement-breakpoint
CREATE INDEX "checklists_assigned_idx" ON "commerce"."checklists" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "checklists_created_by_idx" ON "commerce"."checklists" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "project_checklists_checklist_idx" ON "commerce"."project_checklists" USING btree ("store_id","checklist_id");--> statement-breakpoint
CREATE INDEX "project_checklists_order_idx" ON "commerce"."project_checklists" USING btree ("store_id","project_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_item_stages_item_idx" ON "commerce"."project_item_stages" USING btree ("store_id","item_id");--> statement-breakpoint
CREATE INDEX "project_item_stages_status_idx" ON "commerce"."project_item_stages" USING btree ("store_id","status_id") WHERE "commerce"."project_item_stages"."status_id" is not null;--> statement-breakpoint
CREATE INDEX "project_statuses_order_idx" ON "commerce"."project_statuses" USING btree ("store_id","project_id","sort_order");--> statement-breakpoint
CREATE INDEX "projects_sort_idx" ON "commerce"."projects" USING btree ("store_id","status","sort_order");--> statement-breakpoint
CREATE INDEX "projects_created_by_idx" ON "commerce"."projects" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD CONSTRAINT "audit_log_area" CHECK ("commerce"."audit_log"."area" is null or "commerce"."audit_log"."area" in ('orders', 'products', 'customers', 'marketing', 'analytics', 'website', 'bookings', 'support', 'projects', 'settings', 'billing', 'staff', 'books', 'platform', 'account'));--> statement-breakpoint
ALTER TABLE "commerce"."store_roles" ADD CONSTRAINT "store_roles_permissions" CHECK ("commerce"."store_roles"."permissions" <@ array['orders:read', 'orders:write', 'products:read', 'products:write', 'customers:read', 'customers:write', 'marketing:read', 'marketing:write', 'analytics:read', 'analytics:write', 'website:read', 'website:write', 'bookings:read', 'bookings:write', 'support:read', 'support:write', 'projects:read', 'projects:write', 'settings:read', 'settings:write', 'billing:read', 'staff:read', 'books:read', 'books:write']::text[]);--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_features" CHECK ("commerce"."stores"."features" <@ array['shop', 'subscriptions', 'boxes', 'appointments', 'bookings', 'countries', 'languages', 'currencies', 'business', 'bonus', 'referrals', 'gift_cards', 'reviews', 'sales', 'projects']::text[]);