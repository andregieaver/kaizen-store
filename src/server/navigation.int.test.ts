import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { EMPTY_NAVIGATION, parseNavigation } from "@/lib/navigation";
import { parseStoreSeo } from "@/lib/seo";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));

const { listMenuProducts, saveNavigation } = await import("./navigation");

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
      setupCompletedAt: null,
      paymentsOn: false,
      paymentsTest: false,
      details: { legalName: null, organisationNumber: null, contactEmail: null, postalAddress: null, country: "NO" },
      markets: [
        toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }),
        toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }),
      ],
      seo: parseStoreSeo({}),
      navigation: EMPTY_NAVIGATION,
    },
  } as Membership;
});

afterAll(async () => {
  await closeDb();
});

const stored = async () => {
  const [row] = await db().execute<Row>(sql`select navigation from commerce.stores where id = ${member.store.id}::uuid`);
  return parseNavigation(row.navigation);
};

describe("a store's header and footer (D30)", () => {
  it("starts with the template's logo and menus, whose product links still work", async () => {
    const navigation = await stored();
    expect(navigation.logo?.url).toBe("/demo/logo.svg");
    expect(navigation.header.length).toBeGreaterThan(0);
    const handles = new Set((await listMenuProducts(member.store.id, "nb-NO")).map((p) => p.handle));
    for (const item of navigation.header) {
      if (item.link.kind === "product") expect(handles).toContain(item.link.handle);
    }
  });

  it("saves menus, giving product links the product's title where the owner left the text empty", async () => {
    const result = await saveNavigation(member, {
      logo: null,
      header: [
        { label: { "nb-NO": "Kopp", "da-DK": "Krus" }, link: { kind: "product", handle: "demo-keramikkopp" } },
        { label: {}, link: { kind: "home" } },
      ],
      footer: [{ label: { "nb-NO": "Om oss", "sv-SE": " " }, link: { kind: "url", url: "/om-oss" } }],
    });
    expect(result).toEqual({ ok: true });
    const navigation = await stored();
    expect(navigation.logo).toBeNull();
    // Danish is not one of this store's languages; Swedish takes the product's own title.
    expect(navigation.header[0].label).toEqual({ "nb-NO": "Kopp", "sv-SE": "Demo: Keramikmugg" });
    expect(navigation.header[1]).toEqual({ label: {}, link: { kind: "home" } });
    expect(navigation.footer[0].label).toEqual({ "nb-NO": "Om oss" });
    expect(navigation.logoDark).toBeNull();
  });

  it("keeps a logo for dark backgrounds next to the logo (D60)", async () => {
    const logo = { url: "/demo/logo.svg", width: 120, height: 32 };
    const logoDark = { url: "https://example.no/logo-light.png", width: 240, height: 64 };
    expect(await saveNavigation(member, { logo, logoDark, header: [], footer: [] })).toEqual({ ok: true });
    expect(await stored()).toMatchObject({ logo, logoDark, favicon: null });
    // And an icon (D62), in its two sizes.
    const favicon = { url: "https://example.no/icon.png", smallUrl: "https://example.no/icon-480.png" };
    expect(await saveNavigation(member, { logo, logoDark, favicon, header: [], footer: [] })).toEqual({ ok: true });
    expect((await stored()).favicon).toEqual(favicon);
  });

  it("refuses links to missing products, web links without text, and unsafe addresses", async () => {
    const saved = await stored();
    expect(
      await saveNavigation(member, {
        logo: null,
        header: [{ label: {}, link: { kind: "product", handle: "no-such-product" } }],
        footer: [{ label: {}, link: { kind: "url", url: "https://example.no" } }],
      }),
    ).toEqual({
      ok: false,
      problems: ["A menu links to a product that no longer exists. Choose another.", "Give each web address link a text."],
    });
    expect(
      await saveNavigation(member, {
        logo: null,
        header: [{ label: { "nb-NO": "X" }, link: { kind: "url", url: "javascript:alert(1)" } }],
        footer: [],
      }),
    ).toEqual({ ok: false, problems: ["A menu link has an invalid web address."] });
    // Nothing changed.
    expect(await stored()).toEqual(saved);
  });
});
