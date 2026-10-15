/**
 * The customer notifications (wave 3, D238, `docs/wave-3-notifications.md` 4.1): every email a store sends a buyer automatically about an order or a
 * return on an event. The id of each is its email kind (`sendEmail()`'s `kind`), so the catalogue, `EMAIL_KINDS` and the database's checks name the
 * same thing (`notifications.test.ts` holds the first two together, the rules migration lists the ids in `notification_settings` and
 * `email_templates`' checks).
 *
 * - **Required**: the law (or Kaizen's choice, argued in the spec) needs it sent. It has no switch, and the database refuses to store it off
 *   (`notification_settings_required`).
 * - **Locked**: required and not editable either (the withdrawal acknowledgement, kept as evidence, D153): it can have no template.
 * - Action emails (a pay link, *Send again*, a test) and security, invoice, booking, subscription-reminder, bonus, referral, weekly-box and support
 *   emails are not notifications and are not here (section 7 of the spec).
 *
 * Pure and without imports: `src/db/schema.ts` reads the ids for its checks, and drizzle-kit loads this file without the app's path aliases.
 * Staff and admin words are English.
 */

/** The groups of the Notifications page (2.1). */
export const NOTIFICATION_GROUPS = ["orders", "pickup", "returns"] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroup, string> = {
  orders: "Orders",
  pickup: "Pickup and local delivery",
  returns: "Returns",
};

/**
 * The placeholders an owner may write in a template (4.2). The first three are in every notification; the others belong to the notifications
 * that have the value. What each becomes is `PLACEHOLDERS` in `src/lib/email-template.ts`.
 */
export const PLACEHOLDER_NAMES = [
  "store_name",
  "order_number",
  "customer_first_name",
  "order_total",
  "carrier",
  "tracking_number",
  "refund_amount",
  "return_number",
  "pickup_place",
  "change_number",
] as const;
export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];

/** The placeholders every notification has. */
export const COMMON_PLACEHOLDERS = ["store_name", "order_number", "customer_first_name"] as const satisfies readonly PlaceholderName[];

export type NotificationDef = {
  id: string;
  group: NotificationGroup;
  /** The name on the list and the editor. */
  label: string;
  /** One line on when it is sent. */
  when: string;
  /** On or off while the store has saved nothing for it. Required ones are always on. */
  defaultOn: boolean;
  required: boolean;
  /** False only for a locked notification. */
  editable: boolean;
  /** Its placeholders, the common ones first. */
  placeholders: readonly PlaceholderName[];
  /** Why it is required, for the editor and the review (null when it is not). */
  why: string | null;
};

const def = (
  id: string,
  group: NotificationGroup,
  label: string,
  when: string,
  options: { defaultOn?: boolean; required?: boolean; editable?: boolean; own?: readonly PlaceholderName[]; why?: string } = {},
): NotificationDef => ({
  id,
  group,
  label,
  when,
  defaultOn: options.required ? true : (options.defaultOn ?? true),
  required: options.required ?? false,
  editable: options.editable ?? true,
  placeholders: [...COMMON_PLACEHOLDERS, ...(options.own ?? [])],
  why: options.why ?? null,
});

