-- Pictures in product reviews (wave 5 unit G4, D301, docs/wave-5-marketing.md 9.7). A picture is written only with its review, by its author
-- (`kaizen.review_writer` = 'author' for a new review, `kaizen.review_author` naming the review for an edit, both set only by
-- src/server/reviews.ts), only on a buyer's review, never hidden from the start; staff hide or show one alone (`hidden_at`, `hidden_by`) and
-- change nothing else; it is deleted by its author's edit, with its review (the cascade) or where `kaizen.review_delete` is set (erasure).
ALTER TABLE commerce.review_pictures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.review_pictures_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  review uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.review_id ELSE NEW.review_id END;
  author boolean := coalesce(current_setting('kaizen.review_author', true), '') = review::text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT author AND coalesce(current_setting('kaizen.review_delete', true), '') <> 'on' AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'review_pictures.delete: a picture is taken out by its author or goes with its review' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT author AND coalesce(current_setting('kaizen.review_writer', true), '') <> 'author' THEN
      RAISE EXCEPTION 'review_pictures.writer: a picture is added only by its review''s author' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM commerce.product_reviews r WHERE r.store_id = NEW.store_id AND r.id = NEW.review_id AND r.source = 'buyer') THEN
      RAISE EXCEPTION 'review_pictures.review: only a buyer''s review has pictures' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.hidden_at IS NOT NULL THEN
      RAISE EXCEPTION 'review_pictures.fresh: a new picture is not hidden' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only staff's hiding changes.
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.review_id <> OLD.review_id OR NEW.position <> OLD.position OR NEW.type <> OLD.type
    OR NEW.width <> OLD.width OR NEW.height <> OLD.height OR NEW.bytes <> OLD.bytes OR NEW.thumb_bytes <> OLD.thumb_bytes
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'review_pictures.fixed: a picture is never changed, only hidden or shown' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER review_pictures_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.review_pictures
  FOR EACH ROW EXECUTE FUNCTION commerce.review_pictures_rules();
--> statement-breakpoint

-- The private bucket: written, read and emptied only by the server with the secret key; a picture is served by
-- /api/reviews/picture/{id} while its review is published, and to staff through the admin. Storage exists only on Supabase.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('review-pictures', 'review-pictures', false, 614400, ARRAY['image/webp', 'image/jpeg'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
