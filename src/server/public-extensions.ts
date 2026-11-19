import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { readDb } from "@/db/client";
import type { PublicExtensions, PublicPrice } from "@/lib/extension-offer";
import { EXTENSION_IDS, isExtensionId, type ExtensionId } from "@/lib/extensions";

import { PLANS_TAG } from "./public-plans";
import { col, typedRows } from "./typed-rows";

/** The tag every change to the extensions, their sizes, prices, bundles, plan grants or the founding offer refreshes (D748 E8). */
export const EXTENSIONS_TAG = "extensions";

const interval = z.enum(["month", "year"]);
const PRICE_ROW = z.object({ owner: col.text, currency: col.currency, interval, amount_minor: col.minor, founding_minor: col.minorOrNull });

/**
 * Kaizena Flow's extensions on offer, each with its smallest offered size and that size's prices, the bundles on offer with theirs, the
 * active plans with what each includes, and the founding offer, for the Extensions block (D748 E8). Only what a visitor may see: nothing about
 * an account or Stripe. Cached under `EXTENSIONS_TAG` (and `PLANS_TAG`, for the plans' names); read again when the founding offer ends
 * within the hour, else hourly.
 */
export async function getPublicExtensions(): Promise<PublicExtensions> {
  "use cache";
  cacheTag(EXTENSIONS_TAG, PLANS_TAG);
  const db = readDb();
  const [extensions, sizes, sizePrices, bundles, members, bundlePrices, plans, grants, founding] = await Promise.all([
    typedRows(
      z.object({ id: col.text, name: col.text, description: col.text, standalone: col.bool }),
      sql`select id, name, description, standalone from commerce.extensions where active order by position, id`,
      db,
    ),
    typedRows(
      z.object({ id: col.uuid, extension_id: col.text, label: col.text }),
      sql`
        select distinct on (extension_id) id, extension_id, label from commerce.extension_sizes
         where active order by extension_id, position, created_at
      `,
      db,
    ),
    typedRows(PRICE_ROW, sql`select size_id::text as owner, currency, interval, amount_minor, founding_minor from commerce.extension_prices where active`, db),
    typedRows(
      z.object({ id: col.uuid, name: col.text, description: col.text }),
      sql`select id, name, description from commerce.extension_bundles where active order by position, created_at`,
      db,
    ),
    typedRows(z.object({ bundle_id: col.uuid, extension_id: col.text }), sql`select bundle_id, extension_id from commerce.extension_bundle_members`, db),
    typedRows(PRICE_ROW, sql`select bundle_id::text as owner, currency, interval, amount_minor, founding_minor from commerce.extension_bundle_prices where active`, db),
    typedRows(
      z.object({ id: col.uuid, name: col.text, position: col.int }),
      sql`select id, name, position from commerce.plans where active order by position, lower(name)`,
      db,
    ),
    typedRows(z.object({ plan_id: col.uuid, extension_id: col.text }), sql`select plan_id, extension_id from commerce.plan_extension_grants`, db),
    typedRows(
      z.object({ until: col.timestampOrNull, months: col.int, ends_in: z.number().nullable() }),
      sql`
        select extension_founding_until as until, extension_founding_months as months,
               extract(epoch from extension_founding_until - now())::float8 as ends_in
          from commerce.platform_settings
      `,
      db,
    ),
  ]);
  const offer = founding[0];
  const endsIn = offer?.ends_in ?? null;
  if (endsIn !== null && endsIn > 0 && endsIn < 3600) cacheLife({ revalidate: Math.max(60, Math.ceil(endsIn)) });
  else cacheLife("hours");
  const priceOf = (row: z.output<typeof PRICE_ROW>): PublicPrice => ({
    currency: row.currency,
    interval: row.interval,
    amountMinor: row.amount_minor,
    foundingMinor: row.founding_minor,
  });
  const order = (id: ExtensionId) => EXTENSION_IDS.indexOf(id);
  return {
    extensions: extensions.flatMap((e) => {
      if (!isExtensionId(e.id)) return [];
      const size = sizes.find((s) => s.extension_id === e.id);
      return [
        {
          id: e.id,
          name: e.name,
          description: e.description,
          standalone: e.standalone,
          size: size ? { label: size.label, prices: sizePrices.filter((p) => p.owner === size.id).map(priceOf) } : null,
        },
      ];
    }),
    bundles: bundles.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      members: members
        .filter((m) => m.bundle_id === b.id)
        .map((m) => m.extension_id)
        .filter(isExtensionId)
        .sort((x, y) => order(x) - order(y)),
      prices: bundlePrices.filter((p) => p.owner === b.id).map(priceOf),
    })),
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      includes: grants
        .filter((g) => g.plan_id === p.id)
        .map((g) => g.extension_id)
        .filter(isExtensionId),
    })),
    // An offer that has ended is not shown: the cache is read again within the hour it ends, by the database's clock (no clock in the page).
    founding: { until: offer?.until && endsIn !== null && endsIn > 0 ? offer.until : null, months: offer?.months ?? 12 },
  };
}
