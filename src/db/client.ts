import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import type { SQLWrapper } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { Pool, type PoolConfig } from "pg";

import { serverEnv } from "@/lib/env";

import * as schema from "./schema";

/** Seconds an unused connection stays open. */
const IDLE_SECONDS = 5;

/**
 * The connection string, and TLS as its `sslmode` asks: "require" encrypts
 * without checking the pooler's certificate, "verify-*" checks it too, and
 * no mode connects as the pooler allows.
 */
function connectionConfig(url: string): PoolConfig {
  const parsed = new URL(url);
  const mode = parsed.searchParams.get("sslmode");
  parsed.searchParams.delete("sslmode");
  return {
    connectionString: parsed.toString(),
    ssl: !mode || mode === "disable" ? false : { rejectUnauthorized: mode.startsWith("verify") },
  };
}

type Database = NodePgDatabase<typeof schema>;

/** The database as the app uses it: `execute` gives the rows, in a transaction too. */
export type Db = Omit<Database, "execute" | "transaction"> & {
  execute<TRow extends Record<string, unknown> = Record<string, unknown>>(query: SQLWrapper | string): Promise<TRow[]>;
  transaction<T>(run: (tx: Db) => Promise<T>, config?: PgTransactionConfig): Promise<T>;
};

function withRows(database: object): Db {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "execute") {
        return async (query: SQLWrapper | string) => (await (target as Database).execute(query)).rows;
      }
      if (property === "transaction") {
        return <T>(run: (tx: Db) => Promise<T>, config?: PgTransactionConfig) =>
          (target as Database).transaction((tx) => run(withRows(tx)), config);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Db;
}

/**
 * The driver is node-postgres (D37): it sends a query and its values in one
 * message and one query at a time per connection, which the transaction-mode
 * pooler handles well. (postgres.js sent a query with values in two halves
 * and pipelined queries; through the pooler a half could reach another
 * Postgres connection, leaving the query waiting forever and pages stuck on
 * their loading placeholders.)
 */
function create() {
  const pool = new Pool({
    ...connectionConfig(serverEnv().DATABASE_URL),
    // Functions are short-lived and many run at once; the pooler does the
    // pooling, so each instance keeps only a few connections.
    max: 5,
    idleTimeoutMillis: IDLE_SECONDS * 1000,
    connectionTimeoutMillis: 5000,
  });
  // A connection the pooler closes while idle must not take the function down.
  pool.on("error", () => {});
  // Vercel freezes an instance between requests; frozen with connections
  // open, it would wake up to dead ones. This keeps the instance running
  // after each query until its idle connections have closed.
  attachDatabasePool(pool);
  return { pool, database: withRows(drizzle({ client: pool, schema })) };
}

let instance: ReturnType<typeof create> | undefined;

/** The server-side database connection, created on first use. */
export function db(): Db {
  instance ??= create();
  return instance.database;
}

/**
 * Postgres errors worth one more try: a statement cancelled or timed out,
 * a connection lost or refused, a server restarting, a serialization
 * failure or deadlock. Anything else is a real error.
 */
const TRANSIENT_CODES = new Set([
  "57014", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "40001", "40P01",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
]);

/** Whether the error, or what caused it (Drizzle wraps the driver's), is a passing one. */
export function isTransientDbError(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
    // node-postgres names a lost connection or a slow connect only in words.
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string" && /Connection terminated|timeout exceeded when trying to connect/i.test(message)) return true;
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
  await instance?.pool.end();
  instance = undefined;
}
