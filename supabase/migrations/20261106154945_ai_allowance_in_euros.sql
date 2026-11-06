-- The AI a plan includes on Kaizena Flow's key, in euros (D474): the rules the database holds.
--
-- * `usd_per_euro(day)` is the ECB's dollar rate for a day: the last one published on or before it (a weekend or a holiday takes
--   the working day before), else the first one stored, else 1 in a database that has no rates yet (a new one before the daily
--   job has run). The models' prices are in dollars (D145); the AI a store used is counted in euros at this rate, one day at a time.
-- * The days already measured (`store_usage_daily`, metric `ai_cost_micros`) were millionths of a dollar: each becomes millionths of
--   a euro at its own day's rate, so a month counted before and after this change adds up in one currency.
-- * The limits (`plan_limits`, `limit_overrides`, key `ai_cost_month_micros`) and a sandbox's allowance (`platform_settings.
--   sandbox_ai_micros`) keep their numbers, now in euros: the platform admin typed 5 for five, and five is what a plan says.

CREATE OR REPLACE FUNCTION commerce.usd_per_euro(p_day date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT r.rate FROM commerce.ecb_reference_rates r WHERE r.currency = 'USD' AND r.rate_date <= p_day ORDER BY r.rate_date DESC LIMIT 1),
    (SELECT r.rate FROM commerce.ecb_reference_rates r WHERE r.currency = 'USD' ORDER BY r.rate_date LIMIT 1),
    1::numeric
  )
$$;
--> statement-breakpoint

UPDATE commerce.store_usage_daily
   SET value = round(value / commerce.usd_per_euro(day))::bigint, updated_at = now()
 WHERE metric = 'ai_cost_micros';
