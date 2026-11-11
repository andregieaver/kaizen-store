CREATE TABLE "commerce"."lead_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"decision" text NOT NULL,
	"deal_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_decisions_decision" CHECK ("commerce"."lead_decisions"."decision" in ('dismissed', 'deal')),
	CONSTRAINT "lead_decisions_email" CHECK ("commerce"."lead_decisions"."email" = lower(btrim("commerce"."lead_decisions"."email")) and char_length("commerce"."lead_decisions"."email") between 3 and 320)
);
--> statement-breakpoint
ALTER TABLE "commerce"."lead_decisions" ADD CONSTRAINT "lead_decisions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."lead_decisions" ADD CONSTRAINT "lead_decisions_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."lead_decisions" ADD CONSTRAINT "lead_decisions_deal_fk" FOREIGN KEY ("store_id","deal_id") REFERENCES "commerce"."deals"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_decisions_email_key" ON "commerce"."lead_decisions" USING btree ("store_id","email");--> statement-breakpoint
CREATE INDEX "lead_decisions_decided_by_idx" ON "commerce"."lead_decisions" USING btree ("decided_by");