import type { Widen } from "./common.en";

/**
 * The platform console's own screens (D469 to D471, `docs/platform-parity-plan.md`): Kaizena Flow's site copied into its own store, the
 * analytics of its plans and its team. Only server pages read them, so they are a server-only area (`SERVER_AREAS` in `admin-text.ts`), out
 * of every admin screen's first scripts. `{name}` placeholders are filled by `fillWords()`; a count is a `{ one, many }` pair read by
 * `countWords()`.
 */
export const consoleEn = {
  houseSite: {
    title: "Kaizena Flow's site in its own store",
    description:
      "The site moves into Kaizena Flow's own store, where it gets everything a store's site has. Copy it there to look at it beside the live site: the live site does not change, and copying again brings the latest.",
    never: "The site has not been copied yet.",
    last: {
      one: "Last copied {when}: one page, menu or part.",
      many: "Last copied {when}: {n} pages, menus and parts.",
    },
    look: "Look at it in the store",
    first: "Copy the site",
    again: "Copy it again",
    copied:
      "Copied: {pages} pages, headers and footers, with their menus, parts and look.",
    noStore: "Kaizena Flow's own store does not exist yet.",
    failed: "The site could not be copied. Nothing was changed; try again.",
  },
  planAnalytics: {
    title: "Plan analytics",
    description:
      "What the stores' plans earn every month, how that moved, and how many who ask for a store end up paying.",
    period: "Period",
    days: "{n} days",
    live: "Live payments",
    mrr: "Every month",
    mrrSub:
      "What running plans bring in a month; a yearly plan counts as a twelfth.",
    paying: "Stores paying",
    late: "{n} late with a payment",
    trialing: "On a free trial",
    cancelling: "Leaving",
    cancellingSub: "Plans that end at the end of their period.",
    funnelTitle: "From asking to paying, the last {n} days",
    funnelDescription: "The applications of the period, and how far each got.",
    asked: "Asked for a store",
    approved: "Approved",
    opened: "Opened their store",
    payingStep: "Paying for a plan",
    movesTitle: "How the monthly revenue moved, the last {n} days",
    movesSince: "Counted since {date}.",
    movesNone: "Counted from the first change of a plan.",
    noMoves: "No plan started, changed or ended in the period.",
    kinds: {
      started: "Started",
      upgraded: "Upgraded",
      downgraded: "Downgraded",
      cancelled: "Cancelled",
      paused: "Paused, unpaid",
      resumed: "Resumed",
    },
    byPlanTitle: "By plan",
    byPlanDescription:
      "The stores on each plan, paying or trying it, and what it brings in a month.",
    noPlans: "No store is on a plan yet.",
    stores: { one: "{n} store", many: "{n} stores" },
    test: "Test payments",
    testText:
      "Plans paid with Stripe's test cards: no real money, kept apart from the figures above.",
  },
  /** The platform's team (C1, D471), Platform → Settings → Team. */
  team: {
    title: "Team",
    description:
      "Who runs Kaizena Flow. Each signs in with two-step sign-in and is also an owner of Kaizena Flow's own store.",
    members: "Platform admins",
    membersText:
      "Everyone here can do everything on the platform. Roles that give less are coming.",
    you: "you",
    twoStepOn: "Two-step sign-in on",
    twoStepOff: "Two-step sign-in not set up yet: asked at the next sign-in",
    since: "Since {date}",
    remove: "Remove",
    addTitle: "Add a platform admin",
    addText:
      "Their account if they have one, else a new one: they sign in at Kaizena Flow's admin with this email and set up two-step sign-in.",
    email: "Email",
    name: "Name (if they have no account yet)",
    add: "Add",
    added: "{email} is a platform admin now.",
    removed: "{email} is no longer a platform admin.",
    signInAgain:
      "Sign in again first: adding a platform admin needs a sign-in in the last few minutes.",
    problems: {
      invalid: "Enter a valid email address.",
      disabled: "That account is disabled.",
      already: "That person is a platform admin already.",
      self: "You cannot remove yourself: ask another platform admin.",
      last: "The platform keeps at least one platform admin.",
      not_found: "That person is not a platform admin.",
    },
  },
};

export type ConsoleMessages = Widen<typeof consoleEn>;
