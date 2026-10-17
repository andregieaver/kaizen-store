"use client";

import { useEffect, useRef } from "react";

/**
 * Chooses the theme the theme store's *Start with this theme* sent (`?theme={id}`, `docs/theme-phase-3.md` step 1), or one of its presets
 * (`&preset={key}`, `docs/theme-showcase-phase-1.md` step 4), among the form's theme cards, when it is one of them; the new store then starts
 * as the store the person saw, its demo store following the look (D273). Read in the browser, so the sign-up page stays the same for
 * everyone and is never made per visit; without JavaScript the person chooses it themselves, and the server checks any choice again.
 */
export function ThemeFromAddress({ designName = "design" }: { designName?: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const theme = query.get("theme");
    const preset = query.get("preset");
    const form = marker.current?.closest("form");
    if (!theme || !form) return;
    const designs = [...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${designName}"]`)];
    const input = (preset && designs.find((i) => i.value === `${theme}:${preset}`)) || designs.find((i) => i.value === theme);
    if (input) input.checked = true;
  }, [designName]);
  return <span ref={marker} hidden />;
}
