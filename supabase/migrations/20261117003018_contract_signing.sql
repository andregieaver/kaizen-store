CREATE TABLE "commerce"."contract_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_codes_hash" CHECK ("commerce"."contract_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "contract_codes_attempts" CHECK ("commerce"."contract_codes"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "commerce"."contract_seals" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"certificate_pem" text NOT NULL,
	"key_encrypted" text NOT NULL,
	"fingerprint" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_seals_one" CHECK ("commerce"."contract_seals"."id" = 1),
	CONSTRAINT "contract_seals_fingerprint" CHECK ("commerce"."contract_seals"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."contract_signers" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."contract_signers" ADD COLUMN "reminders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD COLUMN "signed_pdf_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD COLUMN "signed_pdf_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."contract_codes" ADD CONSTRAINT "contract_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."contract_codes" ADD CONSTRAINT "contract_codes_signer_id_contract_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "commerce"."contract_signers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_codes_signer_idx" ON "commerce"."contract_codes" USING btree ("signer_id","created_at");--> statement-breakpoint
CREATE INDEX "contract_codes_store_idx" ON "commerce"."contract_codes" USING btree ("store_id");--> statement-breakpoint
ALTER TABLE "commerce"."contracts" ADD CONSTRAINT "contracts_deal" CHECK ("commerce"."contracts"."deal_id" is not null or "commerce"."contracts"."status" = 'signed');--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders', 'carrier_labels', 'sandboxes', 'recordings', 'contracts'));