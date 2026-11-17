import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERSONAL_DATA } from "@/lib/personal-data";
import { PURPOSE_OF } from "@/lib/personal-purposes";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { QUESTION_CONVERSATIONS, QUESTION_MAX, QUESTION_STATUSES } from "@/lib/unanswered-questions";

import { createTestDatabase } from "./testing";

/**
 * Questions the chat assistant could not answer (ecosystem plan E4.3, D729): the rules the database holds, against real Postgres (PGlite)
 * with every migration applied. A question is one per site, language and wording (Kaizena Flow's own, without a store, too); it keeps its
 * site, language, wording and first day; its answer is a knowledge document of the same site; a decided one says when; it holds one to five
 * conversations and words of at most 300 characters; it goes with its store.
 */

let db: PGlite;
let shop: string;
let other: string;
const conv = "00000000-0000-4000-8000-000000000001";

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function store(slug: string): Promise<string> {
  return (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug])).id;
}
async function document(storeId: string | null): Promise<string> {
  return (await one<{ id: string }>("insert into commerce.knowledge_documents (store_id, title, content) values ($1, 'Shipping', 'We ship to Iceland.') returning id", [storeId])).id;
}
const question = (storeId: string | null, key: string, over: { lang?: string; text?: string; conversations?: string[] } = {}) =>
  db.query<{ id: string }>("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations) values ($1, $2, $3, $4, $5::uuid[]) returning id", [
    storeId,
    over.lang ?? "nb",
    key,
    over.text ?? key,
    over.conversations ?? [conv],
  ]);

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await store("uq-shop");
  other = await store("uq-other");
});

afterAll(async () => {
  await db.close();
});

