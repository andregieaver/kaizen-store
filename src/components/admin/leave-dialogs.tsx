"use client";

import { useEffect } from "react";

import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";

import { useAdminLang, useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { Button } from "./ui/button";

/**
 * What the leave guard asks and what a kept draft offers (code review 1.16, D787), loaded only once there is something to ask or offer
 * (`leave-guard.tsx`), so no editor's first scripts carry them.
 */

/** Asks before leaving with changes not saved: Keep editing (where focus starts, and what Escape and the backdrop do) or Leave without saving. */
export function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const w = useAdminText("common").unsaved;
  // The dialog opens in its layout effect; focus then moves from its title bar to the safe choice.
  useEffect(() => document.querySelector<HTMLButtonElement>("[data-leave-stay]")?.focus(), []);
  return (
    <Modal
      open
      onClose={onStay}
      title={w.title}
      footer={
        <>
          <Button kind="danger" onClick={onLeave} data-leave-confirm="">
            {w.leave}
          </Button>
          <Button kind="main" onClick={onStay} data-leave-stay="">
            {w.stay}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">{w.text}</p>
    </Modal>
  );
}

/** Offers the changes kept in this browser when the editor opens: Restore unsaved changes, the one main action, or Discard. */
export function RestoreBar({ at, onRestore, onDiscard }: { at: number; onRestore: () => void; onDiscard: () => void }) {
  const w = useAdminText("common").unsaved;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const when = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-card p-3 text-sm" data-draft-offer="">
      <p className="min-w-0 flex-1">{fillWords(w.kept, { when })}</p>
      <Button kind="main" onClick={onRestore}>
        {w.restore}
      </Button>
      <Button kind="quiet" onClick={onDiscard}>
        {w.discard}
      </Button>
    </div>
  );
}
