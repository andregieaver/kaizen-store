import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type PageContent } from "@/lib/page-content";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const styles = await import("./text-styles");
const { passMembership } = await import("./auth");
const pages = await import("./pages");

/**
 * Text styles (D393) against a real database: made with a slug from the name and kept as it was made, changed by slug, a custom style's
 * CSS kept to text properties, where one is used (inline markup and the rich-text mark), deleting one in use only when confirmed, the
 * limit, and a store's styles copied with it.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let owner: Membership;

beforeAll(async () => {
  const email = `styles-${run}@example.com`;
  const slug = `styles-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null)`);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${email})`);
  const member = await passMembership(slug, String(account.id));
  if (!member) throw new Error("no membership");
  owner = member;
});

afterAll(async () => {
  await closeDb();
});

const page = (slug: string, heading: string, doc?: PageContent["rows"][number]["columns"][number]["blocks"][number]): PageContent => ({
  ...newPageContent(),
  title: `Page ${slug}`,
  slug,
  rows: [{ id: "row-1", type: "row", layout: "1", columns: [{ id: "column-1", blocks: [{ id: "heading-1", type: "heading", text: heading, level: 2 }, ...(doc ? [doc] : [])] }] }],
});

describe("text styles", () => {
  it("makes a style with a slug from its name, keeps the slug through a rename, and draws it", async () => {
    const made = await styles.saveTextStyle(owner.account, owner.store.id, { name: "Gradient text", kind: "gradient", settings: { colors: ["#ff0000", "#0000ff"], angle: 90 } });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.style.slug).toBe("gradient-text");
    const again = await styles.saveTextStyle(owner.account, owner.store.id, { name: "Gradient text", kind: "glow", settings: { color: "#00ff00" } });
    expect(again.ok && again.style.slug).toBe("gradient-text-2");
    const renamed = await styles.saveTextStyle(owner.account, owner.store.id, { slug: "gradient-text", name: "Sunset", kind: "gradient", settings: { colors: ["#ff8800", "#ff0088"] } });
    expect(renamed.ok && renamed.style).toMatchObject({ slug: "gradient-text", name: "Sunset" });
    const css = await styles.textStylesCssFor(owner.store.id);
    expect(css).toContain(".ts-gradient-text{color:#ff8800;");
    expect(css).toContain(".ts-gradient-text-2{text-shadow:");
  });

  it("keeps a custom style's CSS to text properties, and refuses one with none", async () => {
    const made = await styles.saveTextStyle(owner.account, owner.store.id, { name: "Mine", kind: "custom", settings: {}, css: "color: #1d4ed8;\nposition: fixed;\nbackground-image: url(x.png);" });
    expect(made.ok && made.dropped).toEqual(["position", "background-image"]);
    expect(made.ok && made.style.css).toBe("color: #1d4ed8;");
    const none = await styles.saveTextStyle(owner.account, owner.store.id, { name: "Nothing", kind: "custom", settings: {}, css: "display: none;" });
    expect(none.ok).toBe(false);
    const bad = await styles.saveTextStyle(owner.account, owner.store.id, { name: "Bad", kind: "glow", settings: { color: "red" } });
    expect(bad.ok).toBe(false);
  });

  it("says where a style is used, in inline markup or rich text, and deletes one in use only when confirmed", async () => {
    await pages.savePage(owner.account, owner.store.id, null, page(`styled-${run}`, 'My <span class="ts-gradient-text">awesome</span> heading'), { publish: false });
    const rich = {
      id: "text-1",
      type: "richText" as const,
      doc: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "glowing", marks: [{ type: "textClass" as const, attrs: { name: "gradient-text-2" } }] }] }] },
    };
    await pages.savePage(owner.account, owner.store.id, null, page(`rich-${run}`, "Plain", rich), { publish: false });
    expect(await styles.textStyleUses(owner.store.id, "gradient-text")).toEqual([`Page styled-${run}`]);
    expect(await styles.textStyleUses(owner.store.id, "gradient-text-2")).toEqual([`Page rich-${run}`]);
    expect(await styles.textStyleUses(owner.store.id, "gradient")).toEqual([]);

    const asked = await styles.deleteTextStyle(owner.account, owner.store.id, "gradient-text", false);
    expect(asked).toMatchObject({ ok: false, uses: [`Page styled-${run}`] });
    const deleted = await styles.deleteTextStyle(owner.account, owner.store.id, "gradient-text", true);
    expect(deleted.ok && deleted.styles.map((s) => s.slug)).not.toContain("gradient-text");
  });

  it("copies a store's styles to a copy of it", async () => {
    const [made] = await db().execute<Row>(sql`select commerce.duplicate_store(${owner.store.id}::uuid, ${`styles-copy-${run}`}, 'Copy', ${owner.account.id}::uuid, null, '{}'::uuid[], '{}'::uuid[]) as id`);
    await db().execute(sql`select commerce.copy_text_styles(${owner.store.id}::uuid, ${String(made.id)}::uuid)`);
    const copied = await styles.listTextStyles(String(made.id));
    expect(copied.map((s) => s.slug).sort()).toEqual((await styles.listTextStyles(owner.store.id)).map((s) => s.slug).sort());
  });
});
