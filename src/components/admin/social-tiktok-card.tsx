import { EmptyState } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { TiktokView } from "@/server/tiktok";

import { ActionForm, ConnectAction, DoneNote } from "./social-connect-parts";
import { InsightsFrame } from "./social-insights-card";

type Done = keyof SocialMessages["tiktok"]["done"];

/**
 * The store's TikTok account on Social posts (D870 S3.5), drawn on the server with plain forms posted to `social/tiktok`: connect the account
 * and see where videos go, and that they stay private until TikTok has approved Kaizena Flow. Approved TikTok posts with a slideshow video are
 * then posted from the calendar.
 */
export function SocialTiktokCard({
  view,
  words: w,
  action,
  mayConnect,
  appOn,
  audited,
  done,
}: {
  view: TiktokView;
  words: SocialMessages["tiktok"];
  action: string;
  mayConnect: boolean;
  /** Kaizena Flow's TikTok app is set up here. */
  appOn: boolean;
  /** TikTok has audited the app, so posts may be public. */
  audited: boolean;
  done: string | null;
}) {
  const said = done && Object.hasOwn(w.done, done) ? w.done[done as Done] : null;
  return (
    <InsightsFrame id="social-tiktok" title={w.title} lead={w.lead}>
      <DoneNote said={said} bad={done === "failed"} />
      {view.state === "none" && <EmptyState compact title={w.none} action={<ConnectAction action={action} mayConnect={mayConnect} appOn={appOn} words={w} />} />}
      {view.state === "ready" && (
        <>
          <p className="text-body text-ink">{view.username ? fillWords(w.ready, { username: view.username }) : w.readyNoName}</p>
          {!audited && <p className="text-caption text-ink-2">{w.private}</p>}
          {!view.publish && <p className="text-caption text-ink-2">{w.noPublish}</p>}
          {view.problem && <p className="text-body text-danger-text">{fillWords(w.problem, { problem: view.problem })}</p>}
          {mayConnect && (
            <div className="flex flex-wrap gap-2">
              {appOn && <ActionForm action={action} what="connect" label={w.connect} kind="quiet" />}
              <ActionForm action={action} what="disconnect" label={w.disconnect} kind="quiet" />
            </div>
          )}
        </>
      )}
    </InsightsFrame>
  );
}