/** The catalogue, in the order the Notifications page lists it. */
export const NOTIFICATIONS: readonly NotificationDef[] = [
  def("order.confirmation", "orders", "Order confirmation", "When an order is paid (or confirmed to be paid at the venue).", {
    required: true,
    own: ["order_total"],
    why: "The law requires the order to be confirmed on a durable medium (Consumer Rights Directive Art. 8(7)).",
  }),
  def("subscription.renewed", "orders", "Subscription renewal", "When a subscription renews and its card is charged.", {
    required: true,
    own: ["order_total"],
    why: "A renewal charges the card without the customer present: this email is their notice of the charge and carries the invoice.",
  }),
  def("order.changed", "orders", "Order change", "When staff change the goods of a paid order.", {
    required: true,
    own: ["change_number"],
    why: "A change to the contract is confirmed on a durable medium, and an extra payment is asked through it.",
  }),
  def("order.sent", "orders", "Order sent", "When a parcel is marked as sent.", { own: ["carrier", "tracking_number"] }),
  def("order.parcel_out_for_delivery", "orders", "Out for delivery (carrier)", "When the carrier reports that a parcel is out for delivery.", {
    defaultOn: false,
    own: ["carrier", "tracking_number"],
  }),
  def("order.parcel_delivered", "orders", "Delivered (carrier)", "When the carrier reports that a parcel was delivered.", {
    defaultOn: false,
    own: ["carrier", "tracking_number"],
  }),
  def("order.refunded", "orders", "Refund", "When an order is refunded in full or in part.", { own: ["refund_amount"] }),
  def("order.cancelled", "orders", "Order cancelled", "When staff cancel an order."),
  def("order.ready_for_pickup", "pickup", "Ready for pickup", "When staff mark a pickup order ready to collect.", { own: ["pickup_place"] }),
  def("order.out_for_delivery", "pickup", "Out for delivery (your driver)", "When the store's own driver takes a local delivery out."),
  def("return.acknowledgement", "returns", "Withdrawal acknowledgement", "When a customer withdraws from a purchase with the withdrawal button.", {
    required: true,
    editable: false,
    own: ["return_number"],
    why: "The law requires the receipt of a withdrawal to be acknowledged on a durable medium (Consumer Rights Directive Art. 11a); it is kept as evidence.",
  }),
  def("return.approved", "returns", "Return approved", "When staff approve a return.", {
    required: true,
    own: ["return_number"],
    why: "It carries the return address, instructions and label the customer needs to send goods back in time.",
  }),
  def("return.declined", "returns", "Return declined", "When staff decline a return.", {
    required: true,
    own: ["return_number"],
    why: "A refusal must reach the customer, with the statement that their statutory rights are not affected.",
  }),
  def("return.received", "returns", "Return received", "When staff record that a return arrived.", { own: ["return_number"] }),
  def("return.refunded", "returns", "Return refunded", "When a return is refunded.", { own: ["return_number"] }),
  // Exchanges and return labels (wave 3, D239, docs/wave-3-exchanges.md 2.5).
  def("return.exchange_proposed", "returns", "Exchange proposed", "When staff send the customer an exchange to confirm.", { own: ["return_number"] }),
  def("return.exchange_to_pay", "returns", "Exchange: payment asked", "When an exchange is processed and the customer has a difference to pay.", {
    required: true,
    own: ["return_number"],
    why: "It asks for a payment the customer agreed to (Consumer Rights Directive Art. 22): the customer needs it to pay, and to know that the return is otherwise refunded as usual.",
  }),
  def("return.exchanged", "returns", "Exchange done", "When an exchange is settled: the new order is made and paid.", {
    required: true,
    own: ["return_number", "refund_amount"],
    why: "It records how the return's money was used instead of a refund to the original payment (Consumer Rights Directive Art. 13(1)), on a durable medium.",
  }),
  def("return.exchange_lapsed", "returns", "Exchange did not go through", "When a confirmed exchange expires unpaid or is cancelled, and the return is refunded as usual.", {
    own: ["return_number"],
  }),
  def("return.label_ready", "returns", "Return label ready", "When a return label is booked with the store's carrier.", {
    own: ["return_number", "carrier", "tracking_number"],
  }),
];

export type NotificationId = (typeof NOTIFICATIONS)[number]["id"];

export const NOTIFICATION_IDS: readonly string[] = NOTIFICATIONS.map((n) => n.id);
/** Required: always sent, never stored off. */
export const REQUIRED_NOTIFICATIONS: readonly string[] = NOTIFICATIONS.filter((n) => n.required).map((n) => n.id);
/** Locked: required and not editable; no template can exist for them. */
export const LOCKED_NOTIFICATIONS: readonly string[] = NOTIFICATIONS.filter((n) => !n.editable).map((n) => n.id);
/** The notifications a template can be written for. */
export const EDITABLE_NOTIFICATIONS: readonly string[] = NOTIFICATIONS.filter((n) => n.editable).map((n) => n.id);
/** The ones with a switch on the page. */
export const SWITCHABLE_NOTIFICATIONS: readonly string[] = NOTIFICATIONS.filter((n) => !n.required).map((n) => n.id);

const BY_ID = new Map(NOTIFICATIONS.map((n) => [n.id, n]));

export const isNotificationId = (value: unknown): value is string => typeof value === "string" && BY_ID.has(value);
export const notificationOf = (id: string): NotificationDef | null => BY_ID.get(id) ?? null;
export const isRequiredNotification = (id: string): boolean => BY_ID.get(id)?.required ?? false;
export const isEditableNotification = (id: string): boolean => BY_ID.get(id)?.editable ?? false;

/**
 * Whether a notification is on, from what the store saved (`undefined`: nothing saved, `null`: the read failed). A required one is always on; a
 * read that failed counts as on (2.11: an email too many is better than a confirmation never sent); otherwise the saved value or the default.
 * An id outside the catalogue is on (it is not a notification, so nothing switches it).
 */
export function notificationEnabled(id: string, saved: boolean | null | undefined): boolean {
  const n = BY_ID.get(id);
  if (!n || n.required) return true;
  if (saved === null) return true;
  return saved ?? n.defaultOn;
}

/** The editor's address segment for an id (`order.sent` ↔ `order-sent`); ids hold no `-`, so it goes back exactly. */
export const notificationPath = (id: string): string => id.replace(/\./g, "-");
/** The id of an address segment, or null when it names none. */
export function notificationFromPath(segment: string): string | null {
  const id = segment.replace(/-/g, ".");
  return BY_ID.has(id) ? id : null;
}
