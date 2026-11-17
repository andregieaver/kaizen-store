import { AdminLink } from "@/components/admin/ui";
import { emailListLine, textsLine, type MarketingLine, type MarketingWords } from "@/lib/customer-marketing";
import type { SubscriberStatus } from "@/lib/marketing-consent";
import type { SmsSubscriberStatus } from "@/lib/sms";

const card = "rounded-lg border border-line bg-card p-5 text-sm";

function Line({ line }: { line: MarketingLine }) {
  return line.href ? (
    <AdminLink href={line.href} className="underline underline-offset-2">
      {line.text}
    </AdminLink>
  ) : (
    <span className="text-muted">{line.text}</span>
  );
}

/**
 * The store's marketing to one person, on their customer page (ecosystem plan E2.4, D713): one quiet card of facts Homer already knows the
 * words of, each opening where it is kept. Whether they get the store's emails and texts, for staff who may read marketing (`lists`, null
 * for others); the saved segments they are in now, each linked to its page where the viewer may open it. Nothing is drawn with nothing to say.
 */
export function CustomerMarketing({
  lists,
  segments,
  segmentLinks,
  base,
  words: w,
  date,
}: {
  lists: {
    subscription: { id: string; status: SubscriberStatus; since: string } | null;
    sms: { offered: boolean; number: { status: SmsSubscriberStatus; phone: string; since: string } | null };
  } | null;
  segments: { saved: number; in: { id: string; name: string }[] };
  /** Whether the viewer may open a segment's page. */
  segmentLinks: boolean;
  /** The store's admin address. */
  base: string;
  words: MarketingWords;
  date: (iso: string) => string;
}) {
  const email = lists ? emailListLine(lists.subscription, base, w, date) : null;
  const texts = lists ? textsLine(lists.sms, base, w, date) : null;
  // Where the store has segments: those they are in, or (for a viewer who sees the lists too) that they are in none.
  const showSegments = segments.in.length > 0 || (lists !== null && segments.saved > 0);
  if (!email && !texts && !showSegments) return null;
  return (
    <section aria-labelledby="marketing" className={card}>
      <h2 id="marketing" className="mb-2 text-title text-ink">{w.title}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {email && (
          <>
            <dt className="text-muted">{w.email}</dt>
            <dd>
              <Line line={email} />
            </dd>
          </>
        )}
        {texts && (
          <>
            <dt className="text-muted">{w.texts}</dt>
            <dd>
              <Line line={texts} />
            </dd>
          </>
        )}
        {showSegments && (
          <>
            <dt className="text-muted">{w.segments}</dt>
            <dd>
              {segments.in.length === 0 ? (
                <span className="text-muted">{w.segmentsNone}</span>
              ) : (
                <ul aria-label={w.segments} className="flex flex-wrap gap-x-3 gap-y-1">
                  {segments.in.map((segment) => (
                    <li key={segment.id}>
                      {segmentLinks ? (
                        <AdminLink href={`${base}/segments/${segment.id}`} className="underline underline-offset-2">
                          {segment.name}
                        </AdminLink>
                      ) : (
                        segment.name
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
