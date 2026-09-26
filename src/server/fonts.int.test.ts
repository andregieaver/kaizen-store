import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { findFont, fontCss, fontFile, fontPreview, googleCssUrl, installFont, saveSiteFonts, siteFontStyle } = await import("./fonts");

const face = (subset: string, style: string, weight: number, file: string) => `/* ${subset} */
@font-face {
  font-family: 'Lora';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lora/v1/${file}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

/** Google as the tests see it: Lora's stylesheet, a variable file shared by weights, and a script Kaizen leaves out. */
function fakeGoogle() {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.startsWith("https://fonts.googleapis.com/css2")) {
      return new Response(
        [
          face("cyrillic", "normal", 400, "cyr"),
          face("vietnamese", "normal", 400, "vi"),
          face("latin", "normal", 400, "latin"),
          face("latin", "normal", 700, "latin"),
          face("latin", "italic", 400, "latin-italic"),
        ].join("\n"),
      );
    }
    return new Response(new TextEncoder().encode(`woff2 of ${url}`));
  };
  return { fetcher, calls };
}

afterAll(async () => {
  await db().execute(sql`delete from commerce.fonts where family = 'Lora'`);
  await closeDb();
});

describe("self-hosted Google Fonts (D59)", () => {
  it("asks Google for the builder's weights and italics a family has", () => {
    expect(googleCssUrl(findFont("Inter")!)).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&display=swap",
    );
    // Only one weight, and not 400: the nearest it has.
    expect(googleCssUrl({ family: "Thin Only", category: "display", weights: [100, 300], italics: [] })).toBe(
      "https://fonts.googleapis.com/css2?family=Thin+Only:ital,wght@0,300&display=swap",
    );
  });

  it("downloads a family once, keeps its files, and serves a stylesheet pointing at Kaizen's copies", async () => {
    await db().execute(sql`delete from commerce.fonts where family = 'Lora'`);
    const google = fakeGoogle();
    expect(await installFont("Lora", google.fetcher)).toEqual({ ok: true });
    // The stylesheet, then each file once: the shared latin file, the italic and Cyrillic; not Vietnamese.
    expect(google.calls).toHaveLength(4);
    expect(google.calls.some((url) => url.includes("/vi.woff2"))).toBe(false);

    const css = (await fontCss("lora"))!;
    expect(css).not.toContain("fonts.gstatic.com");
    expect(css).not.toContain("vietnamese");
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toContain('.kf-lora, .kf-lora :where(h1, h2, h3, h4, h5, h6) { font-family: "Lora", ui-serif');
    expect(css).toContain("font-synthesis-weight: none");
    const names = [...css.matchAll(/\/api\/fonts\/files\/([0-9a-f]{32}\.woff2)/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(3);
    expect((await fontFile(names[0]))?.toString()).toMatch(/^woff2 of https:\/\/fonts\.gstatic\.com\//);
    expect(await fontFile("../secrets.woff2")).toBeNull();

    // Installed: nothing is fetched again.
    expect(await installFont("Lora", google.fetcher)).toEqual({ ok: true });
    expect(google.calls).toHaveLength(4);
  });

  it("refuses families outside Google Fonts, and keeps nothing when Google fails", async () => {
    expect(await installFont("Comic Sans MS")).toEqual({ ok: false, problem: "That font is not in Google Fonts." });
    const down = async () => new Response("", { status: 503 });
    expect(await installFont("Merriweather", down)).toMatchObject({ ok: false });
    expect(await fontCss("merriweather")).toBeNull();
    expect(await fontPreview("merriweather", down)).toBeNull();
    expect(await fontPreview("not-a-font")).toBeNull();
  });

  it("saves a site's fonts once they are installed, and styles its body with them", async () => {
    const run = Date.now().toString(36);
    const [account] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.accounts (email, name) values (${`fonts-${run}@example.com`}, 'Owner') returning id, email
    `);
    const owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
    const [store] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.stores (slug, name) values (${`fonts-${run}`}, 'Fonts') returning id
    `);
    const storeId = String(store.id);

    // Lora is installed by the test above, so nothing is fetched.
    expect(await saveSiteFonts(owner, storeId, { heading: "Lora" })).toEqual({ ok: true, fonts: { heading: "Lora" } });
    // A store's fonts live in its theme (D60).
    const [saved] = await db().execute<Record<string, unknown>>(sql`select theme from commerce.stores where id = ${storeId}::uuid`);
    expect(saved.theme).toEqual({ settings: { fonts: { heading: "Lora" } } });
    expect(await saveSiteFonts(owner, storeId, { body: "Comic Sans MS" })).toEqual({
      ok: false,
      problems: ["Comic Sans MS is not in Google Fonts."],
    });
    expect(await saveSiteFonts(owner, storeId, { body: "Lora; color: red" })).toEqual({
      ok: false,
      problems: ["Choose a font from the list."],
    });

    expect(siteFontStyle({})).toBeUndefined();
    expect(siteFontStyle({ heading: "Lora", body: "Inter" })).toEqual({
      fontFamily: expect.stringMatching(/^"Inter", ui-sans-serif/),
      "--site-heading-font": expect.stringMatching(/^"Lora", ui-serif/),
    });
  });
});
