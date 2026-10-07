"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the design profile choice (D176) in step with the store template chosen in the same form: choosing a template chooses the profile
 * it recommends (or the template's own look when it recommends none), and each profile's Preview shows it on that template. Only a
 * default: the person may choose any other profile after. Without JavaScript nothing changes, and the server checks the choice anyway.
 */
export function DesignChoiceSync({
  recommended,
  starterName = "starter",
  designName = "design",
}: {
  /** A store template's id to the profile it recommends. */
  recommended: Record<string, string>;
  starterName?: string;
  designName?: string;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) return;
    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.name !== starterName || !target.checked) return;
      const starter = target.value;
      const wanted = recommended[starter] ?? "";
      for (const input of form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${designName}"]`)) {
        input.checked = input.value === wanted;
      }
      for (const link of form.querySelectorAll<HTMLAnchorElement>("a[data-design-preview]")) {
        const url = new URL(link.href, window.location.origin);
        if (starter) url.searchParams.set("starter", starter);
        else url.searchParams.delete("starter");
        link.href = `${url.pathname}${url.search}`;
      }
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, [recommended, starterName, designName]);
  return <span ref={marker} hidden />;
}
