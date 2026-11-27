-- A product can be a plan (D912): access sold only by subscription, shown in a pricing table and never on a page of its own. The kind's
-- check takes the new value, added not valid on the hot products table (D569); 20261127132028_plan_product_rules validates it.
ALTER TABLE "commerce"."products" DROP CONSTRAINT "products_kind";--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_kind" CHECK ("commerce"."products"."kind" in ('goods', 'appointment', 'stay', 'rental', 'gift_card', 'bundle', 'plan')) NOT VALID;
