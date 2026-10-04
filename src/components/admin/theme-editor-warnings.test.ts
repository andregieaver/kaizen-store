import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { THEME_TEMPLATES, parseStoreTheme, themeWarnings, type StoreTheme } from "@/lib/theme";

import { ThemeEditor, type ThemeActions } from "./theme-editor";

/**
 * Theme settings that fail AA are flagged in the editor (wave 1, 1e, docs/wave-1-trust.md 6.1, accessibility row criterion 3): the editor lists
 * what `themeWarnings()` says, in words, so an owner sees which pair of colours is hard to read and by how much.
 */

const never = async () => {
  throw new Error("not called while drawing");
};
const actions: ThemeActions = { save: never as never, saveSaved: never as never, removeSaved: never as never, installFont: never as never };
const text = (theme: StoreTheme) =>
  renderToString(createElement(ThemeEditor, { storeName: "Kaffe", current: theme, saved: [], actions, logos: { logo: false, dark: false } }))
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'");

describe("the theme editor's readability list", () => {
  it("lists nothing for a template whose colours reach the contrast the standard asks for", () => {
    const theme = parseStoreTheme({ base: Object.keys(THEME_TEMPLATES)[0] });
    expect(themeWarnings(theme.settings)).toEqual([]);
    expect(text(theme)).not.toContain('aria-label="Readability"');
  });

  it("lists each pair that falls below 4.5 to 1, with the ratio, for the sets the theme shows", () => {
    const base = parseStoreTheme({ base: Object.keys(THEME_TEMPLATES)[0] });
    const weak: StoreTheme = { ...base, settings: { ...base.settings, mode: "light", visitorSwitch: false, light: { ...base.settings.light, text: "#bbbbbb", background: "#ffffff" } } };
    const warnings = themeWarnings(weak.settings);
    expect(warnings.length).toBeGreaterThan(0);
    const out = text(weak);
    expect(out).toContain('aria-label="Readability"');
    for (const warning of warnings) expect(out).toContain(warning);
    expect(out).toContain("hard to read");
    expect(out).toContain("aim for 4.5:1");
  });
});
