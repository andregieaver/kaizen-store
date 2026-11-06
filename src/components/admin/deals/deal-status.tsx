"use client";

import { useState, useTransition } from "react";

import { Modal } from "@/components/admin/modal";
import { Button } from "@/components/admin/ui";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { DealStatus } from "@/lib/deals";

import type { PlaceDeal } from "./deal-board";

export type DealStatusWords = { board: Pick<DealsMessages["board"], "moveTo">; lost: DealsMessages["lost"]; deal: Pick<DealsMessages["deal"], "markWon" | "markLost" | "reopen"> };

/**
 * A deal's own page's controls (S2, D464): an open deal is moved to another stage, won, or lost with its reason; a closed one is opened
 * again in its stage. The same action as the board's.
 */
export function DealStatusControls({
  dealId,
  status,
  stageId,
  stages,
  place,
  words,
}: {
  dealId: string;
  status: DealStatus;
  stageId: string;
  stages: { id: string; name: string }[];
  place: PlaceDeal;
  words: DealStatusWords;
}) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState("");
  const go = (target: string, why: string | null = null) =>
    start(async () => {
      const result = await place(dealId, target, why);
      setSaid({ ok: result.ok, text: result.message });
    });

  return (
    <div className="flex flex-col gap-3">
      {status === "open" ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.board.moveTo}
            <select
              value={stageId}
              disabled={pending}
              onChange={(e) => go(e.target.value)}
              className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Button kind="strong" disabled={pending} onClick={() => go("won")}>
            {words.deal.markWon}
          </Button>
          <Button
            kind="danger"
            disabled={pending}
            onClick={() => {
              setReason("");
              setLosing(true);
            }}
          >
            {words.deal.markLost}
          </Button>
        </div>
      ) : (
        <Button kind="secondary" disabled={pending} onClick={() => go(stageId)} className="w-fit">
          {words.deal.reopen}
        </Button>
      )}
      <p role="status" aria-live="polite" className={`text-sm ${said && !said.ok ? "text-danger-text" : "text-muted"}`}>
        {said?.text}
      </p>
      <Modal
        open={losing}
        onClose={() => setLosing(false)}
        title={words.lost.title}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button kind="quiet" onClick={() => setLosing(false)}>
              {words.lost.cancel}
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                setLosing(false);
                go("lost", reason.trim() || null);
              }}
            >
              {words.lost.save}
            </Button>
          </div>
        }
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.lost.reason}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
          <span className="font-normal text-muted">{words.lost.reasonHint}</span>
        </label>
      </Modal>
    </div>
  );
}
