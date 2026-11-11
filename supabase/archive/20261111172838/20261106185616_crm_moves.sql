CREATE TABLE "commerce"."crm_move_links" (
	"store_id" uuid NOT NULL,
	"source" text NOT NULL,
	"account" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"our_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_move_links_store_id_source_account_kind_external_id_pk" PRIMARY KEY("store_id","source","account","kind","external_id"),
	CONSTRAINT "crm_move_links_source" CHECK ("commerce"."crm_move_links"."source" in ('pipedrive')),
	CONSTRAINT "crm_move_links_kind" CHECK ("commerce"."crm_move_links"."kind" in ('organization', 'person', 'pipeline', 'stage', 'deal', 'activity', 'note')),
	CONSTRAINT "crm_move_links_external" CHECK ("commerce"."crm_move_links"."external_id" ~ '^[0-9]{1,20}$' and "commerce"."crm_move_links"."account" ~ '^[0-9]{1,20}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."crm_moves" (
	"store_id" uuid NOT NULL,
	"source" text NOT NULL,
	"token_encrypted" text,
	"token_hint" text DEFAULT '' NOT NULL,
	"account" text NOT NULL,
	"account_name" text DEFAULT '' NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_moves_store_id_source_pk" PRIMARY KEY("store_id","source"),
	CONSTRAINT "crm_moves_source" CHECK ("commerce"."crm_moves"."source" in ('pipedrive')),
	CONSTRAINT "crm_moves_run" CHECK (jsonb_typeof("commerce"."crm_moves"."run") = 'object'),
	CONSTRAINT "crm_moves_names" CHECK (char_length("commerce"."crm_moves"."token_hint") <= 12 and char_length("commerce"."crm_moves"."account_name") <= 200),
	CONSTRAINT "crm_moves_account" CHECK ("commerce"."crm_moves"."account" ~ '^[0-9]{1,20}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."crm_move_links" ADD CONSTRAINT "crm_move_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."crm_moves" ADD CONSTRAINT "crm_moves_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."crm_moves" ADD CONSTRAINT "crm_moves_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_moves_connected_by_idx" ON "commerce"."crm_moves" USING btree ("connected_by");