CREATE TABLE "commerce"."design_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_team_id" text,
	"display_name" text DEFAULT '' NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_encrypted" text,
	"scopes" text DEFAULT '' NOT NULL,
	"problem" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_connections_account_key" UNIQUE("account_id","provider"),
	CONSTRAINT "design_connections_provider" CHECK ("commerce"."design_connections"."provider" in ('canva')),
	CONSTRAINT "design_connections_ids" CHECK (char_length("commerce"."design_connections"."external_user_id") between 1 and 200 and ("commerce"."design_connections"."external_team_id" is null or char_length("commerce"."design_connections"."external_team_id") between 1 and 200)),
	CONSTRAINT "design_connections_name" CHECK (char_length("commerce"."design_connections"."display_name") <= 120),
	CONSTRAINT "design_connections_scopes" CHECK (char_length("commerce"."design_connections"."scopes") <= 1000),
	CONSTRAINT "design_connections_problem" CHECK ("commerce"."design_connections"."problem" is null or char_length("commerce"."design_connections"."problem") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."design_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."design_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"design_id" text NOT NULL,
	"source_media_id" uuid,
	"correlation_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"result_media_id" uuid,
	"returned_at" timestamp with time zone,
	"brought_at" timestamp with time zone,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_edits_provider" CHECK ("commerce"."design_edits"."provider" in ('canva')),
	CONSTRAINT "design_edits_status" CHECK ("commerce"."design_edits"."status" in ('open', 'returned', 'brought')),
	CONSTRAINT "design_edits_design" CHECK ("commerce"."design_edits"."design_id" ~ '^[A-Za-z0-9_-]{1,100}$'),
	CONSTRAINT "design_edits_correlation" CHECK ("commerce"."design_edits"."correlation_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "design_edits_problem" CHECK ("commerce"."design_edits"."problem" is null or char_length("commerce"."design_edits"."problem") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."media" DROP CONSTRAINT "media_made_by";--> statement-breakpoint
ALTER TABLE "commerce"."media" DROP CONSTRAINT "media_edited";--> statement-breakpoint
ALTER TABLE "commerce"."design_connections" ADD CONSTRAINT "design_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD CONSTRAINT "design_edits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD CONSTRAINT "design_edits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD CONSTRAINT "design_edits_source_media_id_media_id_fk" FOREIGN KEY ("source_media_id") REFERENCES "commerce"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD CONSTRAINT "design_edits_result_media_id_media_id_fk" FOREIGN KEY ("result_media_id") REFERENCES "commerce"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_edits_correlation_idx" ON "commerce"."design_edits" USING btree ("correlation_hash");--> statement-breakpoint
CREATE INDEX "design_edits_store_created_idx" ON "commerce"."design_edits" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "design_edits_account_idx" ON "commerce"."design_edits" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "design_edits_source_idx" ON "commerce"."design_edits" USING btree ("source_media_id");--> statement-breakpoint
CREATE INDEX "design_edits_result_idx" ON "commerce"."design_edits" USING btree ("result_media_id");--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_made_by" CHECK ("commerce"."media"."made_by" in ('person', 'ai_made', 'ai_edited', 'canva'));--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_edited" CHECK ("commerce"."media"."made_by" in ('ai_edited', 'canva') or "commerce"."media"."edited_from" is null);