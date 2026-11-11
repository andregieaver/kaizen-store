CREATE TABLE "commerce"."tripletex_connections" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"token_kind" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_hint" text NOT NULL,
	"company_id" bigint NOT NULL,
	"company_name" text NOT NULL,
	"company_org_number" text,
	"state" text DEFAULT 'setup' NOT NULL,
	"sync_from" date,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error_key" text,
	"last_error_at" timestamp with time zone,
	"failures_in_a_row" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "tripletex_connections_company_key" UNIQUE("mode","company_id"),
	CONSTRAINT "tripletex_connections_mode" CHECK ("commerce"."tripletex_connections"."mode" in ('test', 'live')),
	CONSTRAINT "tripletex_connections_token_kind" CHECK ("commerce"."tripletex_connections"."token_kind" in ('api_token', 'employee_token')),
	CONSTRAINT "tripletex_connections_state" CHECK ("commerce"."tripletex_connections"."state" in ('setup', 'on', 'paused', 'auth_failed')),
	CONSTRAINT "tripletex_connections_started" CHECK ("commerce"."tripletex_connections"."state" = 'setup' or "commerce"."tripletex_connections"."sync_from" is not null),
	CONSTRAINT "tripletex_connections_settings" CHECK (jsonb_typeof("commerce"."tripletex_connections"."settings") = 'object'),
	CONSTRAINT "tripletex_connections_texts" CHECK (length("commerce"."tripletex_connections"."token_hint") <= 40 and length("commerce"."tripletex_connections"."company_name") between 1 and 255 and length(coalesce("commerce"."tripletex_connections"."last_error_key", '')) <= 40),
	CONSTRAINT "tripletex_connections_failures" CHECK ("commerce"."tripletex_connections"."failures_in_a_row" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."tripletex_sync" (
	"store_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"company_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"local_id" text NOT NULL,
	"their_id" bigint,
	"their_ref" text,
	"their_version" integer,
	"external_key" text,
	"posting" integer DEFAULT 1 NOT NULL,
	"content_hash" text,
	"source_updated_at" timestamp with time zone,
	"amount_minor" bigint,
	"currency" char(3),
	"variance_minor" bigint,
	"state" text DEFAULT 'pending' NOT NULL,
	"error_key" text,
	"error_detail" text,
	"request_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tripletex_sync_store_id_mode_company_id_kind_local_id_pk" PRIMARY KEY("store_id","mode","company_id","kind","local_id"),
	CONSTRAINT "tripletex_sync_mode" CHECK ("commerce"."tripletex_sync"."mode" in ('test', 'live')),
	CONSTRAINT "tripletex_sync_kind" CHECK ("commerce"."tripletex_sync"."kind" in ('customer', 'work_invoice', 'work_credit_note', 'shop_invoice', 'shop_credit_note')),
	CONSTRAINT "tripletex_sync_state" CHECK ("commerce"."tripletex_sync"."state" in ('pending', 'sending', 'synced', 'failed', 'blocked', 'drifted', 'skipped')),
	CONSTRAINT "tripletex_sync_synced" CHECK ("commerce"."tripletex_sync"."state" <> 'synced' or "commerce"."tripletex_sync"."their_id" is not null),
	CONSTRAINT "tripletex_sync_voucher_key" CHECK ("commerce"."tripletex_sync"."kind" = 'customer' or "commerce"."tripletex_sync"."state" not in ('sending', 'synced') or "commerce"."tripletex_sync"."external_key" is not null),
	CONSTRAINT "tripletex_sync_attempts" CHECK ("commerce"."tripletex_sync"."attempts" >= 0 and "commerce"."tripletex_sync"."posting" >= 1),
	CONSTRAINT "tripletex_sync_texts" CHECK (length("commerce"."tripletex_sync"."local_id") between 1 and 80 and length(coalesce("commerce"."tripletex_sync"."external_key", '')) <= 70 and length(coalesce("commerce"."tripletex_sync"."error_key", '')) <= 40 and length(coalesce("commerce"."tripletex_sync"."error_detail", '')) <= 400 and length(coalesce("commerce"."tripletex_sync"."their_ref", '')) <= 60 and length(coalesce("commerce"."tripletex_sync"."request_id", '')) <= 100)
);
--> statement-breakpoint
ALTER TABLE "commerce"."tripletex_connections" ADD CONSTRAINT "tripletex_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."tripletex_connections" ADD CONSTRAINT "tripletex_connections_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."tripletex_sync" ADD CONSTRAINT "tripletex_sync_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tripletex_connections_updated_by_idx" ON "commerce"."tripletex_connections" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "tripletex_sync_external_key" ON "commerce"."tripletex_sync" USING btree ("store_id","mode","company_id","external_key") WHERE "commerce"."tripletex_sync"."external_key" is not null;--> statement-breakpoint
CREATE INDEX "tripletex_sync_due_idx" ON "commerce"."tripletex_sync" USING btree ("store_id","state","next_attempt_at") WHERE "commerce"."tripletex_sync"."state" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "tripletex_sync_their_idx" ON "commerce"."tripletex_sync" USING btree ("store_id","kind","their_id");--> statement-breakpoint
ALTER TABLE "commerce"."tripletex_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."tripletex_sync" ENABLE ROW LEVEL SECURITY;