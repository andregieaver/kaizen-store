CREATE TABLE "commerce"."unsent_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"refund_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unsent_closures_quantity" CHECK ("commerce"."unsent_closures"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."unsent_closures" ADD CONSTRAINT "unsent_closures_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unsent_closures" ADD CONSTRAINT "unsent_closures_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unsent_closures" ADD CONSTRAINT "unsent_closures_order_line_fk" FOREIGN KEY ("store_id","order_line_id") REFERENCES "commerce"."order_lines"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unsent_closures" ADD CONSTRAINT "unsent_closures_refund_fk" FOREIGN KEY ("store_id","refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unsent_closures_order_idx" ON "commerce"."unsent_closures" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "unsent_closures_order_line_idx" ON "commerce"."unsent_closures" USING btree ("store_id","order_line_id");--> statement-breakpoint
CREATE INDEX "unsent_closures_refund_idx" ON "commerce"."unsent_closures" USING btree ("store_id","refund_id") WHERE "commerce"."unsent_closures"."refund_id" is not null;--> statement-breakpoint
CREATE INDEX "unsent_closures_created_by_idx" ON "commerce"."unsent_closures" USING btree ("created_by");