describe("a question the assistant could not answer", () => {
  it("is one per site, language and wording, Kaizena Flow's own (no store) included", async () => {
    await question(shop, "sender dere til island");
    await rejects("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations) values ($1, 'nb', 'sender dere til island', 'x', $2::uuid[])", [shop, [conv]], /unanswered_questions_key/);
    // Another language, another store and the platform each have their own.
    await question(shop, "sender dere til island", { lang: "en" });
    await question(other, "sender dere til island");
    // Kaizena Flow's own rows (no store) are one per language and wording too: null is not distinct here.
    await question(null, "do you have an api", { lang: "en" });
    await rejects("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations) values (null, 'en', 'do you have an api', 'x', $1::uuid[])", [[conv]], /unanswered_questions_key/);
  });

  it("keeps its site, language, wording and first day; its words, count and state may change", async () => {
    const { rows } = await question(shop, "hvor lenge tar frakten");
    const id = rows[0].id;
    await rejects("update commerce.unanswered_questions set store_id = $2 where id = $1", [id, other], /keeps its site/);
    await rejects("update commerce.unanswered_questions set lang = 'en' where id = $1", [id], /keeps its site/);
    await rejects("update commerce.unanswered_questions set key = 'something else' where id = $1", [id], /keeps its site/);
    await rejects("update commerce.unanswered_questions set first_at = first_at - interval '1 day' where id = $1", [id], /keeps its site/);
    await db.query("update commerce.unanswered_questions set question = 'Hvor lenge tar frakten?', asked = asked + 1, last_at = now() + interval '1 second' where id = $1", [id]);
    expect(await one("select asked, question from commerce.unanswered_questions where id = $1", [id])).toEqual({ asked: 2, question: "Hvor lenge tar frakten?" });
  });

  it("is answered only by a knowledge document of the same site", async () => {
    const { rows } = await question(shop, "har dere gavekort");
    const id = rows[0].id;
    const mine = await document(shop);
    const theirs = await document(other);
    const platforms = await document(null);
    await rejects("update commerce.unanswered_questions set document_id = $2, status = 'answered', decided_at = now() where id = $1", [id, theirs], /same site/);
    await rejects("update commerce.unanswered_questions set document_id = $2, status = 'answered', decided_at = now() where id = $1", [id, platforms], /same site/);
    await db.query("update commerce.unanswered_questions set document_id = $2, status = 'answered', decided_at = now() where id = $1", [id, mine]);
    // The platform's question takes the platform's document, never a store's.
    const kf = (await question(null, "can i move from shopify")).rows[0].id;
    await rejects("update commerce.unanswered_questions set document_id = $2 where id = $1", [kf, mine], /same site/);
    await db.query("update commerce.unanswered_questions set document_id = $2 where id = $1", [kf, platforms]);
    // A deleted document leaves the question without one.
    await db.query("delete from commerce.knowledge_documents where id = $1", [mine]);
    expect((await one<{ document_id: string | null }>("select document_id from commerce.unanswered_questions where id = $1", [id])).document_id).toBeNull();
  });

  it("says when it was decided exactly when it is answered or set aside, and has only the states the code knows", async () => {
    const { rows } = await question(shop, "kan jeg hente selv");
    const id = rows[0].id;
    await rejects("update commerce.unanswered_questions set status = 'dismissed' where id = $1", [id], /unanswered_questions_decided/);
    await rejects("update commerce.unanswered_questions set decided_at = now() where id = $1", [id], /unanswered_questions_decided/);
    await rejects("update commerce.unanswered_questions set status = 'ignored', decided_at = now() where id = $1", [id], /unanswered_questions_status/);
    await db.query("update commerce.unanswered_questions set status = 'dismissed', decided_at = now() where id = $1", [id]);
    await db.query("update commerce.unanswered_questions set status = 'open', decided_at = null where id = $1", [id]);
    const { rows: states } = await db.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'unanswered_questions_status'");
    for (const s of QUESTION_STATUSES) expect(states[0].def).toContain(`'${s}'`);
  });

  it("holds one to five conversations, words of at most 300 characters, a short language code and counts that add up", async () => {
    await rejects("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations) values ($1, 'nb', 'a', 'a', '{}'::uuid[])", [shop], /unanswered_questions_conversations/);
    const six = Array.from({ length: QUESTION_CONVERSATIONS + 1 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    await rejects("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations) values ($1, 'nb', 'b', 'b', $2::uuid[])", [shop, six], /unanswered_questions_conversations/);
    await rejects("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations) values ($1, 'nb', 'c', $2, $3::uuid[])", [shop, "x".repeat(QUESTION_MAX + 1), [conv]], /unanswered_questions_question/);
    await rejects("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations) values ($1, 'nb-NO', 'd', 'd', $2::uuid[])", [shop, [conv]], /unanswered_questions_lang/);
    await rejects("insert into commerce.unanswered_questions (store_id, lang, key, question, conversations, asked, handed_over) values ($1, 'nb', 'e', 'e', $2::uuid[], 1, 2)", [shop, [conv]], /unanswered_questions_asked/);
  });

  it("goes with its store, has row-level security on, and is a person's data under support, never copied", async () => {
    // A store is closed by its own job (D171), which deletes its rows; the key goes with the store when it is.
    const fk = await one<{ confdeltype: string }>(
      "select confdeltype from pg_constraint where conrelid = 'commerce.unanswered_questions'::regclass and confrelid = 'commerce.stores'::regclass",
    );
    expect(fk.confdeltype).toBe("c");
    expect((await one<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'commerce.unanswered_questions'::regclass")).relrowsecurity).toBe(true);
    expect((await one<{ period_value: number }>("select period_value from commerce.retention_rules where kind = 'unanswered_questions' and country is null and valid_to is null")).period_value).toBe(90);
    expect(PERSONAL_DATA.find((entry) => entry.table === "unanswered_questions")).toMatchObject({ subject: "shopper", export: "support", erasure: "delete", until: "unanswered_questions" });
    expect(PURPOSE_OF.unanswered_questions).toBe("support");
    expect(COPY_RULES.unanswered_questions).toBeDefined();
  });
});
