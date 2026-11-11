CREATE TABLE "commerce"."plan_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."plan_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"plan_id" uuid,
	"mode" text,
	"currency" char(3),
	"mrr_before_minor" bigint DEFAULT 0 NOT NULL,
	"mrr_after_minor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "plan_moves_kind" CHECK ("commerce"."plan_moves"."kind" in ('started', 'upgraded', 'downgraded', 'paused', 'resumed', 'cancelled')),
	CONSTRAINT "plan_moves_amounts" CHECK ("commerce"."plan_moves"."mrr_before_minor" >= 0 and "commerce"."plan_moves"."mrr_after_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."plan_moves" ADD CONSTRAINT "plan_moves_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_moves" ADD CONSTRAINT "plan_moves_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_moves_at_idx" ON "commerce"."plan_moves" USING btree ("at");--> statement-breakpoint
CREATE INDEX "plan_moves_store_idx" ON "commerce"."plan_moves" USING btree ("store_id","at");--> statement-breakpoint
CREATE INDEX "plan_moves_plan_idx" ON "commerce"."plan_moves" USING btree ("plan_id");