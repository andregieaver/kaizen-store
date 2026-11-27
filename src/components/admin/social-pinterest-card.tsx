import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { PinterestView } from "@/server/pinterest";

import { ConnectionCard } from "./social-connect-parts";

/**
 * The store's Pinterest account on Social posts (D870 S3.4), drawn on the server with plain forms posted to `social/pinterest`: connect the
 * account, choose the board its Pins go to, and see where they go. Approved Pinterest posts are then pinned from the calendar.
 */
export function SocialPinterestCard(p: { view: PinterestView; words: SocialMessages["pinterest"]; action: string; mayConnect: boolean; appOn: boolean; done: string | null }) {
  const { view, words: w } = p;
  return (
    <ConnectionCard
      id="social-pinterest"
      {...p}
      state={view.state}
      bad={["failed", "noboard"]}
      choose={view.state === "choose" ? { field: "board", label: w.choose, keep: w.keep, choices: view.choices } : undefined}
    >
      {view.state === "ready" && (
        <>
          <p className="text-body text-ink">{fillWords(w.ready, { board: view.board, username: view.username })}</p>
          {!view.publish && <p className="text-caption text-ink-2">{w.noPublish}</p>}
          {view.problem && <p className="text-body text-danger-text">{fillWords(w.problem, { problem: view.problem })}</p>}
        </>
      )}
    </ConnectionCard>
  );
}
