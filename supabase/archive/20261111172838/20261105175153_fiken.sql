CREATE TABLE "commerce"."fiken_connections" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"company_slug" text,
	"company_name" text,
	"company_org_number" text,
	"test_company" boolean DEFAULT false NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"access_expires_at" timestamp with time zone,
	"refresh_token_encrypted" text,
	"state" text DEFAULT 'choose' NOT NULL,
	"sync_from" date,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error_key" text,
	"last_error_at" timestamp with time zone,
	"failures_in_a_row" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "fiken_connections_state" CHECK ("commerce"."fiken_connections"."state" in ('choose', 'setup', 'on', 'paused', 'auth_failed')),
	CONSTRAINT "fiken_connections_company" CHECK ("commerce"."fiken_connections"."state" = 'choose' or ("commerce"."fiken_connections"."company_slug" is not null and "commerce"."fiken_connections"."company_name" is not null)),
	CONSTRAINT "fiken_connections_started" CHECK ("commerce"."fiken_connections"."state" in ('choose', 'setup') or "commerce"."fiken_connections"."sync_from" is not null),
	CONSTRAINT "fiken_connections_settings" CHECK (jsonb_typeof("commerce"."fiken_connections"."settings") = 'object'),
	CONSTRAINT "fiken_connections_texts" CHECK (length(coalesce("commerce"."fiken_connections"."company_slug", '')) <= 100 and length(coalesce("commerce"."fiken_connections"."company_name", '')) <= 255 and length(coalesce("commerce"."fiken_connections"."company_org_number", '')) <= 20 and length(coalesce("commerce"."fiken_connections"."last_error_key", '')) <= 40),
	CONSTRAINT "fiken_connections_failures" CHECK ("commerce"."fiken_connections"."failures_in_a_row" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."fiken_sync" (
	"store_id" uuid NOT NULL,
	"company_slug" text NOT NULL,
	"kind" text NOT NULL,
	"local_id" text NOT NULL,
	"their_id" bigint,
	"their_ref" text,
	"external_key" text,
	"posting" integer DEFAULT 1 NOT NULL,
	"content_hash" text,
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
	"attached_at" timestamp with time zone,
	"attach_tries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiken_sync_store_id_company_slug_kind_local_id_pk" PRIMARY KEY("store_id","company_slug","kind","local_id"),
	CONSTRAINT "fiken_sync_kind" CHECK ("commerce"."fiken_sync"."kind" in ('customer', 'work_invoice', 'work_credit_note', 'shop_invoice', 'shop_credit_note')),
	CONSTRAINT "fiken_sync_state" CHECK ("commerce"."fiken_sync"."state" in ('pending', 'sending', 'synced', 'failed', 'blocked', 'drifted', 'skipped')),
	CONSTRAINT "fiken_sync_synced" CHECK ("commerce"."fiken_sync"."state" <> 'synced' or "commerce"."fiken_sync"."their_id" is not null),
	CONSTRAINT "fiken_sync_sale_number" CHECK ("commerce"."fiken_sync"."kind" = 'customer' or "commerce"."fiken_sync"."state" not in ('sending', 'synced') or "commerce"."fiken_sync"."external_key" is not null),
	CONSTRAINT "fiken_sync_attempts" CHECK ("commerce"."fiken_sync"."attempts" >= 0 and "commerce"."fiken_sync"."posting" >= 1 and "commerce"."fiken_sync"."attach_tries" >= 0),
	CONSTRAINT "fiken_sync_texts" CHECK (length("commerce"."fiken_sync"."company_slug") between 1 and 100 and length("commerce"."fiken_sync"."local_id") between 1 and 80 and length(coalesce("commerce"."fiken_sync"."external_key", '')) <= 50 and length(coalesce("commerce"."fiken_sync"."error_key", '')) <= 40 and length(coalesce("commerce"."fiken_sync"."error_detail", '')) <= 400 and length(coalesce("commerce"."fiken_sync"."their_ref", '')) <= 60 and length(coalesce("commerce"."fiken_sync"."request_id", '')) <= 100)
);
--> statement-breakpoint
ALTER TABLE "commerce"."fiken_connections" ADD CONSTRAINT "fiken_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."fiken_connections" ADD CONSTRAINT "fiken_connections_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."fiken_sync" ADD CONSTRAINT "fiken_sync_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiken_connections_company_key" ON "commerce"."fiken_connections" USING btree ("company_slug");--> statement-breakpoint
CREATE INDEX "fiken_connections_updated_by_idx" ON "commerce"."fiken_connections" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "fiken_sync_external_key" ON "commerce"."fiken_sync" USING btree ("store_id","company_slug","external_key") WHERE "commerce"."fiken_sync"."external_key" is not null;--> statement-breakpoint
CREATE INDEX "fiken_sync_due_idx" ON "commerce"."fiken_sync" USING btree ("store_id","state","next_attempt_at") WHERE "commerce"."fiken_sync"."state" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "fiken_sync_attach_idx" ON "commerce"."fiken_sync" USING btree ("store_id","synced_at") WHERE "commerce"."fiken_sync"."attached_at" is null and "commerce"."fiken_sync"."state" = 'synced' and "commerce"."fiken_sync"."kind" in ('shop_invoice', 'shop_credit_note');
--> statement-breakpoint
ALTER TABLE "commerce"."fiken_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."fiken_sync" ENABLE ROW LEVEL SECURITY;
