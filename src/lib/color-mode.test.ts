import { describe, expect, it } from "vitest";

import { ADMIN_COLOR_KEY, colorModeScript, isColorChoice, storeColorKey } from "./color-mode";

describe("light or dark (D99)", () => {
  it("knows the choices, and keeps a store's apart from others", () => {
    expect(["system", "light", "dark"].every(isColorChoice)).toBe(true);
    expect(isColorChoice("sepia")).toBe(false);
    expect(isColorChoice("toString")).toBe(false);
    expect(storeColorKey("3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c")).toBe("color_mode_3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c");
  });

  it("sets only a saved light or dark on <html>, and survives blocked storage", () => {
    const attributes: Record<string, string> = {};
    const run = (stored: string | null, throws = false) => {
      const localStorage = { getItem: () => { if (throws) throw new Error("blocked"); return stored; } };
      const document = { documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) } };
      new Function("localStorage", "document", colorModeScript(ADMIN_COLOR_KEY))(localStorage, document);
    };
    run("sepia");
    expect(attributes).toEqual({});
    run(null, true);
    expect(attributes).toEqual({});
    run("dark");
    expect(attributes).toEqual({ "data-color-mode": "dark" });
  });
});
