ALTER TABLE "commerce"."email_clicks" ALTER COLUMN "broadcast_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."email_clicks" ADD COLUMN "flow_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."email_clicks" ADD COLUMN "step_id" text;--> statement-breakpoint
ALTER TABLE "commerce"."email_clicks" ADD CONSTRAINT "email_clicks_flow_fk" FOREIGN KEY ("store_id","flow_id") REFERENCES "commerce"."flows"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_clicks_flow_idx" ON "commerce"."email_clicks" USING btree ("flow_id","subscriber_id");--> statement-breakpoint
ALTER TABLE "commerce"."email_clicks" ADD CONSTRAINT "email_clicks_source" CHECK (("commerce"."email_clicks"."broadcast_id" is null) <> ("commerce"."email_clicks"."flow_id" is null) and ("commerce"."email_clicks"."flow_id" is null) = ("commerce"."email_clicks"."step_id" is null));