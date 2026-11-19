/** The customer groups of the RFM analysis (D152), a leaf so a client part names them without the analytics' number words. */
export const RFM_SEGMENTS = ["VIP", "Loyal", "Promising", "New", "At risk", "Lost"] as const;
export type RfmSegment = (typeof RFM_SEGMENTS)[number];
