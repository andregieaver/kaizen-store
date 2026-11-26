/**
 * The words of heatmaps and recordings of how owners use the admin (D895 phase 3b): the ask a store owner sees once, the section in their
 * account settings, and the platform owner's switch. Server-only: the pages post plain forms.
 */
export const adminUseEn = {
  ask: {
    title: "Help us make the admin easier",
    lead: "May we see, without knowing who you are, where the admin is hard to use? Only your own use, never your staff's.",
    heatmaps: "Heatmaps: where you click and scroll, counted as totals per screen.",
    recordings: "Recordings: how you move through some screens, with every word hidden.",
    collected: "We collect clicks, scrolling and pauses on the admin's screens. All text and everything you type is hidden.",
    excluded: "Orders, customers, messages, documents and invoices are never recorded, and we never see your shoppers' data.",
    kept: "Recordings are kept 30 days, then deleted. Heatmap totals hold no person and are kept 13 months.",
    access: "Only Kaizena Flow's own team can watch recordings, and each viewing is logged. Your store and your staff never see them.",
    basis: "Basis: your consent (GDPR Article 6(1)(a)). Saying no changes nothing in what you can do.",
    rights: "You can change or withdraw your choice at any time under Account settings, and ask us for access to or deletion of your data.",
    notice: "Read the privacy notice",
    allowHeat: "Allow heatmaps",
    allowRec: "Also allow recordings",
    save: "Save my choice",
    no: "No thanks",
    saved: "Saved. You can change it at any time under Account settings.",
  },
  account: {
    title: "How you use the admin",
    on: "You allow: {what}.",
    off: "You have not allowed anything.",
    heatmaps: "heatmaps",
    recordings: "recordings",
    change: "Change",
  },
  platform: {
    title: "Learning from how owners use the admin",
    locked: "Locked until a lawyer with the Legal role has answered every question of the assessment.",
    missing: "Not yet answered: {list}.",
    review: "Open the legal review",
    ready: "Every question is answered. Opening asks each store owner once; nothing is collected from anyone who has not said yes.",
    signed: "I have accepted and signed the assessment (docs/dpia-admin-use.md)",
    open: "Open",
    isOpen: "Open since {at}. Store owners are asked once.",
    close: "Close",
    opened: "Opened.",
    closed: "Closed. Nothing more is collected.",
    problems: { locked: "Every question must be answered by a lawyer first.", signed: "Confirm the assessment is signed first." },
  },
};

export type AdminUseMessages = typeof adminUseEn;
