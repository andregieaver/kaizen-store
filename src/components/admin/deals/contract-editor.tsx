"use client";

import { Columns2, Rows2 } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";

import { AdminLink } from "@/components/admin/ui/link";
import { Button } from "@/components/admin/ui/button";
import { Card } from "@/components/admin/ui/card";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { fillContract, type ContractBlock, type ContractFacts, type ContractSnapshot } from "@/lib/contract-fields";

import { BlocksEditor } from "./blocks-editor";
import { ContractPaper, ContractReadiness } from "./contract-preview";

/**
 * A contract's draft (D695): its title, its words as blocks (`BlocksEditor`, rich text, D856), and who signs, and under them how it will
 * look (D857). Homer changes the words in place and sees the contract change while typing, then presses Save and Send. Lisa adds, moves and
 * removes blocks, leaves out an optional clause, and names the signers. The preview is filled in the browser (`fillContract()`) from the
 * facts the server gathered for the deal (`draftFacts()`); sending fills it again on the server from what was saved, so Send is offered only
 * with nothing left unsaved.
 *
 * The words and the preview sit side by side on a wide screen, the preview kept in view while the words scroll (D862); one press stacks
 * them, and the choice is this browser's own. *Save as template* keeps the words as they are on the screen as a new template, named as
 * the draft until changed; the draft itself is not changed.
 */

type Layout = "inline" | "stacked";
const LAYOUT_KEY = "kz-contract-layout";
const layoutListeners = new Set<() => void>();
const readLayout = (): Layout => {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "stacked" ? "stacked" : "inline";
  } catch {
    return "inline";
  }
};
const subscribeLayout = (listener: () => void) => {
  layoutListeners.add(listener);
  return () => {
    layoutListeners.delete(listener);
  };
};
const keepLayout = (layout: Layout) => {
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // A browser that keeps nothing shows them side by side each time.
  }
  for (const listener of layoutListeners) listener();
};

type Words = DealsMessages["contracts"];
export type EditorSigner = { role: "store" | "customer" | "other"; name: string; email: string; accountId: string | null };
type Member = { id: string; name: string; email: string };

const inputClass = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

type Facts = ContractFacts & { parties: ContractSnapshot["parties"] };

