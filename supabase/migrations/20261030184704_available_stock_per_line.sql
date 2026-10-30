-- Each level's reservations summed for that level alone (CI run 780). The view joined a subquery grouped over every active reservation
-- of every store; inside `variant_availability`'s per-variant lateral the planner could choose to aggregate all of them once per variant
-- (200 variants read 190,400 reservation rows in `inventory-perf.int.test.ts`), which grows with the whole platform's carts. A scalar
-- subquery is always run for the one level, through `inventory_reservations_active_idx`. Same columns, same types, same rows.
CREATE OR REPLACE VIEW commerce.available_stock
WITH (security_invoker = true)
AS
SELECT
  l.store_id,
  l.variant_id,
  l.location_id,
  l.on_hand,
  l.on_hand - coalesce((
    SELECT sum(r.quantity)
      FROM commerce.inventory_reservations r
     WHERE r.variant_id = l.variant_id
       AND r.location_id = l.location_id
       AND r.released_at IS NULL
       AND r.expires_at > now()
  ), 0) AS available
FROM commerce.inventory_levels l;
