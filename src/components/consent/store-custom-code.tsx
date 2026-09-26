"use client";

import { useEffect } from "react";

import { addCustomCode, type CustomCode } from "@/lib/custom-code";

/**
 * Adds the store's own code marked necessary (D61) as the page starts. Code
 * in an optional category waits for the shopper's consent in
 * `ConsentManager`.
 */
export function StoreCustomCode({ code }: { code: CustomCode }) {
  useEffect(() => addCustomCode(code, null), [code]);
  return null;
}
