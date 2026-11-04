import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { RESPONSIBLE_AREAS, type ProductSafety } from "@/lib/product-safety";

import { col, typedRows } from "./typed-rows";

const MEMBERSHIP = z.object({ code: col.text, eu: col.bool, eea: col.bool });
const RULE = z.object({ destination: col.text, responsible_person: z.enum(RESPONSIBLE_AREAS) });

/**
 * The EU and EEA classifications and each destination's configured rule (D452, `docs/product-safety-eea.md`), read from
 * `commerce.country_memberships` and `commerce.product_safety_rules`: what the product check (`productProblems()`) and *Who makes your
 * products?* hold a manufacturer to. The database's publish check reads the same rows.
 */
export async function productSafety(): Promise<ProductSafety> {
  const [members, rules] = await Promise.all([
    typedRows(MEMBERSHIP, sql`select code, eu, eea from commerce.country_memberships`),
    typedRows(RULE, sql`select destination, responsible_person from commerce.product_safety_rules`),
  ]);
  return {
    eu: new Set(members.filter((m) => m.eu).map((m) => m.code)),
    eea: new Set(members.filter((m) => m.eea).map((m) => m.code)),
    rules: new Map(rules.map((r) => [r.destination, r.responsible_person])),
  };
}
