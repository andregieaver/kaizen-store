import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { termMetaDescription, termMetaTitle } from "@/lib/term-seo";

import { addSwedish } from "./data-test-support";
import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";
import { redirectRowsOf } from "./redirect-test-support";
import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const taxonomy = await import("./taxonomy");

type Row = Record<string, unknown>;

/**
 * A category's and a tag's own search title and description per language (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.4, 6.3 S3): saved through the
 * term's own save, only in the languages the store offers (the store's list, never the browser's), an empty language removed, an omitted `seo` kept, read back
 * by `siteTerms()` per locale, the audit entry saying THAT it changed and never the text, and a page in a language gets that language's text and never another's.
 */

let fx: Fixture;
let other: Fixture;
let owner: Membership;
let otherOwner: Membership;
const scopeOf = (f: Fixture) => ({ storeId: f.storeId, contentType: "product" }) as const;

beforeAll(async () => {
  fx = await makeStore("termseo");
  other = await makeStore("termseo-other");
  // Norwegian and Swedish for the first store; the second offers Norwegian only.
  await addSwedish(fx);
  await db().execute(sql`update commerce.stores set locales = array['nb-NO'] where id = ${other.storeId}::uuid`);
  await db().execute(sql`update commerce.markets set active = false where store_id = ${other.storeId}::uuid and code <> 'NO'`);
  owner = await ownerOf(fx);
  otherOwner = await ownerOf(other);
});

afterAll(async () => {
  await closeDb();
});

const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

const seoOf = async (f: Fixture, id: string) => {
  const term = (await taxonomy.siteTerms(f.storeId, "product")).find((t) => t.id === id);
  return term?.seo;
};

