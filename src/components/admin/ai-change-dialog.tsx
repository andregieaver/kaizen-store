"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { PageContent } from "@/lib/page-content";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { Button } from "./ui";

/** Up to 1,000 characters, as the server takes (`CHANGE_DESCRIPTION_MAX`). */
const DESCRIPTION_MAX = 1000;

type Phase = { name: "idle" } | { name: "running" } | { name: "error"; problem: string };

/**
 * *Change with AI* (D351): the person says what to change on the open page; the site's AI answers with the page changed, unsaved, which the
 * editor holds as one change they can undo. A late answer to a closed dialog is thrown away.
 */
export function AiChangeDialog({
  open,
  onClose,
  endpoint,
  type,
  content,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  type: string;
  content: PageContent;
  onApply: (next: PageContent, done: string[]) => void;
}) {
  const w = useAdminText("builder").aiChange;
  const id = useId();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [description, setDescription] = useState("");
  const ticket = useRef(0);
  useEffect(() => {
    if (!open) ticket.current += 1;
  }, [open]);

  const close = () => {
    ticket.current += 1;
    setPhase({ name: "idle" });
    onClose();
  };

  const go = async () => {
    const mine = ++ticket.current;
    setPhase({ name: "running" });
    let answer: { ok: true; content: string; done: string[] } | { ok: false; problem: string };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, content: JSON.stringify(content), description }),
      });
      answer = (await response.json().catch(() => null)) ?? { ok: false, problem: w.failed };
    } catch {
      answer = { ok: false, problem: w.failed };
    }
    if (mine !== ticket.current) return;
    if (!answer.ok) return setPhase({ name: "error", problem: answer.problem });
    let next: PageContent;
    try {
      next = JSON.parse(answer.content) as PageContent;
    } catch {
      return setPhase({ name: "error", problem: w.failed });
    }
    onApply(next, answer.done);
    setDescription("");
    setPhase({ name: "idle" });
    onClose();
  };

  const running = phase.name === "running";
  return (
    <Modal
      open={open}
      onClose={close}
      title={w.label}
      footer={
        <div className="flex justify-end gap-2">
          <Button kind="quiet" onClick={close}>
            {w.cancel}
          </Button>
          <Button kind="main" disabled={running || description.trim().length < 3} onClick={() => void go()}>
            {running ? w.working : w.go}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-ai-change="" aria-busy={running}>
        <p className="text-sm text-ink-2">{w.text}</p>
        <label htmlFor={`${id}-what`} className="text-sm font-medium">
          {w.what}
        </label>
        <textarea
          id={`${id}-what`}
          rows={4}
          maxLength={DESCRIPTION_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={w.placeholder}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm"
        />
        {running && (
          <p role="status" className="text-sm text-muted">
            {w.working}
          </p>
        )}
        {phase.name === "error" && (
          <p role="alert" className="text-sm text-danger-text">
            {phase.problem}
          </p>
        )}
      </div>
    </Modal>
  );
}
