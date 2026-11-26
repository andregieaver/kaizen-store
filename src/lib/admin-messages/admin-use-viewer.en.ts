/**
 * The words of Platform → Admin use (D895 phase 3b): how store owners who said yes use the admin. Their own area, so only its pages and
 * the Incidents page read them.
 */
export const adminUseViewerEn = {
  title: "Admin use",
  description:
    "Where store owners who said yes find the admin hard: each screen's last 30 days, and recordings with every word hidden.",
  link: "See where owners struggle",
  notOpen: "Nothing is collected until the switch on Incidents is open.",
  screens: "Where owners struggle",
  screensSub:
    "Each screen over the last 30 days, the hardest first. A share needs 20 views.",
  screensNone: "No screen views yet.",
  views: "{n} views",
  frustrated:
    "{pct} % of views had a click that did nothing or a burst of clicks",
  end: "{pct} % scrolled to the end",
  clicks: "{dead} dead and {rage} rage clicks",
  tooFew: "Too few views to say",
  recordings: "Recordings",
  recordingsSub:
    "Kept 30 days, most frustrated first. Every viewing is written to the activity log.",
  recordingsNone: "No recordings yet.",
  ages: {
    week: "store in its first week",
    month: "store in its first month",
    older: "older store",
  },
  title1: "A recording {when}",
  back: "Admin use",
  home: "Store home",
  accountHome: "Admin home",
  detail: "one item",
};

export type AdminUseViewerMessages = typeof adminUseViewerEn;
