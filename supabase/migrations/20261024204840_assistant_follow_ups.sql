CREATE TABLE "commerce"."assistant_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"account_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"task" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"repeat" text DEFAULT 'none' NOT NULL,
	"time_zone" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_problem" text,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_follow_ups_repeat" CHECK ("commerce"."assistant_follow_ups"."repeat" in ('none', 'daily', 'weekly')),
	CONSTRAINT "assistant_follow_ups_status" CHECK ("commerce"."assistant_follow_ups"."status" in ('waiting', 'done', 'cancelled', 'failed')),
	CONSTRAINT "assistant_follow_ups_task" CHECK (length("commerce"."assistant_follow_ups"."task") between 1 and 500),
	CONSTRAINT "assistant_follow_ups_counts" CHECK ("commerce"."assistant_follow_ups"."tries" >= 0 and "commerce"."assistant_follow_ups"."runs" >= 0),
	CONSTRAINT "assistant_follow_ups_problem" CHECK ("commerce"."assistant_follow_ups"."last_problem" is null or length("commerce"."assistant_follow_ups"."last_problem") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_follow_ups" ADD CONSTRAINT "assistant_follow_ups_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_follow_ups" ADD CONSTRAINT "assistant_follow_ups_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_follow_ups" ADD CONSTRAINT "assistant_follow_ups_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_follow_ups_due_idx" ON "commerce"."assistant_follow_ups" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "assistant_follow_ups_account_idx" ON "commerce"."assistant_follow_ups" USING btree ("account_id","store_id","status");--> statement-breakpoint
CREATE INDEX "assistant_follow_ups_conversation_idx" ON "commerce"."assistant_follow_ups" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "assistant_follow_ups_store_idx" ON "commerce"."assistant_follow_ups" USING btree ("store_id");