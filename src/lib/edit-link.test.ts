import { afterEach, describe, expect, it, vi } from "vitest";

import { EDIT_MINUTES, editPassActive, forgetEditPass, grantUrl, rememberEditPass } from "./edit-link";

/** The note the browser keeps of the pass for a store's own domain (D193), and the address the button starts at. */

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
  return items;
}

afterEach(() => vi.unstubAllGlobals());

describe("the note of a pass", () => {
  const NOW = 1_800_000_000_000;

  it("holds for the pass's time, per store, and no longer", () => {
    fakeStorage();
    expect(editPassActive("kopp", NOW)).toBe(false);
    rememberEditPass("kopp", NOW);
    expect(editPassActive("kopp", NOW + EDIT_MINUTES * 60_000 - 1)).toBe(true);
    expect(editPassActive("kopp", NOW + EDIT_MINUTES * 60_000)).toBe(false);
    expect(editPassActive("annen", NOW)).toBe(false);
  });

  it("is forgotten on its own without touching another store's", () => {
    fakeStorage();
    rememberEditPass("kopp", NOW);
    rememberEditPass("annen", NOW);
    forgetEditPass("kopp");
    expect(editPassActive("kopp", NOW + 1)).toBe(false);
    expect(editPassActive("annen", NOW + 1)).toBe(true);
  });

  it("stands up to storage that holds junk or is unavailable", () => {
    fakeStorage({ "kaizen-edit": "not json" });
    expect(editPassActive("kopp", NOW)).toBe(false);
    fakeStorage({ "kaizen-edit": JSON.stringify({ kopp: "tomorrow", annen: null }) });
    expect(editPassActive("kopp", NOW)).toBe(false);
    expect(editPassActive("annen", NOW)).toBe(false);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(editPassActive("kopp", NOW)).toBe(false);
    expect(() => rememberEditPass("kopp", NOW)).not.toThrow();
    expect(() => forgetEditPass("kopp")).not.toThrow();
  });
});

describe("where the button starts", () => {
  it("is the admin's route, with the store and the page to come back to, both encoded", () => {
    expect(grantUrl("https://kaizenstore.cloud", "kopp", "/no/om oss?a=1&b=2")).toBe(
      "https://kaizenstore.cloud/api/platform/editor/grant?store=kopp&to=%2Fno%2Fom%20oss%3Fa%3D1%26b%3D2",
    );
  });
});
