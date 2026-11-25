import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { openCanvaState, randomToken, sealCanvaState } from "@/lib/canva";
import { parseKey } from "@/lib/secret-box";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

/** The library's files stand in for Storage: a picture read by its row, and what `storePicture()` keeps, as a row of `commerce.media`. */
const kept: { madeBy?: string; editedFrom?: string | null; fileName: string; storeId: string | null }[] = [];
let stored = 0;
vi.mock("./media", () => ({
  uploadsEnabled: () => true,
  downloadStoredFile: async () => new Uint8Array(await sharp({ create: { width: 120, height: 80, channels: 3, background: "#c0ffee" } }).webp().toBuffer()),
}));
vi.mock("./media-library", async () => {
  const { db: database } = await import("@/db/client");
  const { sql: q } = await import("drizzle-orm");
  return {
    storePicture: async (owner: { storeId: string | null }, _image: File, _thumb: File, details: { fileName: string; madeBy?: string; editedFrom?: string | null }) => {
      stored += 1;
      kept.push({ madeBy: details.madeBy, editedFrom: details.editedFrom, fileName: details.fileName, storeId: owner.storeId });
      const url = `https://example.supabase.co/storage/v1/object/public/product-media/canva-${Date.now()}-${stored}.webp`;
      const [row] = await database().execute<{ id: string }>(q`
        insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, made_by, edited_from)
        values (${owner.storeId}::uuid, 'image', ${url}, 'product-media', 'p', ${details.fileName}, 'image/webp', ${details.madeBy ?? "person"}, ${details.editedFrom ?? null}::uuid)
        returning id
      `);
      return { ok: true, url, thumbnailUrl: url, id: String(row.id) };
    },
  };
});

const canva = await import("./canva");
const posts = await import("./canva-posts");
const { PICTURE_SIZES } = await import("@/lib/social-posts");
const { newStore } = await import("./inventory-test-support");

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

/** A stand-in for Canva's REST API, OAuth server, key set and file hosts, as its reference describes them. */
function fakeCanva() {
  const calls: Call[] = [];
  let refreshWorks = true;
  let issued = 0;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = String(publicKey.export({ format: "jwk" }).x);
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = typeof init?.body === "string" ? (url.includes("/oauth/") ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body)) : init?.body ? "bytes" : null;
    calls.push({ method, url, body, headers });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/v1/oauth/token")) {
      const form = body as Record<string, string>;
      if (form.grant_type === "refresh_token" && !refreshWorks) return json(400, { code: "invalid_grant", message: "Invalid refresh token" });
      issued += 1;
      return json(200, { access_token: `access-${issued}`, refresh_token: `refresh-${issued}`, token_type: "Bearer", expires_in: 14400, scope: "asset:read asset:write" });
    }
    if (url.endsWith("/v1/oauth/revoke")) return json(200, {});
    if (url.endsWith("/v1/connect/keys")) return json(200, { keys: [{ kid: "k1", kty: "OKP", crv: "Ed25519", x }] });
    if (url.endsWith("/v1/users/me")) return json(200, { team_user: { user_id: "UAFkari", team_id: "BAFteam" } });
    if (url.endsWith("/v1/users/me/profile")) return json(200, { profile: { display_name: "Kari Nordmann" } });
    if (url.endsWith("/v1/asset-uploads") && method === "POST") return json(200, { job: { id: "up-1", status: "in_progress" } });
    if (url.endsWith("/v1/asset-uploads/up-1")) return json(200, { job: { id: "up-1", status: "success", asset: { id: "MAFasset1" } } });
    if (url.endsWith("/v1/designs") && method === "POST") return json(200, { design: { id: "DAFedited1", urls: { edit_url: "https://www.canva.com/api/design/tok1/edit", view_url: "https://www.canva.com/api/design/tok1/view" } } });
    if (url.includes("/v1/designs?")) {
      return json(200, {
        items: [{ id: "DAFsale1", title: "Black Friday", thumbnail: { url: "https://document-export.canva.com/a/thumbnail/0001.png?sig=1", width: 400, height: 300 }, page_count: 2 }],
        continuation: "next-page",
      });
    }
    if (url.endsWith("/v1/designs/DAFsale1")) return json(200, { design: { id: "DAFsale1", title: "Black Friday" } });
    if (url.endsWith("/v1/designs/DAFedited1") && method === "GET") {
      return json(200, { design: { id: "DAFedited1", title: "hero", urls: { edit_url: "https://www.canva.com/api/design/tok2/edit", view_url: "https://www.canva.com/api/design/tok2/view" } } });
    }
    if (url.endsWith("/v1/designs/DAFmissing")) return json(404, { code: "design_not_found", message: "Design not found" });
    if (url.endsWith("/v1/exports") && method === "POST") return json(200, { job: { id: "ex-1", status: "in_progress" } });
    if (url.endsWith("/v1/exports/ex-1")) return json(200, { job: { id: "ex-1", status: "success", urls: ["https://export-download.canva.com/ex-1/1.png"] } });
    if (url === "https://export-download.canva.com/ex-1/1.png") {
      const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#123456" } }).png().toBuffer();
      return new Response(new Uint8Array(png), { status: 200, headers: { "Content-Type": "image/png" } });
    }
    return json(404, { code: "not_found", message: "Not in the stand-in." });
  }) as typeof fetch;
  /** The JWT Canva's Return button would carry for this edit link. */
  const returnJwt = (claims: Record<string, unknown>) => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${part({ alg: "EdDSA", kid: "k1" })}.${part({ aud: app.clientId, type: "rti", exp: Math.floor(Date.now() / 1000) + 3600, sub: "UAFkari", team_id: "BAFteam", ...claims })}`;
    return `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
  };
  return { calls, fetcher, returnJwt, refuseRefresh: () => (refreshWorks = false) };
}

