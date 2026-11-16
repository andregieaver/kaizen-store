-- A translation's words carry the time they last changed (bloat review step 0.28). On the row itself, never on commerce.products:
-- an update of products would run its publishing check and queue a product.updated event for a write that is not the owner's.
CREATE FUNCTION commerce.product_translations_text_changed() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.safety_information IS DISTINCT FROM OLD.safety_information THEN
    NEW.text_changed_at := now();
  ELSE
    NEW.text_changed_at := OLD.text_changed_at;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_translations_text_changed
BEFORE UPDATE ON commerce.product_translations
FOR EACH ROW EXECUTE FUNCTION commerce.product_translations_text_changed();
