# Kaizena Flow and the EU AI Act

Where Kaizena Flow's uses of AI stand under the AI Act (Regulation (EU) 2024/1689), as amended by the Digital Omnibus on AI
(Regulation (EU) 2026/1744, in force 27 July 2026). Written 30 October 2026 (PSI REG-08). This is a working classification, not legal
advice: the owner's lawyer is to confirm it, as for the DPIA (`docs/dpia-ai.md`).

## Roles

Kaizena Flow builds AI systems on general-purpose models from outside (OpenAI and others, `src/server/ai.ts`) and offers them under its
own name: for those systems it is the **provider** (Art. 3(3)). A store that switches one on for its shoppers is its **deployer**
(Art. 3(4)). Kaizena Flow does not train or place a general-purpose model on the market, so Chapter V (GPAI models) is the model
makers', not ours.

## The uses, and what applies

| Use | Who meets it | Class | What applies, and where it stands |
|---|---|---|---|
| The shop chat assistant (D81) | Shoppers | Limited risk: interacts with people | Art. 50(1): people are told they are talking to an AI. Done: the chat's notice ("an AI assistant", a person on request) and the disclaimer under answers (`messages/*.ts`). |
| AI answers by email on the support desk (D332, D334) | Shoppers | Limited risk | Art. 50(1): each AI answer is labelled ("Answer by AI:", `support-email-text.ts`). Done. |
| Tone of support messages (D216 step 6) | Shoppers, indirectly | Not emotion recognition in the Act's sense: Art. 3(39) needs biometric data, and this reads text | No Art. 5 or high-risk duty. The chat's notice and, since 30 October 2026, the store's privacy starter say it while it is on; a sensitive-information store has it off (REG-11). |
| Conversation summaries (D216 step 7) | Staff | Minimal risk | Said to shoppers in the notice and the privacy starter while on. |
| The AI manager and the autopilot (D94, D309) | Owners and staff | Minimal risk: not in Annex III (no employment, credit, essential-service or similar decision about a person) | Art. 4 (AI literacy) for Kaizena Flow's own people. Changes that matter wait for a person's yes (gated tools, approval expiry). |
| Product texts, translations, alt texts, legal page drafts (D76, D311) | Shoppers read the result | Minimal risk; text not published "to inform the public on matters of public interest", and a person publishes it | Art. 50(4) does not reach it. Legal drafts carry their review notice. |
| Sorting notices of illegal content and checking listings (D411 part 2, `docs/dsa.md`) | Platform admins; senders and stores read decisions | Minimal risk: an aid to a person who decides, not in Annex III; not a decision about a natural person's access to a service | None beyond Art. 4. The DSA asks the emails to say automated means were used (its arts. 16(6) and 17(3)(c)): they do, whenever `ai_used`. |
| Pictures made or edited by AI (D283, D349) | Shoppers see them | Limited risk: synthetic images | Art. 50(2): AI-generated images marked in a machine-readable way. Done 30 October 2026 for every picture made or changed from then on: both stored files carry IPTC's `DigitalSourceType` in their XMP (`trainedAlgorithmicMedia`, or `compositeWithTrainedAlgorithmicMedia` for an edited one; `shrinkPicture()`, `src/server/ai-pictures.ts`), and the site serves the files as stored. Staff also see `media.made_by`. Pictures made before that are marked by the `aiPictureMarks` job (see below). |

No use is a prohibited practice (Art. 5), and none is high-risk (Art. 6 and Annexes I and III), so the delayed high-risk dates
(2 December 2027 and 2 August 2028 after the omnibus) do not bind Kaizena Flow today.

## Dates that matter

- 2 February 2025: Art. 4 (AI literacy) and Art. 5 (prohibitions) apply.
- 2 August 2026: Art. 50 (transparency) applies; the omnibus did not move it.
- 2 December 2026: end of the Art. 50(2) grace period for generative systems already on the market.

## Left to do

1. ~~Pictures made by AI before 30 October 2026 carry no marking.~~ Done 31 October 2026: the five-minute dispatcher's `aiPictureMarks`
   job (`src/server/ai-picture-marks.ts`) gives each of them, ten a run, the same `DigitalSourceType` XMP in both files, written into the
   WebP container without re-encoding (`withWebpXmp()`, `src/lib/webp-xmp.ts`: the picture's bytes are untouched, the tests compare every
   pixel) and back at its own path, so no page's address changes; `media.ai_marked_at` records it (migration `media_ai_marked`), and new
   pictures are recorded as marked when they are made. Production held 190 such pictures (all `ai_made`, 17 to 30 October), about 95
   minutes of runs. Storage's CDN refreshes an overwritten file within about a minute (Supabase Smart CDN, Pro plan and above); a browser
   that cached the old copy keeps it until its cache ends, which can be a year for library pictures.
2. A short AI-literacy note for Kaizena Flow's own staff (Art. 4).
3. The lawyer's confirmation of this classification, with the DPIA.

Sources: the Regulation on EUR-Lex (2024/1689) and the omnibus (2026/1744); summaries of the omnibus's dates by
[Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/),
[Cooley](https://cdp.cooley.com/digital-ai-omnibus-delays-key-deadlines-introduces-new-rules/) and
[ActuIA](https://www.actuia.com/en/news/ai-act-obligations-in-force-and-delays-under-omnibus-2026-1744/), read 30 October 2026. The
article numbers and the grace period are to be checked against the Official Journal text before they are relied on.
