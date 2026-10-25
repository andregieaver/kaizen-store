import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const writer = await import("./legal-writer");
const { passMembership } = await import("./auth");
const { legalOverview } = await import("./legal-starters");
const { newStore } = await import("./inventory-test-support");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");
type SourceText = import("@/lib/legal-writer").SourceText;
type WriterDeps = import("./legal-writer").WriterDeps;
type Membership = import("./auth").Membership;

type Row = Record<string, unknown>;

/**
 * The AI writing a legal page (D311, unit L2, `docs/ai-autopilot.md` 8.3, 8.8) with a stand-in model: an owner asks, the job writes the
 * page and saves it as a draft (never published, no review notice, the store's facts filled by code, a Sources section); a second ask while
 * it runs is the same write; a draft the checks refuse twice saves nothing and says why; only owners of an open store in a covered country
 * with a text model may ask.
 */

const READ = new Date("2026-10-25T08:00:00Z");
const ARL21 = "Angrefristen utløper 14 dager fra den dag avtalen om tjeneste ble inngått, eller den dag forbrukeren får varen i fysisk besittelse.";
const CRD9 = "Save where the exceptions provided for in Article 16 apply, the consumer shall have a period of 14 days to withdraw from a distance or off-premises contract, without giving any reason.";

/** Every passage the stand-in may be offered: one text per passage key, long enough to quote. */
const TEXT_OF = (source: string, key: string) =>
  source === "no-arl" && key === "21" ? ARL21 : source === "eu-crd" && key === "art_9" ? CRD9 : `Forbrukeren har rettigheter etter denne bestemmelsen, ${source} ${key}, som ikke kan fravikes.`;

const TEXTS: SourceText[] = [
  { sourceKey: "eu-crd", language: "en", readAt: READ, passages: ["art_6", "art_9", "art_11", "art_11a", "art_12", "art_13", "art_14", "art_16", "art_18", "art_19", "art_20", "art_22", "art_25", "art_8", "anx_I", "fn_star1"].map((k) => ({ key: k, title: `Article ${k}`, text: TEXT_OF("eu-crd", k) })) },
  { sourceKey: "no-arl", language: "nb", readAt: READ, passages: ["8", "14", "16", "18", "20", "21", "22", "23", "24", "25", "3"].map((k) => ({ key: k, title: `§ ${k}`, text: TEXT_OF("no-arl", k) })) },
];

type Brief = { sections: { topic: string; needs: string[]; passages: { source: string; passage: string }[] }[] };

/** A model that answers from the plan it is given, keeping every rule (or breaking one, when told). */
function standIn(options: { broken?: boolean; calls?: number[] } = {}): WriterDeps["complete"] {
  return async (_store, _account, messages) => {
    options.calls?.push(messages.length);
    const brief = JSON.parse(messages[1].content.split("\n\n<source-data>")[0]) as Brief;
    const sections = brief.sections.map((s) => {
      const blocks: unknown[] = [];
      const first = s.passages[0];
      if (first)
        blocks.push({
          kind: "statement",
          text: options.broken ? "Du har 30 dager på deg." : "Loven gir deg denne retten.",
          cites: [{ source: first.source, passage: first.passage, quote: TEXT_OF(first.source, first.passage).slice(0, 60) }],
        });
      const tokens = s.needs.length > 0 ? s.needs : ["{fact:store}"];
      const lists = tokens.filter((t) => t.startsWith("{list:"));
      for (const list of lists) blocks.push({ kind: "practical", text: list });
      const rest = tokens.filter((t) => !t.startsWith("{list:"));
      if (rest.length > 0) blocks.push({ kind: "practical", text: `Hos oss gjelder dette: ${rest.join(" ")}` });
      return { topic: s.topic, blocks };
    });
    return { text: `\`\`\`json\n${JSON.stringify({ sections })}\n\`\`\``, model: "stand-in-model" };
  };
}

let store: Awaited<ReturnType<typeof newStore>>;
let member: Membership;

