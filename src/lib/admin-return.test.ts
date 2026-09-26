import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminReturnPath,
  forgetAdminPages,
  handedOffPath,
  handoffHash,
  hasSessionCookie,
  isAdminPath,
  rememberAdminPage,
  takeHandoff,
} from "./admin-return";

const signedIn = "theme=dark; sb-abcd-auth-token.0=base64-xyz";

function fakeStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the way back to the admin", () => {
  it("accepts only the store's own admin pages", () => {
    expect(isAdminPath("kopp", "/admin/kopp")).toBe(true);
    expect(isAdminPath("kopp", "/admin/kopp/products/1?tab=text")).toBe(true);
    expect(isAdminPath("kopp", "/admin/koppen/products")).toBe(false);
    expect(isAdminPath("kopp", "/admin/other")).toBe(false);
    expect(isAdminPath("kopp", "//evil.test/admin/kopp")).toBe(false);
    expect(isAdminPath("kopp", "/admin/kopp//evil.test")).toBe(false);
  });

  it("recognises Supabase's session cookie, also when split", () => {
    expect(hasSessionCookie(signedIn)).toBe(true);
    expect(hasSessionCookie("sb-abcd-auth-token=x")).toBe(true);
    expect(hasSessionCookie("theme=dark")).toBe(false);
  });

  it("remembers the last page per store while signed in, and forgets at sign-out", () => {
    fakeStorage();
    rememberAdminPage("kopp", "/admin/kopp/orders");
    rememberAdminPage("kopp", "/admin/kopp/products");
    rememberAdminPage("lampe", "/admin/lampe");
    rememberAdminPage("kopp", "/admin/lampe/staff"); // Not this store's: ignored.
    expect(adminReturnPath("kopp", signedIn)).toBe("/admin/kopp/products");
    expect(adminReturnPath("lampe", signedIn)).toBe("/admin/lampe");
    expect(adminReturnPath("kopp", "theme=dark")).toBeNull();
    forgetAdminPages();
    expect(adminReturnPath("kopp", signedIn)).toBeNull();
  });

  it("offers nothing when storage is missing or holds junk", () => {
    expect(adminReturnPath("kopp", signedIn)).toBeNull();
    fakeStorage();
    localStorage.setItem("kaizen-admin-return", '{"kopp":"https://evil.test"}');
    expect(adminReturnPath("kopp", signedIn)).toBeNull();
  });
});

describe("the way back from a store on its own domain (P7)", () => {
  it("keeps the store's own admin page the admin hands over, for 12 hours", () => {
    fakeStorage();
    const now = Date.UTC(2026, 8, 26, 12);
    expect(takeHandoff("kopp", "#main", now)).toBe(false);
    expect(takeHandoff("kopp", handoffHash("/admin/kopp/products?status=draft"), now)).toBe(true);
    expect(handedOffPath("kopp", now + 3600_000)).toBe("/admin/kopp/products?status=draft");
    expect(handedOffPath("kopp", now + 13 * 3600_000)).toBeNull();
    expect(handedOffPath("lampe", now)).toBeNull();

    // Another store's admin, another site or junk: taken out of the address, never kept.
    expect(takeHandoff("lampe", handoffHash("/admin/kopp"), now)).toBe(true);
    expect(takeHandoff("lampe", handoffHash("https://evil.test/admin/lampe"), now)).toBe(true);
    expect(takeHandoff("lampe", "#kaizen-admin=%E0%A4%A", now)).toBe(true);
    expect(handedOffPath("lampe", now)).toBeNull();
  });
});

