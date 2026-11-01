-- Profit per order (D415): what a booked label cost is kept on its parcel (`shipments.label_cost_minor`, `label_cost_carrier`, added by
-- 20261101200325_shipment_label_cost.sql), written by `recordLabelCost()` right after the booking. A parcel is a record (`shipments_guard()`), so the
-- cost is written once, from nothing, and never changed or taken away; every other rule of the guard is as it was.

CREATE OR REPLACE FUNCTION commerce.shipments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipment.append_only: a parcel is a record; it is undone, never removed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['legacy', 'undone_at', 'undone_by', 'undo_reason', 'label_cost_minor', 'label_cost_carrier'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['legacy', 'undone_at', 'undone_by', 'undo_reason', 'label_cost_minor', 'label_cost_carrier']) THEN
    RAISE EXCEPTION 'shipment.frozen: a parcel''s carrier, tracking, label and order are a record and are not changed' USING ERRCODE = 'restrict_violation';
  END IF;
  -- What the label cost (D415): written once, from nothing, both together.
  IF (NEW.label_cost_minor IS DISTINCT FROM OLD.label_cost_minor OR NEW.label_cost_carrier IS DISTINCT FROM OLD.label_cost_carrier)
     AND (OLD.label_cost_minor IS NOT NULL OR OLD.label_cost_carrier IS NOT NULL OR NEW.label_cost_minor IS NULL) THEN
    RAISE EXCEPTION 'shipment.label_cost: what a label cost is kept once and not changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.legacy IS DISTINCT FROM OLD.legacy AND NOT (NEW.legacy AND NOT OLD.legacy) THEN
    RAISE EXCEPTION 'shipment.legacy: a parcel recorded before parcels named their lines stays so' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.undone_at IS NOT NULL THEN
    IF NEW.undone_at IS DISTINCT FROM OLD.undone_at OR NEW.undone_by IS DISTINCT FROM OLD.undone_by
       OR (NEW.undo_reason IS DISTINCT FROM OLD.undo_reason
           AND NOT (NEW.undo_reason = '[removed]' AND coalesce(current_setting('commerce.anonymising', true), '') = 'on')) THEN
      RAISE EXCEPTION 'shipment.undone_final: an undone parcel stays undone, as it was recorded' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.undone_at IS NOT NULL OR NEW.undone_by IS NOT NULL OR NEW.undo_reason IS NOT NULL THEN
    IF coalesce(current_setting('kaizen.shipment_undo', true), '') <> OLD.id::text THEN
      RAISE EXCEPTION 'shipment.undo_function: a parcel is undone only by commerce.undo_shipment()' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
