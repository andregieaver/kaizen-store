import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { TiktokView } from "@/server/tiktok";

import { ConnectionCard } from "./social-connect-parts";

/**
 * The store's TikTok account on Social posts (D870 S3.5), drawn on the server with plain forms posted to `social/tiktok`: connect the account
 * and see where videos go, and that they stay private until TikTok has approved Kaizena Flow. Approved TikTok posts with a slideshow video are
 * then posted from the calendar.
 */
export function SocialTiktokCard(
  p: { view: TiktokView; words: SocialMessages["tiktok"]; action: string; mayConnect: boolean; appOn: boolean; done: string | null } & {
    /** TikTok has audited the app, so posts may be public. */
    audited: boolean;
  },
) {
  const { view, words: w } = p;
  return (
    <ConnectionCard id="social-tiktok" {...p} state={view.state}>
      {view.state === "ready" && (
        <>
          <p className="text-body text-ink">{view.username ? fillWords(w.ready, { username: view.username }) : w.readyNoName}</p>
          {!p.audited && <p className="text-caption text-ink-2">{w.private}</p>}
          {!view.publish && <p className="text-caption text-ink-2">{w.noPublish}</p>}
          {view.problem && <p className="text-body text-danger-text">{fillWords(w.problem, { problem: view.problem })}</p>}
        </>
      )}
    </ConnectionCard>
  );
}
