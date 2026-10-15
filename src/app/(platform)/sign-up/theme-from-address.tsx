"use client";

import { useEffect, useRef } from "react";

/**
 * Chooses the theme the theme store's *Start with this theme* sent (`?theme={id}`, `docs/theme-phase-3.md` step 1) among the form's
 * design cards, when it is one of them. Read in the browser, so the sign-up page stays the same for everyone and is never made per visit;
 * without JavaScript the person chooses it themselves, and the server checks any choice again.
 */
export function ThemeFromAddress({ designName = "design" }: { designName?: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("theme");
    const form = marker.current?.closest("form");
    if (!wanted || !form) return;
    const input = [...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${designName}"]`)].find((i) => i.value === wanted);
    if (input) input.checked = true;
  }, [designName]);
  return <span ref={marker} hidden />;
}