const app = { clientId: "OC-AZkaizena", clientSecret: "cnvca-secret-1234" };
const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
let store: Awaited<ReturnType<typeof newStore>>;
let fake: ReturnType<typeof fakeCanva>;
let deps: { fetch: typeof fetch; app: typeof app; wait: () => Promise<void> };
let owner: { storeId: string; storeSlug: string; accountId: string };
let picture = "";

beforeAll(async () => {
  store = await newStore("canva");
  fake = fakeCanva();
  deps = { fetch: fake.fetcher, app, wait: async () => {} };
  owner = { storeId: store.storeId, storeSlug: store.slug, accountId: store.accountId };
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, width, height)
    values (${store.storeId}::uuid, 'image', ${`https://example.supabase.co/storage/v1/object/public/product-media/hero-${store.slug}.webp`}, 'product-media', 'hero.webp', 'hero.webp', 'image/webp', 120, 80)
    returning id
  `);
  picture = String(row.id);
});

afterAll(async () => {
  await closeDb();
});

describe("A person's Canva (D898)", () => {
  it("connects through Canva's consent page with PKCE, only as the person who pressed, the tokens kept encrypted", async () => {
    const start = canva.startCanvaConnect(store.accountId, `/admin/${store.slug}/media`, deps);
    if (!start.ok) throw new Error(start.problem);
    const sent = new URL(start.url);
    expect(sent.origin + sent.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    const state = openCanvaState(key, start.cookie)!;
    expect(sent.searchParams.get("state")).toBe(state.state);
    // Someone else signed in now is refused, and so is a state that does not match.
    expect(await canva.finishCanvaConnect(new URLSearchParams({ state: state.state, code: "c" }), start.cookie, "5c2c8f0e-3a9d-4c7b-9e21-0a1b2c3d4e5f", deps)).toBe(
      `/admin/${store.slug}/media?canva=failed`,
    );
    expect(await canva.finishCanvaConnect(new URLSearchParams({ state: "wrong", code: "c" }), start.cookie, store.accountId, deps)).toBe(`/admin/${store.slug}/media?canva=failed`);
    const back = await canva.finishCanvaConnect(new URLSearchParams({ state: state.state, code: "the-code" }), start.cookie, store.accountId, deps);
    expect(back).toBe(`/admin/${store.slug}/media?canva=connected`);
    const exchange = fake.calls.find((c) => c.url.endsWith("/v1/oauth/token"))!;
    expect(exchange.headers.Authorization).toBe(`Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`);
    expect(exchange.body).toMatchObject({ grant_type: "authorization_code", code: "the-code", code_verifier: state.verifier });
    const [row] = await db().execute<Record<string, string>>(
      sql`select display_name, external_user_id, access_token_encrypted, refresh_token_encrypted from commerce.design_connections where account_id = ${store.accountId}::uuid`,
    );
    expect(row.display_name).toBe("Kari Nordmann");
    expect(row.external_user_id).toBe("UAFkari");
    expect(row.access_token_encrypted).not.toContain("access-");
    expect(row.refresh_token_encrypted).not.toContain("refresh-");
    expect(await canva.canvaAccount(store.accountId)).toMatchObject({ name: "Kari Nordmann", problem: null });
    // A cookie this server did not seal is no connect at all.
    const forged = sealCanvaState(randomBytes(32), { state: randomToken(), account: store.accountId, back: "/admin", verifier: randomToken() });
    expect(await canva.finishCanvaConnect(new URLSearchParams({ state: "x", code: "c" }), forged, store.accountId, deps)).toBe("/admin");
  });

  it("refreshes a token that ran out once, under the row's lock, keeping the new refresh token", async () => {
    await db().execute(sql`update commerce.design_connections set access_expires_at = now() - interval '1 minute' where account_id = ${store.accountId}::uuid`);
    const before = fake.calls.filter((c) => c.url.endsWith("/v1/oauth/token")).length;
    const [a, b] = await Promise.all([canva.listCanvaDesigns(owner, {}, deps), canva.listCanvaDesigns(owner, {}, deps)]);
    expect(a.ok && b.ok).toBe(true);
    // Two lists at once refresh once: the second waits for the row and finds the new token.
    expect(fake.calls.filter((c) => c.url.endsWith("/v1/oauth/token")).length).toBe(before + 1);
    if (!a.ok) throw new Error(a.problem);
    expect(a.designs).toHaveLength(1);
    expect(a.designs[0]).toMatchObject({ id: "DAFsale1", title: "Black Friday", pages: 2 });
    expect(a.designs[0].thumbnail).toMatch(/^\/api\/integrations\/canva\/thumbnail\?/);
    expect(a.continuation).toBe("next-page");
  });

  it("sends a library picture to Canva, comes back through Canva's signed Return, and brings the edit in as a new picture", async () => {
    const started = await canva.startCanvaEdit(owner, picture, deps);
    if (!started.ok) throw new Error(started.problem);
    const link = new URL(started.url);
    expect(link.origin + link.pathname).toBe("https://www.canva.com/api/design/tok1/edit");
    const correlation = link.searchParams.get("correlation_state")!;
    const upload = fake.calls.find((c) => c.url.endsWith("/v1/asset-uploads") && c.method === "POST")!;
    expect(upload.headers["Content-Type"]).toBe("application/octet-stream");
    expect(JSON.parse(upload.headers["Asset-Upload-Metadata"])).toEqual({ name_base64: Buffer.from("hero.webp").toString("base64") });
    const made = fake.calls.find((c) => c.url.endsWith("/v1/designs") && c.method === "POST")!;
    expect(made.body).toMatchObject({ type: "type_and_asset", asset_id: "MAFasset1", design_type: { type: "custom", width: 120, height: 80 } });
    // Only the correlation's hash is kept.
    const [edit] = await db().execute<Record<string, string>>(sql`select correlation_hash, status from commerce.design_edits where id = ${started.editId}::uuid`);
    expect(edit.correlation_hash).not.toContain(correlation);
    expect(edit.status).toBe("open");

    // A JWT for another Canva user, or one not signed by Canva, does not name the edit.
    expect(await canva.canvaReturned(new URLSearchParams({ correlation_jwt: fake.returnJwt({ design_id: "DAFedited1", correlation_state: correlation, sub: "UAFsomeone" }) }), deps)).toBe(
      `/admin/${store.slug}/media`,
    );
    expect(await canva.canvaReturned(new URLSearchParams({ correlation_jwt: "a.b.c" }), deps)).toBe("/admin");
    const to = await canva.canvaReturned(new URLSearchParams({ correlation_jwt: fake.returnJwt({ design_id: "DAFedited1", correlation_state: correlation }) }), deps);
    expect(to).toBe(`/admin/${store.slug}/media?canva=${started.editId}`);

    // Someone else in the store cannot bring the person's edit in.
    expect(await canva.bringBackFromCanva({ ...owner, accountId: "5c2c8f0e-3a9d-4c7b-9e21-0a1b2c3d4e5f" }, started.editId, deps)).toEqual({ ok: false, problem: "gone" });
    const brought = await canva.bringBackFromCanva(owner, started.editId, deps);
    if (!brought.ok) throw new Error(brought.problem);
    expect(kept.at(-1)).toMatchObject({ madeBy: "canva", editedFrom: picture, fileName: "hero-canva.webp", storeId: store.storeId });
    const exported = fake.calls.find((c) => c.url.endsWith("/v1/exports") && c.method === "POST")!;
    expect(exported.body).toEqual({ design_id: "DAFedited1", format: { type: "png", pages: [1] } });
    const [after] = await db().execute<Record<string, string>>(sql`select status, result_media_id from commerce.design_edits where id = ${started.editId}::uuid`);
    expect(after).toMatchObject({ status: "brought", result_media_id: brought.mediaId });
    expect(await canva.canvaEditsOf(owner)).toEqual({ [picture]: started.editId });
    const [original] = await db().execute<Record<string, string>>(sql`select made_by from commerce.media where id = ${picture}::uuid`);
    expect(original.made_by).toBe("person");
  });

  it("edits a picture field's picture found by its address: Canva's Return lands on the back page, and the field asks where it stands (C2)", async () => {
    const address = `https://example.supabase.co/storage/v1/object/public/product-media/hero-${store.slug}.webp`;
    // Only a picture the site's own library holds.
    expect(await canva.startCanvaEdit(owner, { url: "https://elsewhere.example/hero.webp" }, deps, "field")).toEqual({ ok: false, problem: "gone" });
    expect(await canva.startCanvaEdit({ ...owner, storeId: null, storeSlug: null }, { url: address }, deps, "field")).toEqual({ ok: false, problem: "gone" });
    const started = await canva.startCanvaEdit(owner, { url: address }, deps, "field");
    if (!started.ok) throw new Error(started.problem);
    const correlation = new URL(started.url).searchParams.get("correlation_state")!;
    expect(await canva.canvaEditStatus(owner, started.editId)).toEqual({ ok: true, status: "open" });
    // Another person's, or a word that is no id, is not there.
    expect(await canva.canvaEditStatus({ ...owner, accountId: "5c2c8f0e-3a9d-4c7b-9e21-0a1b2c3d4e5f" }, started.editId)).toEqual({ ok: false, problem: "gone" });
    expect(await canva.canvaEditStatus(owner, "nope")).toEqual({ ok: false, problem: "gone" });

    const to = await canva.canvaReturned(new URLSearchParams({ correlation_jwt: fake.returnJwt({ design_id: "DAFedited1", correlation_state: correlation }) }), deps);
    expect(to).toBe(`/admin/account/canva-back?edit=${started.editId}`);
    expect(await canva.canvaEditStatus(owner, started.editId)).toEqual({ ok: true, status: "returned" });

    // The field takes the copy brought in: its address and size.
    const brought = await canva.bringBackFromCanva(owner, started.editId, deps);
    if (!brought.ok) throw new Error(brought.problem);
    expect(brought).toMatchObject({ width: 200, height: 100 });
    expect(brought.url).toMatch(/\/canva-\d+-\d+\.webp$/);
    expect(kept.at(-1)).toMatchObject({ madeBy: "canva", editedFrom: picture });
    expect(await canva.canvaEditStatus(owner, started.editId)).toEqual({ ok: true, status: "brought" });
  });

  it("edits a social post's picture: sent in the channel's shape, brought back as the post's picture, reopened in the same design, and undone (C3)", async () => {
    const [post] = await db().execute<{ id: string }>(sql`
      insert into commerce.social_posts (store_id, channel, ref, locale, title, caption, link)
      values (${store.storeId}::uuid, 'instagram', ${`c3${store.slug.replace(/[^a-z0-9]/g, "").slice(0, 10).padEnd(10, "0")}`}, 'nb-NO', 'Mugs', 'New mugs are in.', 'https://example.com/mugs')
      returning id`);
    const member = { store: { id: store.storeId, slug: store.slug }, account: { id: store.accountId } } as unknown as Parameters<typeof posts.startPostEdit>[0];
    const drawn: string[] = [];
    const draw = async (_member: unknown, postId: string) => {
      drawn.push(postId);
      return new Uint8Array(await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#224466" } }).png().toBuffer());
    };
    // Another store's post, or no id, is not there.
    expect(await posts.startPostEdit(member, "nope", "https://kaizenaflow.com", { ...deps, draw })).toEqual({ ok: false, problem: "gone" });

    const first = await posts.startPostEdit(member, String(post.id), "https://kaizenaflow.com", { ...deps, draw });
    if (!first.ok) throw new Error(first.problem);
    expect(drawn).toEqual([String(post.id)]);
    const made = fake.calls.filter((c) => c.url.endsWith("/v1/designs") && c.method === "POST").at(-1)!;
    expect(made.body).toMatchObject({ design_type: { type: "custom", width: PICTURE_SIZES.instagram.width, height: PICTURE_SIZES.instagram.height } });
    const [row] = await db().execute<Record<string, string | null>>(sql`select place, post_id, source_media_id from commerce.design_edits where id = ${first.editId}::uuid`);
    expect(row).toMatchObject({ place: "post", post_id: String(post.id), source_media_id: null });

    const correlation = new URL(first.url).searchParams.get("correlation_state")!;
    const to = await canva.canvaReturned(new URLSearchParams({ correlation_jwt: fake.returnJwt({ design_id: "DAFedited1", correlation_state: correlation }) }), deps);
    expect(to).toBe(`/admin/account/canva-back?edit=${first.editId}`);
    const brought = await canva.bringBackFromCanva({ storeId: store.storeId, storeSlug: store.slug, accountId: store.accountId }, first.editId, deps);
    if (!brought.ok) throw new Error(brought.problem);
    expect(kept.at(-1)).toMatchObject({ madeBy: "canva", editedFrom: null, fileName: expect.stringMatching(/^instagram-.*-canva\./) });
    const pictureOf = async () => (await db().execute<{ picture: string | null }>(sql`select picture_media_id as picture from commerce.social_posts where id = ${post.id}::uuid`))[0].picture;
    expect(await pictureOf()).toBe(brought.mediaId);

    // Edited again: the same design opens where it was left, nothing drawn or sent again.
    const uploads = fake.calls.filter((c) => c.url.endsWith("/v1/asset-uploads") && c.method === "POST").length;
    const again = await posts.startPostEdit(member, String(post.id), "https://kaizenaflow.com", { ...deps, draw });
    if (!again.ok) throw new Error(again.problem);
    expect(new URL(again.url).pathname).toBe("/api/design/tok2/edit");
    expect(fake.calls.filter((c) => c.url.endsWith("/v1/asset-uploads") && c.method === "POST")).toHaveLength(uploads);
    expect(drawn).toHaveLength(1);

    // The original picture again; the copy stays in the library.
    expect(await posts.usePostDrawnPicture(member, String(post.id))).toEqual({ ok: true, postId: String(post.id) });
    expect(await pictureOf()).toBeNull();
    const [still] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.media where id = ${brought.mediaId}::uuid`);
    expect(still.n).toBe(1);
  });

  it("imports a design's first page as a new picture, and says when a design is gone", async () => {
    const imported = await canva.importCanvaDesign(owner, "DAFsale1", deps);
    if (!imported.ok) throw new Error(imported.problem);
    expect(kept.at(-1)).toMatchObject({ madeBy: "canva", editedFrom: null, fileName: "Black Friday.webp" });
    expect(await canva.importCanvaDesign(owner, "DAFmissing", deps)).toEqual({ ok: false, problem: "gone" });
    expect(await canva.importCanvaDesign(owner, "../x", deps)).toEqual({ ok: false, problem: "gone" });
  });

  it("asks the person to connect again when Canva no longer takes the refresh token", async () => {
    fake.refuseRefresh();
    await db().execute(sql`update commerce.design_connections set access_expires_at = now() - interval '1 minute' where account_id = ${store.accountId}::uuid`);
    expect(await canva.listCanvaDesigns(owner, {}, deps)).toEqual({ ok: false, problem: "reconnect" });
    expect((await canva.canvaAccount(store.accountId))?.problem).toBeTruthy();
  });

  it("disconnects: the refresh token revoked at Canva and the row gone", async () => {
    await canva.disconnectCanva(store.accountId, deps);
    expect(await canva.canvaAccount(store.accountId)).toBeNull();
    expect(await canva.listCanvaDesigns(owner, {}, deps)).toEqual({ ok: false, problem: "not_connected" });
  });
});
