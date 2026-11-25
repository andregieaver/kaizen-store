CREATE TABLE "commerce"."plugin_sign_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"read_hash" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"store_id" uuid,
	"account_id" uuid,
	"token_sealed" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_sign_ins_tool" CHECK ("commerce"."plugin_sign_ins"."tool" in ('figma')),
	CONSTRAINT "plugin_sign_ins_status" CHECK ("commerce"."plugin_sign_ins"."status" in ('waiting', 'approved', 'taken', 'declined')),
	CONSTRAINT "plugin_sign_ins_code" CHECK ("commerce"."plugin_sign_ins"."code" ~ '^[A-HJ-NP-Z2-9]{8}$'),
	CONSTRAINT "plugin_sign_ins_read" CHECK ("commerce"."plugin_sign_ins"."read_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "plugin_sign_ins_token" CHECK ("commerce"."plugin_sign_ins"."token_sealed" is null or "commerce"."plugin_sign_ins"."status" = 'approved')
);
--> statement-breakpoint
ALTER TABLE "commerce"."plugin_sign_ins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."plugin_sign_ins" ADD CONSTRAINT "plugin_sign_ins_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plugin_sign_ins" ADD CONSTRAINT "plugin_sign_ins_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_sign_ins_read_idx" ON "commerce"."plugin_sign_ins" USING btree ("read_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_sign_ins_code_idx" ON "commerce"."plugin_sign_ins" USING btree ("code");--> statement-breakpoint
CREATE INDEX "plugin_sign_ins_store_idx" ON "commerce"."plugin_sign_ins" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "plugin_sign_ins_account_idx" ON "commerce"."plugin_sign_ins" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "plugin_sign_ins_expires_idx" ON "commerce"."plugin_sign_ins" USING btree ("expires_at");