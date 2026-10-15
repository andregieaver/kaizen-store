import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Chip } from "@/components/admin/ui";
import type { TrackingPhase, TrackingStop } from "@/lib/tracking-phases";
import type { ParcelTracking } from "@/server/shipment-tracking";

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/** Staff's words for a phase (English, as the admin is). */
export const PHASE_WORDS: Record<TrackingPhase, string> = {
  info_received: "Announced to the carrier",
  in_transit: "On its way",
  out_for_delivery: "Out for delivery",
  ready_for_collection: "Ready to collect",
  attempted: "Delivery attempted",
  delivered: "Delivered",
  returned_to_sender: "On its way back to you",
  problem: "Problem reported",
  unknown: "Status not recognised",
};

const STOP_WORDS: Record<TrackingStop, string> = {
  delivered: "Kaizen stopped following it: delivered.",
  returned: "Kaizen stopped following it: on its way back to you.",
  old: "Kaizen stopped following it: sent more than 30 days ago.",
  undone: "Kaizen stopped following it: the parcel was undone.",
  carrier_failing: "Kaizen could not reach the carrier for this parcel and stopped asking. Check now tries again.",
  no_agreement: "The carrier's agreement is no longer saved under Shipping, so Kaizen stopped asking. Check now tries again.",
};

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
}: {
  /** The parcel's stored tracking, or undefined when Kaizen does not follow it. */
  tracking: ParcelTracking | undefined;
  carrierName: string;
  when: (iso: string) => string;
  /** *Check now*, or null. */
  checkNow: FormAction | null;
}) {
  if (!tracking || !tracking.followed) {
    return <p className="text-xs text-muted">Kaizen follows parcels from carriers you connect under Shipping.</p>;
  }
  const signal = tracking.phase === "returned_to_sender" || tracking.phase === "problem" || tracking.phase === "attempted" ? "warning" : tracking.phase === "delivered" ? "positive" : "neutral";
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {tracking.phase ? (
          <Chip signal={signal} dot>
            {PHASE_WORDS[tracking.phase]}
          </Chip>
        ) : (
          <span className="text-muted">Not checked yet</span>
        )}
        {tracking.phase && !tracking.phaseVerified && <span className="text-muted">({carrierName}&apos;s code is not yet checked against its documentation: no email or delivery date comes from it)</span>}
        {tracking.deliveredAt && <span>Delivered (from {carrierName}, {when(tracking.deliveredAt)})</span>}
      </div>
      {tracking.events.length === 0 && tracking.checkedAt && <p className="text-muted">{carrierName} has no news about this parcel yet.</p>}
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
        {tracking.checkedAt ? `Last checked ${when(tracking.checkedAt)}` : "Kaizen checks it within a few minutes"}
        {tracking.lastCheckFailed && !tracking.stopped && ` · the last ${tracking.failures === 1 ? "check" : `${tracking.failures} checks`} did not reach ${carrierName}`}
        {checkNow && tracking.stopped !== "undone" && (
          <ActionForm action={checkNow} successMessage="Checked." className="flex items-center gap-2">
            <SubmitButton variant="secondary">Check now</SubmitButton>
          </ActionForm>
        )}
      </div>
      {tracking.stopped && <p className="text-muted">{STOP_WORDS[tracking.stopped]}</p>}
    </div>
  );
}
