ALTER TABLE "commerce"."assistant_approvals" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_messages" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "assistant_learns" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_messages" ADD COLUMN "feedback" integer;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_messages" ADD CONSTRAINT "assistant_messages_feedback" CHECK ("commerce"."assistant_messages"."feedback" is null or "commerce"."assistant_messages"."feedback" in (-1, 1));