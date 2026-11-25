# Data protection impact assessment: heatmaps and recordings of how store owners use the admin (draft)

GDPR Article 35. D895, phase 3 of `docs/audits/incident-autopilot-2026-11.md` (section 8). Written 25 November 2026, **before anything is
built**: it describes what step IA-15 will build, so the owner and a lawyer can decide before it runs. Nothing of it records anyone until
the owner has accepted this assessment, written the privacy notice's paragraph and had the lawyer's answers (section 8), and then opened
it under Platform → Settings (a switch that stays off until then).

> **Draft for the owner and a lawyer.** It describes what the code is to do and lists risks and measures; it does not conclude that any
> processing is lawful. Its proposals are in section 7; the questions for the lawyer are in section 9 and under Legal reviews.

Related: `docs/dpia-recordings.md` (the signed assessment for visitors' recordings and heatmaps on stores and kaizenaflow.com, D656, whose
measures this reuses), `docs/heatmaps-and-recordings.md`, `src/lib/personal-data.ts`.

---

## 1. What and why

Kaizena Flow's platform AI is to read **how store owners and their staff use the admin** (where they get stuck, which flows they leave
half done) and propose improvements to Kaizena Flow's owner, who approves or dismisses each. It uses the heatmaps and recordings machinery
of D656, run on the admin instead of a store's pages.

This is a **different processing** from D656's:

