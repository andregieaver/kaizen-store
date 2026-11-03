CREATE TABLE "commerce"."oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"client_uri" text,
	"redirect_uris" text[] NOT NULL,
	"application_type" text,
	"secret_hash" text,
	"verified" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone,
	"fresh_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	CONSTRAINT "oauth_clients_client_id_key" UNIQUE("client_id"),
	CONSTRAINT "oauth_clients_kind" CHECK ("commerce"."oauth_clients"."kind" in ('metadata_document', 'registered', 'preregistered', 'app')),
	CONSTRAINT "oauth_clients_name" CHECK (char_length("commerce"."oauth_clients"."name") between 1 and 100),
	CONSTRAINT "oauth_clients_client_id" CHECK (char_length("commerce"."oauth_clients"."client_id") between 1 and 2000),
	CONSTRAINT "oauth_clients_redirect_uris" CHECK (cardinality("commerce"."oauth_clients"."redirect_uris") between 1 and 20),
	CONSTRAINT "oauth_clients_application_type" CHECK ("commerce"."oauth_clients"."application_type" is null or "commerce"."oauth_clients"."application_type" in ('web', 'native')),
	CONSTRAINT "oauth_clients_secret" CHECK ("commerce"."oauth_clients"."secret_hash" is null or "commerce"."oauth_clients"."kind" in ('preregistered', 'app'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"store_ids" uuid[] NOT NULL,
	"scopes" text[] NOT NULL,
	"resource" text NOT NULL,
	"access" text NOT NULL,
	"aal" text DEFAULT 'aal1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_grants_resource" CHECK ("commerce"."oauth_grants"."resource" in ('mcp')),
	CONSTRAINT "oauth_grants_access" CHECK ("commerce"."oauth_grants"."access" in ('read', 'propose', 'change')),
	CONSTRAINT "oauth_grants_aal" CHECK ("commerce"."oauth_grants"."aal" in ('aal1', 'aal2')),
	CONSTRAINT "oauth_grants_scopes" CHECK (cardinality("commerce"."oauth_grants"."scopes") between 1 and 30),
	CONSTRAINT "oauth_grants_stores" CHECK (cardinality("commerce"."oauth_grants"."store_ids") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."oauth_store_cutoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"cut_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_store_cutoffs_key" UNIQUE("store_id","account_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"family" uuid NOT NULL,
	"code_challenge" text,
	"redirect_uri" text,
	"scopes" text[],
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "oauth_tokens_kind" CHECK ("commerce"."oauth_tokens"."kind" in ('code', 'access', 'refresh')),
	CONSTRAINT "oauth_tokens_code" CHECK (("commerce"."oauth_tokens"."kind" = 'code') = ("commerce"."oauth_tokens"."code_challenge" is not null) and ("commerce"."oauth_tokens"."kind" = 'code') = ("commerce"."oauth_tokens"."redirect_uri" is not null)),
	CONSTRAINT "oauth_tokens_scopes" CHECK ("commerce"."oauth_tokens"."scopes" is null or ("commerce"."oauth_tokens"."kind" = 'access' and cardinality("commerce"."oauth_tokens"."scopes") between 1 and 30))
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" DROP CONSTRAINT "assistant_approvals_category";--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" DROP CONSTRAINT "assistant_conversations_source";--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD COLUMN "oauth_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ADD COLUMN "oauth_client_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" ADD CONSTRAINT "oauth_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "commerce"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_store_cutoffs" ADD CONSTRAINT "oauth_store_cutoffs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_store_cutoffs" ADD CONSTRAINT "oauth_store_cutoffs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_store_cutoffs" ADD CONSTRAINT "oauth_store_cutoffs_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "commerce"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_store_cutoffs" ADD CONSTRAINT "oauth_store_cutoffs_cut_by_accounts_id_fk" FOREIGN KEY ("cut_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "commerce"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_grants_account_idx" ON "commerce"."oauth_grants" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_client_idx" ON "commerce"."oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_store_ids_idx" ON "commerce"."oauth_grants" USING gin ("store_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_live_key" ON "commerce"."oauth_grants" USING btree ("account_id","client_id","resource") WHERE "commerce"."oauth_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "oauth_store_cutoffs_account_idx" ON "commerce"."oauth_store_cutoffs" USING btree ("account_id","client_id");--> statement-breakpoint
CREATE INDEX "oauth_store_cutoffs_client_idx" ON "commerce"."oauth_store_cutoffs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_store_cutoffs_cut_by_idx" ON "commerce"."oauth_store_cutoffs" USING btree ("cut_by");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant_idx" ON "commerce"."oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_idx" ON "commerce"."oauth_tokens" USING btree ("family");--> statement-breakpoint
CREATE INDEX "oauth_tokens_expires_idx" ON "commerce"."oauth_tokens" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_oauth_grant_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "commerce"."oauth_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ADD CONSTRAINT "assistant_conversations_oauth_client_id_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "commerce"."oauth_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_approvals_oauth_grant_idx" ON "commerce"."assistant_approvals" USING btree ("oauth_grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_mcp_idx" ON "commerce"."assistant_conversations" USING btree ("store_id","account_id","oauth_client_id") WHERE "commerce"."assistant_conversations"."source" = 'mcp';--> statement-breakpoint
CREATE INDEX "assistant_conversations_oauth_client_idx" ON "commerce"."assistant_conversations" USING btree ("oauth_client_id");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_category" CHECK ("commerce"."assistant_approvals"."category" in ('send', 'public', 'spend', 'domain', 'access', 'plan', 'change'));--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ADD CONSTRAINT "assistant_conversations_source" CHECK ("commerce"."assistant_conversations"."source" in ('admin', 'kaizen-life', 'mcp'));--> statement-breakpoint
-- Reached only through server code (D439): the authorization server's clients, grants, tokens (hashes only) and stores' cut-offs.
ALTER TABLE "commerce"."oauth_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."oauth_store_cutoffs" ENABLE ROW LEVEL SECURITY;
