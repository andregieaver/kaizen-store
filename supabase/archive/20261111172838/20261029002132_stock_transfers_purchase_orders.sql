CREATE TABLE "commerce"."purchase_order_lines" (
	"store_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_order_lines_purchase_order_id_variant_id_pk" PRIMARY KEY("purchase_order_id","variant_id"),
	CONSTRAINT "purchase_order_lines_quantity" CHECK ("commerce"."purchase_order_lines"."quantity" between 1 and 1000000),
	CONSTRAINT "purchase_order_lines_received" CHECK ("commerce"."purchase_order_lines"."received" between 0 and "commerce"."purchase_order_lines"."quantity"),
	CONSTRAINT "purchase_order_lines_cost" CHECK ("commerce"."purchase_order_lines"."unit_cost_minor" between 0 and 100000000000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"supplier" text NOT NULL,
	"reference" text,
	"currency" char(3) NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_on" date,
	"note" text,
	"created_by" uuid,
	"ordered_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "purchase_orders_status" CHECK ("commerce"."purchase_orders"."status" in ('draft', 'ordered', 'received', 'cancelled')),
	CONSTRAINT "purchase_orders_texts" CHECK (length("commerce"."purchase_orders"."supplier") between 1 and 120 and coalesce(length("commerce"."purchase_orders"."reference") <= 60, true) and coalesce(length("commerce"."purchase_orders"."note") <= 500, true)),
	CONSTRAINT "purchase_orders_currency" CHECK ("commerce"."purchase_orders"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."stock_transfer_lines" (
	"store_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_transfer_lines_transfer_id_variant_id_pk" PRIMARY KEY("transfer_id","variant_id"),
	CONSTRAINT "stock_transfer_lines_quantity" CHECK ("commerce"."stock_transfer_lines"."quantity" between 1 and 1000000),
	CONSTRAINT "stock_transfer_lines_received" CHECK ("commerce"."stock_transfer_lines"."received" between 0 and "commerce"."stock_transfer_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "commerce"."stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"origin_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "stock_transfers_status" CHECK ("commerce"."stock_transfers"."status" in ('draft', 'sent', 'received', 'cancelled')),
	CONSTRAINT "stock_transfers_places" CHECK ("commerce"."stock_transfers"."origin_id" <> "commerce"."stock_transfers"."destination_id"),
	CONSTRAINT "stock_transfers_note" CHECK ("commerce"."stock_transfers"."note" is null or length("commerce"."stock_transfers"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."variant_cost_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."variant_cost_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"cost_minor" bigint,
	"source" text NOT NULL,
	"purchase_order_id" uuid,
	"source_currency" char(3),
	"source_cost_minor" bigint,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_cost_history_source" CHECK ("commerce"."variant_cost_history"."source" in ('editor', 'purchase_order', 'file', 'system'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" DROP CONSTRAINT "inventory_movements_reason";--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" DROP CONSTRAINT "inventory_movements_source";--> statement-breakpoint
ALTER TABLE "commerce"."inventory_locations" ADD COLUMN "fulfils_online" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_fk" FOREIGN KEY ("store_id","purchase_order_id") REFERENCES "commerce"."purchase_orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."purchase_orders" ADD CONSTRAINT "purchase_orders_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."inventory_locations"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_fk" FOREIGN KEY ("store_id","transfer_id") REFERENCES "commerce"."stock_transfers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_transfers" ADD CONSTRAINT "stock_transfers_origin_fk" FOREIGN KEY ("store_id","origin_id") REFERENCES "commerce"."inventory_locations"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_transfers" ADD CONSTRAINT "stock_transfers_destination_fk" FOREIGN KEY ("store_id","destination_id") REFERENCES "commerce"."inventory_locations"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."variant_cost_history" ADD CONSTRAINT "variant_cost_history_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_variant_idx" ON "commerce"."purchase_order_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_store_idx" ON "commerce"."purchase_orders" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_orders_location_idx" ON "commerce"."purchase_orders" USING btree ("store_id","location_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_created_by_idx" ON "commerce"."purchase_orders" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "stock_transfer_lines_variant_idx" ON "commerce"."stock_transfer_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_store_idx" ON "commerce"."stock_transfers" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_transfers_origin_idx" ON "commerce"."stock_transfers" USING btree ("store_id","origin_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_destination_idx" ON "commerce"."stock_transfers" USING btree ("store_id","destination_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_created_by_idx" ON "commerce"."stock_transfers" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "variant_cost_history_variant_idx" ON "commerce"."variant_cost_history" USING btree ("store_id","variant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "variant_cost_history_order_idx" ON "commerce"."variant_cost_history" USING btree ("store_id","purchase_order_id") WHERE "commerce"."variant_cost_history"."purchase_order_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_reason" CHECK ("commerce"."inventory_movements"."reason" in ('received', 'correction', 'count', 'damaged', 'lost', 'promotion', 'sale', 'order_restock', 'return_restock', 'opening', 'system', 'transfer_out', 'transfer_in'));--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_source" CHECK ("commerce"."inventory_movements"."source" in ('inventory_page', 'editor', 'bulk', 'file', 'order', 'return', 'checkout', 'ai_manager', 'copy', 'system', 'order_edit', 'exchange', 'api', 'transfer', 'purchase_order'));--> statement-breakpoint
-- Reached only through server code (D383).
ALTER TABLE "commerce"."stock_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."stock_transfer_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."variant_cost_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The movement recorder learns the transfer's two reasons and the two new sources (D383); a context it does not know reads `system`.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.record_inventory_movement()'::regprocedure);
  IF position('''transfer_out''' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'''order_restock'', ''return_restock'', ''opening'', ''system'') THEN',
    E'''order_restock'', ''return_restock'', ''opening'', ''system'', ''transfer_out'', ''transfer_in'') THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'record_inventory_movement: the list of reasons was not found'; END IF;
  v_def := v_new;
  v_new := replace(
    v_def,
    E'''order_edit'', ''exchange'', ''api'') THEN',
    E'''order_edit'', ''exchange'', ''api'', ''transfer'', ''purchase_order'') THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'record_inventory_movement: the list of sources was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A transfer's and a purchase order's life (D383): the status moves only forward (draft to sent/ordered or cancelled, sent/ordered to
-- received or cancelled), the places, currency and supplier stay once out of draft, and only a draft is deleted.
CREATE FUNCTION commerce.stock_documents_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_open text := CASE WHEN TG_TABLE_NAME = 'stock_transfers' THEN 'sent' ELSE 'ordered' END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'stock_documents.kept: only a draft is deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'stock_documents.draft: a transfer or a purchase order starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.store_id <> OLD.store_id OR NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'stock_documents.fixed: a document stays its store''s' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN (v_open, 'cancelled'))
    OR (OLD.status = v_open AND NEW.status IN ('received', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'stock_documents.status: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'draft' AND (
    CASE WHEN TG_TABLE_NAME = 'stock_transfers'
      THEN (to_jsonb(NEW) ->> 'origin_id', to_jsonb(NEW) ->> 'destination_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'origin_id', to_jsonb(OLD) ->> 'destination_id')
      ELSE (to_jsonb(NEW) ->> 'location_id', to_jsonb(NEW) ->> 'currency', to_jsonb(NEW) ->> 'supplier') IS DISTINCT FROM (to_jsonb(OLD) ->> 'location_id', to_jsonb(OLD) ->> 'currency', to_jsonb(OLD) ->> 'supplier')
    END
  ) THEN
    RAISE EXCEPTION 'stock_documents.fixed: where it goes is fixed once it is out of draft' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('received', 'cancelled') AND to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'stock_documents.closed: a received or cancelled document stays as it closed' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_transfers_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.stock_transfers
FOR EACH ROW EXECUTE FUNCTION commerce.stock_documents_rules();
--> statement-breakpoint
CREATE TRIGGER purchase_orders_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.purchase_orders
FOR EACH ROW EXECUTE FUNCTION commerce.stock_documents_rules();
--> statement-breakpoint

-- A document's lines (D383): added, changed and taken out only while it is a draft; once sent or ordered only `received` moves, and only up.
CREATE FUNCTION commerce.stock_document_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_transfer boolean := TG_TABLE_NAME = 'stock_transfer_lines';
  v_parent uuid;
  v_status text;
BEGIN
  v_parent := CASE WHEN v_transfer THEN (to_jsonb(coalesce(NEW, OLD)) ->> 'transfer_id')::uuid ELSE (to_jsonb(coalesce(NEW, OLD)) ->> 'purchase_order_id')::uuid END;
  IF v_transfer THEN
    SELECT t.status INTO v_status FROM commerce.stock_transfers t WHERE t.id = v_parent;
  ELSE
    SELECT p.status INTO v_status FROM commerce.purchase_orders p WHERE p.id = v_parent;
  END IF;
  -- The document itself going (a draft deleted) takes its lines with it.
  IF TG_OP = 'DELETE' AND v_status IS NULL THEN RETURN OLD; END IF;
  IF TG_OP IN ('INSERT', 'DELETE') THEN
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'stock_document_lines.draft: lines change only while it is a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.received <> 0 THEN
      RAISE EXCEPTION 'stock_document_lines.received: nothing is received on a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN coalesce(NEW, OLD);
  END IF;
  IF (to_jsonb(NEW) - 'received' - 'quantity' - 'unit_cost_minor') IS DISTINCT FROM (to_jsonb(OLD) - 'received' - 'quantity' - 'unit_cost_minor') THEN
    RAISE EXCEPTION 'stock_document_lines.fixed: a line keeps its document and variant' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status = 'draft' THEN
    IF NEW.received <> 0 THEN
      RAISE EXCEPTION 'stock_document_lines.received: nothing is received on a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'received') IS DISTINCT FROM (to_jsonb(OLD) - 'received') THEN
    RAISE EXCEPTION 'stock_document_lines.fixed: a line is fixed once it is sent or ordered' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.received < OLD.received OR v_status NOT IN ('sent', 'ordered') THEN
    RAISE EXCEPTION 'stock_document_lines.received: units are received only forward, while it is open' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_transfer_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.stock_transfer_lines
FOR EACH ROW EXECUTE FUNCTION commerce.stock_document_lines_rules();
--> statement-breakpoint
CREATE TRIGGER purchase_order_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION commerce.stock_document_lines_rules();
--> statement-breakpoint

-- Every change of a variant's cost is kept (D383), whoever writes it: where from is the transaction's `kaizen.cost_source` (a JSON object
-- of source, purchase order, its currency and cost, and account), else `editor`.
CREATE FUNCTION commerce.variant_cost_keep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ctx jsonb;
  v_source text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cost_minor IS NOT DISTINCT FROM OLD.cost_minor THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.cost_minor IS NULL THEN RETURN NULL; END IF;
  BEGIN
    v_ctx := nullif(current_setting('kaizen.cost_source', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_ctx := NULL;
  END;
  v_source := coalesce(v_ctx ->> 'source', 'editor');
  IF v_source NOT IN ('editor', 'purchase_order', 'file', 'system') THEN v_source := 'editor'; END IF;
  INSERT INTO commerce.variant_cost_history (store_id, variant_id, cost_minor, source, purchase_order_id, source_currency, source_cost_minor, account_id)
  VALUES (NEW.store_id, NEW.id, NEW.cost_minor, v_source,
    CASE WHEN v_source = 'purchase_order' THEN (v_ctx ->> 'order')::uuid END,
    CASE WHEN v_source = 'purchase_order' THEN v_ctx ->> 'currency' END,
    CASE WHEN v_source = 'purchase_order' THEN (v_ctx ->> 'cost')::bigint END,
    (v_ctx ->> 'account')::uuid);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_variants_cost_keep AFTER INSERT OR UPDATE OF cost_minor ON commerce.product_variants
FOR EACH ROW EXECUTE FUNCTION commerce.variant_cost_keep();
--> statement-breakpoint

-- The cost history is never changed or deleted.
CREATE FUNCTION commerce.variant_cost_history_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'variant_cost_history.fixed: a cost change is kept as it was' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER variant_cost_history_fixed BEFORE UPDATE OR DELETE ON commerce.variant_cost_history
FOR EACH ROW EXECUTE FUNCTION commerce.variant_cost_history_fixed();
--> statement-breakpoint

-- The storefront's stock leaves out a location that does not fulfil online orders (D383).
CREATE OR REPLACE VIEW commerce.variant_availability WITH (security_invoker = true) AS
SELECT v.store_id,
       v.id AS variant_id,
       v.delivery::text AS delivery,
       (CASE WHEN b.components > 0 THEN b.free ELSE a.free END)::integer AS in_stock,
       (CASE WHEN b.components > 0 THEN b.free ELSE a.available END)::integer AS raw_available,
       v.stock_policy,
       v.backorder_days,
       CASE WHEN b.components > 0 THEN b.free > 0 ELSE (a.free > 0 OR v.stock_policy = 'continue') END AS can_buy
  FROM commerce.product_variants v
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(s.available), 0) AS available,
           coalesce(sum(greatest(s.available, 0)), 0) AS free
      FROM commerce.available_stock s
      JOIN commerce.inventory_locations loc ON loc.store_id = s.store_id AND loc.id = s.location_id AND loc.active AND loc.fulfils_online
     WHERE s.store_id = v.store_id AND s.variant_id = v.id
  ) a
  CROSS JOIN LATERAL (
    SELECT count(*) AS components,
           CASE
             WHEN count(*) = 0 THEN 0
             WHEN coalesce(sum(bc.quantity), 0) < 2 THEN 0
             WHEN bool_or(NOT cv.active OR cp.status = 'archived' OR cp.kind <> 'goods' OR cv.delivery <> 'physical' OR cp.vat_category <> bp.vat_category) THEN 0
             ELSE coalesce(min(floor(cf.free / bc.quantity)), 0)
           END AS free
      FROM commerce.bundle_components bc
      JOIN commerce.products bp ON bp.store_id = v.store_id AND bp.id = v.product_id
      JOIN commerce.product_variants cv ON cv.store_id = bc.store_id AND cv.id = bc.component_variant_id
      JOIN commerce.products cp ON cp.store_id = cv.store_id AND cp.id = cv.product_id
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(greatest(s.available, 0)), 0) AS free
          FROM commerce.available_stock s
          JOIN commerce.inventory_locations loc ON loc.store_id = s.store_id AND loc.id = s.location_id AND loc.active AND loc.fulfils_online
         WHERE s.store_id = cv.store_id AND s.variant_id = cv.id
      ) cf
     WHERE bc.store_id = v.store_id AND bc.bundle_variant_id = v.id
  ) b;
--> statement-breakpoint

-- A store's copies keep whether each location fulfils online orders (D383).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store'::regproc);
  IF position('fulfils_online' IN v_def) = 0 THEN
    v_new := replace(v_def,
      E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, priority)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, priority\n',
      E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, priority, fulfils_online)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, priority, fulfils_online\n');
    IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the copy of the locations was not found'; END IF;
    EXECUTE v_new;
  END IF;
  v_def := pg_get_functiondef('commerce.duplicate_store'::regproc);
  IF position('fulfils_online' IN v_def) = 0 THEN
    v_new := replace(v_def,
      E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, created_at, priority)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, created_at, priority\n',
      E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, created_at, priority, fulfils_online)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, created_at, priority, fulfils_online\n');
    IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the copy of the locations was not found'; END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
