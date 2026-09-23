import { defineConfig } from "drizzle-kit";

// Migrations are generated from src/db/schema.ts into supabase/migrations, named
// the way the Supabase CLI expects, and applied with Supabase tooling.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./supabase/migrations",
  schemaFilter: ["commerce"],
  migrations: { prefix: "supabase" },
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
