import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { readDb } from "@/db/client";
import type { FormRecord } from "@/lib/form-records";
import { formRowShape } from "@/lib/form-records-schema";

import { log } from "./log";
import { owned } from "./owned";
import { col, typedRow } from "./typed-rows";

/**
 * A form as the site reads it (D705): the row's shape and `siteForm()`, cached under the owner's forms tag, apart from the owner's writes
 * (`forms-admin.ts`) so the storefront draws a form without loading the admin's code.
 */

type Owner = string | null;

export const formsTag = (owner: Owner) => (owner === null ? "forms:platform" : `forms:${owner}`);

export const formRow = z.object({
  id: col.uuid,
  store_id: col.textOrNull,
  kind: z.enum(["message", "signup"]),
  name: col.text,
  status: z.enum(["active", "archived"]),
  questions: z.unknown(),
  words: z.unknown(),
  delivery: z.unknown(),
  signup: z.unknown(),
  keep_months: col.int,
  made_from: col.textOrNull,
});

/** A row as a form; parts that no longer read (an older shape) become empty rather than failing the page. */
export function asForm(row: z.output<typeof formRow>): FormRecord {
  const part = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) log("warn", "forms.part_unreadable", { formId: row.id });
    return parsed.success ? parsed.data : fallback;
  };
  return {
    id: row.id,
    storeId: row.store_id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    questions: part(formRowShape.questions, row.questions, []),
    words: part(formRowShape.words, row.words, {}),
    delivery: part(formRowShape.delivery, row.delivery, { recipients: [], subject: "" }),
    signup: row.kind === "signup" ? part(formRowShape.signup, row.signup, { confirm: true, askName: false }) : null,
    keepMonths: row.keep_months,
    madeFrom: row.made_from,
  };
}

export const FORM_COLUMNS = sql`id, store_id, kind, name, status, questions, words, delivery, signup, keep_months, made_from`;


/** A form as the site reads it: cached under the owner's forms tag, refreshed by every change here. */
export async function siteForm(owner: Owner, id: string): Promise<FormRecord | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(formsTag(owner));
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(formRow, sql`select ${FORM_COLUMNS} from commerce.forms where id = ${id}::uuid and ${owned(owner)}`, readDb());
  return row ? asForm(row) : null;
}

