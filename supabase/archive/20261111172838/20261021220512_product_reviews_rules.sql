-- Product reviews (wave 5 unit G, D301, docs/wave-5-marketing.md 9.1). Only buyers write (from an order line of that order and of a variant of
-- that product) and imports come in as imports; the rating and words change only inside the author's own write (`kaizen.review_author` names the
-- review, set only by src/server/reviews.ts); staff publish, hide with a reason and answer, never a word or a star; a review is deleted only where
-- `kaizen.review_delete` is set (the author, erasure, a mistaken import) or by its product's or customer's own deletion.
ALTER TABLE commerce.product_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.review_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.product_reviews_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  writer text := coalesce(current_setting('kaizen.review_writer', true), '');
  author boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('kaizen.review_delete', true), '') <> 'on' AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'product_reviews.delete: a review is deleted only by its author or the person''s erasure' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (NEW.source = 'buyer' AND writer <> 'author') OR (NEW.source = 'import' AND writer <> 'import') THEN
      RAISE EXCEPTION 'product_reviews.writer: a review is written only by its buyer or imported' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'hidden' THEN
      RAISE EXCEPTION 'product_reviews.status: a review starts waiting or published' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source = 'buyer' AND NOT EXISTS (
      SELECT 1 FROM commerce.order_lines l
      JOIN commerce.product_variants v ON v.store_id = l.store_id AND v.id = l.variant_id
      WHERE l.store_id = NEW.store_id AND l.id = NEW.order_line_id AND l.order_id = NEW.order_id
        AND l.variant_id = NEW.variant_id AND v.product_id = NEW.product_id
    ) THEN
      RAISE EXCEPTION 'product_reviews.line: a review is of a line of its order and of a variant of its product' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.moderated_at IS NOT NULL OR NEW.answer IS NOT NULL THEN
      RAISE EXCEPTION 'product_reviews.fresh: a new review has no moderation or answer yet' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: who and what it is about never changes.
  IF NEW.store_id <> OLD.store_id OR NEW.product_id <> OLD.product_id OR NEW.variant_id IS DISTINCT FROM OLD.variant_id
    OR NEW.source <> OLD.source OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.order_line_id IS DISTINCT FROM OLD.order_line_id
    OR NEW.buyer_key IS DISTINCT FROM OLD.buyer_key OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.imported_from IS DISTINCT FROM OLD.imported_from OR NEW.written_on IS DISTINCT FROM OLD.written_on
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'product_reviews.fixed: a review''s product, order and author are fixed' USING ERRCODE = 'check_violation';
  END IF;

  author := OLD.source = 'buyer' AND coalesce(current_setting('kaizen.review_author', true), '') = OLD.id::text;

  IF NEW.rating <> OLD.rating OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.author_name <> OLD.author_name OR NEW.locale <> OLD.locale OR NEW.edited_at IS DISTINCT FROM OLD.edited_at THEN
    IF NOT author THEN
      RAISE EXCEPTION 'product_reviews.words: only the author changes a review''s stars or words' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF author THEN
    -- The author's write touches only the words and sends the review back to the queue (or keeps it as it was, never shown while hidden).
    IF NEW.moderated_at IS DISTINCT FROM OLD.moderated_at OR NEW.moderated_by IS DISTINCT FROM OLD.moderated_by
      OR NEW.answer IS DISTINCT FROM OLD.answer OR NEW.answered_at IS DISTINCT FROM OLD.answered_at OR NEW.answered_by IS DISTINCT FROM OLD.answered_by THEN
      RAISE EXCEPTION 'product_reviews.author: the author changes only the words' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'product_reviews.status: an edited review goes back to waiting' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'hidden' THEN
      RAISE EXCEPTION 'product_reviews.status: an edited review is checked again' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('published', 'hidden'))
    OR (OLD.status = 'published' AND NEW.status = 'hidden')
    OR (OLD.status = 'hidden' AND NEW.status = 'published')
  ) THEN
    RAISE EXCEPTION 'product_reviews.status: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NEW.moderated_at IS NOT DISTINCT FROM OLD.moderated_at THEN
    RAISE EXCEPTION 'product_reviews.moderated: a change of state says when' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER product_reviews_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.product_reviews
  FOR EACH ROW EXECUTE FUNCTION commerce.product_reviews_rules();
