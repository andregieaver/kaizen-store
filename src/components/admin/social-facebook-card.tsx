import { EmptyState, List, ListRow, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { FacebookView } from "@/server/facebook-pages";

import { ActionForm, ChooseForm, ConnectAction, DoneNote } from "./social-connect-parts";
import { InsightsFrame, PostTitle } from "./social-insights-card";

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
  const connect = <ConnectAction action={action} mayConnect={mayConnect} appOn={appOn} words={w} />;
  return (
    <InsightsFrame id="social-facebook" title={w.title} lead={`${w.lead}${view.state === "ready" && view.fetchedAt ? ` ${fillWords(w.readAt, { date: date(view.fetchedAt) })}` : ""}`}>
      <DoneNote said={said} bad={done === "failed" || done === "nopage"} />
      {view.state === "none" && <EmptyState compact title={w.none} action={connect} />}
      {view.state === "choose" &&
        (mayConnect ? (
          <ChooseForm action={action} field="page" label={w.choose} keep={w.keep} choices={view.choices} />
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
                  <RowLead title={<PostTitle post={p} empty={w.noCaption} />} sub={`${view.name} · ${date(p.postedAt)}`} />
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
          {appOn && <ActionForm action={action} what="connect" label={w.connect} kind="quiet" />}
          <ActionForm action={action} what="disconnect" label={w.disconnect} kind="quiet" />
        </div>
      )}
    </InsightsFrame>
  );
}
