import { ButtonLink, EmptyState, List, ListRow, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { InsightsView } from "@/server/social-insights";

/**
 * How the store's own Instagram posts did (D870 S1.2), on the Social posts page, drawn on the server: connect the account (or connect it again
 * for the insights permission), wait for the first reading, or the last 90 days' posts with their reach, likes, saves and shares.
 */
export function SocialInsightsCard({
  view,
  words: w,
  connectHref,
  mayConnect,
  numberLocale,
  timeZone,
}: {
  view: InsightsView;
  words: SocialMessages["insights"];
  connectHref: string;
  mayConnect: boolean;
  numberLocale: string;
  timeZone: string;
}) {
  const count = (n: number | null) => (n === null ? "–" : n.toLocaleString(numberLocale));
  const date = (iso: string) => new Date(iso).toLocaleDateString(numberLocale, { dateStyle: "medium", timeZone });
  const action = (label: string) => (mayConnect ? <ButtonLink href={connectHref} kind="secondary">{label}</ButtonLink> : <p className="text-caption text-ink-2">{w.askOwner}</p>);
  return (
    <section aria-labelledby="social-insights" className="flex flex-col gap-3 rounded-panel bg-sunken p-4">
      <div className="flex flex-col gap-1">
        <h2 id="social-insights" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-caption text-ink-2">
          {w.lead}
          {view.state === "ready" && view.fetchedAt ? ` ${fillWords(w.readAt, { date: date(view.fetchedAt) })}` : ""}
        </p>
      </div>
      {view.state === "none" && <EmptyState compact title={w.none} action={action(w.connect)} />}
      {view.state === "reconnect" && (
        <>
          <p className="text-body text-ink">{fillWords(w.reconnect, { username: view.username })}</p>
          {action(w.reconnectButton)}
        </>
      )}
      {view.state === "waiting" && <EmptyState compact title={fillWords(w.waiting, { username: view.username })} />}
      {view.state === "ready" && (
        <>
          {view.problem && <p className="text-body text-danger-text">{fillWords(w.problem, { problem: view.problem })}</p>}
          {view.posts.length === 0 ? (
            <EmptyState compact title={w.empty} />
          ) : (
            <List label={w.title}>
              {view.posts.map((p) => (
                <ListRow key={p.mediaId}>
                  <RowLead
                    title={
                      p.permalink ? (
                        <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="underline">
                          {p.caption.slice(0, 80) || w.noCaption}
                        </a>
                      ) : (
                        p.caption.slice(0, 80) || w.noCaption
                      )
                    }
                    sub={`${w.kinds[p.kind]} · ${date(p.postedAt)}`}
                  />
                  <RowFact sub={w.reach}>{count(p.figures.reach)}</RowFact>
                  <RowFact sub={w.likes}>{count(p.figures.likes)}</RowFact>
                  <RowFact sub={w.saves}>{count(p.figures.saves)}</RowFact>
                  <RowFact sub={w.shares}>{count(p.figures.shares)}</RowFact>
                </ListRow>
              ))}
            </List>
          )}
        </>
      )}
    </section>
  );
}
