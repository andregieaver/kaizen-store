"use client";

import { useEffect, useState } from "react";

/**
 * What a picker's search found for what is typed: asked a moment after the typing stops, from two characters, and null while fewer are
 * typed whatever the last answer was. An answer that arrives after the words changed again is dropped.
 */
export function useFound<T>(query: string, search: (query: string) => Promise<T[]>, wait = 250): [T[] | null, () => void] {
  const [found, setFound] = useState<T[] | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const answer = await search(query);
      if (live) setFound(answer);
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search, wait]);
  return [query.trim().length < 2 ? null : found, () => setFound(null)];
}
