"use client";

import type { ReactNode } from "react";

import { PhoneRow } from "@/components/admin/phone-row";

/**
 * Round 52 (D788): the share form's optional fields and its author as one row on a phone. The author is required; a field the browser
 * flags inside the closed row opens it (the row follows its anchor), so nothing needed stays hidden.
 */
export function ShareMore({ title, sub, change, done, children }: { title: string; sub: string; change: string; done: string; children: ReactNode }) {
  return (
    <div
      onInvalidCapture={() => {
        if (window.location.hash !== "#share-more") window.location.hash = "share-more";
      }}
    >
      <PhoneRow id="share-more" inset title={title} sub={sub} change={change} done={done}>
        <div className="flex flex-col gap-4">{children}</div>
      </PhoneRow>
    </div>
  );
}
