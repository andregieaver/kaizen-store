import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { greenClaimsIn, textOfContent, type GreenFinding } from "@/lib/green-claims";
import { readPassport } from "@/lib/product-passport";

import { col, typedRows } from "./typed-rows";

/**
 * Environmental claims on a store's live site (D552, `src/lib/green-claims.ts`): its active products' texts in every language and its
 * published pages and articles, read now. Read-only; the owner rewrites each where it is written. At most `limit` findings.
 */

export type GreenClaimPlace = {
  kind: "product" | "page" | "article";
  id: string;
  title: string;
  /** The language or field it was found in, such as `nb-NO` or `nb-NO SEO description`. */
  where: string;
  findings: GreenFinding[];
};

const PRODUCT_FIELDS = [
  ["title", ""],
  ["description", ""],
  ["excerpt", " excerpt"],
  ["seo_title", " SEO title"],
  ["seo_description", " SEO description"],
  ["safety_information", " safety information"],
] as const;

export async function greenClaimsReport(storeId: string, limit = 300): Promise<{ places: GreenClaimPlace[]; claims: number }> {
  const [products, pages, passports] = await Promise.all([
    typedRows(
      z.object({
        id: col.uuid,
        locale: col.text,
        title: col.textOrNull,
        description: col.textOrNull,
        excerpt: col.textOrNull,
        seo_title: col.textOrNull,
        seo_description: col.textOrNull,
        safety_information: col.textOrNull,
      }),
      sql`select p.id, t.locale, t.title, t.description, t.excerpt, t.seo_title, t.seo_description, t.safety_information
          from commerce.products p join commerce.product_translations t on t.store_id = p.store_id and t.product_id = p.id
          where p.store_id = ${storeId}::uuid and p.status = 'active'
          order by p.created_at, p.id, t.locale`,
    ),
    typedRows(
      z.object({ id: col.uuid, type: col.text, published: z.unknown() }),
      sql`select id, type, published from commerce.pages where store_id = ${storeId}::uuid and published is not null order by created_at, id`,
    ),
    // Published product passports (D554): their care, repair and end-of-life words are claims about the product too.
    typedRows(
      z.object({ product_id: col.uuid, title: col.textOrNull, data: z.unknown() }),
      sql`select pp.product_id, (select t.title from commerce.product_translations t where t.store_id = pp.store_id and t.product_id = pp.product_id order by t.locale limit 1) as title, pp.data
          from commerce.product_passports pp where pp.store_id = ${storeId}::uuid and pp.published_at is not null order by pp.created_at`,
    ),
  ]);
  const places: GreenClaimPlace[] = [];
  let claims = 0;
  const push = (place: GreenClaimPlace) => {
    if (place.findings.length === 0 || claims >= limit) return;
    places.push(place);
    claims += place.findings.length;
  };
  for (const row of products) {
    for (const [field, label] of PRODUCT_FIELDS) {
      push({ kind: "product", id: row.id, title: row.title ?? "", where: `${row.locale}${label}`, findings: greenClaimsIn(row[field] ?? "") });
    }
  }
  for (const page of pages) {
    const published = (page.published ?? {}) as Record<string, unknown>;
    const title = typeof published.title === "string" ? published.title : "";
    push({ kind: page.type === "article" ? "article" : "page", id: page.id, title, where: "", findings: greenClaimsIn(textOfContent(published)) });
  }
  for (const passport of passports) {
    const d = readPassport(passport.data);
    push({ kind: "product", id: passport.product_id, title: passport.title ?? "", where: "passport", findings: greenClaimsIn([d.care, d.repair, d.endOfLife, d.substances].filter(Boolean).join("\n")) });
  }
  return { places, claims };
}
