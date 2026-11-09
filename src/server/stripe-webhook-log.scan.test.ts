import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A payment webhook that fails must say so in the log (code review FV2). Until November 2026 the routes answered 500
 * from a bare `catch {`, and the only trace was `webhook_events.last_error`, read as a daily count.
 */
const ROOT = join(process.cwd(), "src/app/api/stripe");

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? routes(path) : entry.name === "route.ts" ? [path] : [];
  });
}

/** Each catch block that answers 500, with whether its failure is logged there or said to be logged by the handler. */
function failingCatches(source: string): { text: string; logged: boolean }[] {
  return [...source.matchAll(/catch\s*(\([^)]*\))?\s*\{([^}]*status: 500[^}]*)\}/g)].map((match) => ({
    text: match[0],
    logged: /\blog\("error"/.test(match[2]) || /stripe\.webhook_failed/.test(match[2]),
  }));
}

describe("Stripe webhook routes", () => {
  const files = routes(ROOT);

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("log every failure they answer with a 500", () => {
    const silent = files.flatMap((file) =>
      failingCatches(readFileSync(file, "utf8"))
        .filter((found) => !found.logged)
        .map(() => file.slice(ROOT.length)),
    );
    expect(silent).toEqual([]);
  });

  it("the stores' handler logs before it rethrows", () => {
    const source = readFileSync(join(process.cwd(), "src/server/stripe-webhooks.ts"), "utf8");
    const logged = source.indexOf('log("error", "stripe.webhook_failed"');
    expect(logged).toBeGreaterThan(0);
    expect(source.indexOf("throw error;", logged)).toBeGreaterThan(logged);
  });
});
