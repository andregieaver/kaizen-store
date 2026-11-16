-- Heatmaps (D656, docs/heatmaps-and-recordings.md 6.2): a page view's summary is added to its day's totals element by element.
CREATE FUNCTION commerce.add_int_arrays(a integer[], b integer[]) RETURNS integer[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
  AS $$ select array_agg(x + y order by i) from unnest(a, b) with ordinality as t(x, y, i) $$;--> statement-breakpoint
CREATE FUNCTION commerce.add_bigint_arrays(a bigint[], b bigint[]) RETURNS bigint[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
  AS $$ select array_agg(x + y order by i) from unnest(a, b) with ordinality as t(x, y, i) $$;
