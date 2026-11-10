import { buildTestDatabaseTemplate } from "../db/testing";

/** Before the unit tests: the migrated test database is made once and kept (`src/db/testing.ts`, code review FD2). */
export default async function setup(): Promise<void> {
  await buildTestDatabaseTemplate();
}