export function ContractEditor({
  initial,
  team,
  words: w,
  save,
  language,
  facts,
  previewCss,
  send,
  saveAsTemplate,
}: {
  initial: { title: string; blocks: ContractBlock[]; signers: EditorSigner[] };
  team: Member[];
  words: Words;
  save: (input: { title: string; blocks: ContractBlock[]; signers: EditorSigner[] }) => Promise<{ ok: boolean; messages: string[] }>;
  /** The contract's language, for the preview's own words. */
  language: string;
  /** What the words are filled in from, gathered by the server for this deal now. */
  facts: Facts;
  /** The contract's styles without the printed page's margins. */
  previewCss: string;
  /** Sending, drawn by the page: offered when the saved draft is ready; `hint` names who signs first. */
  send: { form: ReactNode; hint: string } | null;
  /** A new template from the words on the screen; `href` opens it. */
  saveAsTemplate: (input: { name: string; blocks: ContractBlock[] }) => Promise<{ ok: boolean; messages: string[]; href?: string }>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [blocks, setBlocks] = useState<ContractBlock[]>(initial.blocks);
  const [signers, setSigners] = useState<EditorSigner[]>(initial.signers);
  const [answer, setAnswer] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [pending, start] = useTransition();
  const layout = useSyncExternalStore(subscribeLayout, readLayout, (): Layout => "inline");
  const [naming, setNaming] = useState<string | null>(null);
  const [made, setMade] = useState<{ ok: boolean; messages: string[]; href?: string } | null>(null);
  const onSaveAsTemplate = () =>
    start(async () => {
      const result = await saveAsTemplate({ name: (naming ?? "").trim() || title, blocks });
      setMade(result);
      if (result.ok) setNaming(null);
    });

  const storeSigner = signers.find((s) => s.role === "store");
  const setSigner = (index: number, patch: Partial<EditorSigner>) => setSigners((all) => all.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const chooseStoreSigner = (accountId: string) => {
    const member = team.find((m) => m.id === accountId);
    if (!member) return;
    const next = { role: "store" as const, name: member.name, email: member.email, accountId: member.id };
    setSigners((all) => (all.some((s) => s.role === "store") ? all.map((s) => (s.role === "store" ? next : s)) : [next, ...all]));
  };

  // The store signs first: its signer is kept first, the customer's side after it in the order shown.
  const ordered = useMemo(() => [...signers.filter((s) => s.role === "store"), ...signers.filter((s) => s.role !== "store")], [signers]);
  const current = JSON.stringify({ title, blocks, signers: ordered });
  const [saved, setSaved] = useState(() =>
    JSON.stringify({
      title: initial.title,
      blocks: initial.blocks,
      signers: [...initial.signers.filter((s) => s.role === "store"), ...initial.signers.filter((s) => s.role !== "store")],
    }),
  );
  const unsaved = current !== saved;

  const onSave = () =>
    start(async () => {
      const result = await save({ title, blocks, signers: ordered });
      setAnswer(result);
      if (result.ok) setSaved(current);
    });

  // The contract as it would go out with the words as they are now: the server's values, with the title as typed.
  const preview = useMemo(
    () =>
      fillContract(
        { title, language, blocks, parties: facts.parties, signers: ordered.map((s) => ({ role: s.role, name: s.name })) },
        { values: { ...facts.values, "contract.title": title }, quote: facts.quote },
      ),
    [title, language, blocks, facts, ordered],
  );

  const layoutOption = (value: Layout, Icon: typeof Rows2, label: string) => (
    <button
      type="button"
      aria-pressed={layout === value}
      onClick={() => keepLayout(value)}
      className="flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-sm text-ink-2 hover:text-ink aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
    >
      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Side by side needs a wide screen: below it the two are stacked and there is nothing to choose. */}
      <div role="group" aria-label={w.layout} className="hidden items-center gap-0.5 self-end rounded-pill border border-edge p-0.5 xl:flex">
        {layoutOption("inline", Columns2, w.layoutInline)}
        {layoutOption("stacked", Rows2, w.layoutStacked)}
      </div>
      <div data-layout={layout} className={layout === "inline" ? "grid items-start gap-6 xl:grid-cols-2" : "flex flex-col gap-6"}>
        <Card title={w.words} compact>
          <div className="flex flex-col gap-6">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.titleLabel}
              <input className={inputClass} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </label>

            <BlocksEditor blocks={blocks} setBlocks={setBlocks} words={w} />

            <section className="flex flex-col gap-3" aria-label={w.signers}>
              <div>
                <h3 className="text-body-strong text-ink">{w.signers}</h3>
                <p className="text-sm text-muted">{w.signersHint}</p>
              </div>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.roles.store}
                <select className={inputClass} value={storeSigner?.accountId ?? ""} onChange={(e) => chooseStoreSigner(e.target.value)}>
                  {!storeSigner && <option value="">—</option>}
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name === m.email ? m.email : `${m.name} (${m.email})`}
                    </option>
                  ))}
                </select>
              </label>
              {signers.map((signer, index) =>
                signer.role === "store" ? null : (
                  <fieldset key={index} className="flex flex-col gap-2 rounded-panel border border-line p-3">
                    <legend className="px-1 text-sm font-medium">{w.roles[signer.role]}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm">
                        {w.name}
                        <input
                          className={inputClass}
                          value={signer.name}
                          maxLength={200}
                          autoComplete="off"
                          onChange={(e) => setSigner(index, { name: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        {w.email}
                        <input
                          className={inputClass}
                          type="email"
                          value={signer.email}
                          autoComplete="off"
                          onChange={(e) => setSigner(index, { email: e.target.value })}
                        />
                      </label>
                    </div>
                    {signer.role === "other" && (
                      <div>
                        <Button kind="quiet" size="dense" onClick={() => setSigners((all) => all.filter((_, i) => i !== index))}>
                          {w.remove}
                        </Button>
                      </div>
                    )}
                  </fieldset>
                ),
              )}
              <div>
                <Button
                  onClick={() =>
                    setSigners((all) => [
                      ...all,
                      { role: all.some((s) => s.role === "customer") ? "other" : "customer", name: "", email: "", accountId: null },
                    ])
                  }
                >
                  {w.addSigner}
                </Button>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button kind="main" onClick={onSave} disabled={pending}>
                {w.save}
              </Button>
              {naming === null && (
                <Button
                  onClick={() => {
                    setMade(null);
                    setNaming(title);
                  }}
                  disabled={pending}
                >
                  {w.asTemplate}
                </Button>
              )}
              <p role="status" aria-live="polite" className={answer && !answer.ok ? "text-sm text-danger" : "text-sm text-muted"}>
                {unsaved ? null : answer?.messages.join(" ")}
              </p>
            </div>

            {naming !== null && (
              <section aria-label={w.asTemplate} className="flex flex-col gap-2 rounded-panel border border-line p-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.asTemplateName}
                  <input className={inputClass} value={naming} maxLength={80} onChange={(e) => setNaming(e.target.value)} />
                </label>
                <p className="text-sm text-muted">{w.asTemplateHint}</p>
                <div className="flex flex-wrap gap-2">
                  <Button kind="main" onClick={onSaveAsTemplate} disabled={pending}>
                    {w.asTemplateSave}
                  </Button>
                  <Button kind="quiet" onClick={() => setNaming(null)} disabled={pending}>
                    {w.asTemplateCancel}
                  </Button>
                </div>
              </section>
            )}
            {made && (
              <p role="status" aria-live="polite" className={made.ok ? "text-sm text-muted" : "text-sm text-danger"}>
                {made.messages.join(" ")} {made.ok && made.href && <AdminLink href={made.href}>{w.asTemplateOpen}</AdminLink>}
              </p>
            )}
          </div>
        </Card>

        {/* Side by side, the preview stays in view and scrolls on its own. */}
        <div className={layout === "inline" ? "xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto" : undefined}>
          <Card title={w.preview} compact>
            <ContractReadiness ok={preview.ok} problems={preview.ok ? [] : preview.problems} words={w} live />
            {send && (
              <div className="mb-4 flex flex-col gap-2">
                <p className="text-sm text-muted">{!preview.ok ? w.sendBlocked : unsaved ? w.saveFirst : send.hint}</p>
                {preview.ok && !unsaved && send.form}
              </div>
            )}
            <ContractPaper snapshot={preview.snapshot} css={previewCss} />
          </Card>
        </div>
      </div>
    </div>
  );
}
