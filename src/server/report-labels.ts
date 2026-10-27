import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { methodGroup } from "@/lib/payment-facts";
import type { DimensionKey } from "@/lib/report-catalogue";

import { CUSTOM_KEY, NONE_KEY, OTHER_KEY, REST_KEY, type ReportResult } from "./report-query";
import { col, typedRows } from "./typed-rows";
import type { Store } from "./stores";

/**
 * The words for a report's rows (wave 8 unit A, D345): a product's or variant's name in the store's main language, a term's name, a
 * country's name in the admin's language, a channel's, a payment method's group, a day, week, month or quarter. Read for the rows a report
 * shows only, every query by the store id; an id that is no longer the store's is shown as it is stored.
 */

export type RowLabels = Map<string, string>;

const ids = (values: Iterable<string>) => [...new Set(values)].filter((v) => z.uuid().safeParse(v).success);
const uuidList = (values: string[]) => sql`${`{${values.join(",")}}`}::uuid[]`;

/** A method key as `METHOD_KEY` writes it, back into `methodGroup()`'s facts, so the label is the Payments by method table's own. */
function methodLabel(key: string, words: { noPayment: string; unknownMethod: string }): string {
  if (key === NONE_KEY) return words.noPayment;
  if (key === "unknown") return words.unknownMethod;
  const [kind, value] = key.includes(":") ? (key.split(":", 2) as [string, string]) : [key, ""];
  if (kind === "manual") return methodGroup({ provider: "manual", manualMethod: value, wallet: null, methodType: null }).label;
  if (kind === "wallet") return methodGroup({ provider: "stripe", wallet: value, methodType: null, manualMethod: null }).label;
  if (kind === "method") return methodGroup({ provider: "stripe", methodType: value, wallet: null, manualMethod: null }).label;
  return methodGroup({ provider: kind, methodType: null, wallet: null, manualMethod: null }).label;
}

function timeLabel(key: DimensionKey, day: string, locale: string, words: { week: string; quarter: string }): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...o }).format(date);
  switch (key) {
    case "day":
      return fmt({ day: "numeric", month: "short", year: "numeric" });
    case "week":
      return fillWords(words.week, { date: fmt({ day: "numeric", month: "short", year: "numeric" }) });
    case "month":
      return fmt({ month: "long", year: "numeric" });
    default:
      return fillWords(words.quarter, { n: String(Math.floor(date.getUTCMonth() / 3) + 1), year: String(date.getUTCFullYear()) });
  }
}

/** Every label a report needs, keyed `{dimension}:{value}`. */
export async function reportLabels(store: Store, report: Pick<ReportResult, "rows" | "spec">, lang: AdminLang, locale: string): Promise<RowLabels> {
  const words = adminText(lang, "customReports");
  const channels = adminText(lang, "reports").channels as Record<string, string>;
  const values = (d: DimensionKey) => {
    const at = report.spec.dimensions.indexOf(d);
    const filtered = report.spec.filters.filter((f) => f.dimension === d).flatMap((f) => f.values);
    return [...(at < 0 ? [] : report.rows.map((r) => r.keys[at])), ...filtered];
  };
  const labels: RowLabels = new Map();
  const set = (d: DimensionKey, value: string, label: string) => labels.set(`${d}:${value}`, label);
  const main = store.localization.locales[0] ?? "en";

  const productIds = ids(values("product"));
  const variantIds = ids(values("variant"));
  const termIds = ids([...values("category"), ...values("tag")]);
  const [productRows, variantRows, termRows] = await Promise.all([
    productIds.length
      ? typedRows(
          z.object({ id: col.uuid, handle: col.text, title: col.textOrNull }),
          sql`select distinct on (p.id) p.id, p.handle, pt.title from commerce.products p
            left join commerce.product_translations pt on pt.product_id = p.id
            where p.store_id = ${store.id}::uuid and p.id = any(${uuidList(productIds)})
            order by p.id, (pt.locale = ${main}) desc nulls last, pt.locale`,
        )
      : [],
    variantIds.length
      ? typedRows(
          z.object({ id: col.uuid, sku: col.textOrNull, handle: col.text, title: col.textOrNull }),
          sql`select distinct on (v.id) v.id, v.sku, p.handle, pt.title from commerce.product_variants v
            join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
            left join commerce.product_translations pt on pt.product_id = p.id
            where v.store_id = ${store.id}::uuid and v.id = any(${uuidList(variantIds)})
            order by v.id, (pt.locale = ${main}) desc nulls last, pt.locale`,
        )
      : [],
    termIds.length
      ? typedRows(z.object({ id: col.uuid, name: col.text }), sql`select id, name from commerce.terms where store_id = ${store.id}::uuid and id = any(${uuidList(termIds)})`)
      : [],
  ]);
  for (const r of productRows) set("product", r.id, r.title ?? r.handle);
  for (const r of variantRows) set("variant", r.id, `${r.title ?? r.handle}${r.sku ? ` · ${r.sku}` : ""}`);
  for (const r of termRows) {
    set("category", r.id, r.name);
    set("tag", r.id, r.name);
  }
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  for (const d of report.spec.dimensions.concat(report.spec.filters.map((f) => f.dimension))) {
    for (const v of values(d)) {
      if (labels.has(`${d}:${v}`)) continue;
      if (v === REST_KEY) set(d, v, words.values.rest);
      else if (v === OTHER_KEY && ["product", "variant", "kind"].includes(d)) set(d, v, words.values.other);
      else if (v === CUSTOM_KEY && ["product", "variant", "kind"].includes(d)) set(d, v, words.values.custom);
      else if (d === "day" || d === "week" || d === "month" || d === "quarter") set(d, v, timeLabel(d, v, locale, words.values));
      else if (d === "market") set(d, v, regions.of(v.trim()) ?? v);
      else if (d === "category") set(d, v, v === NONE_KEY ? words.values.noCategory : v);
      else if (d === "tag") set(d, v, v === NONE_KEY ? words.values.noTag : v);
      else if (d === "discount_code") set(d, v, v === NONE_KEY ? words.values.noCode : v.toUpperCase());
      else if (d === "channel") set(d, v, v === NONE_KEY ? words.values.noVisit : (channels[v] ?? v));
      else if (d === "device") set(d, v, v === NONE_KEY ? words.values.noVisit : ((words.values.devices as Record<string, string>)[v] ?? v));
      else if (d === "payment_method") set(d, v, methodLabel(v, words.values));
      else if (d === "customer_type") set(d, v, v === "new" ? words.values.new : v === "returning" ? words.values.returning : words.values.noCustomer);
      else if (d === "kind") set(d, v, (words.values.kinds as Record<string, string>)[v] ?? v);
      else set(d, v, v);
    }
  }
  return labels;
}

/** A row's label in one dimension. */
export const labelOf = (labels: RowLabels, dimension: DimensionKey, value: string): string => labels.get(`${dimension}:${value}`) ?? value;
