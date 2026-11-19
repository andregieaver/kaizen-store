DROP INDEX "commerce"."email_clicks_flow_idx";--> statement-breakpoint
CREATE INDEX "email_clicks_flow_idx" ON "commerce"."email_clicks" USING btree ("store_id","flow_id","subscriber_id");