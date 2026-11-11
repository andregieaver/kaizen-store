ALTER TABLE "commerce"."store_starters" ADD COLUMN "pack_key" text;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "pack_version" integer;--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD COLUMN "pack_pictures" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "store_starters_pack_key_idx" ON "commerce"."store_starters" USING btree ("pack_key");--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_pack" CHECK ("commerce"."store_starters"."pack_version" is null or ("commerce"."store_starters"."pack_key" is not null and "commerce"."store_starters"."pack_version" > 0));--> statement-breakpoint
ALTER TABLE "commerce"."store_starters" ADD CONSTRAINT "store_starters_pack_pictures" CHECK (jsonb_typeof("commerce"."store_starters"."pack_pictures") = 'object');