CREATE TABLE "commerce"."sending_pauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"reason" text NOT NULL,
	"counts" jsonb NOT NULL,
	"paused_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resumed_at" timestamp with time zone,
	"resumed_by" uuid,
	CONSTRAINT "sending_pauses_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "sending_pauses_reason" CHECK ("commerce"."sending_pauses"."reason" in ('bounces', 'complaints')),
	CONSTRAINT "sending_pauses_counts" CHECK (jsonb_typeof("commerce"."sending_pauses"."counts") = 'object'),
	CONSTRAINT "sending_pauses_resumed" CHECK ("commerce"."sending_pauses"."resumed_at" is null or "commerce"."sending_pauses"."resumed_at" >= "commerce"."sending_pauses"."paused_at")
);
--> statement-breakpoint
ALTER TABLE "commerce"."sending_pauses" ADD CONSTRAINT "sending_pauses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sending_pauses" ADD CONSTRAINT "sending_pauses_resumed_by_accounts_id_fk" FOREIGN KEY ("resumed_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sending_pauses_resumed_by_idx" ON "commerce"."sending_pauses" USING btree ("resumed_by");