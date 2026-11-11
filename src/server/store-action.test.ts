import { notFound } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  member: null as null | { account: { id: string; adminLocale: string | null }; store: { id: string } },
  account: null as null | { id: string; adminLocale: string | null; platformAdmin: boolean },
  logged: [] as { level: string; event: string; fields: Record<string, unknown> }[],
}));

vi.mock("./permissions", () => ({ checkPermission: async () => state.member }));
vi.mock("./auth", () => ({
  getAccount: async () => state.account,
  platformCan: (account: { platformAdmin: boolean } | null) => Boolean(account?.platformAdmin),
}));
vi.mock("./admin-request-lang", () => ({ actionAdminLang: async () => "en" }));
vi.mock("./log", () => ({
  log: (level: string, event: string, fields: Record<string, unknown>) => state.logged.push({ level, event, fields }),
}));

const { platformAction, storeAction } = await import("./store-action");

type Result = { ok: boolean; message: string | null };
const answer = (message: string): Result => ({ ok: false, message });
const options = { store: "shop", key: "orders:write" as const, action: "order.send", answer };

beforeEach(() => {
  state.member = { account: { id: "a", adminLocale: "nb-NO" }, store: { id: "s1" } };
  state.account = { id: "p", adminLocale: null, platformAdmin: true };
  state.logged = [];
});

/** A server action run through the wrapper (code review 1.4, FV9). */
describe("storeAction", () => {
  it("runs the handler for a member with the key, in their language, and returns what it returns", async () => {
    const seen: string[] = [];
    const result = await storeAction(options, async (member, lang) => {
      seen.push(member.store.id, lang);
      return { ok: true, message: "Sent." };
    });
    expect(result).toEqual({ ok: true, message: "Sent." });
    expect(seen).toEqual(["s1", "nb"]);
    expect(state.logged).toEqual([]);
  });

  it("refuses a member without the key in words, never running the handler", async () => {
    state.member = null;
    let ran = false;
    const result = await storeAction(options, async () => {
      ran = true;
      return { ok: true, message: null };
    });
    expect(ran).toBe(false);
    expect(result).toEqual({ ok: false, message: "You do not have access to this." });
  });

  it("turns an unplanned throw into a plain line in the form and one log line, naming the action and the store, never the error's words", async () => {
    const result = await storeAction(options, async () => {
      throw new Error("relation commerce.orders does not exist: secret detail");
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^Det gikk ikke gjennom\./);
    expect(result.message).not.toContain("secret");
    expect(state.logged).toEqual([{ level: "error", event: "action.failed", fields: { action: "order.send", storeId: "s1" } }]);
  });

  it("lets Next's own signals through untouched", async () => {
    await expect(storeAction(options, async () => notFound())).rejects.toThrow();
    expect(state.logged).toEqual([]);
  });
});

describe("platformAction", () => {
  it("runs for someone on the platform's team, refuses anyone else, and answers a throw as storeAction does", async () => {
    const platform = { area: "settings" as const, action: "platform.save", answer };
    expect(await platformAction(platform, async () => ({ ok: true, message: "Saved." }))).toEqual({ ok: true, message: "Saved." });
    const failed = await platformAction(platform, async () => {
      throw new Error("boom");
    });
    expect(failed).toEqual({ ok: false, message: expect.stringMatching(/^That did not go through\./) });
    expect(state.logged).toEqual([{ level: "error", event: "action.failed", fields: { action: "platform.save", platform: true } }]);
    state.account = null;
    expect(await platformAction(platform, async () => ({ ok: true, message: null }))).toEqual({ ok: false, message: "You do not have access to this." });
  });
});
