import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const SHARED = { testTimeout: 20_000, hookTimeout: 60_000 };
const SKIP = ["src/**/*.int.test.ts", "node_modules/**"];

// Three projects, so a test loads only what it uses (bloat review step 0.39): `components` draws admin parts and needs their
// English settled before a test (src/test/admin-english.ts: 93 modules); `db` opens the migrated test database, built once
// (src/test/test-db-template.ts); `unit` is everything else. Integration tests need a database: `pnpm test:int`. Parts loaded
// with next/dynamic are drawn whole in both projects that draw parts (D211). src/lib/ci-once.scan.test.ts holds this layout.
// Nothing is set at the root of `test`: arrays there are merged into every project, so a root setup file would come back everywhere.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "components",
          include: ["src/components/**/*.test.ts"],
          exclude: SKIP,
          setupFiles: ["src/test/eager-lazy-views.ts", "src/test/admin-english.ts"],
          ...SHARED,
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["src/db/**/*.test.ts"],
          exclude: SKIP,
          globalSetup: ["src/test/test-db-template.ts"],
          ...SHARED,
        },
      },
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: [...SKIP, "src/components/**", "src/db/**"],
          setupFiles: ["src/test/eager-lazy-views.ts"],
          ...SHARED,
        },
      },
    ],
  },
});
