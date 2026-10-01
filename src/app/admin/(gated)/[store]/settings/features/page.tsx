import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { REMINDER_HOURS, storeTimeZones } from "@/server/bookings";

import { saveBookingsModuleAction, saveDeliveriesModuleAction } from "./actions";

export const metadata: Metadata = { title: "Features" };

const card = "rounded-lg border border-border bg-background p-5";

/** What the store does besides selling goods (D65): switched on here. */
export default async function FeaturesPage({ params }: PageProps<"/admin/[store]/settings/features">) {
  const { store, role } = await requireMember((await params).store);
  const owner = role === "owner";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Features</h1>
        <p className="text-sm text-muted">What your store does besides selling goods.</p>
      </div>

      <section aria-labelledby="bookings-heading" className={card}>
        <h2 id="bookings-heading" className="mb-1 font-medium">
          Appointments
        </h2>
        <p className="mb-4 text-sm text-muted">
          Sell time with your staff, such as treatments, consultations or lessons. Shoppers choose a day and a time on
          the product page and pay at checkout; you see every booking in a calendar.
        </p>
        <ActionForm action={saveBookingsModuleAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="bookings" defaultChecked={store.bookingsOn} disabled={!owner} className="mt-0.5 size-4" />
            <span>
              Take bookings
              <span className="block text-muted">
                Adds Bookings to the menu (staff and their hours, the calendar) and lets products be appointments.
              </span>
            </span>
          </label>
          <label className="flex max-w-sm flex-col gap-1 text-sm font-medium">
            Time zone
            <select
              name="timeZone"
              defaultValue={store.timeZone}
              disabled={!owner}
              className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
            >
              {storeTimeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace("_", " ")}
                </option>
              ))}
            </select>
            <span className="font-normal text-muted">Where the appointments take place: times are shown in it.</span>
          </label>
          <label className="flex max-w-sm flex-col gap-1 text-sm font-medium">
            Reminder email
            <select
              name="reminderHours"
              defaultValue={store.bookingReminderHours}
              disabled={!owner}
              className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
            >
              {REMINDER_HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours === 0 ? "Send none" : hours < 48 ? `${hours} hours before` : `${hours / 24} days before`}
                </option>
              ))}
            </select>
            <span className="font-normal text-muted">
              Shoppers get a reminder with the time, place and a calendar file. Those who book closer to the time than
              this get only their confirmation.
            </span>
          </label>
          {owner ? (
            <div>
              <SubmitButton>Save</SubmitButton>
            </div>
          ) : (
            <p className="text-sm text-muted">Only an owner can switch features on or off.</p>
          )}
        </ActionForm>
      </section>

      <section aria-labelledby="deliveries-heading" className={card}>
        <h2 id="deliveries-heading" className="mb-1 font-medium">
          Subscription boxes
        </h2>
        <p className="mb-4 text-sm text-muted">
          Shoppers keep a list of what they want in their box, delivered on your delivery days. At each cutoff the list
          becomes that delivery&apos;s order at the day&apos;s prices, with its stock held; the card they saved is charged when you
          send it. A list nobody changes repeats.
        </p>
        <ActionForm action={saveDeliveriesModuleAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="deliveries" defaultChecked={store.deliveriesOn} disabled={!owner} className="mt-0.5 size-4" />
            <span>
              Offer subscription boxes
              <span className="block text-muted">
                Adds Subscription boxes to the menu (delivery days, lists and each delivery&apos;s orders), a Subscription box page to My
                account, and a button to add products to it on their pages. Uses the time zone above.
              </span>
            </span>
          </label>
          {owner && (
            <div>
              <SubmitButton>Save</SubmitButton>
            </div>
          )}
        </ActionForm>
      </section>
    </div>
  );
}
