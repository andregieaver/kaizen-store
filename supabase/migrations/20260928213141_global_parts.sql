ALTER TABLE "commerce"."saved_parts" ADD COLUMN "global" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD CONSTRAINT "saved_parts_translations" CHECK (jsonb_typeof("commerce"."saved_parts"."translations") = 'object');