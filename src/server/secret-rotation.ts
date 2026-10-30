import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret, keyId, parseKey, previousKeys } from "@/lib/secret-box";

import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * Moving every kept secret to the current settings key (PSI SEC-06, `docs/runbooks/key-rotation.md`). While
 * `SETTINGS_ENCRYPTION_KEY_PREVIOUS` is set, the five-minute dispatcher reads each secret not yet under the current key with the key it was
 * kept under and writes it again under the current one (`v2.<kid>.…`), a batch a run, each row changed only if it still holds what was
 * read. Outside a rotation it does nothing. The columns are found, not listed: every text column of `commerce` whose name says it may hold
 * one (`SECRET_COLUMN_NAME`), and in them only values in the secret box's own format (`KEPT_SECRET`), so a token kept as a hash, or a
 * public one, is never touched. Counts and column names are logged, never a value.
 */

/** Names of columns that may hold a kept secret. */
export const SECRET_COLUMN_NAME = "(encrypt|cipher|token|secret|_box)";
/** A value in the secret box's format: `v1.<iv>.<tag>.<ct>` or `v2.<kid>.<iv>.<tag>.<ct>`, the iv 12 bytes and the tag 16. */
export const KEPT_SECRET = "^(v1|v2\\.[0-9a-f]{8})\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]*$";
const BATCH = 200;

type Column = { table: string; column: string };

/** The text columns of `commerce` that may hold a kept secret. */
export async function secretColumns(): Promise<Column[]> {
  return typedRows(
    z.object({ table: col.text, column: col.text }),
    sql`
      select c.table_name as "table", c.column_name as "column"
        from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'commerce' and c.data_type = 'text' and c.column_name ~ ${SECRET_COLUMN_NAME}
       order by 1, 2
    `,
  );
}

/**
 * The secrets of a column still to move: every `v1` (it names no key), and every `v2` naming one of the previous keys. A `v2` naming a key
 * this server does not have is never picked: no run could open it, and it would take a batch's place every five minutes.
 */
const toMove = (column: Column, key: Buffer, older: Buffer[]) => {
  const names = older.filter((one) => keyId(one) !== keyId(key)).map((one) => `v2.${keyId(one)}.%`);
  return sql`
    ${sql.identifier(column.column)} ~ ${KEPT_SECRET}
    and (${sql.identifier(column.column)} like 'v1.%' or ${sql.identifier(column.column)} like any(${`{${names.join(",")}}`}::text[]))
  `;
};

/** How many kept secrets are still to move to `key`, over every column. */
export async function secretsToMove(key: Buffer, older: Buffer[], columns?: Column[]): Promise<number> {
  let left = 0;
  for (const column of columns ?? (await secretColumns())) {
    const [row] = await typedRows(
      z.object({ n: col.int }),
      sql`select count(*)::int as n from commerce.${sql.identifier(column.table)} where ${toMove(column, key, older)}`,
    );
    left += row?.n ?? 0;
  }
  return left;
}

/**
 * One run of the move: up to `batch` secrets written again under the current key. A `v1` secret neither key opens is left as it is and
 * counted as failed (the runbook says what then). Outside a rotation (no previous key, or no current one) it reads nothing.
 */
export async function reencryptSecrets(
  key: Buffer | null = parseKey(process.env.SETTINGS_ENCRYPTION_KEY),
  older: Buffer[] = previousKeys(),
  batch = BATCH,
): Promise<{ moved: number; failed: number; left: number }> {
  if (!key || older.length === 0) return { moved: 0, failed: 0, left: 0 };
  const columns = await secretColumns();
  let moved = 0;
  let failed = 0;
  for (const column of columns) {
    if (moved + failed >= batch) break;
    const rows = await typedRows(
      z.object({ at: col.text, kept: col.text }),
      sql`
        select ctid::text as at, ${sql.identifier(column.column)} as kept from commerce.${sql.identifier(column.table)}
         where ${toMove(column, key, older)} limit ${batch - moved - failed}
      `,
    );
    for (const row of rows) {
      let fresh: string;
      try {
        fresh = encryptSecret(decryptSecret(row.kept, key, older), key, "v2");
      } catch {
        failed += 1;
        log("warn", "secrets.rotation_unreadable", { table: column.table, column: column.column });
        continue;
      }
      await db().execute(sql`
        update commerce.${sql.identifier(column.table)} set ${sql.identifier(column.column)} = ${fresh}
         where ctid = ${row.at}::tid and ${sql.identifier(column.column)} = ${row.kept}
      `);
      moved += 1;
    }
  }
  const left = await secretsToMove(key, older, columns);
  log("info", "secrets.rotation", { moved, failed, left });
  return { moved, failed, left };
}
