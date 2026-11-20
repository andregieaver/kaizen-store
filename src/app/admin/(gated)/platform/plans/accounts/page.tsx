import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Chip, EmptyState, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { ScreensMessages } from "@/lib/admin-messages/screens.en";
import { formatMoney } from "@/lib/money";
import { SCREENS_WORDS } from "@/lib/admin-words/screens";
import { movePreviews, type MovePreview } from "@/server/account-move";
import { requirePlatformReader } from "@/server/auth";

import { moveAccountAction } from "./actions";

export const metadata: Metadata = { title: "Accounts" };

/**
 * Platform → Plans → Accounts (D748 step E4, `docs/extensions.md` 13): each account's billing, and for one still billed store by store what
 * the move to one plan does (the plan it keeps, the plans that end, the money a month before and after, a store limit it is above), with
 * "Move this account" to try it on one. Launch (step E5) moves the rest.
 */
export default async function AccountsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = SCREENS_WORDS[lang].platformAccounts;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const previews = await movePreviews();
  const day = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "day", lang);
  const money = (totals: MovePreview["before"]) => totals.map((t) => formatMoney(t.minor, t.currency, locale)).join(" + ") || formatMoney(0, "EUR", locale);

  return (
    <>
      <PageHeader back={{ href: "/admin/platform/plans", label: w.plans }} title={w.title}
        description={
          <>
            <span className="sm:hidden">{w.phoneLead}</span>
            <span className="max-sm:hidden">{w.description}</span>
          </>
        }
      />
      {/* Round 62 (D823): on a phone how many still need moving comes first, and each account is one row with Move behind it. */}
      {previews.some((p) => !p.billed) && (
        <section className="flex flex-col gap-0.5 rounded-panel bg-warning-soft px-4 py-3 sm:hidden">
          <span className="text-body text-ink">{countWords(previews.filter((p) => !p.billed).length, w.phoneLeft, { n: previews.filter((p) => !p.billed).length })}</span>
          <span className="text-caption text-ink-2">{w.phoneLeftSub}</span>
        </section>
      )}
      {previews.length === 0 ? (
        <EmptyState title={w.none} />
      ) : (
        <List label={w.list}>
          {previews.map((p) => (
            <ListRow key={p.organisationId}>
              <RowLead
                title={p.name}
                sub={[p.ownerEmail ? fillWords(w.owner, { email: p.ownerEmail }) : null, countWords(p.stores.length, w.stores, { n: p.stores.length })].filter(Boolean).join(" · ")}
              />
              {!p.billed && (
                <details className="group sm:hidden">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-ink underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                    {w.phoneMove}
                  </summary>
                  <div className="flex flex-col gap-3 pb-2 text-caption text-ink-2">
                    <MoveFacts preview={p} w={w} day={day} money={money} />
                    <MoveForm preview={p} w={w} />
                  </div>
                </details>
              )}
              {p.billed ? (
                <RowFact>
                  <Chip signal="positive" dot>
                    {p.movedAt ? fillWords(w.oneSince, { date: day(p.movedAt) }) : w.oneFromStart}
                  </Chip>
                </RowFact>
              ) : (
                <>
                  <div className="contents max-sm:hidden">
                    <RowFact sub={<MoveFacts preview={p} w={w} day={day} money={money} />}>
                      <Chip dot>{w.storeByStore}</Chip>
                    </RowFact>
                    <RowActions>
                      <MoveForm preview={p} w={w} />
                    </RowActions>
                  </div>
                </>
              )}
            </ListRow>
          ))}
        </List>
      )}
    </>
  );
}

/** Move this account: the box only where the move ends a store's plan; otherwise there is nothing to understand first. */
function MoveForm({ preview: p, w }: { preview: MovePreview; w: ScreensMessages["platformAccounts"] }) {
  return (
    <ActionForm action={moveAccountAction.bind(null, p.organisationId)} className="flex flex-col items-end gap-2 max-sm:items-start">
      {p.ending.length > 0 ? (
        <label className="flex items-center gap-2 text-caption">
          <input type="checkbox" name="understand" required />
          {w.understand}
        </label>
      ) : (
        <input type="hidden" name="understand" value="on" />
      )}
      <SubmitButton variant="secondary">{w.move}</SubmitButton>
    </ActionForm>
  );
}

/** What the move does for one account, in a few lines. */
function MoveFacts({
  preview: p,
  w,
  day,
  money,
}: {
  preview: MovePreview;
  w: ScreensMessages["platformAccounts"];
  day: (iso: string) => string;
  money: (totals: MovePreview["before"]) => string;
}) {
  const lines = [
    p.kept ? fillWords(w.keeps, { plan: p.kept.planName ?? "?", store: p.kept.name }) : w.keepsNone,
    p.ending.length > 0 ? countWords(p.ending.length, w.ends, { n: p.ending.length }) : null,
    p.kept ? fillWords(w.money, { before: money(p.before), after: money(p.after) }) : null,
    !p.kept && p.trialEndsAt ? fillWords(p.trialEnded ? w.trialEnded : w.trial, { date: day(p.trialEndsAt) }) : null,
    p.overLimit ? fillWords(w.overLimit, { n: p.stores.length, plan: p.kept?.planName ?? "?", limit: p.storeLimit ?? 0 }) : null,
  ].filter((line): line is string => line !== null);
  return (
    <span className="flex flex-col">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}
