---
title: Build a theme and submit it
summary: What a Kaizena Flow theme is made of, how to build one in a store, the checks it must pass, how to try it, and how to send it to the theme store for review.
track: developers
section: themes
kind: how-to
areas: [themes, website]
features: []
plans: []
admin: /admin/{store}/settings/design/share
order: 10
checked: 2026-11-04
sources: [D344, D388, D246, D241, D242, D244, D245, D247, D248, D256, D286]
---

A Kaizena Flow theme is data, never code. It is settings, a header, a footer, a product page and CSS, which Kaizena Flow's own components
draw. A theme brings no template language, no server code and no JavaScript of its own, so there is no package to upload and no command-line
tool. You build a theme as a store's look, with the admin's own tools, and share that look for review. Once approved, it is in the theme
store for every store.

## What a theme is made of

When you share a look, Kaizena Flow takes a snapshot of it. The snapshot is the theme:

| Part | What it holds | Where you make it |
|---|---|---|
| `theme` | The settings: a base (Minimal, Warm classic or Bold modern) and every setting over it, listed below | [Design settings](/admin/{store}/settings/design), and the page builder's Theme tab |
| `header` | The store's header: its rows, its own CSS, whether it lies over the page (everywhere or on the front page only), and which of its menus is the header's or the footer's | [Headers](/admin/{store}/headers) |
| `footer` | The store's footer, kept the same way | [Footers](/admin/{store}/footers) |
| `productLayout` | The store's standard product page layout, kept the same way | [Product layouts](/admin/{store}/product-layouts) |
| `css` | The site's own CSS | The page builder's Custom CSS panel |

The header, footer and product page are taken as last published. One the store has not chosen, or not published, is left empty, and a store
that installs the theme gets the standard one.

The settings hold:

- **Colours.** The colour mode, whether visitors may switch between light and dark, and a light and a dark palette, each with `background`,
  `surface`, `text`, `muted`, `border`, `accent` and `accentText`.
- **Type.** The heading and body font families (Google Fonts, which Kaizena Flow serves itself), and the headings' weight and case.
- **Shapes.** Buttons' style and corners, the corners of cards and fields.
- **Layout.** The content's width, the logo's place and the header's background, product cards (picture shape, style, alignment), and the
  screen sizes the parts' rules are written for.
- **Elements.** What every row, heading (h1 to h6), paragraph, list and button of the store's pages looks like: typography, spacing, frame
  and, for rows, colour and content width.
- **Section styles**, below.
- **Also:** the saved colours and gradients the builder offers, hover timing and the buttons' hover, and the checkout's look.

### What a theme never holds

A snapshot reads the store's look only. It never takes the store's name, logos and icon, business details, search texts, menus and their
links, tracking, its own code, languages, pages, products or prices. A store that installs the theme keeps all of these, so switching theme
never changes its words, pictures, links or products.

When the look is taken:

- A menu in the header or footer is kept by its role: the installing store shows its own header or footer menu there. A menu that is
  neither shows no menu until the store chooses one.
- Custom field components are left out: they show one store's own fields.
- CSS that reaches into the store's own files is left out.
- A header that lies over pages of the store's own categories or tags is kept above the page instead.

### Section styles

A section style is a named set of elements for the rows that name it. A row names a style, never CSS, and is drawn with the style's
elements over the site's, its own settings winning over both. So the pages of any store follow the theme it switches to.

- Every theme has the six core styles: `plain`, `hero`, `feature`, `muted`, `contrast` and `quote`. A row that names a style the live theme
  does not have looks like its `plain`.
- A theme may add its own, named with lower-case letters, digits and hyphens, starting with a letter. A theme has at most 12 styles, the core
  ones included.
- Make them in the page builder's Theme tab, choosing which style's elements you edit.

A look without the core styles is given neutral ones in review, so it can pass the checks. Make your own, so the theme looks as you mean it
on every store's rows.

### Presets and content

- **Presets** are up to five named designs over a theme (colours, fonts, buttons, corners, product cards, elements and section styles each),
  sharing its header, footer, product page and CSS. A shared look arrives as one look, without presets. Presets are made on the theme's own
  page in Kaizena Flow's admin.
- **Content.** A theme is shown in the theme store on a store of its own content, and a new store started from the theme gets a copy of
  it. You may send your store's published pages as that content when you share the look. Without them, the theme store shows the theme's
  colours and no preview until Kaizena Flow gives the theme content.

## Build the look in a store

Use an open store where you may change the website: as its owner, as staff given that permission, or as a designer invited to it.

1. Set the colours, fonts, buttons, corners, layout and product cards in [Design settings](/admin/{store}/settings/design).
2. Set the elements and the section styles in the page builder's Theme tab.
3. Build the header, footer and product layout in the page builder, choose them for the store and publish them.
4. Add the site's CSS in the builder's Custom CSS panel, if the theme needs it. It is at most 50,000 characters, holds no `@import` and no
   `<`, and loads files only from the store's own site or as `data:` pictures and fonts.
5. Look at the store's pages at phone and computer widths, in light and dark if the theme offers both.

Keep words in the header, footer and product layout neutral, since every store that installs the theme shows them. The checks below refuse
claims and links off the site.

## Check it against the theme checks

