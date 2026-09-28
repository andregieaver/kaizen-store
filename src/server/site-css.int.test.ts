import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent } from "@/lib/page-content";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { saveSiteCss } = await import("./site-css");
const pages = await import("./pages");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let owner: Account;
let storeId: string;
let before: string;

beforeAll(async () => {
  const email = `css-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', 'Css') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`css-${run}`}, 'Css', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = ${email}`);
  owner = { id: String(account.id), email, name: "Owner", platformAdmin: true };
  [{ custom_css: before }] = (await db().execute<Row>(sql`select custom_css from commerce.platform_settings`)) as { custom_css: string }[];
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set custom_css = ${before}`);
  await closeDb();
});

describe("owners' own CSS (D100)", () => {
  it("keeps a store's and Kaizen's CSS for every page, only when it can be used", async () => {
    expect(await saveSiteCss(owner, storeId, "  h2 { text-wrap: balance; }  ")).toEqual({ ok: true });
    const [store] = await db().execute<Row>(sql`select custom_css from commerce.stores where id = ${storeId}::uuid`);
    expect(store.custom_css).toBe("h2 { text-wrap: balance; }");

    const refused = await saveSiteCss(owner, storeId, "body { background: url(https://tracker.example/p.gif) }");
    expect(refused).toMatchObject({ ok: false, problems: [expect.stringMatching(/another site/)] });
    const [still] = await db().execute<Row>(sql`select custom_css from commerce.stores where id = ${storeId}::uuid`);
    expect(still.custom_css).toBe("h2 { text-wrap: balance; }");

    expect(await saveSiteCss(owner, null, "footer { opacity: 0.9 }")).toEqual({ ok: true });
    const [platform] = await db().execute<Row>(sql`select custom_css from commerce.platform_settings`);
    expect(platform.custom_css).toBe("footer { opacity: 0.9 }");
    const [logged] = await db().execute<Row>(sql`
      select action from commerce.audit_log where account_id = ${owner.id}::uuid and store_id = ${storeId}::uuid order by created_at desc limit 1
    `);
    expect(logged.action).toBe("store.css_saved");
  });

  it("saves a page's own CSS with it, and refuses the page while the CSS cannot be used", async () => {
    const content = { ...newPageContent(), title: "Styled", slug: `styled-${run}`, css: ".hero h1 { color: #b4532a; }" };
    const saved = await pages.savePage(owner, storeId, null, content, { publish: true });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const [row] = await db().execute<Row>(sql`select draft ->> 'css' as draft, published ->> 'css' as live from commerce.pages where id = ${saved.id}::uuid`);
    expect(row).toEqual({ draft: ".hero h1 { color: #b4532a; }", live: ".hero h1 { color: #b4532a; }" });
    const bad = await pages.savePage(owner, storeId, saved.id, { ...content, css: "@import 'x.css';" }, { publish: false });
    expect(bad).toMatchObject({ ok: false, problems: [expect.stringMatching(/^Custom CSS: @import cannot be used/)] });
  });
});
