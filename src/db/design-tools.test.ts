import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The rules of a person's Canva (D898, `docs/design-tools.md` C1) on a real schema: one connection per person and tool, gone with the
 * account; edits found by a correlation's SHA-256 only; and library pictures marked `canva` that may name the picture they were edited from,
 * which an upload still may not.
 */

let db: PGlite;
let person: string;
let store: string;

beforeAll(async () => {
  db = await createTestDatabase();
  person = (await one<{ id: string }>("insert into commerce.accounts (email) values ('canva-person@example.com') returning id")).id;
  store = (await one<{ id: string }>("insert into commerce.stores (slug, name) values ('canva-shop', 'Canva shop') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const fails = async (sql: string, params: unknown[] = []) => {
  await expect(db.query(sql, params)).rejects.toThrow();
};

const connect = (account: string, provider = "canva", user = "UAFabc") =>
  db.query(
    `insert into commerce.design_connections (account_id, provider, external_user_id, external_team_id, display_name, access_token_encrypted, access_expires_at)
     values ($1, $2, $3, 'BAFteam', 'Kari', 'sealed', now() + interval '4 hours')`,
    [account, provider, user],
  );

const picture = async (madeBy: string, editedFrom: string | null = null, url = `https://x.supabase.co/${Math.random()}.webp`) =>
  (
    await one<{ id: string }>(
      `insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, made_by, edited_from)
       values ($1, 'image', $2, 'product-media', 'p', 'a.webp', 'image/webp', $3, $4) returning id`,
      [store, url, madeBy, editedFrom],
    )
  ).id;

describe("A person's Canva (D898)", () => {
  it("is one connection per person and tool, and only to tools we know", async () => {
    await connect(person);
    await fails(
      `insert into commerce.design_connections (account_id, provider, external_user_id, access_token_encrypted, access_expires_at)
       values ($1, 'canva', 'UAFother', 'sealed', now())`,
      [person],
    );
    const other = (await one<{ id: string }>("insert into commerce.accounts (email) values ('canva-other@example.com') returning id")).id;
    await expect(connect(other, "photoshop")).rejects.toThrow();
    await expect(connect(other, "canva", "")).rejects.toThrow();
  });

  it("goes with the person's account", async () => {
    const gone = (await one<{ id: string }>("insert into commerce.accounts (email) values ('canva-gone@example.com') returning id")).id;
    await connect(gone);
    await db.query("delete from commerce.accounts where id = $1", [gone]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.design_connections where account_id = $1", [gone])).n).toBe(0);
  });

  it("keeps an edit's correlation only as a SHA-256, and only known states", async () => {
    const source = await picture("person");
    const hash = "a".repeat(64);
    await db.query(
      `insert into commerce.design_edits (store_id, account_id, provider, design_id, source_media_id, correlation_hash) values ($1, $2, 'canva', 'DAFVztcvd9z', $3, $4)`,
      [store, person, source, hash],
    );
    await fails(
      `insert into commerce.design_edits (store_id, account_id, provider, design_id, correlation_hash) values ($1, $2, 'canva', 'DAFVztcvd9z', $3)`,
      [store, person, hash],
    );
    await fails(
      `insert into commerce.design_edits (store_id, account_id, provider, design_id, correlation_hash) values ($1, $2, 'canva', 'DAFVztcvd9z', 'plain-correlation')`,
      [store, person],
    );
    await fails(
      `insert into commerce.design_edits (store_id, account_id, provider, design_id, correlation_hash) values ($1, $2, 'canva', '../etc', $3)`,
      [store, person, "b".repeat(64)],
    );
    await fails(`update commerce.design_edits set status = 'lost' where correlation_hash = $1`, [hash]);
    // The picture it came from may be deleted; the edit stays without it.
    await db.query("delete from commerce.media where id = $1", [source]);
    expect((await one<{ source: string | null }>("select source_media_id as source from commerce.design_edits where correlation_hash = $1", [hash])).source).toBeNull();
  });
});

describe("Pictures from Canva in the library (D898)", () => {
  it("may name the picture they were edited from; an upload still may not", async () => {
    const original = await picture("person");
    const edited = await picture("canva", original);
    expect((await one<{ made_by: string }>("select made_by from commerce.media where id = $1", [edited])).made_by).toBe("canva");
    await picture("canva");
    await expect(picture("person", original)).rejects.toThrow();
    await expect(picture("figma")).rejects.toThrow();
  });
});
