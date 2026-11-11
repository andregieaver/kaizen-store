-- Blogs in depth (wave 7 unit G, D341, docs/wave-7-storefront.md section 4, G):
-- * Every store has its first blog from its first moment (`stores_first_blog()`), and every store there is gets one now: today's `/blog`,
--   so no address moves. Its listing page stays the `blog` page role (D112); other blogs name theirs in `listing_page_id`, a page of the
--   same store (`blogs_rules()`).
-- * A visitor's comment keeps its words, name, email, article and day as written: only its status, when and by whom it was decided and
--   what the spam check found change (`blog_comments_rules()`), and a decided comment never goes back to waiting.
-- * A page's schedule (the start of D340's model) only leaves `waiting`, once (`page_schedules_rules()`).
-- * The retention rule of refused comments, as `RETENTION_SEED` in src/lib/retention.ts says (src/db/privacy.test.ts holds the two equal).
--
-- No function here contains DELETE, TRUNCATE or DROP: comments are deleted by application code (staff, erasure, `runRetention()`).

ALTER TABLE commerce.blogs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.blog_authors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.blog_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.page_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.stores_first_blog()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO commerce.blogs (store_id, handle, main) VALUES (NEW.id, 'blog', true) ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stores_first_blog AFTER INSERT ON commerce.stores
  FOR EACH ROW EXECUTE FUNCTION commerce.stores_first_blog();
--> statement-breakpoint
INSERT INTO commerce.blogs (store_id, handle, main)
SELECT s.id, 'blog', true FROM commerce.stores s
 WHERE NOT EXISTS (SELECT 1 FROM commerce.blogs b WHERE b.store_id = s.id AND b.main);
--> statement-breakpoint

CREATE FUNCTION commerce.blogs_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.listing_page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.pages p WHERE p.id = NEW.listing_page_id AND p.store_id = NEW.store_id AND p.type = 'page'
  ) THEN
    RAISE EXCEPTION 'blogs.listing_page: a blog lists on a page of its own store' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.store_id <> OLD.store_id OR NEW.main <> OLD.main) THEN
    RAISE EXCEPTION 'blogs.fixed: a blog stays its store''s, and the first blog stays the first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER blogs_rules BEFORE INSERT OR UPDATE ON commerce.blogs
  FOR EACH ROW EXECUTE FUNCTION commerce.blogs_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.blog_comments_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id <> OLD.store_id OR NEW.page_id <> OLD.page_id OR NEW.name <> OLD.name OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.body <> OLD.body OR NEW.body_hash <> OLD.body_hash OR NEW.locale <> OLD.locale OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'blog_comments.fixed: a visitor''s comment is kept as they wrote it' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'blog_comments.decided: a decided comment does not wait again' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER blog_comments_rules BEFORE UPDATE ON commerce.blog_comments
  FOR EACH ROW EXECUTE FUNCTION commerce.blog_comments_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.page_schedules_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id <> OLD.store_id OR NEW.page_id <> OLD.page_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'page_schedules.fixed: a schedule stays its page''s' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'waiting' AND (NEW.status <> OLD.status OR NEW.publish_at <> OLD.publish_at) THEN
    RAISE EXCEPTION 'page_schedules.settled: a schedule that ran or was cancelled is kept as it ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER page_schedules_rules BEFORE UPDATE ON commerce.page_schedules
  FOR EACH ROW EXECUTE FUNCTION commerce.page_schedules_rules();
--> statement-breakpoint

INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
  ('blog_comments', NULL, 30, 'days', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-10-27', '2000-01-01', 'runRetention: blog_comments',
   'Rejected and spam comments only; an approved one stays with its article, a waiting one until staff decide. REFUSED_COMMENT_DAYS, a test holds them equal.');
