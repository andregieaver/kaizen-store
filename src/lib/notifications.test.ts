import { describe, expect, it } from "vitest";

import {
  COMMON_PLACEHOLDERS,
  EDITABLE_NOTIFICATIONS,
  LOCKED_NOTIFICATIONS,
  NOTIFICATIONS,
  NOTIFICATION_IDS,
  PLACEHOLDER_NAMES,
  REQUIRED_NOTIFICATIONS,
  SWITCHABLE_NOTIFICATIONS,
  isNotificationId,
  notificationEnabled,
  notificationFromPath,
  notificationOf,
  notificationPath,
} from "./notifications";
import { EMAIL_KINDS, emailClassOf } from "./personal-data";

describe("the notification catalogue (docs/wave-3-notifications.md 4.1)", () => {
  it("lists exactly the order and return emails of the spec, in the page's order", () => {
    expect(NOTIFICATION_IDS).toEqual([
      "order.confirmation",
      "subscription.renewed",
      "order.changed",
      "order.sent",
      "order.parcel_out_for_delivery",
      "order.parcel_delivered",
      "order.refunded",
      "order.cancelled",
      "order.payment_due",
      "order.payment_overdue",
      "order.ready_for_pickup",
      "order.out_for_delivery",
      "return.acknowledgement",
      "return.approved",
      "return.declined",
      "return.received",
      "return.refunded",
      "return.exchange_proposed",
      "return.exchange_to_pay",
      "return.exchanged",
      "return.exchange_lapsed",
      "return.label_ready",
    ]);
  });

  it("pins the required, locked and default-off sets", () => {
    expect(REQUIRED_NOTIFICATIONS).toEqual([
      "order.confirmation",
      "subscription.renewed",
      "order.changed",
      "return.acknowledgement",
      "return.approved",
      "return.declined",
      "return.exchange_to_pay",
      "return.exchanged",
    ]);
    expect(LOCKED_NOTIFICATIONS).toEqual(["return.acknowledgement"]);
    expect(NOTIFICATIONS.filter((n) => !n.defaultOn).map((n) => n.id)).toEqual(["order.parcel_out_for_delivery", "order.parcel_delivered"]);
    expect(EDITABLE_NOTIFICATIONS).not.toContain("return.acknowledgement");
    expect(EDITABLE_NOTIFICATIONS).toHaveLength(NOTIFICATIONS.length - 1);
    expect(SWITCHABLE_NOTIFICATIONS).toHaveLength(NOTIFICATIONS.length - REQUIRED_NOTIFICATIONS.length);
    for (const id of REQUIRED_NOTIFICATIONS) {
      expect(notificationOf(id)?.why, id).toBeTruthy();
      expect(notificationOf(id)?.defaultOn, id).toBe(true);
    }
  });

  it("names an email kind that EMAIL_KINDS classifies as a shopper's (or evidence) for every id", () => {
    for (const id of NOTIFICATION_IDS) {
      expect([id, id in EMAIL_KINDS]).toEqual([id, true]);
      expect([id, emailClassOf(id)]).toEqual([id, id === "return.acknowledgement" ? "evidence" : "shopper"]);
    }
  });

  it("classifies the new staff kinds as staff", () => {
    for (const kind of ["notification.test", "staff.new_order", "staff.return_requested", "staff.summary", "staff.test", "automation.notify"]) {
      expect([kind, EMAIL_KINDS[kind]]).toEqual([kind, "staff"]);
    }
  });

  it("gives every notification the common placeholders first and only known ones", () => {
    for (const n of NOTIFICATIONS) {
      expect(n.placeholders.slice(0, 3)).toEqual([...COMMON_PLACEHOLDERS]);
      for (const p of n.placeholders) expect(PLACEHOLDER_NAMES).toContain(p);
      expect(new Set(n.placeholders).size).toBe(n.placeholders.length);
    }
    expect(notificationOf("order.confirmation")?.placeholders).toContain("order_total");
    expect(notificationOf("order.sent")?.placeholders).toEqual(expect.arrayContaining(["carrier", "tracking_number"]));
    expect(notificationOf("order.refunded")?.placeholders).toContain("refund_amount");
    expect(notificationOf("order.ready_for_pickup")?.placeholders).toContain("pickup_place");
    expect(notificationOf("order.changed")?.placeholders).toContain("change_number");
    expect(notificationOf("return.received")?.placeholders).toContain("return_number");
    expect(notificationOf("order.cancelled")?.placeholders).toEqual([...COMMON_PLACEHOLDERS]);
  });

  it("is on by default, off when saved off, and always on when required or when the read failed", () => {
    expect(notificationEnabled("order.sent", undefined)).toBe(true);
    expect(notificationEnabled("order.sent", false)).toBe(false);
    expect(notificationEnabled("order.sent", null)).toBe(true);
    expect(notificationEnabled("order.parcel_delivered", undefined)).toBe(false);
    expect(notificationEnabled("order.parcel_delivered", true)).toBe(true);
    expect(notificationEnabled("order.confirmation", false)).toBe(true);
    expect(notificationEnabled("return.acknowledgement", false)).toBe(true);
    // Not a notification: nothing switches it.
    expect(notificationEnabled("draft.pay_link", false)).toBe(true);
  });

  it("goes to and from the editor's address", () => {
    for (const id of NOTIFICATION_IDS) {
      expect(notificationPath(id)).not.toContain(".");
      expect(notificationFromPath(notificationPath(id))).toBe(id);
    }
    expect(notificationPath("order.parcel_out_for_delivery")).toBe("order-parcel_out_for_delivery");
    expect(notificationFromPath("order-unknown")).toBeNull();
    expect(notificationFromPath("account-code")).toBeNull();
    expect(isNotificationId("order.sent")).toBe(true);
    expect(isNotificationId("draft.pay_link")).toBe(false);
    expect(isNotificationId(3)).toBe(false);
  });
});
