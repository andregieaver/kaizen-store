import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { FeatureOffNote } from "@/components/admin/feature-off";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { FoldRow } from "@/components/admin/fold-row";
import { CARD_CLASS } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { languageNames } from "@/lib/legal-admin-words";
import { legalEn, type LegalMessages } from "@/lib/admin-messages/legal.en";
import { TERMS_MODES, termsSettingNotice, type TermsMode } from "@/lib/checkout-terms";
import { isLegalRole } from "@/lib/legal-roles";
import type { LegalOverview } from "@/server/legal-starters";
import type { LegalWriteState } from "@/server/legal-writer";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
/** An action bound to a kind of page or role first. */
type KindAction = (kind: string, ...rest: Parameters<Action>) => ReturnType<Action>;

/** Whether the AI can write the store's legal pages (D311, unit L2), why not, and its newest write of each kind. */
export type LegalAiState = {
  available: boolean;
  reason: "country" | "ai" | "sources" | null;
  writes: Record<string, LegalWriteState>;
  /** The owner's choice (D311, unit L3); off unless turned on. */
  settings: { enabled: boolean; publish: "auto" | "ask"; turnedOnAt: string | null; stoppedRoles: string[] };
};

const field = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

/** A detail `missingFacts()` names, in the admin's words: its English is matched to the catalogue's key, and one not known is shown as written. */
function missingWord(text: string, words: LegalMessages): string {
  const key = (Object.keys(legalEn.pages.missing) as (keyof LegalMessages["pages"]["missing"])[]).find((k) => legalEn.pages.missing[k] === text);
  return key ? words.pages.missing[key] : text;
}

/** What `termsSettingNotice()` says, in the admin's words. */
function noticeWord(text: string | null, words: LegalMessages): string | null {
  if (text === null) return null;
  if (text === legalEn.terms.noTerms) return words.terms.noTerms;
  if (text === legalEn.terms.noTickTerms) return words.terms.noTickTerms;
  return text;
}

/**
 * The legal pages (wave 1, 1e, docs/wave-1-trust.md 2.1, 2.4): for each kind, the published page chosen for it and a starter draft to begin from;
 * what checkout says about the terms. A starter is only ever a draft: it never overwrites a page, is not in the sitemap until published, and
 * regenerating makes another draft. One page holds one role, so the terms and the privacy statement are two pages.
 */
