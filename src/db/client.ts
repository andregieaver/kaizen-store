import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/lib/env";

import * as schema from "./schema";

let instance: ReturnType<typeof create> | undefined;

function create() {
  // Supabase's transaction-mode pooler does not support prepared statements.
  const client = postgres(serverEnv().DATABASE_URL, { prepare: false });
  return drizzle(client, { schema });
}

/** The server-side database connection, created on first use. */
export function db() {
  instance ??= create();
  return instance;
}
