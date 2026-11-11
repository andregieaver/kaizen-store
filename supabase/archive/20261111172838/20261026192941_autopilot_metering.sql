ALTER TABLE "commerce"."ai_usage" ADD COLUMN "acted_by" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."page_ai_jobs" ADD COLUMN "acted_by" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."page_looks" ADD COLUMN "acted_by" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_usage_autopilot_idx" ON "commerce"."ai_usage" USING btree ("store_id","created_at") WHERE "commerce"."ai_usage"."acted_by" = 'autopilot';--> statement-breakpoint
ALTER TABLE "commerce"."ai_usage" ADD CONSTRAINT "ai_usage_acted_by" CHECK ("commerce"."ai_usage"."acted_by" in ('person', 'ai_manager', 'autopilot'));--> statement-breakpoint
ALTER TABLE "commerce"."page_ai_jobs" ADD CONSTRAINT "page_ai_jobs_acted_by" CHECK ("commerce"."page_ai_jobs"."acted_by" in ('person', 'ai_manager', 'autopilot'));--> statement-breakpoint
ALTER TABLE "commerce"."page_looks" ADD CONSTRAINT "page_looks_acted_by" CHECK ("commerce"."page_looks"."acted_by" in ('person', 'ai_manager', 'autopilot'));