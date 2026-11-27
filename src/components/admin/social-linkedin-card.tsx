import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { LinkedinView } from "@/server/linkedin";

import { ConnectionCard } from "./social-connect-parts";

/**
 * The store's LinkedIn on Social posts (D870 S3.6), drawn on the server with plain forms posted to `social/linkedin`: connect, choose whether
 * posts go to the member's profile or a Company Page they administer, and see where they go and, without renewal, until when.
 */
export function SocialLinkedinCard(
  p: { view: LinkedinView; words: SocialMessages["linkedin"]; action: string; mayConnect: boolean; appOn: boolean; done: string | null } & { dateLocale: string; timeZone: string },
) {
  const { view, words: w } = p;
  const choices = view.state === "choose" ? view.choices.map((c) => ({ id: c.urn, name: c.name })) : [];
  return (
    <ConnectionCard id="social-linkedin" {...p} state={view.state} choose={view.state === "choose" ? { field: "place", label: w.choose, keep: w.keep, choices } : undefined}>
      {view.state === "ready" && (
        <>
          <p className="text-body text-ink">{fillWords(view.page ? w.readyPage : w.readyProfile, { place: view.place })}</p>
          {!view.publish && <p className="text-caption text-ink-2">{w.noPublish}</p>}
          {view.endsAt && <p className="text-caption text-ink-2">{fillWords(w.endsAt, { date: new Date(view.endsAt).toLocaleDateString(p.dateLocale, { dateStyle: "medium", timeZone: p.timeZone }) })}</p>}
          {view.problem && <p className="text-body text-danger-text">{fillWords(w.problem, { problem: view.problem })}</p>}
        </>
      )}
    </ConnectionCard>
  );
}