| | D656 (signed 18 November 2026) | This assessment |
|---|---|---|
| Whose pages | A store's own pages, and kaizenaflow.com | The admin (`/admin/…`), where owners and staff work |
| Who is recorded | Visitors and shoppers | Store owners and staff (Kaizena Flow's customers and their people) |
| Controller | The store (Kaizena Flow its processor); Kaizena Flow for its own site | **Kaizena Flow** |
| Purpose | The store finds what is hard on its pages | Kaizena Flow finds what is hard in its admin and improves the product |

D656's rule stands unchanged: **Kaizena Flow never reads a store's visitor recordings** for itself.

## 2. What would be processed

**Admin recordings** (rrweb, as D656): the admin page's shape as drawn, pointer and scroll movement, clicks and taps, dead and rage clicks,
errors shown, and where a flow was left. With these measures beyond D656's:

- **All text masked**, not optional (D656's *Hide all text*): every text node is drawn as dots; every field is masked to nothing, not even
  its length.
- **Screens never recorded** (blocked outright, the recorder pauses before they are drawn): orders, customers, the inbox and chat,
  messages and campaigns, documents and invoices, the recordings player, the AI manager's conversation, anything marked
  `data-kz-private`, and every page whose address is not on an allow-list of admin screen keys.
- **No identity**: a random id per tab, joined to no account, store, IP or other id. Each recording keeps only the plan's name, the
  store's age band (first week, first month, older) and the screen key.
- **Sampled** (a share of tabs, set by the owner), **30 days**, then deleted with every file. Kaizena Flow's admins may watch them
  (Platform → Analytics → Admin use); each viewing is written to the activity log first, as D656's are.
- Stored apart from stores' data, in their own tables and bucket, never in a store's export or copy.

**Admin heatmaps** (as D656's): daily totals per screen key and device class only (views, clicks per cell, reach, dead and rage clicks):
no visitor, no id, no address.

**Signals already held**, used as counts only: the AI manager's thumbs down per tool and screen, tool calls that failed, admin screens that
load slowly.

**What the platform AI is given**: weekly figures per screen worked out in code, and at most five recordings' event summaries (clicks and
pauses as text, all text already masked). Never a person, never a raw recording. Its answer is checked against the figures in code.

## 3. Choice

- **Asked first, off until yes.** Each admin user is asked once, with Heatmaps and Recordings as separate choices, and can change either at
  any time in their account settings. Nothing is collected before the choice, and a no is never asked again.
- The ask is plain: what is collected, that all text is hidden and the data screens are never recorded, 30 days, and that it is only for
  improving Kaizena Flow.
- **Proposed basis: consent** (ePrivacy Art. 5(3) and ekomloven § 3-15 for reading from the device, which apply to business users too; GDPR
  Art. 6(1)(a) for the recordings). Legitimate interest is not proposed for the reading itself.

## 4. Risks

| Risk to people | Likelihood before measures | Measures | Left |
|---|---|---|---|
| A shopper's personal data in an admin recording (the admin shows orders, customers, addresses) | High | All text masked; the data screens blocked; the allow-list of screens; fields masked to nothing | Low; a store's own content shown as text on an allowed screen is dots. Lawyer question 1 |
| Kaizena Flow becoming joint controller of a store's shopper data | Medium | The measures above keep shopper data out; never a store's visitor recordings | Low, if question 1 is answered yes |
| A recording tied to a store owner or staff member | Medium | Random id per tab; no account, store or IP; only plan, age band and screen key | Low; a small store's plan and age band together could narrow it. Lawyer question 4 |
| Store staff recorded without a real choice (an employer's pressure) | Low to medium | The choice is each person's own, asked of them, not their employer; never asked again after a no; the store's owner cannot set it for them | Lawyer question 3 |
| Monitoring of workers | — | Kaizena Flow is not the staff member's employer; the data is never shown to the store or its owner | Lawyer question 3 |
| Kaizena Flow's admins watching a known person | Low | No identity in a recording; each viewing logged; 30 days | Low |
| Recording before this is settled | — | The switch stays off until section 8 is done | — |

## 5. Necessity and proportionality

Totals (heatmaps and the counts already held) show *where* owners struggle; a few masked recordings show *what they tried*, which totals
cannot. Recordings are sampled, masked further than D656's, kept 30 days and a separate choice, so a person can give heatmaps and refuse
recordings.

## 6. The privacy notice

Kaizena Flow's privacy notice needs a paragraph. Legal texts are the owner's (never written by a model into
`src/lib/platform-legal/*`), so this is a proposal for the owner to adapt:

> **How you use the admin.** If you say yes when asked, we collect how the admin is used so we can make it easier: where people click and
> scroll, as totals per screen (heatmaps), and, if you also allow it, recordings of how you moved through some screens. All text is
> hidden in recordings, and screens with orders, customers, messages and documents are never recorded. Recordings carry no name, account
> or store, are kept 30 days and are used only to improve Kaizena Flow. You can change your choice at any time under Account settings.

## 7. Proposed conclusions (draft)

None of these is a decision. For the owner, with a lawyer:

1. Accept this assessment, or change it.
2. Add the privacy notice's paragraph (section 6, in the owner's words).
3. Get the lawyer's answers to section 9 (under Platform → Legal reviews).
4. Only then open admin heatmaps and recordings (Platform → Settings), and review this assessment when what is recorded changes, and
   yearly.

## 8. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Owner of Kaizena Flow | | | |
| Lawyer | | | |
| Data protection officer (required, in the lawyer's view of 18 November 2026) | [[Add: once appointed]] | | |

## 9. Questions for the lawyer

1. **Shopper data kept out.** Are all text masked, the data screens blocked and an allow-list of screens enough that admin recordings hold
   no shopper personal data, so Kaizena Flow stays only the stores' processor for that data?
2. **Consent from business users.** Is a choice asked of each admin user, separately for heatmaps and recordings, a valid consent under
   ePrivacy Art. 5(3) and ekomloven § 3-15 for people using a business tool?
3. **Store staff.** Is a staff member's own choice enough when the store (their employer) uses Kaizena Flow, given that Kaizena Flow is
   not their employer and nothing is shown to the store? Does it touch rules on monitoring of workers?
4. **Identifiability.** Is a recording with only the plan, the store's age band and the screen key personal data in practice (a small
   store could be narrowed), and if so, is the processing described here proportionate?
5. **Retention.** Is 30 days right for recordings, and is keeping daily heatmap totals without a limit right (they hold no person)?
6. **The notice.** Is section 6's paragraph enough, and where must it appear (the privacy notice alone, or also at the ask)?
7. **This assessment.** Is an assessment required for this processing, and does it need anything more before it runs?
