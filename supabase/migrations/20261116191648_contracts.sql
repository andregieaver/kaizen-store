CREATE TABLE "commerce"."contract_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."contract_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"signer_id" uuid,
	"kind" text NOT NULL,
	"document_sha256" text,
	"ip" text,
	"user_agent" text,
	"by_account" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_events_kind" CHECK ("commerce"."contract_events"."kind" in ('sent', 'viewed', 'code_sent', 'code_checked', 'signed', 'declined', 'reminded', 'completed', 'expired', 'cancelled')),
	CONSTRAINT "contract_events_sha" CHECK ("commerce"."contract_events"."document_sha256" is null or "commerce"."contract_events"."document_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "contract_events_agent" CHECK (("commerce"."contract_events"."ip" is null or char_length("commerce"."contract_events"."ip") <= 64) and ("commerce"."contract_events"."user_agent" is null or char_length("commerce"."contract_events"."user_agent") <= 500))
);
--> statement-breakpoint
CREATE TABLE "commerce"."contract_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"account_id" uuid,
	"token" text DEFAULT commerce.new_document_token('sig_') NOT NULL,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_name" text,
	"document_sha256" text,
	"evidence" jsonb,
	"ip" text,
	"user_agent" text,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_signers_role" CHECK ("commerce"."contract_signers"."role" in ('store', 'customer', 'other')),
	CONSTRAINT "contract_signers_position" CHECK ("commerce"."contract_signers"."position" between 0 and 9),
	CONSTRAINT "contract_signers_name" CHECK ("commerce"."contract_signers"."name" = btrim("commerce"."contract_signers"."name") and char_length("commerce"."contract_signers"."name") between 1 and 200),
	CONSTRAINT "contract_signers_email" CHECK ("commerce"."contract_signers"."email" = lower(btrim("commerce"."contract_signers"."email")) and "commerce"."contract_signers"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length("commerce"."contract_signers"."email") <= 254),
	CONSTRAINT "contract_signers_token" CHECK ("commerce"."contract_signers"."token" ~ '^sig_[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "contract_signers_once" CHECK ("commerce"."contract_signers"."signed_at" is null or "commerce"."contract_signers"."declined_at" is null),
	CONSTRAINT "contract_signers_signed" CHECK (("commerce"."contract_signers"."signed_at" is null) = ("commerce"."contract_signers"."signed_name" is null) and ("commerce"."contract_signers"."signed_at" is null) = ("commerce"."contract_signers"."document_sha256" is null) and ("commerce"."contract_signers"."signed_at" is null) = ("commerce"."contract_signers"."evidence" is null)),
	CONSTRAINT "contract_signers_signed_name" CHECK ("commerce"."contract_signers"."signed_name" is null or char_length(btrim("commerce"."contract_signers"."signed_name")) between 2 and 200),
	CONSTRAINT "contract_signers_sha" CHECK ("commerce"."contract_signers"."document_sha256" is null or "commerce"."contract_signers"."document_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "contract_signers_reason" CHECK ("commerce"."contract_signers"."decline_reason" is null or ("commerce"."contract_signers"."declined_at" is not null and char_length("commerce"."contract_signers"."decline_reason") between 1 and 500)),
	CONSTRAINT "contract_signers_agent" CHECK (("commerce"."contract_signers"."ip" is null or char_length("commerce"."contract_signers"."ip") <= 64) and ("commerce"."contract_signers"."user_agent" is null or char_length("commerce"."contract_signers"."user_agent") <= 500))
);
--> statement-breakpoint
CREATE TABLE "commerce"."contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"signing_level" text DEFAULT 'email' NOT NULL,
	"expires_days" integer DEFAULT 30 NOT NULL,
	"reminder_days" integer,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_templates_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "contract_templates_name" CHECK ("commerce"."contract_templates"."name" = btrim("commerce"."contract_templates"."name") and char_length("commerce"."contract_templates"."name") between 1 and 80),
	CONSTRAINT "contract_templates_language" CHECK ("commerce"."contract_templates"."language" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "contract_templates_blocks" CHECK (jsonb_typeof("commerce"."contract_templates"."blocks") = 'array'),
	CONSTRAINT "contract_templates_level" CHECK ("commerce"."contract_templates"."signing_level" in ('email')),
	CONSTRAINT "contract_templates_expires" CHECK ("commerce"."contract_templates"."expires_days" between 1 and 365),
	CONSTRAINT "contract_templates_reminder" CHECK ("commerce"."contract_templates"."reminder_days" is null or "commerce"."contract_templates"."reminder_days" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "commerce"."contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"customer_id" uuid,
	"company_id" uuid,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb,
	"pdf_path" text,
	"pdf_sha256" text,
	"signed_pdf_path" text,
	"signed_pdf_sha256" text,
	"signing_level" text DEFAULT 'email' NOT NULL,
	"reminder_days" integer,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"replaces_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "contracts_title" CHECK ("commerce"."contracts"."title" = btrim("commerce"."contracts"."title") and char_length("commerce"."contracts"."title") between 1 and 200),
	CONSTRAINT "contracts_language" CHECK ("commerce"."contracts"."language" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "contracts_status" CHECK ("commerce"."contracts"."status" in ('draft', 'sent', 'signed', 'declined', 'expired', 'cancelled')),
	CONSTRAINT "contracts_blocks" CHECK (jsonb_typeof("commerce"."contracts"."blocks") = 'array'),
	CONSTRAINT "contracts_level" CHECK ("commerce"."contracts"."signing_level" in ('email')),
	CONSTRAINT "contracts_reminder" CHECK ("commerce"."contracts"."reminder_days" is null or "commerce"."contracts"."reminder_days" between 1 and 60),
	CONSTRAINT "contracts_sent" CHECK (("commerce"."contracts"."status" = 'draft') = ("commerce"."contracts"."sent_at" is null) and ("commerce"."contracts"."sent_at" is null) = ("commerce"."contracts"."snapshot" is null) and ("commerce"."contracts"."sent_at" is null) = ("commerce"."contracts"."expires_at" is null)),
	CONSTRAINT "contracts_signed" CHECK (("commerce"."contracts"."status" = 'signed') = ("commerce"."contracts"."completed_at" is not null)),
	CONSTRAINT "contracts_closed" CHECK (("commerce"."contracts"."status" in ('declined', 'expired', 'cancelled')) = ("commerce"."contracts"."closed_at" is not null)),
	CONSTRAINT "contracts_pdf" CHECK (("commerce"."contracts"."pdf_path" is null) = ("commerce"."contracts"."pdf_sha256" is null) and ("commerce"."contracts"."pdf_path" is null or "commerce"."contracts"."sent_at" is not null)),
	CONSTRAINT "contracts_signed_pdf" CHECK (("commerce"."contracts"."signed_pdf_path" is null) = ("commerce"."contracts"."signed_pdf_sha256" is null) and ("commerce"."contracts"."signed_pdf_path" is null or "commerce"."contracts"."status" = 'signed')),
	CONSTRAINT "contracts_sha" CHECK (("commerce"."contracts"."pdf_sha256" is null or "commerce"."contracts"."pdf_sha256" ~ '^[0-9a-f]{64}$') and ("commerce"."contracts"."signed_pdf_sha256" is null or "commerce"."contracts"."signed_pdf_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "contracts_not_itself" CHECK ("commerce"."contracts"."replaces_id" is null or "commerce"."contracts"."replaces_id" <> "commerce"."contracts"."id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."deals" DROP CONSTRAINT "deals_closed_via";--> statement-breakpoint
ALTER TABLE "commerce"."deal_stages" ADD COLUMN "contract_stage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."contract_events" ADD CONSTRAINT "contract_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_events" ADD CONSTRAINT "contract_events_signer_id_contract_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "commerce"."contract_signers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_events" ADD CONSTRAINT "contract_events_by_account_accounts_id_fk" FOREIGN KEY ("by_account") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_events" ADD CONSTRAINT "contract_events_contract_fk" FOREIGN KEY ("store_id","contract_id") REFERENCES "commerce"."contracts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_signers" ADD CONSTRAINT "contract_signers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_signers" ADD CONSTRAINT "contract_signers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_signers" ADD CONSTRAINT "contract_signers_contract_fk" FOREIGN KEY ("store_id","contract_id") REFERENCES "commerce"."contracts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_templates" ADD CONSTRAINT "contract_templates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_templates" ADD CONSTRAINT "contract_templates_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_sent_by_accounts_id_fk" FOREIGN KEY ("sent_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_deal_fk" FOREIGN KEY ("store_id","deal_id") REFERENCES "commerce"."deals"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_template_fk" FOREIGN KEY ("store_id","template_id") REFERENCES "commerce"."contract_templates"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_replaces_fk" FOREIGN KEY ("store_id","replaces_id") REFERENCES "commerce"."contracts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_events_contract_idx" ON "commerce"."contract_events" USING btree ("store_id","contract_id","at");--> statement-breakpoint
CREATE INDEX "contract_events_signer_idx" ON "commerce"."contract_events" USING btree ("signer_id");--> statement-breakpoint
CREATE INDEX "contract_events_by_idx" ON "commerce"."contract_events" USING btree ("by_account");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_signers_token_key" ON "commerce"."contract_signers" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_signers_position_key" ON "commerce"."contract_signers" USING btree ("store_id","contract_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_signers_store_key" ON "commerce"."contract_signers" USING btree ("store_id","contract_id") WHERE "commerce"."contract_signers"."role" = 'store';--> statement-breakpoint
CREATE INDEX "contract_signers_account_idx" ON "commerce"."contract_signers" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_templates_name_key" ON "commerce"."contract_templates" USING btree ("store_id",lower("name")) WHERE "commerce"."contract_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "contract_templates_created_by_idx" ON "commerce"."contract_templates" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_replaces_key" ON "commerce"."contracts" USING btree ("store_id","replaces_id") WHERE "commerce"."contracts"."replaces_id" is not null;--> statement-breakpoint
CREATE INDEX "contracts_deal_idx" ON "commerce"."contracts" USING btree ("store_id","deal_id","created_at");--> statement-breakpoint
CREATE INDEX "contracts_customer_idx" ON "commerce"."contracts" USING btree ("store_id","customer_id") WHERE "commerce"."contracts"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "contracts_company_idx" ON "commerce"."contracts" USING btree ("store_id","company_id") WHERE "commerce"."contracts"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "contracts_template_idx" ON "commerce"."contracts" USING btree ("store_id","template_id") WHERE "commerce"."contracts"."template_id" is not null;--> statement-breakpoint
CREATE INDEX "contracts_open_idx" ON "commerce"."contracts" USING btree ("status","expires_at") WHERE "commerce"."contracts"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "contracts_sent_by_idx" ON "commerce"."contracts" USING btree ("sent_by");--> statement-breakpoint
CREATE INDEX "contracts_created_by_idx" ON "commerce"."contracts" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_stages_contract_key" ON "commerce"."deal_stages" USING btree ("store_id","pipeline_id") WHERE "commerce"."deal_stages"."contract_stage";--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_closed_via" CHECK ("commerce"."deals"."closed_via" is null or "commerce"."deals"."closed_via" in ('person', 'order', 'work_invoice', 'platform', 'contract'));