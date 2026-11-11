CREATE TABLE "commerce"."einvoice_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"state" text NOT NULL,
	"problem" text,
	"access_point" text,
	"message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einvoice_sends_document_key" UNIQUE("store_id","document_type","document_id"),
	CONSTRAINT "einvoice_sends_type" CHECK ("commerce"."einvoice_sends"."document_type" in ('invoice', 'credit_note', 'work_invoice', 'work_credit_note')),
	CONSTRAINT "einvoice_sends_state" CHECK ("commerce"."einvoice_sends"."state" in ('pending', 'sent', 'delivered', 'refused', 'failed', 'waiting', 'not_receiver', 'not_valid')),
	CONSTRAINT "einvoice_sends_sent" CHECK ("commerce"."einvoice_sends"."state" not in ('sent', 'delivered') or ("commerce"."einvoice_sends"."access_point" is not null and "commerce"."einvoice_sends"."message_id" is not null and "commerce"."einvoice_sends"."sent_at" is not null)),
	CONSTRAINT "einvoice_sends_problem" CHECK ("commerce"."einvoice_sends"."state" not in ('refused', 'failed', 'not_valid') or "commerce"."einvoice_sends"."problem" is not null),
	CONSTRAINT "einvoice_sends_attempts" CHECK ("commerce"."einvoice_sends"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."peppol_receivers" (
	"participant" text PRIMARY KEY NOT NULL,
	"invoice" boolean NOT NULL,
	"credit_note" boolean NOT NULL,
	"problem" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peppol_receivers_participant" CHECK ("commerce"."peppol_receivers"."participant" ~ '^[0-9]{4}:[0-9A-Za-z]{1,50}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."einvoice_sends" ADD CONSTRAINT "einvoice_sends_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_sends_message_key" ON "commerce"."einvoice_sends" USING btree ("access_point","message_id") WHERE "commerce"."einvoice_sends"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "einvoice_sends_due_idx" ON "commerce"."einvoice_sends" USING btree ("next_attempt_at") WHERE "commerce"."einvoice_sends"."state" in ('pending', 'failed');--> statement-breakpoint
ALTER TABLE "commerce"."einvoice_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."peppol_receivers" ENABLE ROW LEVEL SECURITY;
