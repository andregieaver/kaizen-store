import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";
import { EMPTY_NAVIGATION, parseMenuItems, parseNavigation } from "@/lib/navigation";
import { parseStoreSeo } from "@/lib/seo";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));

const { listMenuProducts, saveNavigation } = await import("./navigation");
const { deleteMenu, menuUses, saveStoreMenu } = await import("./menus");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let member: Membership;

/** A store copied from the template, which comes with the demo's logo and menus. */
beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`nav-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`nav-${run}`}, 'Test', null) as id
  `);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-nav-${run}@example.com`}, 'Owner') returning id
  `);
  member = {
    account: { id: String(account.id), email: `owner-nav-${run}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: {
      id: String(store.id),
      slug: `nav-${run}`,
      name: "Test",
      status: "active",
      isTemplate: false,
      starter: false,
      setupCompletedAt: null,
      paymentsOn: false,
      paymentsTest: false,
      details: { legalName: null, organisationNumber: null, contactEmail: null, postalAddress: null, country: "NO" },
      markets: [
        toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }),
        toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }),
      ],
      localization: localizationOf([], [], [
        toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }),
        toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }),
      ]),
      seo: parseStoreSeo({}),
      navigation: EMPTY_NAVIGATION,
    },
  } as Membership;
});

afterAll(async () => {
  await closeDb();
});

const stored = async () => {
  const [row] = await db().execute<Row>(sql`
    select navigation, header_menu_id, footer_menu_id from commerce.stores where id = ${member.store.id}::uuid
  `);
  return { ...parseNavigation(row.navigation), headerMenuId: row.header_menu_id, footerMenuId: row.footer_menu_id };
};

const storedMenu = async (id: string) => {
  const [row] = await db().execute<Row>(sql`select name, items from commerce.menus where id = ${id}::uuid`);
  return row && { name: String(row.name), items: parseMenuItems(row.items) };
};

describe("a store's menus (D85)", () => {
  it("starts with the template's logo and menus, shown in the standard header and footer, whose product links still work", async () => {
    const navigation = await stored();
    expect(navigation.logo?.url).toBe("/demo/logo.svg");
    const main = await storedMenu(String(navigation.headerMenuId));
    expect(main.name).toBe("Main menu");
    expect(main.items.length).toBeGreaterThan(0);
    expect((await storedMenu(String(navigation.footerMenuId))).name).toBe("Footer menu");
    const handles = new Set((await listMenuProducts(member.store.id, "nb-NO")).map((p) => p.handle));
    for (const item of main.items) {
      if (item.link.kind === "product") expect(handles).toContain(item.link.handle);
    }
  });

  it("saves a menu, giving product links the product's title where the owner left the text empty, with links under links", async () => {
    const result = await saveStoreMenu(member, null, {
      name: `Sidebar ${run}`,
      items: [
        { label: { "nb-NO": "Kopp", "da-DK": "Krus" }, link: { kind: "product", handle: "demo-keramikkopp" }, depth: 0 },
        { label: {}, link: { kind: "home" }, depth: 1, newTab: true },
        { label: { "nb-NO": "Om oss", "sv-SE": " " }, link: { kind: "url", url: "/om-oss" }, depth: 0, newTab: false },
      ],
    });
    if (!result.ok) throw new Error(result.problems.join(" "));
    const menu = await storedMenu(result.id);
    // Danish is not one of this store's languages; Swedish takes the product's own title.
    expect(menu.items).toEqual([
      { label: { "nb-NO": "Kopp", "sv-SE": "Demo: Keramikmugg" }, link: { kind: "product", handle: "demo-keramikkopp" }, depth: 0 },
      { label: {}, link: { kind: "home" }, depth: 1, newTab: true },
      { label: { "nb-NO": "Om oss" }, link: { kind: "url", url: "/om-oss" }, depth: 0 },
    ]);
    // Renamed in place; a second menu may not take its name.
    expect(await saveStoreMenu(member, result.id, { name: `Side ${run}`, items: [] })).toEqual({ ok: true, id: result.id });
    expect(await saveStoreMenu(member, null, { name: `Side ${run}`, items: [] })).toEqual({
      ok: false,
      problems: [`There is already a menu called Side ${run}.`],
    });

    // Chosen for the standard footer, and let go of when deleted.
    const own = await stored();
    expect(await saveNavigation(member, { logo: own.logo, headerMenuId: own.headerMenuId, footerMenuId: result.id })).toEqual({ ok: true });
    expect((await menuUses(member.store.id)).get(result.id)?.standard).toEqual(["footer"]);
    expect(await deleteMenu(member.account.id, member.store.id, result.id)).toBe(true);
    expect((await stored()).footerMenuId).toBeNull();
    expect(await deleteMenu(member.account.id, member.store.id, result.id)).toBe(false);
  });

  it("keeps a top link's mega menu and its links' pictures (D87)", async () => {
    const image = { url: "https://example.no/kopper.webp", width: 1600, height: 1200 };
    const result = await saveStoreMenu(member, null, {
      name: `Mega ${run}`,
      items: [
        { label: { "nb-NO": "Kjøkken" }, link: { kind: "home" }, depth: 0, mega: { columns: 3, center: false } },
        { label: { "nb-NO": "Kopper" }, link: { kind: "product", handle: "demo-keramikkopp" }, depth: 1, image },
      ],
    });
    if (!result.ok) throw new Error(result.problems.join(" "));
    const menu = await storedMenu(result.id);
    expect(menu.items[0].mega).toEqual({ columns: 3 });
    expect(menu.items[1].image).toEqual(image);
    expect(
      await saveStoreMenu(member, result.id, {
        name: `Mega ${run}`,
        items: [
          { label: {}, link: { kind: "home" }, depth: 0 },
          { label: {}, link: { kind: "cart" }, depth: 1, mega: { columns: 2 } },
        ],
      }),
    ).toEqual({ ok: false, problems: ["Only a top link can be a mega menu."] });
    await deleteMenu(member.account.id, member.store.id, result.id);
  });

  it("keeps a logo for dark backgrounds next to the logo (D60)", async () => {
    const logo = { url: "/demo/logo.svg", width: 120, height: 32 };
    const logoDark = { url: "https://example.no/logo-light.png", width: 240, height: 64 };
    expect(await saveNavigation(member, { logo, logoDark })).toEqual({ ok: true });
    expect(await stored()).toMatchObject({ logo, logoDark, favicon: null });
    // And an icon (D62), in its two sizes.
    const favicon = { url: "https://example.no/icon.png", smallUrl: "https://example.no/icon-480.png" };
    expect(await saveNavigation(member, { logo, logoDark, favicon })).toEqual({ ok: true });
    expect((await stored()).favicon).toEqual(favicon);
  });

  it("refuses links to missing products, custom links without text, unsafe addresses and another store's menu", async () => {
    expect(
      await saveStoreMenu(member, null, {
        name: `Bad ${run}`,
        items: [
          { label: {}, link: { kind: "product", handle: "no-such-product" }, depth: 0 },
          { label: {}, link: { kind: "url", url: "https://example.no" }, depth: 0 },
        ],
      }),
    ).toEqual({
      ok: false,
      problems: ["A link goes to a product that no longer exists. Choose another.", "Give each custom link a text."],
    });
    expect(
      await saveStoreMenu(member, null, {
        name: `Bad ${run}`,
        items: [{ label: { "nb-NO": "X" }, link: { kind: "url", url: "javascript:alert(1)" }, depth: 0 }],
      }),
    ).toEqual({ ok: false, problems: ["A menu link has an invalid web address."] });
    const [theirs] = await db().execute<Row>(sql`
      select m.id from commerce.menus m join commerce.stores s on s.id = m.store_id where s.is_template limit 1
    `);
    expect(await saveNavigation(member, { logo: null, headerMenuId: String(theirs.id) })).toEqual({
      ok: false,
      problems: ["That menu no longer exists. Choose another."],
    });
    expect(await saveStoreMenu(member, String(theirs.id), { name: "Mine now", items: [] })).toEqual({
      ok: false,
      problems: ["That menu no longer exists."],
    });
  });
});
