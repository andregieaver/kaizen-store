CREATE TABLE "commerce"."checklist_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"item_id" uuid,
	"checklist_id" uuid,
	"remind_at" timestamp with time zone,
	"offset_minutes" integer,
	"recurrence" jsonb,
	"channels" text[] DEFAULT '{email,push}'::text[] NOT NULL,
	"next_at" timestamp with time zone,
	"fired_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_reminders_target" CHECK (num_nonnulls("commerce"."checklist_reminders"."item_id", "commerce"."checklist_reminders"."checklist_id") = 1),
	CONSTRAINT "checklist_reminders_when" CHECK (num_nonnulls("commerce"."checklist_reminders"."remind_at", "commerce"."checklist_reminders"."offset_minutes", "commerce"."checklist_reminders"."recurrence") = 1 and ("commerce"."checklist_reminders"."offset_minutes" is null or "commerce"."checklist_reminders"."item_id" is not null) and ("commerce"."checklist_reminders"."recurrence" is null or "commerce"."checklist_reminders"."checklist_id" is not null)),
	CONSTRAINT "checklist_reminders_offset" CHECK ("commerce"."checklist_reminders"."offset_minutes" is null or "commerce"."checklist_reminders"."offset_minutes" between 0 and 40320),
	CONSTRAINT "checklist_reminders_recurrence" CHECK ("commerce"."checklist_reminders"."recurrence" is null or jsonb_typeof("commerce"."checklist_reminders"."recurrence") = 'object'),
	CONSTRAINT "checklist_reminders_channels" CHECK (cardinality("commerce"."checklist_reminders"."channels") between 1 and 2 and "commerce"."checklist_reminders"."channels" <@ array['email', 'push']::text[])
);
--> statement-breakpoint
ALTER TABLE "commerce"."checklist_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_reminders" ADD CONSTRAINT "checklist_reminders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_reminders" ADD CONSTRAINT "checklist_reminders_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_reminders" ADD CONSTRAINT "checklist_reminders_item_fk" FOREIGN KEY ("store_id","item_id") REFERENCES "commerce"."checklist_items"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checklist_reminders" ADD CONSTRAINT "checklist_reminders_checklist_fk" FOREIGN KEY ("store_id","checklist_id") REFERENCES "commerce"."checklists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_reminders_next_idx" ON "commerce"."checklist_reminders" USING btree ("next_at") WHERE "commerce"."checklist_reminders"."next_at" is not null;--> statement-breakpoint
CREATE INDEX "checklist_reminders_item_idx" ON "commerce"."checklist_reminders" USING btree ("store_id","item_id") WHERE "commerce"."checklist_reminders"."item_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_reminders_checklist_idx" ON "commerce"."checklist_reminders" USING btree ("store_id","checklist_id") WHERE "commerce"."checklist_reminders"."checklist_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_reminders_created_by_idx" ON "commerce"."checklist_reminders" USING btree ("created_by");