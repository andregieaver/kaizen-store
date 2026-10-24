ALTER TABLE "commerce"."assistant_follow_ups" ADD COLUMN "origin" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_follow_ups" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_follow_ups" ADD CONSTRAINT "assistant_follow_ups_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_follow_ups_rule_idx" ON "commerce"."assistant_follow_ups" USING btree ("store_id","created_at") WHERE "commerce"."assistant_follow_ups"."origin" = 'rule';--> statement-breakpoint
CREATE INDEX "assistant_follow_ups_order_idx" ON "commerce"."assistant_follow_ups" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_follow_ups" ADD CONSTRAINT "assistant_follow_ups_origin" CHECK ("commerce"."assistant_follow_ups"."origin" in ('person', 'rule'));