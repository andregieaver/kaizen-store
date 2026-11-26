"use client";

import { useEffect, useState, type ComponentType } from "react";

/**
 * Guide in each level's frame (D909, `src/lib/guide.ts`): all a screen's first scripts carry of it. Once the screen is drawn it loads Guide's
 * runtime (`guide-runtime.tsx`, a chunk of its own), which reads the record, places and words from Guide's route and draws into the slots the
 * server sent (`guide-slots.tsx`); the spotlight, beacons and panel are a further chunk, loaded only when one is shown. The runtime is loaded
 * by `import()` in an effect, never `lazy()` under a `<Suspense>`: a boundary in the layout kept the router from finishing some moves
 * (`e2e/signed-in/ab-behaviour.spec.ts`, 26 November 2026).
 */
type Props = { level: string };

/** One prop, so a screen's document carries as little of Guide as can be (`admin-scripts.spec.ts`, what a screen is handed). */
export function GuideProvider({
  level,
}: {
  /** The store's address name, or `platform`. */
  level: string;
}) {
  const [Runtime, setRuntime] = useState<ComponentType<Props> | null>(null);
  useEffect(() => {
    let live = true;
    import("./guide-runtime").then(
      (module) => {
        if (live) setRuntime(() => module.default);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return Runtime ? <Runtime level={level} /> : null;
}
