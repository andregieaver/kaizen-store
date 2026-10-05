import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isDialect, type DialectId } from "@/lib/csv";
import { redirectRows, type ExportRedirect } from "@/lib/redirect-csv";

import type { ExportReader } from "./data-export-run";
import { redirectsForExport } from "./redirects";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The redirect export (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.5): the store's manual redirects (the default), or every redirect including the
 * automatic ones, in the layout `src/lib/redirect-csv.ts` writes (`Redirect from`, `Redirect to`, then `type`, `created`, `used`, `last_used`), by source in
 * order so a run that stops goes on where it was. The file of manual redirects imports back unchanged. Every cell goes through the one CSV writer. The store id
 * is on every statement.
 */

export type RedirectExportOptions = {
  /** The manual redirects (default), or all of them, the automatic ones too. */
  scope: "manual" | "all";
  dialect: DialectId;
};

const optionsSchema = z.object({
  scope: z.enum(["manual", "all"]).default("manual"),
  dialect: z.string().default("standard"),
});

/** The options a form or a job holds, checked. */
export function parseRedirectExportOptions(raw: unknown): { ok: true; options: RedirectExportOptions } | { ok: false; problem: string } {
  const parsed = optionsSchema.safeParse(typeof raw === "object" && raw !== null ? raw : {});
  if (!parsed.success) return { ok: false, problem: "The choices for the export could not be read." };
  if (!isDialect(parsed.data.dialect)) return { ok: false, problem: "Choose a file format." };
  return { ok: true, options: { scope: parsed.data.scope, dialect: parsed.data.dialect } };
}

/** The rows the file will have, for the choice between a download and a job and for the limit. */
export async function countRedirectExportRows(storeId: string, o: RedirectExportOptions): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.redirects where store_id = ${storeId}::uuid ${o.scope === "all" ? sql`` : sql`and kind = 'manual'`}
  `);
  return Number(row?.n ?? 0);
}

/** The reader of an export of the store's redirects. */
export async function redirectExportReader(store: Pick<Store, "id">, o: RedirectExportOptions): Promise<ExportReader> {
  const header = redirectRows([])[0];
  return {
    header,
    dialect: o.dialect,
    fileBase: "redirects",
    total: () => countRedirectExportRows(store.id, o),
    async read(position, limit) {
      const after = typeof position === "string" ? position : null;
      const page = await redirectsForExport(store.id, { automatic: o.scope === "all", after, limit });
      const rows: ExportRedirect[] = page.rows;
      return { rows: redirectRows(rows).slice(1), position: page.last, more: page.more, units: rows.length };
    },
  };
}
