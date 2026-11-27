ALTER TABLE "commerce"."guide_progress" DROP CONSTRAINT "guide_progress_key";--> statement-breakpoint
ALTER TABLE "commerce"."guide_progress" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "commerce"."guide_progress" ADD CONSTRAINT "guide_progress_key" UNIQUE NULLS NOT DISTINCT("account_id","store_id","level");--> statement-breakpoint
ALTER TABLE "commerce"."guide_progress" ADD CONSTRAINT "guide_progress_level" CHECK ("commerce"."guide_progress"."level" is null or ("commerce"."guide_progress"."level" = 'owner' and "commerce"."guide_progress"."store_id" is null));