Every version of every theme passes the same checks before it is published, Kaizena Flow's own themes included. A blocking finding refuses
publishing. Kaizena Flow's reviewers read the findings on the theme's page; you meet them by building the look to these rules:

| Check | What it asks | Blocks |
|---|---|---|
| The theme's files | The snapshot can be read as a theme, and the header, footer and product page pass the checks a save of a page passes | Yes |
| Accessibility | The header, footer and product page pass the page builder's accessibility rules in each colour set the theme shows | Where the rule blocks |
| Contrast | Text on the background, and text on the accent colour (buttons), reach 4.5:1 in each colour set | Yes |
| Contrast | Text on the surface colour, and secondary text on the background, reach 4.5:1 | A warning |
| Contrast | Over each row's background, for the site's elements and every section style: h1 to h3 reach 3:1, other headings, paragraphs and lists 4.5:1 | Yes |
| Section styles | The six core styles are there | Yes |
| Checkout pages | The header and footer, which the checkout's pages show too, hold nothing those pages may not | Yes |
| Words and links | The layouts make no claim a theme cannot make for every store (an environmental claim, urgency or scarcity, a best or lowest price, an amount of money, a stock level), and link nowhere off the site (a full address, an email or a phone number) | Yes |

The page builder shows accessibility problems as you edit a page, and Design settings' theme editor warns when a pair of the palette's
colours is hard to read. Both help you pass before you send the look.

## Try it in a store

Visitors see nothing of a theme until a store switches to it. A store's theme library holds several themes, one of them live:

- **Before you share.** Add a theme to your store from the theme store or from Design settings, without making it live. On its own page
  under Design settings, change its settings and its own CSS, edit its header, footer and product page, preview it on your store's pages,
  and read *What changes* if you switch. Switch to it when it is right: sharing takes the store's live look.
- **After approval.** Your theme has a page in the [theme store](/themes). Anyone who may change a store's website can press *Try it in your
  store* there, choose a store, and preview and customise it the same way before switching.

## Share it for review

In the store, open Design settings and choose **Share this look as a theme**, or go to [Share this look as a theme](/admin/{store}/settings/design/share).

| Field | What to write | Limit |
|---|---|---|
| Send it as | *A new theme*, or *An update of …* a theme you made. Shown only when you are the author of a theme | |
| Theme name | The theme's name, which also gives its address in the theme store | Required for a new theme, up to 80 characters |
| One line about it | The theme's summary | Up to 200 characters |
| Description | What the theme is for and what it does | Up to 2,000 characters |
| Your name as its author | Shown on the theme's page as "By …" | Required, up to 80 characters |
| What's new | For an update: shown to the stores that use the theme | Up to 2,000 characters |
| Send my published pages too | Unticked at first. Ticked, up to 12 of your published pages go as the theme's demo content, your front page first | |

Press **Send for review**. The look is taken at that moment and kept with what you sent, so you can go on changing your store.

What decides whether you can send:

- The store is open, and it is not a demo store or starting content.
- You may change its website.
- You have fewer than three looks waiting or in review. Wait for an answer, or withdraw one, to send another.

Pages you send are copied as a template is: links, ids and files of your store are taken out, forms lose their recipients, and a page's
categories, tags, countries, author's name, blog and thumbnail are not sent. Pages chosen for a place (legal pages, the cart, the blog and the like),
products, customers, settings and secrets are never sent.

## What happens after you send it

A submission moves only forward: *waiting*, then *reviewing*, then *approved*; or *not accepted* (rejected), or *withdrawn* by you while it is
still open.

1. **Review.** A reviewer makes a draft theme from your look, with you as its author and its pictures copied into it. They preview it on
   the theme's own pages, and on your pages if you sent them, and read the theme checks.
2. **Approve and publish.** The theme is published, so the checks must pass: a blocking finding keeps it in review. A new theme gets its
   address in the theme store from its name (`/themes/coastal-light` for *Coastal Light*), with a number added when the name is taken.
   Its page names you as its author, and how many stores use it.
3. **Not accepted.** The reviewer says why, in up to 1,000 characters, and the draft theme is put away unpublished.

Follow your submissions under [Account, Your themes](/admin/account/themes): each one's state and, when it was not accepted, the reason.
You can withdraw one still open there. The same page lists your published themes with their version and how many stores use each.
Kaizena Flow sends no email about a decision yet.

## Send an update

Only a theme's author can send an update of it. Change the look in your store, then share it again with *Send it as* set to *An update of
…*, and say what's new. The theme's name, line and description stay as they are.

- An approved update is the theme's next version, with your *What's new*.
- An update whose look did not change makes no new version.
- A version that drops a core section style the last one had is refused.

A store that installed the theme sees each new version in Design settings, with its *What's new* and *Update now*. A new install waits for
its owner to update it, unless the owner lets it update by itself. An update keeps the store's own changes: its own settings and CSS stay,
and a header, footer or product page it edited stays its own, with the new one made as a draft beside it. The store can undo an update for
90 days, while its look is still what the update left.

## Prices

A theme from outside is free in the theme store. The database refuses a price for any theme that has an author, until a share of revenue
for authors is decided. Premium themes, with a price per store paid when the store goes live, are Kaizena Flow's own for now.
