/**
 * Kaizena Flow's own site in the Autopilot (ecosystem plan E5.3, D757), in English: its sign-ups per visit as a goal on the Goals tab of
 * Kaizena Flow's own Autopilot and its store's, and the line on Kaizena Flow's own Settings that leads to its site's store, whose autopilot
 * tests the site's pages. `{name}`-style placeholders are filled by `fillWords()`. Only the server reads them (`SERVER_AREAS`): the Autopilot
 * page draws them, so they are not handed to the browser with the assistant's words.
 */
export const houseAutopilotEn = {
  signups: {
    title: "More sign-ups to Kaizena Flow",
    now: "Now {percent} of visits to the site end in a sign-up, over the last 30 days.",
    notCounted: {
      not_house: "Only Kaizena Flow's own store counts sign-ups.",
      not_counting: "Not counted yet: Kaizena Flow's store does not count visits. Switch it on in the store's Settings → Analytics.",
      no_visits: "Not counted yet: no visits to the site were counted in the last 30 days.",
    },
    aim: "Aim for this share of visits signing up (%)",
    help: "The autopilot plans toward it, and tests its changes to the site's pages on sign-ups where enough people visit them.",
    set: "Set this goal",
    setNow: "The goal is set.",
    invalid: "Give a share of visits between 0.1 and 100 %.",
    goalTitle: "More sign-ups to Kaizena Flow",
  },
  /** On Kaizena Flow's own Settings, where a store has *Test my page changes first*: its site is its own store's (D484). */
  siteTests: {
    title: "Test my page changes first when there is enough traffic",
    help: "Kaizena Flow's site is served by its own store, and that store's autopilot tests its changes to the site's pages on sign-ups, never on orders, and only once page speed has been watched too. The switch is in that store's autopilot.",
    open: "Open its settings",
  },
};

export type HouseAutopilotMessages = typeof houseAutopilotEn;
