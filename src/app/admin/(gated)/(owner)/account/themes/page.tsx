import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { themeStorePath } from "@/lib/theme-host";
import { OPEN_STATUSES, SUBMISSION_SIGNAL } from "@/lib/theme-submissions";
import { requireAccount } from "@/server/auth";
import { authoredThemes, mySubmissions } from "@/server/theme-submissions";

import { withdrawSubmissionAction } from "./actions";

export const metadata: Metadata = { title: "Your themes" };

/**
 * The looks a person shared as themes (wave 7 unit J, D344): each submission with its state and, when it was not accepted, why; and the themes
 * they are the author of, with their version and how many stores use each. An update is sent from a store's Design settings.
 */
export default async function YourThemesPage() {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "design").yours;
  const date = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium" });
  const [submissions, themes] = await Promise.all([mySubmissions(account.id), authoredThemes(account.id)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <Card title={w.sent}>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <List label={w.sent}>
            {submissions.map((submission) => (
              <ListRow key={submission.id}>
                <RowLead
                  title={submission.kind === "update" ? (submission.presetTitle ?? submission.title) : submission.title}
                  sub={
                    <>
                      {w.kind[submission.kind]} · {fillWords(w.from, { store: submission.storeName })} · {date.format(new Date(submission.createdAt))}
                      {submission.status === "rejected" && submission.reason && <span className="block text-ink-2">{fillWords(w.why, { reason: submission.reason })}</span>}
                    </>
                  }
                />
                <Chip signal={SUBMISSION_SIGNAL[submission.status]}>{w.status[submission.status]}</Chip>
                {OPEN_STATUSES.includes(submission.status) && (
                  <RowActions>
                    <ActionForm action={withdrawSubmissionAction.bind(null, submission.id)} successMessage={w.withdrawn}>
                      <SubmitButton variant="secondary">{w.withdraw}</SubmitButton>
                    </ActionForm>
                  </RowActions>
                )}
              </ListRow>
            ))}
          </List>
        )}
      </Card>
      <Card title={w.themes} description={w.updateHint}>
        {themes.length === 0 ? (
          <p className="text-sm text-muted">{w.noThemes}</p>
        ) : (
          <List label={w.themes}>
            {themes.map((theme) => (
              <ListRow key={theme.id}>
                <RowLead
                  title={theme.title}
                  href={theme.published && !theme.archived && theme.slug ? themeStorePath(`/${theme.slug}`) : undefined}
                  sub={theme.published && !theme.archived ? countWords(theme.stores, w.stores, { n: theme.stores }) : w.unpublished}
                />
                {theme.version !== null && <RowFact>{fillWords(adminText(lang, "design").common.version, { n: theme.version })}</RowFact>}
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
