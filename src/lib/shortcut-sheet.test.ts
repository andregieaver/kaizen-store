import { describe, expect, it } from "vitest";

import { SHORTCUTS, keyLabel, opensShortcutSheet } from "./shortcut-sheet";

describe("the admin's shortcut list (PSI UX-07)", () => {
  const press = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra });

  it("opens on ? alone, never while typing or with Ctrl, Cmd or Alt", () => {
    expect(opensShortcutSheet(press("?"), false)).toBe(true);
    expect(opensShortcutSheet(press("?"), true)).toBe(false);
    expect(opensShortcutSheet(press("?", { metaKey: true }), false)).toBe(false);
    expect(opensShortcutSheet(press("/"), false)).toBe(false);
  });

  it("shows Cmd on a Mac and Ctrl elsewhere, and names every action once", () => {
    expect(keyLabel("mod", true)).toBe("⌘");
    expect(keyLabel("mod", false)).toBe("Ctrl");
    expect(keyLabel("K", true)).toBe("K");
    const actions = SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
