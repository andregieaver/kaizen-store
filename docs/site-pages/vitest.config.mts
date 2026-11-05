// Runs the generators of Kaizena Flow's own pages made by Claude (docs/site-design.md 9, docs/site-pages/README.md): `pnpm exec vitest run --config docs/site-pages/vitest.config.mts`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { include: ["docs/site-pages/*.test.ts"], testTimeout: 60_000 },
});
