CREATE TABLE "commerce"."api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "api_tokens_name" CHECK (char_length("commerce"."api_tokens"."name") between 1 and 80),
	CONSTRAINT "api_tokens_scopes" CHECK (cardinality("commerce"."api_tokens"."scopes") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" DROP CONSTRAINT "inventory_movements_source";--> statement-breakpoint
ALTER TABLE "commerce"."api_tokens" ADD CONSTRAINT "api_tokens_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."api_tokens" ADD CONSTRAINT "api_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_store_idx" ON "commerce"."api_tokens" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "api_tokens_created_by_idx" ON "commerce"."api_tokens" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_source" CHECK ("commerce"."inventory_movements"."source" in ('inventory_page', 'editor', 'bulk', 'file', 'order', 'return', 'checkout', 'ai_manager', 'copy', 'system', 'order_edit', 'exchange', 'api'));--> statement-breakpoint
-- Reached only through server code (D355).
ALTER TABLE "commerce"."api_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A movement may come from the Admin API (`api`, D355) or an exchange (`exchange`, D239, which the recorder's own list never learnt, so its
-- movements read `system`); the recorder's list learns both.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.record_inventory_movement()'::regprocedure);
  IF position('''api''' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'''ai_manager'', ''copy'', ''system'', ''order_edit'') THEN',
    E'''ai_manager'', ''copy'', ''system'', ''order_edit'', ''exchange'', ''api'') THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'record_inventory_movement: the list of sources was not found, so an API change''s movements would read system'; END IF;
  EXECUTE v_new;
END
$patch$;
