import { FX_NOSCRIPT_CSS, type MotionNeeds } from "@/lib/motion-attrs";

import { MotionRuntime } from "./motion-runtime";

/**
 * What a page with motion (D128) adds to what it draws: a `<noscript>` style that shows every part still waiting for a
 * waypoint (no scripts, no waypoints), and the runtime when something needs it (`motionNeeds()`), so pages without
 * motion carry and load neither.
 */
export function MotionSupport({ needs }: { needs: MotionNeeds }) {
  return (
    <>
      {needs.view && (
        <noscript>
          <style dangerouslySetInnerHTML={{ __html: FX_NOSCRIPT_CSS }} />
        </noscript>
      )}
      {needs.js && <MotionRuntime />}
    </>
  );
}
