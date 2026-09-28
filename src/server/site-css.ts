import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";

import { audit, type Account } from "./auth";

/**
 * An owner's own CSS for every page of its site (D100): a store's
 * (`stores.custom_css`) or Kaizen's (`platform_settings.custom_css`, owner
 * null). It goes live when saved; callers refresh the site's cache.
 */
export async function saveSiteCss(
  account: Account,
  owner: string | null,
  input: unknown,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const css = typeof input === "string" ? input.trim() : "";
  const problem = cssProblem(css);
  if (problem) return { ok: false, problems: [problem] };
  if (owner === null) {
    await db().execute(sql`update commerce.platform_settings set custom_css = ${css}, updated_at = now(), updated_by = ${account.id}::uuid`);
  } else {
    await db().execute(sql`update commerce.stores set custom_css = ${css} where id = ${owner}::uuid`);
  }
  await audit(account.id, owner, owner === null ? "platform.css_saved" : "store.css_saved", { length: css.length });
  return { ok: true };
}
