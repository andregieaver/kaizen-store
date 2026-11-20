/**
 * The staff alerts' names, in English (bloat review step 2.50): beside `staff-alerts.ts`, which re-exports them, so the admin's `notifications`
 * catalogue, the alerts' emails and the settings' actions read one text and the catalogue imports no code. Imports nothing but types.
 */
import type { StaffAlertEvent } from "./staff-alerts";

/** The columns of the staff alerts page. */
export const ALERT_LABELS: Record<StaffAlertEvent, string> = {
  new_order: "New order",
  return_requested: "Return requested",
  refund_overdue: "Refund overdue",
  low_stock: "Low stock",
  summary: "Briefing",
  automation: "Automation",
  dispute: "Dispute",
  payment_overdue: "Payment overdue",
  analytics: "Analytics alerts",
  accounting: "Accounting",
};
