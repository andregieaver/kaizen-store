import { afterEach, describe, expect, it, vi } from "vitest";

import { adminReturnPath, forgetAdminPages, hasSessionCookie, isAdminPath, rememberAdminPage } from "./admin-return";

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
