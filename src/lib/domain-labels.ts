/**
 * A domain's findings, the DNS changes' effects and the domain move's checklist in English (bloat review step 2.50): the AI manager's domain
 * tools and the holder's assistant say them with no language (`findingText()`, `effectText()`), so the `domains` catalogue takes these groups
 * from here and those tools bring no catalogue. Imports nothing.
 */

export const DOMAIN_HEALTH_EN = {
  points_away: "{domain} no longer reaches your store: when it was checked on {date}, it answered with another site or not at all. Check where its DNS points.",
  certificate_failing: "{domain}'s https certificate failed when it was checked on {date}, so visitors see a warning instead of your store.",
  not_pointed: "{domain} doesn't reach your store yet: its DNS doesn't point here.",
  proof_missing: "The record that shows {domain} is yours isn't there yet.",
  check_problem: "The last check couldn't finish: {problem}",
  expired: "{domain} expired on {date}. Renew it or it stops working for good.",
  expires_soon: "{domain} expires on {date}, in {days} days, and doesn't renew by itself.",
  contact_unverified: "Confirm the registrant's email for {domain}, or the registry stops the domain.",
  caa_blocks: "A CAA record on {domain} stops your store's https certificate.",
  spf_duplicate: "{domain} has {count} SPF records. Email checks fail unless there is one.",
  spf_missing: "Email from {domain} has no SPF record, so it may land in spam.",
  dmarc_missing: "Email from {domain} has no DMARC policy. Adding one helps it reach inboxes.",
  no_email: "No email is set up on {domain}.",
  lookup_failed: "Some of {domain}'s records couldn't be read just now.",
  healthy: "{domain} is working.",
};

export const DNS_EFFECTS_EN = {
  email_to: "Email for {domain} will go to {provider}.",
  email_stops: "Email for {domain} will stop arriving.",
  email_extra: "Email for {domain} will also reach {provider}.",
  website_points: "{host} will point to {target}.",
  subdomain_points: "{host} will show {target}.",
  verification: "Adds a record that proves {domain} to a service.",
  spf_set: "Says which servers may send email for {domain} (SPF).",
  spf_merged: "Joins the SPF records into one: {value}.",
  dkim_set: "Lets email from {domain} be signed (DKIM).",
  dmarc_set: "Sets the DMARC policy of {domain}.",
  removes: "Records removed: {count}.",
  adds: "Records added: {count}.",
};

export const DOMAIN_MOVE_EN = {
  open: "Move this domain",
  title: "Move {domain}",
  intro: "Choose what you want. Each step checks itself, so you know when the next one is safe.",
  back: "Domains",
  /** Round 60 (D820): the page on a phone, each choice a row saying what it involves. */
  phone: {
    lead: "Choose what you want. Each step checks itself.",
    subs: {
      registrar: "The transfer code, then the new registrar takes it",
      dns: "Download the records, check them there, switch",
      elsewhere: "For another site or shop",
      leave: "Its DNS and its registration both move out",
    },
  },
  goals: {
    registrar: "Keep it working here, move the registration to another registrar",
    dns: "Move its DNS to another provider",
    elsewhere: "Use it somewhere else (the store stops using it)",
    leave: "Leave Kaizena Flow with my domain",
  },
  steps: {
    download: "Download the DNS records",
    check_new_dns: "Check the new DNS provider has them",
    switch_dns: "Switch the nameservers",
    transfer_code: "Get the transfer code",
    transfer_done: "The new registrar takes it over",
    disconnect: "Stop using it in the store",
  },
  states: { done: "Done", ready: "Ready", waiting: "Waiting", blocked: "Not yet", not_needed: "Not needed" },
  download: {
    intro: "Import the zone file at your new DNS provider, or copy the records from the spreadsheet. Records marked as kept for your store point the domain at Kaizena Flow: recreate them only if the store stays on it.",
    zone: "Zone file",
    csv: "Spreadsheet (CSV)",
  },
  dns: {
    intro: "Add the records at your new DNS provider first. Then give its nameservers here: Kaizena Flow asks them for every record, so you see what would stop working before anything changes.",
    nameservers: "The new provider's nameservers",
    nameserversHint: "One a line, as the provider shows them, like ns1.example-dns.com.",
    check: "Check the new provider",
    allThere: "The new provider answers every record. You can switch.",
    missing: "The new provider doesn't have these yet:",
    unanswered: "These questions got no answer: {list}. Check the provider is set up for the domain.",
    accept: "These records may go",
    switch: "Switch to the new nameservers",
    switchedRegistrar: "The nameservers are switched. It can take a few hours before everyone sees the new provider.",
    switchedWatched: "Public DNS shows the new nameservers. Kaizena Flow keeps the old records for 30 days.",
    elsewhereNote: "{domain} is registered elsewhere: set the nameservers there, then press Switch here to confirm.",
    leaving: "The DNS moved to {nameservers} on {date}. Kaizena Flow keeps the old records, read-only, until {until}.",
    switchBack: "Switch back",
    switchedBack: "Kaizena Flow's DNS answers for the domain again.",
  },
  transfer: {
    intro: "Start the transfer at the new registrar with this code. Your DNS stays here, so the store and email keep working while it moves.",
    notHere: "{domain} isn't registered through Kaizena Flow: its transfer code is at its own registrar.",
    email: "The registrar may send its approval to the registrant's email, {email}.",
    blockers: {
      locked: "{domain} can't move until {date}: registries lock a domain for 60 days after it is registered or moved.",
      renewal_under_way: "A renewal of {domain} is under way. Wait until it is done.",
      contact_unverified: "Confirm the registrant's email for {domain} first.",
      moved: "{domain} has moved to another registrar.",
      expired: "{domain} has expired. Renew it first, or ask the new registrar.",
    },
    advice: {
      expires_soon: "{domain} expires on {date}. Renew it first, or ask the new registrar whether the move can wait that close.",
      already_started: "You've started moving {domain}. Kaizena Flow checks every day whether the new registrar has taken it over.",
    },
    reveal: "Show the transfer code",
    signInAgain: "For your safety, sign in again before the code is shown.",
    signIn: "Sign in again",
    codeIs: "The transfer code",
    codeNote: "Shown only here, now. Kaizena Flow keeps no copy of it.",
    stay: "Stop the move",
    stayed: "{domain} stays registered here.",
    moved: "{domain} moved to another registrar on {date}. Renewal and charges stopped.",
  },
  disconnect: {
    intro: "The store stops using {domain}. The domain, its email and every other record stay as they are.",
    button: "Stop using it in the store",
    done: "The store no longer uses {domain}.",
    none: "The store doesn't use it.",
  },
};
