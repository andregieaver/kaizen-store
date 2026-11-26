CREATE TABLE "commerce"."platform_admin_signal_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"heatmaps" boolean NOT NULL,
	"recordings" boolean NOT NULL,
	"notice" text NOT NULL,
	"chosen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admin_signal_choices_notice" CHECK ("commerce"."platform_admin_signal_choices"."notice" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "platform_admin_signal_choices_pair" CHECK (not "commerce"."platform_admin_signal_choices"."recordings" or "commerce"."platform_admin_signal_choices"."heatmaps")
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_admin_signal_choices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "admin_signals_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "admin_signals_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "admin_signals_opened_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."platform_admin_signal_choices" ADD CONSTRAINT "platform_admin_signal_choices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_admin_signal_choices_account_idx" ON "commerce"."platform_admin_signal_choices" USING btree ("account_id","chosen_at");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_admin_signals_opened_by_accounts_id_fk" FOREIGN KEY ("admin_signals_opened_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_admin_signals_opened_by_idx" ON "commerce"."platform_settings" USING btree ("admin_signals_opened_by");