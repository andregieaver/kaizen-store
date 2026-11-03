-- How a store shows prices and quantities (D429, D430) is one of its settings, so it comes along when a store is copied (D129): the store's
-- decimals, words around a product's price and quantity chooser, each country's own decimals, and each copied product's own words. A store
-- made from a store template (D175) takes the template's three settings, as it takes its other cart and checkout settings.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.oid = 'commerce.duplicate_store'::regproc;
  IF position('s.quantity_picker' in v_def) = 0 THEN
    v_new := replace(replace(replace(replace(replace(replace(v_def,
      'time_zone, booking_reminder_hours, custom_css, locales, rates_auto, rates_updated_at',
      'time_zone, booking_reminder_hours, custom_css, locales, rates_auto, rates_updated_at, price_decimals, price_words, quantity_picker'),
      's.booking_reminder_hours, s.custom_css, s.locales, s.rates_auto, s.rates_updated_at',
      's.booking_reminder_hours, s.custom_css, s.locales, s.rates_auto, s.rates_updated_at, s.price_decimals, s.price_words, s.quantity_picker'),
      '(store_id, code, currency, default_locale, locales, active, created_at)',
      '(store_id, code, currency, default_locale, locales, active, created_at, price_decimals)'),
      'SELECT v_store, code, currency, default_locale, locales, active, created_at',
      'SELECT v_store, code, currency, default_locale, locales, active, created_at, price_decimals'),
      'sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes',
      'sold_by_measure, bundle_pricing, bundle_percent_off, standard_category, standard_attributes, price_words'),
      'p.bundle_pricing, p.bundle_percent_off, p.standard_category, p.standard_attributes',
      'p.bundle_pricing, p.bundle_percent_off, p.standard_category, p.standard_attributes, p.price_words');
    IF (length(v_new) - length(v_def)) <> length(', price_decimals, price_words, quantity_picker') + length(', s.price_decimals, s.price_words, s.quantity_picker')
        + 2 * length(', price_decimals') + length(', price_words') + length(', p.price_words') THEN
      RAISE EXCEPTION 'duplicate_store: the store, market or product copy was not found';
    END IF;
    EXECUTE v_new;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.oid = 'commerce.clone_starter_setup'::regproc;
  IF position('quantity_picker = t.quantity_picker' in v_def) = 0 THEN
    v_new := replace(v_def,
      'custom_css = t.custom_css,',
      'custom_css = t.custom_css,
         price_decimals = t.price_decimals,
         price_words = t.price_words,
         quantity_picker = t.quantity_picker,');
    IF v_new = v_def THEN RAISE EXCEPTION 'clone_starter_setup: the store settings copy was not found'; END IF;
    EXECUTE v_new;
  END IF;
END;
$patch$;
