import postgres from "postgres";

/** Direct database access for arranging test data (e.g. approving a request). */
export function testDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for the end-to-end tests");
  return postgres(url, { max: 1, onnotice: () => {} });
}
