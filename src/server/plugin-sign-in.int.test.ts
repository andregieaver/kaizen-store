import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const signIn = await import("./plugin-sign-in");
const { apiCaller } = await import("./api-tokens");
const { newStore } = await import("./inventory-test-support");

let store: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("plugin");
});

afterAll(async () => {
  await closeDb();
});

describe("Signing a design tool's app in (D898 F1)", () => {
  it("gives the plugin its token once, after the owner connects, and a second sign-in replaces the first token", async () => {
    const started = await signIn.startPluginSignIn("figma");
    expect(started.code).toMatch(signIn.PLUGIN_CODE);
    expect(started.url).toMatch(new RegExp(`/admin/account/plugin\\?code=${started.code}$`));
    expect(await signIn.pollPluginSignIn(started.readKey)).toEqual({ status: "waiting" });
    expect(await signIn.pollPluginSignIn("not-a-key")).toEqual({ status: "gone" });
    expect(await signIn.waitingSignIn(started.code)).toEqual({ code: started.code, tool: "figma" });

    expect(await signIn.approvePluginSignIn(store.member, started.code)).toEqual({ ok: true });
    const ready = await signIn.pollPluginSignIn(started.readKey);
    if (ready.status !== "ready") throw new Error(ready.status);
    expect(ready.store.slug).toBe(store.slug);
    // The token is the store's, with the plugin's scopes, and it works on the Admin API.
    const caller = await apiCaller(`Bearer ${ready.token}`);
    expect(caller?.member.store.id).toBe(store.storeId);
    expect([...(caller?.token.scopes ?? [])].sort()).toEqual([...signIn.PLUGIN_SCOPES.figma].sort());
    // Given once: asked again, it is gone, and nothing of it is kept.
    expect(await signIn.pollPluginSignIn(started.readKey)).toEqual({ status: "gone" });
    const [row] = await db().execute<{ status: string; token_sealed: string | null }>(sql`select status, token_sealed from commerce.plugin_sign_ins where code = ${started.code}`);
    expect(row).toMatchObject({ status: "taken", token_sealed: null });
    // An answered sign-in cannot be approved again.
    expect(await signIn.approvePluginSignIn(store.member, started.code)).toEqual({ ok: false, problem: "gone" });

    // Signing in again replaces the first token: it stops working.
    const again = await signIn.startPluginSignIn("figma");
    expect(await signIn.approvePluginSignIn(store.member, again.code)).toEqual({ ok: true });
    const second = await signIn.pollPluginSignIn(again.readKey);
    if (second.status !== "ready") throw new Error(second.status);
    expect(await apiCaller(`Bearer ${ready.token}`)).toBeNull();
    expect((await apiCaller(`Bearer ${second.token}`))?.member.store.id).toBe(store.storeId);
  });

  it("tells the plugin when the owner declines, and forgets a sign-in nobody answered in time", async () => {
    const declined = await signIn.startPluginSignIn("figma");
    await signIn.declinePluginSignIn(declined.code);
    expect(await signIn.pollPluginSignIn(declined.readKey)).toEqual({ status: "declined" });
    expect(await signIn.approvePluginSignIn(store.member, declined.code)).toEqual({ ok: false, problem: "gone" });

    const late = await signIn.startPluginSignIn("figma");
    await db().execute(sql`update commerce.plugin_sign_ins set expires_at = now() - interval '1 second' where code = ${late.code}`);
    expect(await signIn.waitingSignIn(late.code)).toBeNull();
    expect(await signIn.pollPluginSignIn(late.readKey)).toEqual({ status: "gone" });
    expect(await signIn.approvePluginSignIn(store.member, late.code)).toEqual({ ok: false, problem: "gone" });
  });

  it("makes no token for a member who is not the owner", async () => {
    const started = await signIn.startPluginSignIn("figma");
    const staff = { ...store.member, role: "admin" as const, permissions: ["website:write"] };
    expect(await signIn.approvePluginSignIn(staff as typeof store.member, started.code)).toEqual({ ok: false, problem: "owner" });
    expect(await signIn.pollPluginSignIn(started.readKey)).toEqual({ status: "waiting" });
  });
});
