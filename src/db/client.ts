import "server-only";

import type { SQLWrapper } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/lib/env";

import * as schema from "./schema";

let instance: ReturnType<typeof create> | undefined;

function create() {
  const client = postgres(serverEnv().DATABASE_URL, {
    // Supabase's transaction-mode pooler does not support prepared statements.
    prepare: false,
    // Functions are short-lived and many run at once; the pooler does the
    // pooling, so each instance keeps only a few connections.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 5,
  });
  return drizzle(client, { schema });
}

/** The server-side database connection, created on first use. */
export function db() {
  instance ??= create();
  return instance;
}

/**
 * Postgres errors worth one more try: a statement cancelled or timed out,
 * a connection lost or refused, a server restarting, a serialization
 * failure or deadlock. Anything else is a real error.
 */
const TRANSIENT_CODES = new Set([
  "57014", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "40001", "40P01",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT",
]);

/** Whether the error, or what caused it (Drizzle wraps the driver's), is a passing one. */
export function isTransientDbError(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
  }
  return false;
}

/** Runs a read, and once more after a short pause if it failed on a passing error. */
export async function retryTransient<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isTransientDbError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return read();
  }
}

/**
 * For cached reads, which pages are built from (some while the site is
 * built): a read that meets a passing hiccup of the database or its pooler
 * is tried once more rather than failing the page, or the whole build.
 * Only for reads: a write is never repeated.
 */
export function readDb() {
  const database = db();
  return {
    execute: <TRow extends Record<string, unknown> = Record<string, unknown>>(query: SQLWrapper) =>
      retryTransient(async () => database.execute<TRow>(query)),
  };
}

/** Closes the connection (for scripts and tests; servers never need it). */
export async function closeDb(): Promise<void> {
  await instance?.$client.end();
  instance = undefined;
}
