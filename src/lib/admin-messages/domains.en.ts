import type { Widen } from "./common.en";

/**
 * The words of the store's Domains page (D312, D313 `docs/language-domains.md`), converted as they were written: a language's own domain.
 * `{name}` is a language's name.
 */
export const domainsEn = {
  forOneLanguage: "Use for one language",
  language: "Language",
  everyLanguage: "Every language: leads to your address",
  languageOption: "{name}: your store in {name} here",
  activeInLanguage: "Active: your store in {name}",
  forLanguage: "For {name}",
  explain:
    "A language's own domain shows your store in that language without the language in its addresses. Each domain keeps its own cart, sign-in and cookie choices, as browsers keep them per site.",
  save: "Save",
  address: "Your store's address",
  leadsThere: "{host} leads there too",
  deploying: "Your domains changed. Kaizena Flow is putting the change live, which takes a few minutes; this page updates by itself.",
  useHost: "Use {host} as the address instead",
  ownDomains: "Your own domains",
  ownDomainsNote:
    "Use a domain you own, like butikk.example.no or example.no. Add it here, then create the DNS records shown at the company where you manage the domain's DNS. When they are in place, the domain becomes your store's address, with a certificate for https, and your other addresses lead there. Up to {max} domains.",
  notConfigured: "Custom domains are not set up on Kaizena Flow yet.",
  domain: "Domain",
  add: "Add domain",
  ownerOnly: "Only an owner can add domains.",
  yourAddress: "Your address",
  activeLeads: "Active: leads to your address",
  waitingDns: "Waiting for DNS",
  createRecords:
    "Create these records at your DNS provider, and remove other A, AAAA or CNAME records on the same name. Providers that add the domain themselves want only the first part of the name",
  like: ", like ",
  type: "Type",
  name: "Name",
  value: "Value",
  found: "Found",
  yes: "Yes",
  notYet: "Not yet",
  lastChecked: "Last checked {date}. ",
  checkedAgain: "Checked again each time you open this page; DNS changes can take up to a few hours to show.",
  checkNow: "Check now",
  makeAddress: "Make this the address",
  remove: "Remove",
  // D315: each domain's health (`domainHealth()`), in words. `{domain}`, `{date}`, `{days}`, `{registrar}`, `{count}`, `{problem}`.
  working: "Working",
  healthTitle: "Health",
  healthChecking: "Checked as you open this page.",
  health: {
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
  },
  severity: { error: "Needs you", warning: "Check", advice: "Tip", info: "Note" },
  registeredWith: "Registered with {registrar}",
  expiresOn: "Expires {date}",
  dnsHere: "DNS kept by Kaizena Flow",
  dnsElsewhere: "DNS kept elsewhere",
};

export type DomainsMessages = Widen<typeof domainsEn>;
