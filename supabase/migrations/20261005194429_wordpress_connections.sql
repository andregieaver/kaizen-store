CREATE TABLE "commerce"."wordpress_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"site_url" text NOT NULL,
	"site_name" text,
	"code_hash" text,
	"code_challenge" text,
	"code_expires_at" timestamp with time zone,
	"token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "wordpress_connections_site" CHECK (length("commerce"."wordpress_connections"."site_url") <= 300 and ("commerce"."wordpress_connections"."site_name" is null or length("commerce"."wordpress_connections"."site_name") <= 120))
);
--> statement-breakpoint
ALTER TABLE "commerce"."wordpress_connections" ADD CONSTRAINT "wordpress_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wordpress_connections_code_idx" ON "commerce"."wordpress_connections" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "wordpress_connections_token_idx" ON "commerce"."wordpress_connections" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "wordpress_connections_account_idx" ON "commerce"."wordpress_connections" USING btree ("account_id");