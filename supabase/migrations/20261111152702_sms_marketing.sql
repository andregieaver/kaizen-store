CREATE TABLE "commerce"."sms_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"segment_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"estimate_units" bigint,
	"stop_reason" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_campaigns_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "sms_campaigns_status" CHECK ("commerce"."sms_campaigns"."status" in ('draft', 'sending', 'sent', 'stopped')),
	CONSTRAINT "sms_campaigns_stop" CHECK ("commerce"."sms_campaigns"."stop_reason" is null or "commerce"."sms_campaigns"."stop_reason" in ('staff', 'cap')),
	CONSTRAINT "sms_campaigns_texts" CHECK (char_length("commerce"."sms_campaigns"."title") between 1 and 120 and char_length("commerce"."sms_campaigns"."text") between 1 and 600)
);
--> statement-breakpoint
CREATE TABLE "commerce"."sms_consent_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."sms_consent_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"consent_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_consent_events_kind" CHECK ("commerce"."sms_consent_events"."kind" in ('requested', 'subscribed', 'unsubscribed'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"parts" integer,
	"provider_id" text,
	"cost_units" bigint,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_status" CHECK ("commerce"."sms_messages"."status" in ('queued', 'sent', 'delivered', 'failed', 'skipped')),
	CONSTRAINT "sms_messages_cost" CHECK ("commerce"."sms_messages"."cost_units" is null or "commerce"."sms_messages"."cost_units" >= 0),
	CONSTRAINT "sms_messages_error" CHECK ("commerce"."sms_messages"."error" is null or char_length("commerce"."sms_messages"."error") <= 40)
);
--> statement-breakpoint
CREATE TABLE "commerce"."sms_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"api_username" text NOT NULL,
	"api_password_encrypted" text NOT NULL,
	"currency" char(3) NOT NULL,
	"sender" text NOT NULL,
	"reply_number" text,
	"inbound_key" text NOT NULL,
	"quiet_from" integer DEFAULT 9 NOT NULL,
	"quiet_until" integer DEFAULT 20 NOT NULL,
	"monthly_cap_units" bigint DEFAULT 5000000 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_settings_sender" CHECK ("commerce"."sms_settings"."sender" ~ '^[A-Za-z][A-Za-z0-9]{0,10}$'),
	CONSTRAINT "sms_settings_reply" CHECK ("commerce"."sms_settings"."reply_number" is null or "commerce"."sms_settings"."reply_number" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "sms_settings_inbound" CHECK ("commerce"."sms_settings"."inbound_key" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "sms_settings_quiet" CHECK ("commerce"."sms_settings"."quiet_from" between 8 and 20 and "commerce"."sms_settings"."quiet_until" between 9 and 21 and "commerce"."sms_settings"."quiet_from" < "commerce"."sms_settings"."quiet_until"),
	CONSTRAINT "sms_settings_cap" CHECK ("commerce"."sms_settings"."monthly_cap_units" >= 0),
	CONSTRAINT "sms_settings_texts" CHECK (char_length("commerce"."sms_settings"."api_username") between 1 and 100 and char_length("commerce"."sms_settings"."api_password_encrypted") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."sms_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"country" char(2) NOT NULL,
	"customer_id" uuid,
	"email" text,
	"locale" text NOT NULL,
	"market_code" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"consent_text" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"unsubscribe_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_subscribers_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "sms_subscribers_status" CHECK ("commerce"."sms_subscribers"."status" in ('pending', 'subscribed', 'unsubscribed')),
	CONSTRAINT "sms_subscribers_source" CHECK ("commerce"."sms_subscribers"."source" in ('checkout', 'account')),
	CONSTRAINT "sms_subscribers_stop_source" CHECK ("commerce"."sms_subscribers"."unsubscribe_source" is null or "commerce"."sms_subscribers"."unsubscribe_source" in ('reply', 'link', 'account', 'staff', 'unreachable')),
	CONSTRAINT "sms_subscribers_phone" CHECK ("commerce"."sms_subscribers"."phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "sms_subscribers_country" CHECK ("commerce"."sms_subscribers"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "sms_subscribers_email" CHECK ("commerce"."sms_subscribers"."email" is null or ("commerce"."sms_subscribers"."email" = lower("commerce"."sms_subscribers"."email") and char_length("commerce"."sms_subscribers"."email") <= 254)),
	CONSTRAINT "sms_subscribers_token" CHECK ("commerce"."sms_subscribers"."token" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "sms_subscribers_texts" CHECK (char_length("commerce"."sms_subscribers"."consent_text") between 1 and 1000 and char_length("commerce"."sms_subscribers"."locale") <= 20)
);
--> statement-breakpoint
ALTER TABLE "commerce"."sms_campaigns" ADD CONSTRAINT "sms_campaigns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_campaigns" ADD CONSTRAINT "sms_campaigns_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_consent_events" ADD CONSTRAINT "sms_consent_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_consent_events" ADD CONSTRAINT "sms_consent_events_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."sms_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_messages" ADD CONSTRAINT "sms_messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_messages" ADD CONSTRAINT "sms_messages_campaign_fk" FOREIGN KEY ("store_id","campaign_id") REFERENCES "commerce"."sms_campaigns"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_messages" ADD CONSTRAINT "sms_messages_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."sms_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_settings" ADD CONSTRAINT "sms_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_settings" ADD CONSTRAINT "sms_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_subscribers" ADD CONSTRAINT "sms_subscribers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sms_subscribers" ADD CONSTRAINT "sms_subscribers_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_campaigns_list_idx" ON "commerce"."sms_campaigns" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_campaigns_sending_idx" ON "commerce"."sms_campaigns" USING btree ("status") WHERE "commerce"."sms_campaigns"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "sms_campaigns_created_by_idx" ON "commerce"."sms_campaigns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "sms_campaigns_segment_idx" ON "commerce"."sms_campaigns" USING btree ("store_id","segment_id");--> statement-breakpoint
CREATE INDEX "sms_consent_events_subscriber_idx" ON "commerce"."sms_consent_events" USING btree ("store_id","subscriber_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_messages_once_idx" ON "commerce"."sms_messages" USING btree ("campaign_id","subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_messages_provider_idx" ON "commerce"."sms_messages" USING btree ("store_id","provider_id");--> statement-breakpoint
CREATE INDEX "sms_messages_due_idx" ON "commerce"."sms_messages" USING btree ("send_after") WHERE "commerce"."sms_messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "sms_messages_subscriber_idx" ON "commerce"."sms_messages" USING btree ("store_id","subscriber_id");--> statement-breakpoint
CREATE INDEX "sms_messages_month_idx" ON "commerce"."sms_messages" USING btree ("store_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_settings_inbound_key" ON "commerce"."sms_settings" USING btree ("inbound_key");--> statement-breakpoint
CREATE INDEX "sms_settings_updated_by_idx" ON "commerce"."sms_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_subscribers_phone_idx" ON "commerce"."sms_subscribers" USING btree ("store_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_subscribers_token_idx" ON "commerce"."sms_subscribers" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sms_subscribers_list_idx" ON "commerce"."sms_subscribers" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sms_subscribers_customer_idx" ON "commerce"."sms_subscribers" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "sms_subscribers_email_idx" ON "commerce"."sms_subscribers" USING btree ("store_id","email");