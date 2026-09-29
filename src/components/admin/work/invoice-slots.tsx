/**
 * PLACES FOR THE INVOICE SCREENS. The client and assignment pages render these
 * three components where invoices belong, without knowing what is behind them.
 * They are the invoice screens' own panels (`invoice-panels.tsx`), so a change
 * to what the client or assignment page shows about invoices is made there and
 * these names and props stay:
 *
 *  - `ClientInvoicesSlot`: the client page's "Invoices" section (its invoices
 *    with status, total and due date, void and credited ones included).
 *  - `AssignmentInvoicesSlot`: the assignment page's "Invoices" section (the
 *    draft that time goes on, and the invoices that bill it).
 *  - `BillUnbilledTimeSlot`: the "Bill unbilled time" action, on both pages
 *    (`scope` says which). Draws nothing when there is no unbilled time.
 */

import {
  AssignmentInvoicesPanel,
  BillUnbilledPanel,
  ClientInvoicesPanel,
  type AssignmentInvoicesPanelProps,
  type BillUnbilledPanelProps,
  type ClientInvoicesPanelProps,
} from "./invoice-panels";

export type ClientInvoicesSlotProps = ClientInvoicesPanelProps;
export type AssignmentInvoicesSlotProps = AssignmentInvoicesPanelProps;
export type BillUnbilledTimeSlotProps = BillUnbilledPanelProps;

export const ClientInvoicesSlot = ClientInvoicesPanel;
export const AssignmentInvoicesSlot = AssignmentInvoicesPanel;
export const BillUnbilledTimeSlot = BillUnbilledPanel;
