import "server-only";

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