export function LegalPagesPanel({
  overview,
  ai,
  storeSlug,
  actions,
  words = legalEn,
  lang = "en",
}: {
  overview: LegalOverview;
  ai?: LegalAiState;
  storeSlug: string;
  actions: {
    createStarter: KindAction;
    setRole: KindAction;
    setTerms: Action;
    /** Makes every starter still missing in one press (round 15). */
    createAll?: Action;
    writeWithAi?: KindAction;
    turnOn?: Action;
    turnOff?: Action;
    setPublish?: Action;
    stop?: KindAction;
    handBack?: KindAction;
  };
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: LegalMessages;
  lang?: AdminLang;
}) {
  const w = words.pages;
  const a = words.ai;
  const writing = ai ? Object.values(ai.writes).some((write) => write.status === "queued" || write.status === "running") : false;
  const on = Boolean(ai?.settings.enabled);
  const t = words.terms;
  const roleName = (role: string, fallback: string) => (isLegalRole(role) ? w.roles[role].name : fallback);
  const base = `/admin/${storeSlug}`;
  const termsPage = overview.roles.find((r) => r.role === "terms")?.page;
  const privacyPage = overview.roles.find((r) => r.role === "privacy")?.page;
  const shown = [termsPage && { role: "terms" as const, title: termsPage.title, href: "#" }, privacyPage && { role: "privacy" as const, title: privacyPage.title, href: "#" }].filter(
    (p): p is { role: "terms" | "privacy"; title: string; href: string } => Boolean(p),
  );
  const notice = noticeWord(termsSettingNotice(overview.termsAtCheckout as TermsMode, shown), words);

  const r = w.round;
  const toMake = overview.roles.filter((entry) => entry.starter && entry.needed && !entry.page && !entry.draft);
  const aiSub = !ai
    ? ""
    : on
      ? [ai.settings.turnedOnAt && fillWords(a.on.since, { date: new Intl.DateTimeFormat(lang === "nb" ? "nb-NO" : "en-GB", { dateStyle: "long" }).format(new Date(ai.settings.turnedOnAt)) }), ai.settings.publish === "auto" ? a.on.autoLine : a.on.askLine]
          .filter(Boolean)
          .join(" ")
      : ai.available
        ? r.aiOff
        : ai.reason
          ? a.unavailable[ai.reason]
          : r.aiCannot;

  return (
    <div className="flex flex-col gap-6">
      {/* Round 15 (D647): the drafts still missing are one press, with the warning that no lawyer has read them. */}
      {toMake.length > 0 && actions.createAll && (
        <section aria-labelledby="make-all" className={`flex flex-wrap items-center justify-between gap-4 p-6 ${CARD_CLASS}`}>
          <span className="flex max-w-xl flex-col gap-1">
            <h2 id="make-all" className="text-title text-ink">
              {countWords(toMake.length, r.makeAll)}
            </h2>
            <span className="text-caption text-ink-2">
              {fillWords(r.makeAllText, { names: toMake.map((entry) => roleName(entry.role, entry.name)).join(", ") })}
            </span>
          </span>
          <ActionForm action={actions.createAll} className="flex flex-col gap-2">
            <div>
              <SubmitButton>{r.makeAllButton}</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}

      {overview.missing.length > 0 && (
        <p role="note" className="text-sm text-warning-text">
          {countWords(overview.missing.length, r.missingLine, { list: overview.missing.map((m) => missingWord(m, words)).join(", ") })}{" "}
          <Link href={`${base}/settings/company`} className="underline">
            {r.fillIn}
          </Link>
        </p>
      )}

      <section aria-labelledby="yours" className={`px-6 py-2 ${CARD_CLASS}`}>
        <h2 id="yours" className="mt-3 mb-1 text-title text-ink">
          {r.yours}
        </h2>
        <ul className="divide-y divide-line">
          {overview.roles.map((entry) => {
            const name = roleName(entry.role, entry.name);
            const write = ai?.writes[entry.role];
            const sub = entry.page ? fillWords(w.chosen, { title: entry.page.title }) : entry.draft ? fillWords(r.draftWaiting, { title: entry.draft.title }) : r.noPage;
            return (
              <FoldRow key={entry.role} title={name} sub={entry.needed ? sub : `${sub} · ${r.notNeededShort}`} action={entry.page ? r.change : r.choose} open={isActive(write)}>
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted">{isLegalRole(entry.role) ? w.roles[entry.role].hint : entry.hint}</p>
                  {!entry.needed && (
                    <p role="note" className="text-sm">
                      {w.notNeeded}
                    </p>
                  )}
                  <div className="flex flex-wrap items-start gap-6">
                    <ActionForm action={actions.setRole.bind(null, entry.role)} className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <span className="sr-only">{fillWords(w.pageFor, { name })}</span>
                        <select name="page" defaultValue={entry.page?.id ?? ""} className={`${field} max-w-xs`}>
                          <option value="">{w.none}</option>
                          {overview.choosable.map((page) => {
                            const other = page.role && page.role !== entry.role;
                            const otherName = page.role && isLegalRole(page.role) ? w.roles[page.role].name : page.role;
                            return (
                              <option key={page.id} value={page.id} disabled={Boolean(other)}>
                                {page.title}
                                {other ? fillWords(w.alreadyThe, { name: otherName?.toLowerCase() ?? "" }) : ""}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <SubmitButton variant="secondary">
                        {w.choose}<span className="sr-only">{fillWords(w.choosePageFor, { name })}</span>
                      </SubmitButton>
                    </ActionForm>
                    {entry.starter ? (
                      <ActionForm action={actions.createStarter.bind(null, entry.role)} className="flex flex-col gap-1">
                        <div>
                          <SubmitButton variant="secondary">
                            {entry.draft ? w.newDraft : w.starterDraft}
                            <span className="sr-only">{fillWords(w.draftOf, { name })}</span>
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    ) : null}
                    {entry.starter && ai?.available && !isActive(write) && (
                      <AiButtons role={entry.role} name={name} ai={ai} words={words} actions={{ write: actions.writeWithAi, stop: actions.stop, handBack: actions.handBack }} />
                    )}
                    {!entry.starter && (
                      <p className="text-sm">
                        <Link href={`${base}/settings/accessibility`} className="underline">
                          {w.onAccessibility}
                        </Link>
                      </p>
                    )}
                  </div>
                  {ai?.settings.stoppedRoles.includes(entry.role) && (
                    <p role="note" className="text-sm">
                      {a.stoppedLine}
                    </p>
                  )}
                  {write && <WriteLine write={write} words={words} lang={lang} base={base} />}
                  {entry.draft && (
                    <p className="text-sm text-muted">
                      {w.latest}<Link href={`${base}/pages/${entry.draft.id}`} className="underline">{entry.draft.title}</Link>{" "}
                      {entry.draft.published ? w.latestPublished : w.latestDraft}.
                    </p>
                  )}
                </div>
              </FoldRow>
            );
          })}

          {ai && (
            <FoldRow title={a.title} sub={aiSub} action={ai.available || on ? r.change : null} open={writing}>
              <div className="flex flex-col gap-3 text-sm">
                {!on && (
                  <>
                    <p>
                      <strong className="font-medium">{a.on.lead}</strong> {a.on.sentence}
                    </p>
                    <p className="text-muted">{a.intro}</p>
                  </>
                )}
                {ai.available && !on && actions.turnOn && (
                  <ActionForm action={actions.turnOn} className="flex flex-col gap-3">
                    <PublishChoice words={words} chosen={ai.settings.publish} />
                    <div>
                      <SubmitButton>{a.on.turnOn}</SubmitButton>
                    </div>
                  </ActionForm>
                )}
                {on && (
                  <div className="flex flex-wrap items-end gap-6">
                    {actions.setPublish && (
                      <ActionForm action={actions.setPublish} className="flex flex-col gap-3">
                        <PublishChoice words={words} chosen={ai.settings.publish} />
                        <div>
                          <SubmitButton variant="secondary">{a.on.save}</SubmitButton>
                        </div>
                      </ActionForm>
                    )}
                    {actions.turnOff && (
                      <ActionForm action={actions.turnOff}>
                        <SubmitButton variant="secondary">{a.on.turnOff}</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                )}
              </div>
            </FoldRow>
          )}

          {!overview.shopOn ? (
            <li className="flex flex-col gap-1 py-3">
              <span className="text-body text-ink">{r.atCheckout}</span>
              <FeatureOffNote storeSlug={storeSlug} feature="shop" owner what={t.offWhat} />
            </li>
          ) : (
            <FoldRow title={r.atCheckout} sub={[t.modes[overview.termsAtCheckout as TermsMode]?.name, notice].filter(Boolean).join(" · ")} action={r.change}>
              <ActionForm action={actions.setTerms} className="flex flex-col gap-4">
                <p className="text-sm text-muted">{t.description}</p>
                <fieldset className="flex flex-col gap-3">
                  <legend className="sr-only">{t.legend}</legend>
                  {TERMS_MODES.map((mode) => (
                    <label key={mode} className="flex items-start gap-2 text-sm">
                      <input type="radio" name="mode" value={mode} defaultChecked={overview.termsAtCheckout === mode} className="mt-1 size-4" />
                      <span>
                        <span className="font-medium">{t.modes[mode].name}</span>
                        <span className="block text-muted">{t.modes[mode].hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {notice && (
                  <p role="status" className="text-sm">
                    {notice}
                  </p>
                )}
                <div>
                  <SubmitButton>{t.save}</SubmitButton>
                </div>
              </ActionForm>
            </FoldRow>
          )}
        </ul>
        {writing && <RefreshWhile seconds={10} />}
      </section>

      {!on && (
        <p role="note" className="text-caption text-ink-2">
          <strong className="font-medium">{w.reviewLead}</strong> {w.notice}
        </p>
      )}
    </div>
  );
}

/**
 * The page's sentence (round 15, D647): how many of the legal pages the store needs are chosen, and, while the terms are missing from a shop,
 * that checkout shows none.
 */
export function legalLead(overview: LegalOverview, words: LegalMessages = legalEn): string {
  const r = words.pages.round;
  const needed = overview.roles.filter((entry) => entry.needed);
  const chosen = needed.filter((entry) => entry.page).length;
  const termsMissing = overview.shopOn && !overview.roles.some((entry) => entry.role === "terms" && entry.page);
  const first =
    chosen === 0 ? (termsMissing ? r.leadNoTerms : r.leadNone) : chosen === needed.length ? r.leadAll : fillWords(r.leadSome, { chosen, total: needed.length });
  return chosen === needed.length ? first : `${first} ${r.leadRest}`;
}

const isActive = (write: LegalWriteState | undefined) => write?.status === "queued" || write?.status === "running";

/** Where the AI's newest write of a kind stands: writing, a draft to open, or why it could not. */
function WriteLine({ write, words, lang, base }: { write: LegalWriteState; words: LegalMessages; lang: AdminLang; base: string }) {
  const a = words.ai;
  if (isActive(write)) {
    return (
      <p role="status" className="mt-3 text-sm">
        {a.writing}
      </p>
    );
  }
  const because = write.status === "written" || write.status === "published" || write.status === "kept" ? ` ${a.because[write.why]}` : "";
  if (write.status === "failed") {
    return (
      <p role="status" className="mt-3 text-sm">
        {a.failed}
        {write.problems.join(" ")}
      </p>
    );
  }
  return (
    <p role="status" className="mt-3 text-sm">
      {write.status === "published" ? a.published : write.status === "kept" ? a.kept : a.ready}
      {write.page ? (
        <Link href={`${base}/pages/${write.page.id}`} className="underline">
          {write.page.title}
        </Link>
      ) : null}
      . {write.languages.length > 0 && fillWords(a.readyIn, { languages: languageNames(write.languages, lang) })}
      {because}
      {write.problems.length > 0 && (
        <>
          {" "}
          {a.partly}
          {write.problems.join(" ")}
        </>
      )}
    </p>
  );
}

/** The two ways a page may be published, the store's choice checked. */
function PublishChoice({ words, chosen }: { words: LegalMessages; chosen: "auto" | "ask" }) {
  const o = words.ai.on;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{o.legend}</legend>
      {(["auto", "ask"] as const).map((mode) => (
        <label key={mode} className="flex items-center gap-2 text-sm">
          <input type="radio" name="publish" value={mode} defaultChecked={chosen === mode} className="size-4" />
          {mode === "auto" ? o.publishAuto : o.publishAsk}
        </label>
      ))}
    </fieldset>
  );
}

/** Write (again), stop or hand back one kind of page, as its state allows. */
function AiButtons({
  role,
  name,
  ai,
  words,
  actions,
}: {
  role: string;
  name: string;
  ai: LegalAiState;
  words: LegalMessages;
  actions: { write?: KindAction; stop?: KindAction; handBack?: KindAction };
}) {
  const a = words.ai;
  const stopped = ai.settings.stoppedRoles.includes(role);
  const kept = ai.writes[role]?.status === "kept";
  const label = <span className="sr-only">{fillWords(a.writeOf, { name })}</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {!stopped && actions.write && (
        <ActionForm action={actions.write.bind(null, role)}>
          <SubmitButton variant="secondary">
            {ai.writes[role] ? a.writeAgain : a.write}
            {label}
          </SubmitButton>
        </ActionForm>
      )}
      {(stopped || kept) && actions.handBack && (
        <ActionForm action={actions.handBack.bind(null, role)}>
          <SubmitButton variant="secondary">
            {a.handBack}
            {label}
          </SubmitButton>
        </ActionForm>
      )}
      {ai.settings.enabled && !stopped && actions.stop && (
        <ActionForm action={actions.stop.bind(null, role)}>
          <SubmitButton variant="secondary">
            {a.stop}
            {label}
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
