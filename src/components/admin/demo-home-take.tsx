"use client";

import { useActionState } from "react";

import { idle, type FormState } from "./action-form";
import { Button, ButtonLink } from "./ui";
import { fillWords } from "@/lib/admin-fill";
import { useAdminText } from "./admin-text";

export type DemoHomeTake = { id: string; name: string; pageId: string | null; previousTitle: string | null; copyIsFront: boolean };

/**
 * The home page a store took from a demo store and *Put back your front page* (`docs/theme-showcase-phase-1.md` step 4c). Always drawn, so
 * after the press (the page drawn again has no take and passes `take` null) it stays to say what was put back and what stayed.
 */
export function DemoHomeTakeLine({
  take,
  editBase,
  undo,
}: {
  take: DemoHomeTake | null;
  editBase: string;
  undo: (state: FormState, data: FormData) => Promise<FormState>;
}) {
  const w = useAdminText("website").demoHomes;
  const [state, formAction, pending] = useActionState(undo, idle);
  if (state.status === "ok") {
    return (
      <p role="status" className="mb-4 rounded-panel bg-sunken p-4 text-body">
        {state.messages.join(" ")}
      </p>
    );
  }
  if (!take) return null;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-panel bg-sunken p-4 text-body">
      <p>
        {fillWords(take.copyIsFront ? w.opensWith : w.took, { name: take.name })}{" "}
        {take.previousTitle ? fillWords(w.before, { title: take.previousTitle }) : w.beforeProducts}
      </p>
      <form action={formAction} aria-busy={pending} className="flex flex-wrap items-center gap-3">
        {take.pageId && (
          <ButtonLink href={`${editBase}/${take.pageId}`} kind="strong">
            {w.ownWords}
          </ButtonLink>
        )}
        <input type="hidden" name="take" value={take.id} />
        <Button type="submit" disabled={pending}>
          {w.putBack}
        </Button>
      </form>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger-text">
          {state.messages.join(" ")}
        </p>
      )}
    </div>
  );
}
