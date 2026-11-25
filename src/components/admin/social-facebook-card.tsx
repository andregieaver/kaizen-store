import { Button, EmptyState, Field, List, ListRow, RowFact, RowLead, Select } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { FacebookView } from "@/server/facebook-pages";

type Done = keyof SocialMessages["facebook"]["done"];

/**
 * How the store's Facebook Page's posts did (D870 S1.2b), on the Social posts page, drawn on the server with plain forms posted to
 * `social/facebook`: connect the Page, choose which of the person's Pages it is, wait for the first reading, or the last 90 days' posts with
 * their reach, reactions, comments and shares.
 */
export function SocialFacebookCard({
  view,
  words: w,
  action,
  mayConnect,
  appOn,
  done,
  numberLocale,
  timeZone,
}: {
  view: FacebookView;
  words: SocialMessages["facebook"];
  /** Where the forms post. */
  action: string;
  mayConnect: boolean;
  /** Kaizena Flow's Facebook app is set up here. */
  appOn: boolean;
  /** How the last connect or choice went, from the address. */
  done: string | null;
  numberLocale: string;
  timeZone: string;
}) {
  const count = (n: number | null) => (n === null ? "–" : n.toLocaleString(numberLocale));
  const date = (iso: string) => new Date(iso).toLocaleDateString(numberLocale, { dateStyle: "medium", timeZone });
  const said = done && Object.hasOwn(w.done, done) ? w.done[done as Done] : null;
  const form = (what: string, label: string, kind: "main" | "secondary" | "quiet" = "secondary") => (
    <form method="post" action={action}>
      <input type="hidden" name="do" value={what} />
      <Button type="submit" kind={kind}>
        {label}
      </Button>
    </form>
  );
  const connect = !mayConnect ? <p className="text-caption text-ink-2">{w.askOwner}</p> : appOn ? form("connect", w.connect) : <p className="text-caption text-ink-2">{w.off}</p>;
  return (
    <section id="social-facebook" aria-labelledby="social-facebook-title" className="flex flex-col gap-3 rounded-panel bg-sunken p-4">
      <div className="flex flex-col gap-1">
        <h2 id="social-facebook-title" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-caption text-ink-2">
          {w.lead}
          {view.state === "ready" && view.fetchedAt ? ` ${fillWords(w.readAt, { date: date(view.fetchedAt) })}` : ""}
        </p>
      </div>
      {said && (
        <p role="status" className={done === "failed" || done === "nopage" ? "text-body text-danger-text" : "text-body text-ink"}>
          {said}
        </p>
      )}
      {view.state === "none" && <EmptyState compact title={w.none} action={connect} />}
      {view.state === "choose" &&
        (mayConnect ? (
          <form method="post" action={action} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="do" value="choose" />
            <Field label={w.choose}>
              {(control) => (
                <Select name="page" {...control}>
                  {view.choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" kind="main">
              {w.keep}
            </Button>
          </form>
        ) : (
          <p className="text-caption text-ink-2">{w.askOwner}</p>
        ))}
      {view.state === "waiting" && <EmptyState compact title={fillWords(w.waiting, { name: view.name })} />}
      {view.state === "ready" && (
        <>
          {view.problem && <p className="text-body text-danger-text">{fillWords(w.problem, { problem: view.problem })}</p>}
          {!view.insights && <p className="text-caption text-ink-2">{w.noReach}</p>}
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
                    sub={`${view.name} · ${date(p.postedAt)}`}
                  />
                  {view.insights && <RowFact sub={w.reach}>{count(p.figures.reach)}</RowFact>}
                  <RowFact sub={w.reactions}>{count(p.figures.likes)}</RowFact>
                  <RowFact sub={w.comments}>{count(p.figures.comments)}</RowFact>
                  <RowFact sub={w.shares}>{count(p.figures.shares)}</RowFact>
                </ListRow>
              ))}
            </List>
          )}
        </>
      )}
      {(view.state === "ready" || view.state === "waiting" || view.state === "choose") && mayConnect && (
        <div className="flex flex-wrap gap-2">
          {appOn && form("connect", w.connect, "quiet")}
          {form("disconnect", w.disconnect, "quiet")}
        </div>
      )}
    </section>
  );
}
