ALTER TABLE "commerce"."media" DROP CONSTRAINT "media_kind";--> statement-breakpoint
ALTER TABLE "commerce"."product_media" ADD COLUMN "kind" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."product_media" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "commerce"."product_media" ADD COLUMN "media_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_kind" CHECK ("commerce"."media"."kind" in ('image', 'video', 'model'));--> statement-breakpoint
ALTER TABLE "commerce"."product_media" ADD CONSTRAINT "product_media_kind" CHECK (case "commerce"."product_media"."kind"
        when 'image' then "commerce"."product_media"."source" is null and "commerce"."product_media"."media_url" is null
        when 'video' then "commerce"."product_media"."source" in ('upload', 'youtube', 'vimeo') and "commerce"."product_media"."media_url" is not null
        when 'model' then "commerce"."product_media"."source" is null and "commerce"."product_media"."media_url" is not null
        else false end);