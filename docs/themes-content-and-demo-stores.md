# Themes with their own content, demo stores at their own addresses (D275)

Status: **spec, for review before building.** Agreed with the owner on 18 October 2026. It replaces the per-look demo store of D273
(`ThemeListing.pack`, `presetPacks`, `demoStoreForLook()`) and the gate of D274 (`shownLooks()`).

## 1. In four sentences

1. **A theme comes with its own content**: a home page, an about page, products and photographs. Its preview, its photographs and every
   new store started from it use that content, never a demo store and never the Standard store.
2. **A demo store is a live store at its own address on kaizenaflow.com** (`fieldandfold.kaizenaflow.com`), made by a platform admin,
   wearing a theme the admin customises. The theme's page links to it: *See it live*.
3. **A demo store's customised look can go into the theme store**: as a new theme, as a preset of the theme it wears, or into that
   theme's next version. It is always a copy made when you press, never a live link.
4. **The theme's page sells the theme**: shown large, presets one press away, a full-screen preview, and one clear way to use it.

## 2. The words

| Word | What it is | Where you work on it |
| --- | --- | --- |
| Theme | A whole look, **and now its own content** | Stores → Themes → the theme |
| Preset | Up to five other looks over the theme. Each preset shares the theme's content, header, footer, product page and CSS | The theme's Presets tab |
| Content | A theme's own pages, products, menus and pictures: what its preview shows and what a new store starts with | The theme's **Content** tab (new) |
| Demo store | A live store at `{address}.kaizenaflow.com` wearing a theme, made by a platform admin | Stores → Themes → Demo stores |
| Starting content | Ten sets of pages, products and photographs that Kaizena Flow writes, one per trade (today's content packs, D257). A theme's content or a demo store starts as a copy of one | A card on Stores → Themes |
| Theme store | themes.kaizenaflow.com | Filled from what you publish |

Visitors read only *theme*, *preset* and *demo store*. *Content* and *starting content* are words for the platform admin.

## 3. A theme's content

### What it is

- **A store kept for the theme**: a `store_starters` row with `kind = 'theme_content'` and `design_preset_id`, one per theme. It is never
  listed among demo stores, never routed to an address of its own, and never offered on its own.
- **It holds what any store holds**: pages (the home page as its front page, an about page, a products page), products, categories,
  menus and pictures.
- **Its own look does not count.** Previews and photographs always draw the theme's look over it. Its Design settings say *"This is
  Calm's content: change the look on Calm's page"* and offer nothing else.
- **The look stays in the hidden workspace (D177)**, the store behind the Theme, Header, Footer, Product page and CSS tabs. Content and
  look are two stores, so editing a product can never change the look, and the other way round.

### Where you edit it

The theme gets a **Content** tab:

- **What it holds**: so many products and pages, and how many pictures are made.
- **Edit the content**: opens its store admin, as a demo store's *Open the store's admin* does today (`joinStarter()`).
- **Make the pictures**, while its photographs are still to be made.
- **Replace with…**: a starting content, or another theme's content. It asks before replacing.

How a new theme gets its content:

- **From scratch**: *New theme* asks which starting content to begin with. The Standard store is never offered.
- **From a store's look**: the look comes from that store and the content from a starting content. An owner's products are never copied
  into a theme.
- **From a demo store** (section 4): the look and the content both come from the demo store.

### Publishing

- **Publishing the theme publishes its content too**: its frozen copy, `commerce.freeze_starter()`.
- **Content changes count as unpublished changes of the theme**: the header's *Unpublished changes* line says so.
- **Only the frozen copy is read**: by the theme store, the photographs and new stores.

### What reads it

| Reader | Today | Now |
| --- | --- | --- |
| The preview (`readPreview()`) | The look's demo store, `?starter=` | The theme's own content, for every look; no `starter` |
| Photographs (D264) | Each look on its demo store | Each look on its theme's content |
| A new store (D273) | `demoStoreForLook()` | `starter_source(the theme's content)`, then the chosen look, then `markDemoContent()`, as now |
| The theme store | Only looks on a published demo store (D274) | Every look of every published theme |

Applying or switching a theme in an existing store never brings its content (as now: Design settings never changes a store's words).

### Kaizena Flow's eight themes

Each launch theme takes one starting content as its own. The sync writes it (`syncLaunchThemes()`), and no two themes share one:

| Theme | Its content | Pictures today |
| --- | --- | --- |
| Calm | Fashion · Field & Fold | made |
| Hearth | Food · Harbour Pantry | **to make** |
| Signal | Electronics · Volt & Wire (today Signal's own look is shown on Fashion, as Calm's is) | **to make** |
| Fjord | Home · Still House | **to make** |
| Orbit | Astronomy · Far Light (designed for it) | made |
| Atelier | Ceramics · Ostra Studio (designed for it) | made |
| Arcade | Neon · Neon Alley (designed for it) | made |
| Botanica | Plants · Fernhouse (designed for it) | made |

- **Beauty (Lumen Skin) and Services (North Hair Studio)** are left over for demo stores.
- **To get ahead now**: press *Make every picture* on today's Demo stores card. Food, Home, Electronics and Beauty need their photographs,
  and step 1 copies them in.

### What goes away

- **The per-look demo store choice**: the theme's Demo stores card, `saveThemeDemoStores()`, and `ThemeListing.pack` and `presetPacks`
  (read once to keep pending requests working, then no longer written).
- **D274's `shownLooks()`**: no look is without content now.
- **Presets on another trade's store**, for example Signal · Cobalt on the services store. A preset is now another look on the same
  content. Trades are shown by demo stores instead.

## 4. Demo stores

### Making one

On **Stores → Themes → Demo stores**, press **New demo store** and fill in:

- **Name**.
- **Address**: `{address}.kaizenaflow.com`. Lowercase letters, digits and hyphens; not a platform word; not taken by any store, since
  real stores share the namespace.
- **Theme**: any theme or preset.
- **Content to start with**: a starting content, or a copy of a theme's content.

**Make the demo store** makes it wearing that look and opens its store admin. From there:

- **Customise it like any store**: its Design settings (the theme's customiser, D244), its pages, products and pictures.
- **Publish** puts it live at its address. From then on it behaves as a real store does: changes show at once. **Unpublish** takes the
  address down.
- **What it never does**: it takes no orders, sends no emails to shoppers, is kept from search engines, and runs only Kaizena Flow's
  code. That last point is why it may live on kaizenaflow.com.

### What it wears

- **A demo store wears the look that is live in its theme library** (`store_theme_installs`).
- **The theme's page shows it automatically**: every published demo store wearing one of the theme's looks appears under *See it live*.
  Nothing is chosen on the theme.

### Publishing its look

On the demo store's page, **Publish this look…** offers three things:

- **As a new theme**: a theme whose look is the demo store's (theme settings, header, footer, product page, CSS) and whose content is a
  copy of the demo store's. It opens unpublished, to be named and published like any theme.
- **As a preset of {theme}**: the demo store's theme settings (colours, fonts, buttons) become a new draft preset of the theme it wears.
  Publishing the theme sends it out.
  - This is refused, with the reason, when the header, footer, product page or CSS differ from the theme's, because a preset cannot hold
    those. *As a new theme* is offered instead.
- **Into {theme}'s next version**: the demo store's look replaces the theme's draft look. You review it, write What's new and publish.
  Stores that follow updates get it only then.

Each is a copy made once, when pressed. The demo store and the theme never stay linked, so an experiment on a demo store never reaches
the stores that use the theme.

## 5. Addresses on kaizenaflow.com

### How it works

- **A new setting**: `NEXT_PUBLIC_DEMO_DOMAIN` (`kaizenaflow.com`).
- **A rule per published demo store**, read from the database when building, as a store's own domain is (P8):
  - `{address}.kaizenaflow.com` serves the demo store;
  - its `/s/{address}` moves there.
  - Publishing, unpublishing or renaming a demo store deploys again (`requestDeploy()`), so a new address answers within a few minutes.
- **Only published demo stores are routed. There is never a catch-all for `*.kaizenaflow.com`.** Any other name is not found, and a real
  store is never served there: real stores stay on the store domain (P7).
- **The platform's own names are unchanged**: the bare domain is the platform, `www.` goes to it, and `themes.` is the theme store.
- **No owner code on the demo domain.** `liveCustomCode()` gives none for a demo store; today it would. Every cookie stays host-only, as
  now.
- **Nothing breaks in between.** Until the setting is set, demo stores stay on the store domain.

### What you do (outside the code)

1. **Now, and separately: set `NEXT_PUBLIC_STORE_DOMAIN` back to `kaizenstore.site` and redeploy.** Every real storefront is down until
   then.
2. Copy kaizenaflow.com's DNS records into Vercel first (Resend's SPF, DKIM and return path, and any mail records). Then move its name
   servers from Hostinger to Vercel. Vercel issues a wildcard certificate only on its own name servers.
3. Add `*.kaizenaflow.com` to the Vercel project.
4. Set `NEXT_PUBLIC_DEMO_DOMAIN=kaizenaflow.com` and redeploy.

## 6. The theme's page in the theme store

Top to bottom, written for Homer:

1. **The theme, large.** Its name and one sentence. Below them, a computer and a phone showing the chosen look on the theme's own
   content: the photograph appears at once, and the live preview draws over it. Under the frames are the presets as swatches, each a dot
   in its colours with its name. Choosing one changes the frames and the buttons, and the address keeps it (`?preset=`), so a shared link
   opens on that look.
2. **Two buttons, always for the chosen look.**
   - **Preview**: full screen, see below.
   - **Use this theme**: starts a store with it (sign-up with the look chosen).
   - Under them, a quiet link, *Already have a store? Add it to your store*, which leads to today's try page.
3. **See it live**: a card for each demo store wearing one of its looks (photograph, name, its trade, which look). It opens the store at
   its address. The section shows only when there is at least one.
4. **Highlights**: the three pictures with their words.
5. **What you get**: the short list, and *Your words, pictures and products stay as they are when you switch.*
6. **Details**, folded away for Lisa: about, kinds and styles, section styles, changelog.

Under the frames, one line: *Sample content: your own words, pictures and products take its place.* The preview never says *demo store*;
only *See it live* does.

**The full-screen preview** gets the theme store's own address: `/themes/{slug}/preview?preset=`, or `/{slug}/preview` on its own host.
Today it lives under `/admin/account/themes/{id}/preview`.

- **A slim bar on top**:
  - back to the theme;
  - the presets;
  - Home or A product;
  - computer or phone;
  - **Use this theme**.
- **Under the bar**, the store can be scrolled but not pressed, as now.

**The list's card** adds the preset swatches. Nothing else changes.

## 7. Steps

Each step ships and is checked on its own:

1. **A theme's content**:
   - a migration (`store_starters.kind`, `design_preset_id`);
   - the Content tab;
   - Publish freezes the content;
   - the preview, the photographs and new stores read it;
   - the eight themes get their content;
   - the per-look choice goes.
2. **The theme's page** and the full-screen preview.
3. **Demo stores**: *New demo store*, *See it live*, *Publish this look…*.
4. **The demo domain**, once your DNS steps 2 and 3 are done.

Steps 1 and 2 change what visitors see. Steps 3 and 4 only add.

## 8. Decided, and still to confirm

**Decided with the owner:**

- Themes carry their own content.
- A new store starts with the chosen theme's content.
- Demo stores live on kaizenaflow.com; real stores stay on a domain of their own.
- Publishing from a demo store is a copy you press.

**To confirm while reading:**

1. **Signal's content becomes Electronics**, so that Calm and Signal don't share Fashion.
2. **A published demo store is live**: changes show at once. There is no separate published copy, unlike a theme's content.
3. **A theme's content is seen only in previews**, never as a store at an address of its own. Demo stores are the live ones.
