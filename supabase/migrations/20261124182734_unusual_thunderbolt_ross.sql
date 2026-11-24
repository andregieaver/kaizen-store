CREATE TABLE "commerce"."platform_legal_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review" text NOT NULL,
	"item" text NOT NULL,
	"view" text NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_legal_views_review" CHECK ("commerce"."platform_legal_views"."review" ~ '^[a-z0-9-]{1,60}$' and "commerce"."platform_legal_views"."item" ~ '^[A-Za-z0-9_-]{1,40}$'),
	CONSTRAINT "platform_legal_views_view" CHECK (char_length("commerce"."platform_legal_views"."view") between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_legal_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" DROP CONSTRAINT "accounts_platform_role";--> statement-breakpoint
ALTER TABLE "commerce"."platform_legal_views" ADD CONSTRAINT "platform_legal_views_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_legal_views_review_idx" ON "commerce"."platform_legal_views" USING btree ("review","item","created_at");--> statement-breakpoint
CREATE INDEX "platform_legal_views_account_idx" ON "commerce"."platform_legal_views" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD CONSTRAINT "accounts_platform_role" CHECK ("commerce"."accounts"."platform_role" is null or ("commerce"."accounts"."platform_role" in ('support', 'content', 'finance', 'read_only', 'legal') and not "commerce"."accounts"."platform_admin"));