async function fresh(): Promise<Membership> {
  const m = await passMembership(store.slug, store.accountId);
  if (!m) throw new Error("no membership");
  return m;
}

beforeAll(async () => {
  store = await newStore("legalai");
  await db().execute(sql`
    update commerce.stores set country = 'NO', legal_name = 'Lovtest AS', organisation_number = '999 888 777',
      contact_email = 'post@lovtest.example', postal_address = 'Storgata 1, 0155 Oslo'
    where id = ${store.storeId}::uuid`);
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  await db().execute(sql`
    insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, enabled, text_model)
    values (${store.storeId}::uuid, 'openai', ${encryptSecret("sk-test", key)}, 'test', true, 'text-a')`);
  member = await fresh();
}, 120_000);

afterAll(async () => {
  await closeDb();
});

/** The sources read, as availability would find them (the writer is given the texts themselves). */
const READ_KEYS = { sourceKeys: ["no-arl", "eu-crd"] };

const pageOf = async (id: string) => {
  const [page] = await db().execute<Row>(sql`select draft, published, published_at from commerce.pages where id = ${id}::uuid and store_id = ${store.storeId}::uuid`);
  return page;
};

describe("writing a legal page with AI", () => {
  it("is asked for by an owner, written by the job and saved as a draft with the store's facts and its sources", async () => {
    const asked = await writer.askForLegalPage(member, "returns_policy", READ_KEYS);
    expect(asked).toMatchObject({ ok: true, already: false });
    // A second press while it runs is the same write.
    expect(await writer.askForLegalPage(member, "returns_policy", READ_KEYS)).toMatchObject({ ok: true, already: true, id: asked.ok ? asked.id : "" });
    const calls: number[] = [];
    await writer.runLegalWrites({ complete: standIn({ calls }), texts: TEXTS, now: () => READ });
    const writes = await writer.legalWrites(store.storeId);
    const write = writes.returns_policy;
    expect(write).toMatchObject({ status: "written", languages: expect.arrayContaining([expect.any(String)]) });
    expect(calls.every((n) => n === 2)).toBe(true);
    const page = await pageOf(write.page!.id);
    expect(page.published).toBeNull();
    expect(page.published_at).toBeNull();
    const text = JSON.stringify(page.draft);
    expect(text).toContain("Storgata 1, 0155 Oslo");
    expect(text).not.toContain("legal-review-notice");
    expect(text).not.toContain("{fact:");
    expect(text).toMatch(/Kilder|Sources/);
    expect(text).toContain("Angrerettloven (LOV-2014-06-20-27)");
    // The Legal page lists it as the newest draft of its kind.
    const overview = await legalOverview(await fresh());
    expect(overview.roles.find((r) => r.role === "returns_policy")?.draft?.id).toBe(write.page!.id);
    const [log] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'store.legal_ai_draft_made' order by id desc limit 1`);
    expect(log.details).toMatchObject({ role: "returns_policy", page: write.page!.id, model: "stand-in-model" });
  });

  it("saves nothing when the checks refuse the draft twice, and says why", async () => {
    expect(await writer.askForLegalPage(member, "withdrawal_info", READ_KEYS)).toMatchObject({ ok: true });
    const calls: number[] = [];
    await writer.runLegalWrites({ complete: standIn({ broken: true, calls }), texts: TEXTS, now: () => READ });
    // The first try, then the second told why (the last answer and the reasons added).
    expect(calls).toEqual([2, 4]);
    const write = (await writer.legalWrites(store.storeId)).withdrawal_info;
    expect(write).toMatchObject({ status: "failed", page: null, problems: expect.arrayContaining([expect.stringContaining("the number 30")]) });
  });

  it("says when the store has no text model", async () => {
    expect(await writer.askForLegalPage(member, "terms", READ_KEYS)).toMatchObject({ ok: true });
    await writer.runLegalWrites({ complete: async () => null, texts: TEXTS });
    expect((await writer.legalWrites(store.storeId)).terms).toMatchObject({ status: "failed", problems: ["The store has no text model in its AI settings."] });
  });
});

describe("who may ask", () => {
  it("only an owner", async () => {
    expect(await writer.askForLegalPage({ ...member, role: "admin" }, "terms", READ_KEYS)).toMatchObject({ ok: false });
  });

  it("says when no source of a page has been read", async () => {
    expect(await writer.askForLegalPage(member, "imprint", READ_KEYS)).toMatchObject({ ok: true });
    await writer.runLegalWrites({ complete: standIn(), texts: TEXTS });
    expect((await writer.legalWrites(store.storeId)).imprint).toMatchObject({ status: "failed", problems: ["No official source could be read for this page yet."] });
  });

  it("not for a kind of page the AI does not write", async () => {
    expect(await writer.askForLegalPage(member, "accessibility", READ_KEYS)).toMatchObject({ ok: false, problems: ["The AI does not write that kind of page."] });
  });

  it("not for a store established outside the covered countries", async () => {
    await db().execute(sql`update commerce.stores set country = 'DE' where id = ${store.storeId}::uuid`);
    expect(await writer.askForLegalPage(await fresh(), "terms", READ_KEYS)).toEqual({ ok: false, problems: ["country"] });
    await db().execute(sql`update commerce.stores set country = 'NO' where id = ${store.storeId}::uuid`);
  });

  it("not without a text model", async () => {
    await db().execute(sql`update commerce.ai_providers set text_model = null where store_id = ${store.storeId}::uuid`);
    expect(await writer.legalWriterAvailability((await fresh()).store, undefined, READ_KEYS.sourceKeys)).toEqual({ ok: false, reason: "ai" });
    await db().execute(sql`update commerce.ai_providers set text_model = 'text-a' where store_id = ${store.storeId}::uuid`);
  });
});

describe("keeping the legal pages (L3)", () => {
  let shop: Awaited<ReturnType<typeof newStore>>;
  const owner = async () => {
    const m = await passMembership(shop.slug, shop.accountId);
    if (!m) throw new Error("no membership");
    return m;
  };
  const roleOf = async (role: string) => {
    const [row] = await db().execute<Row>(sql`select page_id from commerce.page_roles where store_id = ${shop.storeId}::uuid and role = ${role}`);
    return row ? String(row.page_id) : null;
  };
  const run = (texts: SourceText[] = TEXTS) => writer.runLegalWrites({ complete: standIn(), texts, now: () => READ }, 600_000);
  /** The upkeep as the next day's run: the store due, and earlier writes outside the day's cap (the cap has its own test). */
  const upkeep = async (texts: SourceText[] = TEXTS, options: { sameDay?: boolean } = {}) => {
    await db().execute(sql`update commerce.legal_ai_settings set checked_at = null where store_id = ${shop.storeId}::uuid`);
    if (!options.sameDay) await db().execute(sql`update commerce.legal_ai_writes set created_at = created_at - interval '25 hours' where store_id = ${shop.storeId}::uuid and status not in ('queued', 'running')`);
    return writer.runLegalUpkeep({ texts });
  };

  beforeAll(async () => {
    shop = await newStore("legalkeep");
    await db().execute(sql`
      update commerce.stores set country = 'NO', legal_name = 'Holdt AS', organisation_number = '999 777 555',
        contact_email = 'post@holdt.example', postal_address = 'Kirkegata 2, 0153 Oslo'
      where id = ${shop.storeId}::uuid`);
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await db().execute(sql`
      insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, enabled, text_model)
      values (${shop.storeId}::uuid, 'openai', ${encryptSecret("sk-test", key)}, 'test', true, 'text-a')`);
  }, 120_000);

  it("is turned on by an owner, who agrees to the sentence; each page it can write is published and put in its place", async () => {
    expect(await writer.turnOnLegalAi({ ...(await owner()), role: "admin" }, "auto", READ_KEYS)).toMatchObject({ ok: false });
    const on = await writer.turnOnLegalAi(await owner(), "auto", READ_KEYS);
    expect(on).toMatchObject({ ok: true, queued: 6 });
    const [settings] = await db().execute<Row>(sql`select enabled, publish, agreed from commerce.legal_ai_settings where store_id = ${shop.storeId}::uuid`);
    expect(settings).toMatchObject({ enabled: true, publish: "auto", agreed: writer.LEGAL_AI_TERMS_VERSION });
    await run();
    const writes = await writer.legalWrites(shop.storeId);
    expect(writes.returns_policy).toMatchObject({ status: "published", why: "first" });
    expect(writes.withdrawal_info).toMatchObject({ status: "published", why: "first" });
    // A kind with no source read yet is not written, and says why.
    expect(writes.imprint).toMatchObject({ status: "failed", problems: ["No official source could be read for this page yet."] });
    const returnsPage = await roleOf("returns_policy");
    expect(returnsPage).toBe(writes.returns_policy.page!.id);
    const [page] = await db().execute<Row>(sql`select published_at from commerce.pages where id = ${returnsPage}::uuid`);
    expect(page.published_at).not.toBeNull();
    // Nothing changed: the upkeep queues nothing for the pages written.
    await upkeep();
    expect((await writer.legalWrites(shop.storeId)).returns_policy.status).toBe("published");
  });

  it("writes a page again, as a new version at its own address, when the store's facts change", async () => {
    const before = await roleOf("returns_policy");
    await db().execute(sql`update commerce.stores set postal_address = 'Kirkegata 9, 0153 Oslo' where id = ${shop.storeId}::uuid`);
    await upkeep();
    expect((await writer.legalWrites(shop.storeId)).returns_policy).toMatchObject({ status: "queued", why: "facts_changed" });
    await run();
    const write = (await writer.legalWrites(shop.storeId)).returns_policy;
    expect(write).toMatchObject({ status: "published", why: "facts_changed", page: { id: before } });
    const [page] = await db().execute<Row>(sql`select published from commerce.pages where id = ${before}::uuid`);
    expect(JSON.stringify(page.published)).toContain("Kirkegata 9, 0153 Oslo");
  });

  it("writes a page again when a passage of the law it cites changes, and not when another does", async () => {
    const changed = TEXTS.map((t) => (t.sourceKey === "no-arl" ? { ...t, passages: t.passages.map((p) => (p.key === "21" ? { ...p, text: `${p.text} Endret ved lov.` } : p)) } : t));
    await upkeep(changed);
    const writes = await writer.legalWrites(shop.storeId);
    expect(writes.returns_policy).toMatchObject({ status: "queued", why: "source_changed" });
    await run(changed);
    expect((await writer.legalWrites(shop.storeId)).returns_policy).toMatchObject({ status: "published", why: "source_changed" });
    // Read again with the same texts, nothing has changed.
    await upkeep(changed);
    expect((await writer.legalWrites(shop.storeId)).returns_policy.status).toBe("published");
  });

  it("leaves a page a person changed alone and drafts beside it, until the owner hands it back", async () => {
    const chosen = (await roleOf("returns_policy"))!;
    await db().execute(sql`update commerce.pages set draft = jsonb_set(draft, '{title}', '"Våre returregler"') where id = ${chosen}::uuid`);
    await db().execute(sql`update commerce.stores set postal_address = 'Kirkegata 11, 0153 Oslo' where id = ${shop.storeId}::uuid`);
    await upkeep();
    await run();
    const kept = (await writer.legalWrites(shop.storeId)).returns_policy;
    expect(kept).toMatchObject({ status: "kept", problems: expect.arrayContaining([expect.stringContaining("changed by a person")]) });
    expect(kept.page!.id).not.toBe(chosen);
    const [mine] = await db().execute<Row>(sql`select draft ->> 'title' as title from commerce.pages where id = ${chosen}::uuid`);
    expect(mine.title).toBe("Våre returregler");
    expect(await roleOf("returns_policy")).toBe(chosen);
    // Another change writes the same draft again, not a second one beside the person's page.
    await db().execute(sql`update commerce.stores set postal_address = 'Kirkegata 12, 0153 Oslo' where id = ${shop.storeId}::uuid`);
    await upkeep();
    await run();
    const again = (await writer.legalWrites(shop.storeId)).returns_policy;
    expect(again).toMatchObject({ status: "kept", page: { id: kept.page!.id } });
    const [draft] = await db().execute<Row>(sql`select draft from commerce.pages where id = ${kept.page!.id}::uuid`);
    expect(JSON.stringify(draft.draft)).toContain("Kirkegata 12");
    // Handed back, it writes over the chosen page.
    expect(await writer.handBackLegalPage(await owner(), "returns_policy", READ_KEYS)).toMatchObject({ ok: true });
    await run();
    expect((await writer.legalWrites(shop.storeId)).returns_policy).toMatchObject({ status: "published", page: { id: chosen } });
  });

  it("keeps pages as drafts when the owner chooses so", async () => {
    await writer.setLegalAiPublish(await owner(), "ask");
    await db().execute(sql`update commerce.stores set postal_address = 'Kirkegata 13, 0153 Oslo' where id = ${shop.storeId}::uuid`);
    await upkeep();
    await run();
    const write = (await writer.legalWrites(shop.storeId)).returns_policy;
    expect(write.status).toBe("written");
    const [page] = await db().execute<Row>(sql`select published, draft from commerce.pages where id = ${write.page!.id}::uuid`);
    expect(JSON.stringify(page.draft)).toContain("Kirkegata 13");
    expect(JSON.stringify(page.published)).not.toContain("Kirkegata 13");
    await writer.setLegalAiPublish(await owner(), "auto");
  });

  it("writes no page the owner stopped, and nothing once turned off", async () => {
    await writer.stopLegalPage(await owner(), "withdrawal_info");
    await db().execute(sql`update commerce.stores set postal_address = 'Kirkegata 15, 0153 Oslo' where id = ${shop.storeId}::uuid`);
    await upkeep();
    const writes = await writer.legalWrites(shop.storeId);
    expect(writes.returns_policy).toMatchObject({ status: "queued" });
    expect(writes.withdrawal_info.status).not.toBe("queued");
    // Turned off before the queued write runs: it is not written.
    await writer.turnOffLegalAi(await owner());
    expect((await writer.legalWrites(shop.storeId)).returns_policy).toMatchObject({ status: "failed", problems: ["Turned off before it was written."] });
    expect(await upkeep()).toMatchObject({ stores: 0, queued: 0 });
  });

  it("queues at most a day's writes", async () => {
    await writer.turnOnLegalAi(await owner(), "auto", READ_KEYS);
    await run();
    // Each change of facts within the same day queues the needed pages again, until the cap.
    let queued = 0;
    for (let n = 0; n < 6; n++) {
      await db().execute(sql`update commerce.stores set postal_address = ${`Kirkegata ${20 + n}, 0153 Oslo`} where id = ${shop.storeId}::uuid`);
      queued += (await upkeep(TEXTS, { sameDay: true })).queued;
      await run();
    }
    const [{ n: today }] = await db().execute<{ n: string }>(sql`
      select count(*)::text as n from commerce.legal_ai_writes where store_id = ${shop.storeId}::uuid and why <> 'asked' and created_at > now() - interval '24 hours'`);
    expect(Number(today)).toBe(writer.LEGAL_WRITES_PER_DAY);
    expect(queued).toBeLessThan(6 * 5);
    await writer.turnOffLegalAi(await owner());
  });

  it("is told to the AI manager, read only", async () => {
    const status = await writer.legalStatusTool({ store: (await owner()).store });
    expect(status).toMatchObject({ on: false, pages: expect.arrayContaining([expect.objectContaining({ kind: "withdrawal_info", stopped: true })]) });
    expect(status.note).toContain("no tool changes it");
  });
});