describe("a category's search texts", () => {
  it("are saved with the category, per language, and read back as written", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Hage", seo: { "nb-NO": { title: "Hage og hjem | Kopp", description: "Alt til hjemmet." } } }));
    expect(await seoOf(fx, made.id)).toEqual({ "nb-NO": { title: "Hage og hjem | Kopp", description: "Alt til hjemmet." } });
    const updated = ok(
      await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, {
        name: "Hage",
        slug: "hage",
        seo: { "nb-NO": { title: "Hage og hjem | Kopp", description: "Alt til hjemmet." }, "sv-SE": { title: "Hem och trädgård", description: "" } },
      }),
    );
    expect(updated.terms.find((t) => t.id === made.id)?.seo).toEqual({
      "nb-NO": { title: "Hage og hjem | Kopp", description: "Alt til hjemmet." },
      "sv-SE": { title: "Hem och trädgård", description: "" },
    });
  });

  it("are kept when a save sends none (an older form), and replaced as a whole when it sends some, an empty language removed", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "tag", name: "Nyhet", seo: { "nb-NO": { title: "Nytt", description: "" } } }));
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Nyhet", slug: "nyhet-ny" }));
    expect(await seoOf(fx, made.id)).toEqual({ "nb-NO": { title: "Nytt", description: "" } });
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Nyhet", slug: "nyhet-ny", seo: { "nb-NO": { title: "", description: "" }, "sv-SE": { title: "Nytt", description: "Nyheter" } } }));
    expect(await seoOf(fx, made.id)).toEqual({ "sv-SE": { title: "Nytt", description: "Nyheter" } });
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Nyhet", slug: "nyhet-ny", seo: {} }));
    expect(await seoOf(fx, made.id)).toEqual({});
  });

  it("refuse a language the store does not offer, a title or description that is too long, and another store's languages", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Grenser" }));
    const french = await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Grenser", slug: "grenser", seo: { "fr-FR": { title: "x", description: "" } } });
    expect(french).toMatchObject({ ok: false, problems: [expect.stringContaining("fr-FR")] });
    const long = await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Grenser", slug: "grenser", seo: { "nb-NO": { title: "x".repeat(121), description: "" } } });
    expect(long).toMatchObject({ ok: false });
    const longer = await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Grenser", slug: "grenser", seo: { "nb-NO": { title: "", description: "x".repeat(321) } } });
    expect(longer).toMatchObject({ ok: false });
    // The other store offers Norwegian only: Swedish text for its term is refused although the first store offers it.
    const theirs = ok(await taxonomy.createTerm(otherOwner.account, scopeOf(other), { kind: "category", name: "Deres" }));
    const swedish = await taxonomy.updateTerm(otherOwner.account, scopeOf(other), theirs.id, { name: "Deres", slug: "deres", seo: { "sv-SE": { title: "Hej", description: "" } } });
    expect(swedish).toMatchObject({ ok: false, problems: [expect.stringContaining("sv-SE")] });
    expect(await seoOf(fx, made.id)).toEqual({});
    // A term of another store is not found, whatever is sent.
    expect(await taxonomy.updateTerm(owner.account, scopeOf(fx), theirs.id, { name: "Deres", slug: "deres" })).toMatchObject({ ok: false });
  });

  it("are for a store's product categories and tags only: Kaizen's and a page's terms refuse them", async () => {
    const [admin] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`termseo-admin-${fx.slug}@example.com`}, 'Admin', true) returning id, email`);
    const account = { id: String(admin.id), email: String(admin.email), name: "Admin", platformAdmin: true };
    const refused = await taxonomy.createTerm(account, { storeId: null, contentType: "page" }, { kind: "category", name: `Kaizen ${fx.slug}`, seo: { en: { title: "x", description: "" } } });
    expect(refused).toMatchObject({ ok: false, problems: [expect.stringContaining("product categories")] });
    // Sending none is fine.
    expect(ok(await taxonomy.createTerm(account, { storeId: null, contentType: "page" }, { kind: "category", name: `Kaizen ok ${fx.slug}`, seo: {} })).id).toBeTruthy();
    await db().execute(sql`delete from commerce.terms where store_id is null and name like ${`Kaizen%${fx.slug}`}`);
  });

  it("write an entry that says THAT the search texts changed, never what they say", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Logg", seo: { "nb-NO": { title: "Hemmelig tittel", description: "Hemmelig tekst" } } }));
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Logg", slug: "logg", seo: { "nb-NO": { title: "Ny hemmelig tittel", description: "" } } }));
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Logg 2", slug: "logg" }));
    const entries = await db().execute<Row>(sql`select action, details from commerce.audit_log where store_id = ${fx.storeId}::uuid and details ->> 'id' = ${made.id} order by id`);
    expect(entries.map((e) => [e.action, (e.details as Record<string, unknown>).seo])).toEqual([
      ["product.category_created", true],
      ["product.category_updated", true],
      ["product.category_updated", undefined],
    ]);
    expect(JSON.stringify(entries)).not.toContain("Hemmelig");
  });

  it("leave a redirect from the old address when the address changes, and a refreshed lookup", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Gammel", slug: "gammel-adresse" }));
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Ny", slug: "ny-adresse" }));
    expect((await redirectRowsOf(fx.storeId)).find((r) => r.source === "/category/gammel-adresse")).toMatchObject({ kind: "category", term_id: made.id });
  });
});

describe("the page's title and description in a language", () => {
  it("use the language's text as written (no store name added) and never another language's", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Sider", seo: { "sv-SE": { title: "Sidor i Sverige", description: "Beskrivning" } } }));
    const term = (await taxonomy.siteTerms(fx.storeId, "product")).find((t) => t.id === made.id)!;
    expect(termMetaTitle(term, "sv-SE", "Kopp")).toEqual({ absolute: "Sidor i Sverige" });
    expect(termMetaTitle(term, "nb-NO", "Kopp")).toBe("Sider · Kopp");
    expect(termMetaDescription(term, "sv-SE", "Butikken")).toBe("Beskrivning");
    expect(termMetaDescription(term, "nb-NO", "Butikken")).toBe("Butikken");
  });
});
