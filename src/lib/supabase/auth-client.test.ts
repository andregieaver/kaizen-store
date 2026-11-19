import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserClient } from "@supabase/ssr";

import { createAuthClient } from "./auth-client";

/**
 * The admin's session is kept by `auth-client.ts` and read by the server through `createServerClient` (bloat review step 2.31). The two
 * browser clients must agree on the cookie's name and encoding, or the server stops seeing the session a tab refreshed. A stubbed
 * `document.cookie` stands in for the browser.
 */
const URL_ = "https://abcd.supabase.co";
const KEY = "test-publishable-key";

type Storage = { setItem(key: string, value: string): Promise<void>; getItem(key: string): Promise<string | null> };
const storageOf = (client: unknown): Storage => (client as { storage: Storage }).storage;

const jar = new Map<string, string>();
function stubBrowser() {
  const doc = {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(line: string) {
      const [pair, ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1);
      const expired = attributes.some((a) => /^\s*max-age=(0|-)/i.test(a) || /^\s*expires=Thu, 01 Jan 1970/i.test(a));
      if (expired || value === "") jar.delete(name);
      else jar.set(name, value);
    },
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { document: doc, location: { href: "http://localhost/", search: "", hash: "", origin: "http://localhost" } });
}

function session() {
  return {
    access_token: "access",
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "11111111-1111-1111-1111-111111111111", aud: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
  stubBrowser();
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
beforeEach(() => jar.clear());

describe("the auth-only client", () => {
  it("uses the storage key of the full browser client, 'sb-abcd-auth-token'", async () => {
    const full = createBrowserClient(URL_, KEY);
    const mine = createAuthClient();
    expect((mine as unknown as { storageKey: string }).storageKey).toBe("sb-abcd-auth-token");
    expect((mine as unknown as { storageKey: string }).storageKey).toBe((full.auth as unknown as { storageKey: string }).storageKey);
  });

  it("reads the session the full client wrote, and the full client reads the one it wrote", async () => {
    const full = createBrowserClient(URL_, KEY);
    const mine = createAuthClient();
    await storageOf(full.auth).setItem("sb-abcd-auth-token", JSON.stringify(session()));
    expect(jar.size).toBeGreaterThan(0);
    expect((await mine.getSession()).data.session?.user.email).toBe("owner@example.com");

    jar.clear();
    await storageOf(mine).setItem("sb-abcd-auth-token", JSON.stringify({ ...session(), refresh_token: "other" }));
    expect((await full.auth.getSession()).data.session?.refresh_token).toBe("other");
  });

  it("is one per tab", () => {
    expect(createAuthClient()).toBe(createAuthClient());
  });

  it("is told to be re-read when the libraries it mirrors change", () => {
    const version = (name: string) => JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version as string;
    expect(
      [version("@supabase/ssr"), version("@supabase/supabase-js")],
      "re-read createBrowserClient.js and supabase-js's _initSupabaseAuthClient, and update auth-client.ts",
    ).toEqual(["0.12.7", "2.118.0"]);
  });

  it("reads the public settings, never the zod-built environment", () => {
    const text = readFileSync("src/lib/supabase/auth-client.ts", "utf8");
    expect(text).not.toContain('@/lib/env"');
    expect(text).toContain('@/lib/public-env"');
  });
});
