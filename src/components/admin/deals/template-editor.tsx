"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/admin/ui";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { ContractBlock } from "@/lib/contract-fields";

import { BlocksEditor } from "./blocks-editor";

/**
 * A contract template (D695 step 2): its name, the contract's language, its words (`BlocksEditor`, as a draft's), how many days a contract
 * made from it may be signed, and the days between reminders. Kept by one action; its version rises when its words change.
 */

type Contracts = DealsMessages["contracts"];
type Templates = DealsMessages["templates"];
type Input = { name: string; language: string; blocks: ContractBlock[]; expiresDays: string; reminderDays: string };

const inputClass = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

export function TemplateEditor({
  initial,
  words: w,
  contractWords,
  save,
}: {
  initial: Input;
  words: Templates;
  contractWords: Contracts;
  save: (input: Input) => Promise<{ ok: boolean; messages: string[] }>;
}) {
  const [name, setName] = useState(initial.name);
  const [language, setLanguage] = useState(initial.language);
  const [blocks, setBlocks] = useState<ContractBlock[]>(initial.blocks);
  const [expiresDays, setExpiresDays] = useState(initial.expiresDays);
  const [reminderDays, setReminderDays] = useState(initial.reminderDays);
  const [answer, setAnswer] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.name}
          <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.language}
          <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="nb">{w.languages.nb}</option>
            <option value="en">{w.languages.en}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.expiresDays}
          <input className={inputClass} type="number" min={1} max={365} value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.reminderDays}
          <input className={inputClass} type="number" min={1} max={60} value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} aria-describedby="reminder-hint" />
          <span id="reminder-hint" className="text-xs font-normal text-muted">
            {w.reminderHint}
          </span>
        </label>
      </div>

      <BlocksEditor blocks={blocks} setBlocks={setBlocks} words={contractWords} />

      <div className="flex flex-wrap items-center gap-3">
        <Button kind="main" disabled={pending} onClick={() => start(async () => setAnswer(await save({ name, language, blocks, expiresDays, reminderDays })))}>
          {w.save}
        </Button>
        <p role="status" aria-live="polite" className={answer && !answer.ok ? "text-sm text-danger" : "text-sm text-muted"}>
          {answer?.messages.join(" ")}
        </p>
      </div>
    </div>
  );
}
