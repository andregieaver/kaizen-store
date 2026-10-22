import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Chip } from "@/components/admin/ui";
import type { TrackingPhase } from "@/lib/tracking-phases";
import type { ParcelTracking } from "@/server/shipment-tracking";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";
import { countWords, fillWords } from "@/lib/admin-fill";

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/** Staff's words for a phase in English (the AI manager's tools read them too); the page reads the account's language from the `order` catalogue. */
export const PHASE_WORDS: Record<TrackingPhase, string> = orderEn.tracking.phases;

const SHOWN = 5;

/**
 * A parcel's tracking on the staff order page (wave 3, D238, `docs/wave-3-notifications.md` 2.3), read from the stored rows (`parcelTrackingFor()`), never
 * from the carrier while the page renders: the phase as a chip (a warning for *returned* and *problem*, and a note when the code is not verified), the
 * latest events in the store's time zone, *Last checked* and *Check now*. A parcel whose carrier is not connected says how to have it followed.
 */
export function ParcelStatus({
  tracking,
  carrierName,
  when,
  checkNow,
  words: w = orderEn.tracking,
}: {
  /** The `order` catalogue's `tracking` words in the account's language (D312 A4). */
  words?: OrderMessages["tracking"];
  /** The parcel's stored tracking, or undefined when Kaizen does not follow it. */
  tracking: ParcelTracking | undefined;
  carrierName: string;
  when: (iso: string) => string;
  /** *Check now*, or null. */
  checkNow: FormAction | null;
}) {
  if (!tracking || !tracking.followed) {
    return <p className="text-xs text-muted">{w.notFollowed}</p>;
  }
  const signal = tracking.phase === "returned_to_sender" || tracking.phase === "problem" || tracking.phase === "attempted" ? "warning" : tracking.phase === "delivered" ? "positive" : "neutral";
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {tracking.phase ? (
          <Chip signal={signal} dot>
            {w.phases[tracking.phase]}
          </Chip>
        ) : (
          <span className="text-muted">{w.notChecked}</span>
        )}
        {tracking.phase && !tracking.phaseVerified && <span className="text-muted">{fillWords(w.notVerified, { carrier: carrierName })}</span>}
        {tracking.deliveredAt && <span>{fillWords(w.deliveredFrom, { carrier: carrierName, when: when(tracking.deliveredAt) })}</span>}
      </div>
      {tracking.events.length === 0 && tracking.checkedAt && <p className="text-muted">{fillWords(w.noNews, { carrier: carrierName })}</p>}
      {tracking.events.length > 0 && (
        <ol className="flex flex-col gap-0.5">
          {tracking.events.slice(0, SHOWN).map((e, i) => (
            <li key={`${e.at}-${e.code}-${i}`}>
              <time dateTime={e.at} className="text-muted">
                {when(e.at)}
              </time>{" "}
              {e.description || e.code}
              {e.location ? `, ${e.location}` : ""}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2 text-muted">
        {tracking.checkedAt ? fillWords(w.lastChecked, { when: when(tracking.checkedAt) }) : w.checksSoon}
        {tracking.lastCheckFailed && !tracking.stopped && countWords(tracking.failures, w.failed, { carrier: carrierName })}
        {checkNow && tracking.stopped !== "undone" && (
          <ActionForm action={checkNow} successMessage={w.checked} className="flex items-center gap-2">
            <SubmitButton variant="secondary">{w.checkNow}</SubmitButton>
          </ActionForm>
        )}
      </div>
      {tracking.stopped && <p className="text-muted">{w.stops[tracking.stopped]}</p>}
    </div>
  );
}
