import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore } = await import("./trust-fixtures");
const { designLookInput } = await import("@/lib/brand-design");
const { parseStoreTheme, themeWarnings } = await import("@/lib/theme");
const { getBrandTool, setBrandTool, designLookTool } = await import("./brand-tools");
const { listInstalls, switchToInstall } = await import("./theme-installs");

type Row = Record<string, unknown>;

/**
 * The brand and a look of the store's own (D330, `docs/ai-autopilot.md` 14.4): the brand kept per store and for Kaizena Flow's own site,
 * a claim in the tagline refused; a designed look added to the library not live, changing nothing visitors see, and the store's theme
 * once switched to; a font not in the catalogue refused.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let admin: Awaited<ReturnType<typeof makeAccount>>;
const scope = () => ({ account: store.account, store: { id: store.id, slug: store.slug } as never });
const ctx = () => ({ ...scope(), invalidate: () => {} });
const storeTheme = async () => (await db().execute<Row>(sql`select theme from commerce.stores where id = ${store.id}::uuid`))[0].theme;

beforeAll(async () => {
  store = await makeStore("brand");
  admin = await makeAccount("brand-admin", { platformAdmin: true });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.brand_profiles where store_id = ${store.id}::uuid or store_id is null`);
  await closeDb();
});

describe("the brand", () => {
  it("is kept per store, only the fields given change, and a claim in the tagline is refused", async () => {
    expect((await getBrandTool(scope())).note).toContain("No brand is set down yet");
    await setBrandTool(scope(), { tagline: "Coffee roasted in Bergen", voice: "Warm, plain, short sentences.", values: ["Honest", "honest", "Local"] });
    await setBrandTool(scope(), { audience: "People who brew at home." });
    expect((await getBrandTool(scope())).brand).toEqual({
      tagline: "Coffee roasted in Bergen",
      voice: "Warm, plain, short sentences.",
      audience: "People who brew at home.",
      values: ["Honest", "Local"],
      avoid: [],
    });
    await expect(setBrandTool(scope(), { tagline: "The best price in Norway" })).rejects.toThrow("makes a claim");
    expect((await getBrandTool(scope())).brand.tagline).toBe("Coffee roasted in Bergen");
  });

  it("is Kaizena Flow's own with no store, apart from every store's", async () => {
    const platform = { account: admin, store: null };
    await setBrandTool(platform, { tagline: "Stores that run themselves" });
    expect((await getBrandTool(platform)).brand.tagline).toBe("Stores that run themselves");
    expect((await getBrandTool(scope())).brand.tagline).toBe("Coffee roasted in Bergen");
  });
});

describe("a look of the store's own", () => {
  it("is added to the library not live, changing nothing visitors see, and becomes the store's theme once switched to", async () => {
    const before = await storeTheme();
    const answer = await designLookTool(ctx(), designLookInput.parse({ title: "Bergen roast", start: "warm", accent: "#1f6f5c", background: "#fbf8f3", button_corners: "rounded" }));
    expect(answer.done).toContain("Visitors see nothing of it yet");
    expect(await storeTheme()).toEqual(before);
    const install = (await listInstalls(store.id)).find((i) => i.id === answer.install);
    expect(install).toMatchObject({ title: "Bergen roast", live: false, presetId: null });
    const switched = await switchToInstall(store.id, answer.install, store.account.id);
    expect(switched.ok).toBe(true);
    const live = parseStoreTheme(await storeTheme());
    expect(live.base).toBe("warm");
    expect(live.settings.light).toMatchObject({ background: "#fbf8f3", accent: "#1f6f5c" });
    expect(live.settings.buttons.corners).toBe("rounded");
    expect(themeWarnings({ ...live.settings, visitorSwitch: true })).toEqual([]);
  });

  it("refuses a font that is not in the catalogue, adding nothing", async () => {
    const count = (await listInstalls(store.id)).length;
    await expect(designLookTool(ctx(), designLookInput.parse({ title: "Odd", accent: "#123456", heading_font: "Comic Sansz Pro" }))).rejects.toThrow("not in the font catalogue");
    expect((await listInstalls(store.id)).length).toBe(count);
  });
});
