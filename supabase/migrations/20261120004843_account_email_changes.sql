CREATE TABLE "commerce"."account_email_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"new_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "account_email_changes_account_key" UNIQUE("account_id"),
	CONSTRAINT "account_email_changes_token_key" UNIQUE("token_hash"),
	CONSTRAINT "account_email_changes_token" CHECK ("commerce"."account_email_changes"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_email_changes_email" CHECK ("commerce"."account_email_changes"."new_email" = lower(btrim("commerce"."account_email_changes"."new_email")) and length("commerce"."account_email_changes"."new_email") between 3 and 254 and "commerce"."account_email_changes"."new_email" ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
	CONSTRAINT "account_email_changes_times" CHECK ("commerce"."account_email_changes"."expires_at" > "commerce"."account_email_changes"."created_at" and ("commerce"."account_email_changes"."used_at" is null or "commerce"."account_email_changes"."used_at" >= "commerce"."account_email_changes"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "commerce"."account_email_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."account_email_changes" ADD CONSTRAINT "account_email_changes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."account_email_changes" ADD CONSTRAINT "account_email_changes_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;