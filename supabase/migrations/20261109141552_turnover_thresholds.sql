CREATE TABLE "commerce"."turnover_thresholds" (
	"store_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turnover_thresholds_store_id_id_pk" PRIMARY KEY("store_id","id"),
	CONSTRAINT "turnover_thresholds_amount" CHECK ("commerce"."turnover_thresholds"."amount_minor" > 0),
	CONSTRAINT "turnover_thresholds_note" CHECK (char_length(btrim("commerce"."turnover_thresholds"."note")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "commerce"."turnover_thresholds" ADD CONSTRAINT "turnover_thresholds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."turnover_thresholds" ADD CONSTRAINT "turnover_thresholds_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "turnover_thresholds_created_by_idx" ON "commerce"."turnover_thresholds" USING btree ("created_by");