"use client";

import { useEffect, useRef } from "react";

/**
 * Chooses the theme the theme store's *Start with this theme* sent (`?theme={id}`, `docs/theme-phase-3.md` step 1), or one of its presets
 * (`&preset={key}`, `docs/theme-showcase-phase-1.md` step 4), among the form's design cards, when it is one of them; and, when that look is
 * shown on a content pack whose store template the form offers, chooses that template too, so the new store starts as the store the person
 * saw. Read in the browser, so the sign-up page stays the same for everyone and is never made per visit; without JavaScript the person
 * chooses them themselves, and the server checks any choice again.
 */
export function ThemeFromAddress({ designName = "design", starterName = "starter" }: { designName?: string; starterName?: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const theme = query.get("theme");
    const preset = query.get("preset");
    const form = marker.current?.closest("form");
    if (!theme || !form) return;
    const radios = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)];
    const designs = radios(designName);
    const input = (preset && designs.find((i) => i.value === `${theme}:${preset}`)) || designs.find((i) => i.value === theme);
    if (!input) return;
    input.checked = true;
    const starter = input.dataset.starter;
    const template = starter ? radios(starterName).find((i) => i.value === starter) : undefined;
    if (template) template.checked = true;
  }, [designName, starterName]);
  return <span ref={marker} hidden />;
}
