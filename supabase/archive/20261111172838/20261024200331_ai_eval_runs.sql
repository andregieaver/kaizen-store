CREATE TABLE "commerce"."ai_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"passed" integer NOT NULL,
	"total" integer NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"ran_by" uuid,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_eval_runs_suite" CHECK ("commerce"."ai_eval_runs"."suite" in ('agents')),
	CONSTRAINT "ai_eval_runs_counts" CHECK ("commerce"."ai_eval_runs"."passed" >= 0 and "commerce"."ai_eval_runs"."passed" <= "commerce"."ai_eval_runs"."total" and "commerce"."ai_eval_runs"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_ran_by_accounts_id_fk" FOREIGN KEY ("ran_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_eval_runs_ran_idx" ON "commerce"."ai_eval_runs" USING btree ("suite","ran_at");