import { EmptyState } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { PinterestView } from "@/server/pinterest";

import { ActionForm, ChooseForm, ConnectAction, DoneNote } from "./social-connect-parts";
import { InsightsFrame } from "./social-insights-card";

type Done = keyof SocialMessages["pinterest"]["done"];

/**
 * The store's Pinterest account on Social posts (D870 S3.4), drawn on the server with plain forms posted to `social/pinterest`: connect the
 * account, choose the board its Pins go to, and see where they go. Approved Pinterest posts are then pinned from the calendar.
 */
export function SocialPinterestCard({
  view,
  words: w,
  action,
  mayConnect,
  appOn,
  done,
}: {
  view: PinterestView;
  words: SocialMessages["pinterest"];
  action: string;
  mayConnect: boolean;
  /** Kaizena Flow's Pinterest app is set up here. */
  appOn: boolean;
  /** How the last connect or choice went, from the address. */
  done: string | null;
}) {
  const said = done && Object.hasOwn(w.done, done) ? w.done[done as Done] : null;
  const connect = <ConnectAction action={action} mayConnect={mayConnect} appOn={appOn} words={w} />;
  return (
    <InsightsFrame id="social-pinterest" title={w.title} lead={w.lead}>
      <DoneNote said={said} bad={done === "failed" || done === "noboard"} />
      {view.state === "none" && <EmptyState compact title={w.none} action={connect} />}
      {view.state === "choose" &&
        (mayConnect ? (
          <ChooseForm action={action} field="board" label={w.choose} keep={w.keep} choices={view.choices} />
        ) : (
          <p className="text-caption text-ink-2">{w.askOwner}</p>
        ))}
      {view.state === "ready" && (
        <>
          <p className="text-body text-ink">{fillWords(w.ready, { board: view.board, username: view.username })}</p>
          {!view.publish && <p className="text-caption text-ink-2">{w.noPublish}</p>}
          {view.problem && <p className="text-body text-danger-text">{fillWords(w.problem, { problem: view.problem })}</p>}
        </>
      )}
      {(view.state === "ready" || view.state === "choose") && mayConnect && (
        <div className="flex flex-wrap gap-2">
          {appOn && <ActionForm action={action} what="connect" label={w.connect} kind="quiet" />}
          <ActionForm action={action} what="disconnect" label={w.disconnect} kind="quiet" />
        </div>
      )}
    </InsightsFrame>
  );
}
