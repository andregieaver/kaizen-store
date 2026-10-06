import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A gift message is the buyer's own words (wave 3, run 2, D173, `docs/wave-3-orders.md` 4.8 and 6.4 G3): React escapes it on every screen, `renderEmail()` escapes it in the confirmation, the packing slip
 * uses `white-space: pre-line`. Nothing that draws it may turn it into markup: no `dangerouslySetInnerHTML`, no `innerHTML`, no markdown renderer, no link detection. This reads the source:
 * every non-test file that touches the gift's text fields is scanned, so a new place that draws the message is held to the same rule without being listed.
 */
const SRC = join(process.cwd(), "src");

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

/** What marks a file as drawing or carrying the buyer's gift text: the column names, the cart and order field names, the gift component. */
const TOUCHES = /\bgift_message\b|\bgift_to\b|\bgift_from\b|\bgiftMessage\b|\bgift\.message\b|\bgift\.to\b|\bgift\.from\b|\bGiftNote\b|\bGiftBox\b/;

/** What turns text into markup or into links. */
const FORBIDDEN: readonly [string, RegExp][] = [
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["innerHTML", /\.innerHTML\b|\binnerHTML\s*=/],
  ["insertAdjacentHTML", /insertAdjacentHTML/],
  ["a markdown renderer", /from\s+["'](?:marked|markdown-it|react-markdown|remark[^"']*|showdown|micromark|snarkdown)["']/],
  ["link detection", /linkify|autolink|urlRegex/i],
  ["rich text rendering", /<RichText\b|cleanRichText\s*\(/],
];

describe("the gift message is never turned into markup", () => {
  const touching = sources(SRC).filter((file) => TOUCHES.test(readFileSync(file, "utf8")));

  it("finds the places that draw or carry it, so the scan cannot go stale", () => {
    const names = touching.map((file) => relative(SRC, file).replaceAll("\\", "/"));
    for (const expected of ["components/gift-note.tsx", "app/s/[store]/[market]/cart/cart-gift.tsx", "lib/gift.ts", "server/shopper-emails.ts", "components/admin/orders/packing-slip-view.tsx"]) {
      expect(names, expected).toContain(expected);
    }
  });

  it.each(FORBIDDEN)("uses no %s", (what, pattern) => {
    const offenders = touching
      .filter((file) => {
        // Comments say what is not done; only code counts.
        const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
        return pattern.test(code);
      })
      .map((file) => relative(SRC, file).replaceAll("\\", "/"));
    expect([what, offenders]).toEqual([what, []]);
  });
});
