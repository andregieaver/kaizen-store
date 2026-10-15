import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the shopper's side of exchanges and return labels sets in the browser (wave 3, D239, `docs/wave-3-exchanges.md` 3.7 and 5.6): nothing. The exchange
 * page, the return label route, the status page's wish form and the withdrawal form's wish field read no cookie, set none and use no browser storage, so
 * `KNOWN_COOKIES` gains nothing. This walks their source and fails on any cookie or storage call, so a later change has to come through the register.
 */
const ROOT = process.cwd();
const FILES = [
  "src/app/s/[store]/[market]/account/exchange/[token]",
  "src/app/s/[store]/[market]/returns/[token]",
  "src/components/exchange",
  "src/components/withdraw/return-status-view.tsx",
  "src/app/s/[store]/[market]/withdraw/withdraw-flow.tsx",
];

function sources(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full).flatMap((name) => sources(join(path, name))).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
}

const SETS_STATE = [/document\.cookie/, /localStorage/, /sessionStorage/, /indexedDB/, /\bcookies\(\)/, /Set-Cookie/i, /\.cookies\.set\(/];

describe("exchanges and return labels for shoppers set nothing in the browser (D239)", () => {
  const files = FILES.flatMap(sources);

  it("finds the files it guards", () => {
    expect(files.some((file) => file.endsWith("exchange-form.tsx"))).toBe(true);
    expect(files.some((file) => file.endsWith(join("label", "route.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith("exchange-wish-form.tsx"))).toBe(true);
  });

  it.each(FILES.flatMap(sources).map((file) => [file.slice(ROOT.length + 1), file]))("%s reads and sets no cookie or storage", (_name, file) => {
    const text = readFileSync(file, "utf8");
    for (const pattern of SETS_STATE) expect(text, String(pattern)).not.toMatch(pattern);
  });

  it("the exchange page and the label route are never indexed and pass no referrer", () => {
    const page = readFileSync(join(ROOT, "src/app/s/[store]/[market]/account/exchange/[token]/page.tsx"), "utf8");
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).toMatch(/referrer: "no-referrer"/);
    expect(page).toContain("<PayRouteGuard");
    const route = readFileSync(join(ROOT, "src/app/s/[store]/[market]/returns/[token]/label/route.ts"), "utf8");
    expect(route).toContain('"X-Robots-Tag": "noindex"');
    expect(route).toContain('"Referrer-Policy": "no-referrer"');
    expect(route).toContain('"Cache-Control": "no-store"');
    expect(route).toMatch(/inline; filename=/);
  });
});
