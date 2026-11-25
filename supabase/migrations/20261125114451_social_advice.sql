CREATE TABLE "commerce"."social_advice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"facts" jsonb NOT NULL,
	"advice" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_advice_size" CHECK (octet_length("commerce"."social_advice"."facts"::text) < 100000 and octet_length("commerce"."social_advice"."advice"::text) < 50000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."social_advice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."social_advice" ADD CONSTRAINT "social_advice_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."social_advice" ADD CONSTRAINT "social_advice_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_advice_list_idx" ON "commerce"."social_advice" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "social_advice_created_by_idx" ON "commerce"."social_advice" USING btree ("created_by");