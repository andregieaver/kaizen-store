import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { defaultFooter, defaultHeader } from "@/lib/site-layout";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const pages = await import("./pages");
const layouts = await import("./site-layouts");

const run = Date.now().toString(36);
let storeId: string;
let owner: Account;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`chrome-${run}@example.com`}, 'Owner', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`chrome-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`chrome-${run}@example.com`}`);
  owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
});

afterAll(async () => {
  await closeDb();
});

describe("headers and footers (D80)", () => {
  it("saves a store's header and footer, and uses the chosen ones once published", async () => {
    // A new store has the template's header, if it has one; start from the standard one.
    await layouts.chooseSiteLayout(owner, storeId, "header", null);
    expect(await layouts.siteLayoutFor(storeId, "header")).toBeNull();
    const header = await pages.savePage(owner, storeId, null, { ...defaultHeader(storeId), slug: `top-${run}` }, { publish: false, type: "header" });
    if (!header.ok) throw new Error(header.problems.join(" "));
    // Not published yet: it cannot be chosen.
    expect(await layouts.chooseSiteLayout(owner, storeId, "header", header.id)).toEqual({ ok: false, problems: ["Publish the header before using it."] });
    await pages.savePage(owner, storeId, header.id, { ...defaultHeader(storeId), slug: `top-${run}` }, { publish: true, type: "header" });
    expect(await layouts.chooseSiteLayout(owner, storeId, "header", header.id)).toEqual({ ok: true });
    const used = await layouts.siteLayoutFor(storeId, "header");
    expect(used?.id).toBe(header.id);
    expect(used?.content.rows[0].columns[2].blocks.map((b) => (b.type === "site" ? b.part : b.type))).toContain("cart");
    // A header is not a footer, and a footer is not a page.
    expect(await layouts.chooseSiteLayout(owner, storeId, "footer", header.id)).toEqual({ ok: false, problems: ["This footer no longer exists."] });
    expect((await layouts.siteLayoutChoice(storeId)).header).toBe(header.id);

    // Back to the standard one, and deleting a chosen one does the same.
    expect(await layouts.chooseSiteLayout(owner, storeId, "header", null)).toEqual({ ok: true });
    expect(await layouts.siteLayoutFor(storeId, "header")).toBeNull();
    await layouts.chooseSiteLayout(owner, storeId, "header", header.id);
    await pages.deletePage(owner, storeId, header.id, "header");
    expect(await layouts.siteLayoutFor(storeId, "header")).toBeNull();
  });

  it("refuses a footer without the business details, cookies and withdrawal links, and site components on pages", async () => {
    const footer = defaultFooter(storeId);
    const bare = { ...footer, slug: `bare-${run}`, rows: [{ ...footer.rows[0], columns: footer.rows[0].columns.map((c) => ({ ...c, blocks: [] })) }] };
    const refused = await pages.savePage(owner, storeId, null, bare, { publish: true, type: "footer" });
    expect(refused).toEqual({ ok: false, problems: [expect.stringMatching(/business details, the cookies link and the withdrawal link/)] });
    const onPage = await pages.savePage(owner, storeId, null, { ...defaultHeader(storeId), slug: `page-${run}` }, { publish: false, type: "page" });
    expect(onPage).toEqual({ ok: false, problems: ["Site components belong in headers and footers."] });
    const saved = await pages.savePage(owner, storeId, null, { ...footer, slug: `bottom-${run}` }, { publish: true, type: "footer" });
    expect(saved.ok).toBe(true);
  });
});
