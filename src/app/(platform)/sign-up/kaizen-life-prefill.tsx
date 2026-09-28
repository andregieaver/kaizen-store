"use client";

import { useEffect, useState } from "react";

/**
 * Someone who signed in with Kaizen Life (D95) but has no store yet lands
 * here with what Kaizen Life knows in the address: it fills in the form
 * (the page itself stays the same for everyone) and says why they are
 * here. The request goes to the same queue as any other.
 */
export function KaizenLifePrefill() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("via") !== "kaizen-life") return;
    const form = document.getElementById("sign-up-form") as HTMLFormElement | null;
    const fill = (name: string, value: string | null) => {
      const input = form?.elements.namedItem(name);
      if (input instanceof HTMLInputElement && value && !input.value) input.value = value.slice(0, 200);
    };
    fill("email", params.get("email"));
    fill("name", params.get("name"));
    const frame = requestAnimationFrame(() => setEmail(params.get("email") ?? ""));
    return () => cancelAnimationFrame(frame);
  }, []);
  if (email === null) return null;
  return (
    <p role="status" className="rounded-md border border-border p-3 text-sm">
      No Kaizen Store account uses {email || "that email address"} yet. Ask for a store below. If you already have a store under another
      email, sign in with that and connect Kaizen Life under Your account.
    </p>
  );
}
