# The theme showcase plan

Shopify's theme pages work like shop windows: a live store in a frame, ready-made **presets** for different trades, designed highlight
pictures and proof from real stores. On 16 October 2026 our theme store showed a colour swatch and a preview of the same demo store for every
theme. This plan closes that gap in six phases and ends with an AI studio that makes a complete theme from one sentence. The audit, with
screenshots of Voltix, Concept and Broadcast beside ours, is the artifact *Closing the theme store gap* (16 October 2026); this file is the
plan as agreed.

**The gap is in what a theme holds, not only in the page.** A Kaizena Flow theme holds a look (settings, three optional layouts, CSS). A
Shopify theme ships with presets, and each preset is a complete demo store with its own pictures, words and products. Once a theme carries
that, a great theme page mostly follows.

## Decisions (16 October 2026, the owner: "Go with your recommendations")

1. **Presets.** The interface calls them *Presets*. In code they are **variations** (`design_variations`, `snapshot.variations`), because
   "design presets" already means themes there.
2. **Demo pictures** are made by AI for the content packs, and any picture can be replaced.
3. **A new store that starts with a theme gets the preset's demo content** (home page and products), marked Demo and removable in one press.
4. **Reviews and live stores** come in phase 6, after the studio.
5. **The AI theme studio** is for platform admins first, store owners one step later.
6. **The first content packs**: fashion, beauty, food and drink, home, electronics, services.

## Before phase 1: quick fixes (D255, built)

The admin banner off the public preview, no Private / Business switch in previews, the demo template's front page cleaned, the themes before
one bar of filters, and a photograph of each launch theme on its card.

## The phases

Each phase ships in steps that each go to production. Phases 4 and 5 can overlap.

| Phase | Builds | Homer | Lisa |
|---|---|---|---|
| **1. Presets and showcases** (`docs/theme-showcase-phase-1.md`) | A theme gets 1 to 6 presets: named designs over the theme (colours, fonts, buttons, section styles). Each preset is shown on a **content pack**: a clean demo store for one trade (home page from the theme's sections, demo products with pictures, a collection, an about page, menus). The launch themes get 2 to 4 presets each. A new store that starts from a preset gets its demo content; an existing store can take a preset's home page, with undo. Installing never changes a store's words. | picks a preset for his trade and sees his kind of store | writes her own showcase, adds presets, edits each one |
| **2. Pictures made automatically** | Each publish photographs every preset's showcase: full-length computer and phone shots, card crops and share images. Three highlight pictures composed from the shots (a device trio, a page collage, a close-up); words by a person or suggested by AI through the claims filter. Later, short silent loops of a page scrolling. | never uploads a picture to list a theme | swaps any made picture for her own |
| **3. The new theme store** | A theme page with a dark stage, a Computer and Phone switch, hover scrolling the full-length shot, *Live demo* in the frame with full screen, a bar pinned to the bottom (name, Free, presets, both buttons); presets in a fanned stack, each with its own address; *What's included* in fixed groups, first *Every Kaizena Flow theme includes* (VAT per country, withdrawal and returns, unit prices, languages and currencies, AI search and chat, bookings), then what the theme adds; versions, designer, *More themes for this trade*. A list of screenshot cards with a phone beside them and preset dots, rows by trade. | sees stores, picks one, presses Start | compares features line by line, reads the versions |
| **4. Wider design range** | Header designs (a rotating announcement bar, a centred logo with split menus, two rows of menus, a see-through header over the hero), hero designs (a split hero with a thumbnail strip, a full-bleed slideshow, a framed hero, a video hero, an editorial grid), a bigger type scale per preset, and the missing sections (image hotspots, a before-and-after slider, a countdown, lookbooks) in order of use. | more distinct choices, still one click each | mixes header, hero and type per preset |
| **5. AI theme studio** | A sentence becomes a theme, three presets, a showcase for each with words and pictures, highlights and a listing, saved as a draft for a person to review. For owners a private theme previewed with their own products and logo; for platform admins themes for the theme store. | describes his store in one sentence and picks one of three | regenerates any part, locks the rest, edits every setting |
| **6. Proof and trust** | Reviews from owners who used a theme (moderated), stores using it (only by their owners' choice, while live), a designer page once themes come from others. | | checks reviews, versions and support |

## The AI theme studio's guardrails (phase 5)

As for our other AI: the model proposes and chooses from catalogues, code builds, measures and checks, a person decides. The model never
writes CSS, page structure or links of its own; colours are built by code from its direction and corrected for contrast (4.5:1) in light and
dark; every word passes `findClaims()`; pictures carry no text or logos; every run is metered under its own feature with the cost shown and a
picture budget; it uses the store's own AI settings, else Kaizena Flow's; without a model a rule-based theme still comes out (one colour and a
font pair); it always ends as a draft.
