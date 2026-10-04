-- Staff security and the activity log (wave 1, 1f, docs/wave-1-trust.md): the rules that live in the database.
-- Like every commerce table, row-level security on and no policies, so the Data API reaches none of it.
ALTER TABLE commerce.account_recovery_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.store_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Recovery codes (second step): the plaintext is never stored, only an HMAC of it (the check on code_hash). A code is
-- single use: used_at is set once and never changed, a code revoked by a new set can never be used, and nothing else
-- about a row changes. The rows of used and revoked codes are pruned after 12 months by the daily job in application code.
CREATE FUNCTION commerce.guard_recovery_code() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id OR NEW.batch <> OLD.batch
     OR NEW.code_hash <> OLD.code_hash OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'recovery_codes.fixed: a recovery code only changes by being used or revoked' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'recovery_codes.single_use: a recovery code is used once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'recovery_codes.revoked: a revoked recovery code stays revoked' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND OLD.used_at IS NULL AND NEW.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'recovery_codes.revoked: a revoked recovery code cannot be used' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_recovery_codes_guard
  BEFORE UPDATE ON commerce.account_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_recovery_code();
--> statement-breakpoint

-- The area an action belongs to, for the rows written before audit_log had the column. It is made from the same table as
-- AUDIT_AREAS in src/lib/audit.ts (exact actions first, then the longest prefix) and a test holds the two together.
CREATE FUNCTION commerce.audit_area_of(p_action text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_action = 'shipping.bring_booked' THEN 'orders'
    WHEN p_action = 'shipping.helthjem_booked' THEN 'orders'
    WHEN p_action = 'shipping.porterbuddy_booked' THEN 'orders'
    WHEN p_action = 'company.office_saved' THEN 'settings'
    WHEN p_action = 'store.bonus_settings' THEN 'marketing'
    WHEN p_action = 'store.affiliate_settings' THEN 'marketing'
    WHEN p_action = 'store.fields_updated' THEN 'website'
    WHEN p_action = 'store.ai_translated' THEN 'website'
    WHEN p_action = 'store.front_page_changed' THEN 'website'
    WHEN p_action = 'store.products_page_changed' THEN 'website'
    WHEN p_action = 'store.page_role_changed' THEN 'website'
    WHEN p_action = 'store.legal_role_changed' THEN 'website'
    WHEN p_action = 'store.navigation_updated' THEN 'website'
    WHEN p_action = 'store.part_sharing' THEN 'website'
    WHEN p_action = 'activity.exported' THEN 'staff'
    WHEN p_action = 'store.two_step_required' THEN 'staff'
    WHEN p_action = 'store.two_step_optional' THEN 'staff'
    WHEN p_action = 'store.legal_starter_made' THEN 'website'
    WHEN starts_with(p_action, 'store.product_layout_') THEN 'products'
    WHEN starts_with(p_action, 'store.products_page_') THEN 'website'
    WHEN starts_with(p_action, 'store.saved_theme_') THEN 'website'
    WHEN starts_with(p_action, 'booking_resource.') THEN 'bookings'
    WHEN starts_with(p_action, 'store.front_page_') THEN 'website'
    WHEN starts_with(p_action, 'google.platform_') THEN 'platform'
    WHEN starts_with(p_action, 'recommendations.') THEN 'marketing'
    WHEN starts_with(p_action, 'cart_reminders.') THEN 'marketing'
    WHEN starts_with(p_action, 'plan_reminders.') THEN 'platform'
    WHEN starts_with(p_action, 'vat.') THEN 'platform'
    WHEN starts_with(p_action, 'product_layout.') THEN 'products'
    WHEN starts_with(p_action, 'resource_block.') THEN 'bookings'
    WHEN starts_with(p_action, 'store.template_') THEN 'website'
    WHEN starts_with(p_action, 'store.two_step_') THEN 'staff'
    WHEN starts_with(p_action, 'calendar_feed.') THEN 'bookings'
    WHEN starts_with(p_action, 'company.place_') THEN 'settings'
    WHEN starts_with(p_action, 'store.article_') THEN 'website'
    WHEN starts_with(p_action, 'localization.') THEN 'settings'
    WHEN starts_with(p_action, 'store.footer_') THEN 'website'
    WHEN starts_with(p_action, 'store.header_') THEN 'website'
    WHEN starts_with(p_action, 'ai.platform_') THEN 'platform'
    WHEN starts_with(p_action, 'field_group.') THEN 'website'
    WHEN starts_with(p_action, 'integration.') THEN 'settings'
    WHEN starts_with(p_action, 'search_test.') THEN 'marketing'
    WHEN starts_with(p_action, 'store.fonts_') THEN 'website'
    WHEN starts_with(p_action, 'store.media_') THEN 'website'
    WHEN starts_with(p_action, 'store.theme_') THEN 'website'
    WHEN starts_with(p_action, 'deliveries.') THEN 'orders'
    WHEN starts_with(p_action, 'experiment.') THEN 'marketing'
    WHEN starts_with(p_action, 'store.menu_') THEN 'website'
    WHEN starts_with(p_action, 'store.page_') THEN 'website'
    WHEN starts_with(p_action, 'store.part_') THEN 'website'
    WHEN starts_with(p_action, 'analytics.') THEN 'analytics'
    WHEN starts_with(p_action, 'knowledge.') THEN 'settings'
    WHEN starts_with(p_action, 'store.css_') THEN 'website'
    WHEN starts_with(p_action, 'bookings.') THEN 'bookings'
    WHEN starts_with(p_action, 'campaign.') THEN 'marketing'
    WHEN starts_with(p_action, 'customer.') THEN 'customers'
    WHEN starts_with(p_action, 'discount.') THEN 'marketing'
    WHEN starts_with(p_action, 'language.') THEN 'platform'
    WHEN starts_with(p_action, 'payments.') THEN 'settings'
    WHEN starts_with(p_action, 'platform.') THEN 'platform'
    WHEN starts_with(p_action, 'products.') THEN 'products'
    WHEN starts_with(p_action, 'shipping.') THEN 'settings'
    WHEN starts_with(p_action, 'account.') THEN 'account'
    WHEN starts_with(p_action, 'article.') THEN 'website'
    WHEN starts_with(p_action, 'billing.') THEN 'billing'
    WHEN starts_with(p_action, 'booking.') THEN 'orders'
    WHEN starts_with(p_action, 'company.') THEN 'customers'
    WHEN starts_with(p_action, 'cookies.') THEN 'settings'
    WHEN starts_with(p_action, 'product.') THEN 'products'
    WHEN starts_with(p_action, 'returns.') THEN 'settings'
    WHEN starts_with(p_action, 'footer.') THEN 'website'
    WHEN starts_with(p_action, 'google.') THEN 'settings'
    WHEN starts_with(p_action, 'header.') THEN 'website'
    WHEN starts_with(p_action, 'return.') THEN 'orders'
    WHEN starts_with(p_action, 'hosts.') THEN 'bookings'
    WHEN starts_with(p_action, 'order.') THEN 'orders'
    WHEN starts_with(p_action, 'staff.') THEN 'staff'
    WHEN starts_with(p_action, 'store.') THEN 'settings'
    WHEN starts_with(p_action, 'chat.') THEN 'settings'
    WHEN starts_with(p_action, 'host.') THEN 'bookings'
    WHEN starts_with(p_action, 'page.') THEN 'website'
    WHEN starts_with(p_action, 'role.') THEN 'staff'
    WHEN starts_with(p_action, 'site_') THEN 'website'
    WHEN starts_with(p_action, 'term.') THEN 'website'
    WHEN starts_with(p_action, 'tier.') THEN 'customers'
    WHEN starts_with(p_action, 'work.') THEN 'settings'
    WHEN starts_with(p_action, 'ai.') THEN 'settings'
    ELSE 'settings'
  END
$$;
--> statement-breakpoint

-- The activity log is append-only (wave 1, 1f): the one update allowed fills a row's area once, from null, and changes
-- nothing else; a row can be removed only when it is older than the retention period (24 months, AUDIT_RETENTION_MONTHS
-- in src/lib/audit.ts, which a test holds equal to the figure here), and then by the daily job in application code. No
-- statement of removal is inside this function: it only says yes or no.
CREATE FUNCTION commerce.guard_audit_log() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.area IS NULL AND NEW.area IS NOT NULL
       AND NEW.id = OLD.id
       AND NEW.store_id IS NOT DISTINCT FROM OLD.store_id
       AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
       AND NEW.action = OLD.action
       AND NEW.details = OLD.details
       AND NEW.created_at = OLD.created_at
       AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
       AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
       AND NEW.changes IS NOT DISTINCT FROM OLD.changes THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'commerce.audit_log is append-only; % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.created_at < now() - interval '24 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'commerce.audit_log is append-only for 24 months; % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER audit_log_append_only ON commerce.audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_guard
  BEFORE UPDATE OR DELETE ON commerce.audit_log
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_audit_log();
--> statement-breakpoint

-- The rows from before the area column get theirs from their action (one update; the guard above allows exactly this).
-- The readers use coalesce(area, the same rules in code), so a failed backfill changes nothing they show.
UPDATE commerce.audit_log SET area = commerce.audit_area_of(action) WHERE area IS NULL;
