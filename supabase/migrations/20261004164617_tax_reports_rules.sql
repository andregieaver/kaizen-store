-- VAT, OSS and IOSS reports (D161, docs/wave-1c-reports.md). Additive: three tables (the previous migration), their rules, the one
-- function that reads documents for a report, and one row in the plan comparison. Nothing is dropped and no existing function is
-- replaced: the dispatch country the reports classify by is a JSON field of orders.vat_treatment that application code writes.
-- No function here removes rows.

-- Like every commerce table: row-level security on and no policy, so the Data API reaches none of it.
ALTER TABLE commerce.ecb_reference_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.tax_rate_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.tax_report_exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The ECB's rates and the export log are append-only: a stored rate is part of what a filed return rested on, and a logged
-- export is what a later change to the period is compared with. commerce.forbid_change() only raises.
-- ---------------------------------------------------------------------------
CREATE TRIGGER ecb_reference_rates_append_only
  BEFORE UPDATE OR DELETE ON commerce.ecb_reference_rates
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint
CREATE TRIGGER tax_report_exports_append_only
  BEFORE UPDATE OR DELETE ON commerce.tax_report_exports
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint

-- An owner's rate is for a day that has happened: a rate for tomorrow would be a guess.
CREATE FUNCTION commerce.tax_rate_overrides_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.rate_date > current_date THEN
    RAISE EXCEPTION 'tax_rate_override.future: a rate is entered for a day that has passed, not for %', NEW.rate_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tax_rate_overrides_rules
  BEFORE INSERT OR UPDATE ON commerce.tax_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION commerce.tax_rate_overrides_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The one reader of documents for a report (docs/wave-1c-reports.md 3.4). Returns the documents whose tax date (an invoice's
-- supply_date, a credit note's issued_on) is in [p_from, p_to), one row per distinct combination of the key columns, with the
-- amounts of their VAT buckets summed in the document's currency. It opens a snapshot for its buckets, the stored conversion to
-- the main currency, the buyer's type and the kinds of the invoice's lines, and for nothing personal. The delivery country is the
-- order's market, never the snapshot. A credit note takes the buyer type, line kinds, VAT kind and dispatch country of its invoice's
-- order, so a refund can never land in a different return than its sale. Copied and host orders have no document, so none appears.
--
--   fx_state: 'same' (the document is in the store's main currency), 'stored' (the document keeps a conversion to it) or
--             'missing' (it does not, or the stored one is to another currency)
--   dispatch_source: 'order' (frozen on the order when it was placed), 'profile' (the store's live setting) or 'unknown'
--   seller_country, seller_oss_member_state, seller_source: the country the store was established in and the member state it was
--           identified in for the Union scheme, as the order froze them (orders.vat_treatment: sellerCountry and ossMemberState; source
--           'order'), else the store's live country and profile (source 'profile': an order placed before they were frozen). A later
--           edit of the store's country or registration therefore moves no document's sale to another part of a return.
--   net_main_minor, vat_main_minor, gross_main_minor: the same sums in the main currency, each bucket converted on its own with the
--           document's stored rate (commerce.convert_with, as the snapshot's own conversion does), so the converted VAT of an invoice
--           equals its stored main-currency VAT exactly; null when fx_state is 'missing'
--   orders: for an invoice, the distinct orders; for a credit note 0.  currency_orders: the distinct orders with an invoice in the
--           period in that currency (the same on every row of a currency), so a total of distinct orders can be made from rows.
--   kind_documents: the distinct documents of the same doc_kind, currency and fx_state in the period (the same on every row of that
--           combination), because a document with two rates is in two rows and a total of documents cannot be made by adding rows.
-- ---------------------------------------------------------------------------
CREATE FUNCTION commerce.tax_document_groups(p_store uuid, p_from date, p_to date)
RETURNS TABLE (
  doc_kind text,
  tax_date date,
  original_tax_date date,
  market_code text,
  market_in_eu boolean,
  currency text,
  main_currency text,
  fx_state text,
  fx_rate numeric,
  vat_kind text,
  buyer_type text,
  has_physical boolean,
  has_download boolean,
  has_service boolean,
  dispatch_country text,
  dispatch_source text,
  seller_country text,
  seller_oss_member_state text,
  seller_source text,
  rate numeric,
  basis text,
  standard_rate numeric,
  documents bigint,
  orders bigint,
  currency_orders bigint,
  kind_documents bigint,
  net_minor bigint,
  vat_minor bigint,
  gross_minor bigint,
  net_main_minor bigint,
  vat_main_minor bigint,
  gross_main_minor bigint
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  -- MATERIALIZED: the planner would otherwise fold this one-row query into every place `main.code` is read and call the function once per
  -- document and place (it took a second for five thousand documents).
  WITH main AS MATERIALIZED (
    SELECT commerce.main_currency(p_store) AS code
  ), prof AS MATERIALIZED (
    SELECT coalesce(nullif(btrim(p.dispatch_country), ''), s.country) AS dispatch,
           s.country::text AS country, p.oss_member_state::text AS oss_msi
      FROM commerce.stores s
      LEFT JOIN commerce.store_tax_profile p ON p.store_id = s.id
     WHERE s.id = p_store
  ), docs AS (
    SELECT 'invoice'::text AS doc_kind, i.supply_date AS tax_date, NULL::date AS original_tax_date, i.id AS doc_id, i.order_id,
           i.currency::text AS currency, i.vat_kind, i.snapshot AS snap, i.snapshot AS inv_snap
      FROM commerce.invoices i
     WHERE i.store_id = p_store AND i.supply_date >= p_from AND i.supply_date < p_to
    UNION ALL
    SELECT 'credit_note'::text, c.issued_on, i.supply_date, c.id, i.order_id,
           c.currency::text, i.vat_kind, c.snapshot, i.snapshot
      FROM commerce.credit_notes c
      JOIN commerce.invoices i ON i.store_id = c.store_id AND i.id = c.invoice_id
     WHERE c.store_id = p_store AND c.issued_on >= p_from AND c.issued_on < p_to
  ), parts AS (
    -- A snapshot is compressed in the table, and every `->` on it decompresses it again: each is opened once here, for the four
    -- parts the report needs (jsonb_to_record reads the object once), and everything below reads those small values.
    SELECT d.doc_kind, d.tax_date, d.original_tax_date, d.doc_id, d.order_id, d.currency, d.vat_kind,
           s.buckets, s."vatMain" AS vat_main, v.buyer, v.lines
      FROM docs d
     CROSS JOIN LATERAL jsonb_to_record(d.snap) AS s(buckets jsonb, "vatMain" jsonb)
     CROSS JOIN LATERAL jsonb_to_record(d.inv_snap) AS v(buyer jsonb, lines jsonb)
  ), per_currency AS (
    SELECT d.currency, count(DISTINCT d.order_id) AS n
      FROM parts d WHERE d.doc_kind = 'invoice' GROUP BY d.currency
  ), facts AS (
    SELECT d.*, o.market_code::text AS market_code, coalesce(co.in_eu, false) AS market_in_eu,
           main.code AS main_currency,
           CASE
             WHEN d.currency = main.code THEN 'same'
             WHEN jsonb_typeof(d.vat_main -> 'fxRate') = 'number' AND d.vat_main ->> 'currency' = main.code THEN 'stored'
             ELSE 'missing'
           END AS fx_state,
           CASE
             WHEN d.currency <> main.code AND jsonb_typeof(d.vat_main -> 'fxRate') = 'number' AND d.vat_main ->> 'currency' = main.code
               THEN (d.vat_main ->> 'fxRate')::numeric
           END AS fx_rate,
           CASE WHEN d.buyer ->> 'type' = 'business' THEN 'business' ELSE 'consumer' END AS buyer_type,
           nullif(btrim(o.vat_treatment ->> 'dispatchCountry'), '') AS frozen_dispatch,
           -- The seller as the order froze it: both keys present (a JSON null is a fact, an absent key is an order from before D161).
           (o.vat_treatment -> 'sellerCountry' IS NOT NULL AND o.vat_treatment -> 'ossMemberState' IS NOT NULL) AS seller_frozen,
           nullif(btrim(o.vat_treatment ->> 'sellerCountry'), '') AS frozen_seller_country,
           nullif(btrim(o.vat_treatment ->> 'ossMemberState'), '') AS frozen_msi
      FROM parts d
      JOIN commerce.orders o ON o.store_id = p_store AND o.id = d.order_id
      LEFT JOIN commerce.countries co ON co.code = o.market_code
      CROSS JOIN main
  ), lined AS (
    SELECT f.doc_kind, f.tax_date, f.original_tax_date, f.doc_id, f.order_id, f.currency, f.vat_kind, f.buckets, f.market_code, f.market_in_eu,
           f.main_currency, f.fx_state, f.fx_rate, f.buyer_type,
           k.has_physical, k.has_download, k.has_service,
           CASE WHEN f.seller_frozen THEN f.frozen_seller_country ELSE prof.country END AS seller_country,
           CASE WHEN f.seller_frozen THEN f.frozen_msi ELSE prof.oss_msi END AS seller_oss_member_state,
           CASE WHEN f.seller_frozen THEN 'order' ELSE 'profile' END AS seller_source,
           coalesce(f.frozen_dispatch, prof.dispatch) AS dispatch_country,
           CASE
             WHEN f.frozen_dispatch IS NOT NULL THEN 'order'
             WHEN prof.dispatch IS NOT NULL THEN 'profile'
             ELSE 'unknown'
           END AS dispatch_source
      FROM facts f
      LEFT JOIN prof ON true
     CROSS JOIN LATERAL (
       SELECT coalesce(bool_or(l ->> 'kind' IN ('goods', 'gift')), false) AS has_physical,
              coalesce(bool_or(l ->> 'kind' = 'download'), false) AS has_download,
              coalesce(bool_or(l ->> 'kind' IN ('service', 'booking')), false) AS has_service
         FROM jsonb_array_elements(f.lines) AS l
     ) k
  ), per_kind AS (
    SELECT l.doc_kind, l.currency, l.fx_state, count(DISTINCT l.doc_id) AS n
      FROM lined l GROUP BY l.doc_kind, l.currency, l.fx_state
  ), bucketed AS (
    SELECT l.*, (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis,
           (b ->> 'netMinor')::bigint AS b_net, (b ->> 'vatMinor')::bigint AS b_vat, (b ->> 'grossMinor')::bigint AS b_gross
      FROM lined l
     CROSS JOIN LATERAL jsonb_array_elements(l.buckets) AS b
  ), converted AS (
    SELECT x.*,
           CASE x.fx_state WHEN 'same' THEN x.b_net WHEN 'stored' THEN commerce.convert_with(x.b_net, x.fx_rate) END AS m_net,
           CASE x.fx_state WHEN 'same' THEN x.b_vat WHEN 'stored' THEN commerce.convert_with(x.b_vat, x.fx_rate) END AS m_vat,
           CASE x.fx_state WHEN 'same' THEN x.b_gross WHEN 'stored' THEN commerce.convert_with(x.b_gross, x.fx_rate) END AS m_gross
      FROM bucketed x
  )
  SELECT x.doc_kind, x.tax_date, x.original_tax_date, x.market_code, x.market_in_eu, x.currency, x.main_currency, x.fx_state, x.fx_rate,
         x.vat_kind, x.buyer_type, x.has_physical, x.has_download, x.has_service, x.dispatch_country, x.dispatch_source,
         x.seller_country, x.seller_oss_member_state, x.seller_source, x.rate, x.basis,
         commerce.vat_rate(x.market_code::char(2), 'standard', (x.tax_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC') AS standard_rate,
         count(DISTINCT x.doc_id)::bigint AS documents,
         CASE WHEN x.doc_kind = 'invoice' THEN count(DISTINCT x.order_id)::bigint ELSE 0::bigint END AS orders,
         coalesce(max(pc.n), 0)::bigint AS currency_orders,
         coalesce(max(pk.n), 0)::bigint AS kind_documents,
         coalesce(sum(x.b_net), 0)::bigint AS net_minor,
         coalesce(sum(x.b_vat), 0)::bigint AS vat_minor,
         coalesce(sum(x.b_gross), 0)::bigint AS gross_minor,
         sum(x.m_net)::bigint AS net_main_minor,
         sum(x.m_vat)::bigint AS vat_main_minor,
         sum(x.m_gross)::bigint AS gross_main_minor
    FROM converted x
    LEFT JOIN per_currency pc ON pc.currency = x.currency
    LEFT JOIN per_kind pk ON pk.doc_kind = x.doc_kind AND pk.currency = x.currency AND pk.fx_state = x.fx_state
   GROUP BY x.doc_kind, x.tax_date, x.original_tax_date, x.market_code, x.market_in_eu, x.currency, x.main_currency, x.fx_state, x.fx_rate,
            x.vat_kind, x.buyer_type, x.has_physical, x.has_download, x.has_service, x.dispatch_country, x.dispatch_source,
            x.seller_country, x.seller_oss_member_state, x.seller_source, x.rate, x.basis
   ORDER BY x.tax_date, x.doc_kind, x.market_code, x.currency, x.rate, x.basis;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The plan comparison (D132) lists what the product can do. The row describes; it enables nothing, and no plan includes it until
-- the platform's admin ticks the plans that do.
-- ---------------------------------------------------------------------------
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Checkout and selling', 'VAT, OSS and IOSS reports', 'VAT per country and rate from the store''s own invoices and credit notes, the quarterly OSS and monthly IOSS return data in euro at the ECB''s rate, a reconciliation against the order totals, and CSV exports for the owner''s accountant. Reports only: nothing is filed.', 219)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);
