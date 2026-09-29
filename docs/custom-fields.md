# Custom fields (proposal)

A custom field generator for Kaizen, in the spirit of WordPress's Advanced
Custom Fields (ACF): store owners define their own fields (a size guide, an
ingredient list, a warranty, a designer's name), fill them in wherever they
edit a product or a page, and place them in the page builder's templates.

Status: all three phases are built (D118, D119, D120). What phase 1
did differently from the design below:

- **Required fields** are asked for when a product is saved as published; a
  draft may lack them. Pages and articles do not enforce them yet.
- A picture's description is kept in the field's value, in the main language;
  showing the library's translated descriptions is later.
- Deleting a group, or a field from a group, deletes what was entered in it.
- `products.attributes` was dropped, as recommended.

Phase 2 (D119) added group and repeater, link, relational and file fields;
variants and categories and tags as things with fields (the store and
customers wait for phase 3); binding a heading, rich text, image or button to
a field; the filter, search, structured data and chat flags; the store
translation worklist (variant and category texts included) and the AI manager
tools (`list_field_groups`, `get_fields`, `set_fields`, `create_field_group`).
What it leaves: number ranges as listing filters, variants and categories in
search, the alt text of a picture field translated, and the inline editor of
saved parts having no binding picker.

## 1. What ACF does (research)

Sources: ACF's documentation on
[field types](https://www.advancedcustomfields.com/resources/),
[registering fields](https://www.advancedcustomfields.com/resources/register-fields-via-php/),
[location rules](https://www.advancedcustomfields.com/resources/custom-location-rules/),
[conditional logic](https://www.advancedcustomfields.com/resources/conditional-logic/),
[repeater](https://www.advancedcustomfields.com/resources/repeater/) and
[flexible content](https://www.advancedcustomfields.com/resources/flexible-content/),
and its community's write-ups of
[how values are stored](https://support.advancedcustomfields.com/forums/topic/understanding-the-acf-database-values/).
Shopify's
[metafields](https://shopify.dev/docs/apps/build/custom-data/metafields) are the
closest thing in commerce and give the second opinion.

**The model has four ideas.**

1. **Field groups** hold **fields**. A group has a title, an ordered list of
   fields, a position on the edit screen (after the title, main, side), a
   style, where labels and instructions sit, and an on/off switch.
2. **Fields** have a stable `key` (`field_…`), a `name` (what code asks for),
   a `label`, a `type`, `instructions`, `required`, a `default_value`, a
   `wrapper` (width, class, id) and type-specific settings (choices, min/max,
   maxlength, placeholder, return format, sub fields).
3. **Location rules** say which edit screens a group appears on: a list of
   rule groups, OR between groups and AND inside one. Each rule is
   `param == value` (post type, category, page template, taxonomy, user role,
   options page, block …). Developers can register their own params.
4. **Conditional logic** shows or hides a field by the value of another
   field in the same group: the same OR-of-AND shape, with operators *has any
   value*, *has no value*, *is equal to*, *is not equal to*, *matches
   pattern*, *contains*. Which operators are offered depends on the trigger
   field's type.

**Field types** (35 in ACF 6): basic (text, text area, email, number,
password, range, URL); choice (button group, checkbox, radio, select,
true/false); content (file, gallery, image, oEmbed, WYSIWYG); jQuery
(colour, date, date-time, time, Google map, icon picker); layout (accordion,
clone, flexible content, group, repeater, tab); relational (link, page link,
post object, relationship, taxonomy, user). The two structural ones matter
most: the **repeater** (rows of sub fields, with min/max, a table/block/row
layout and a button label) and **flexible content** (a list of rows, each of
a layout the developer defined: the field-level version of a page builder).

**Storage and reading.** Values live in WordPress's key/value meta table: one
row for the value and one hidden row (`_name`) that points at the field's
definition by key, so the type's formatting can be applied on read. A
repeater flattens into `name_0_sub`, `name_1_sub`, plus a count row: five
rows of four sub fields is 41 meta rows on one post. Templates read with
`get_field()`, `have_rows()`/`the_row()`/`get_sub_field()`; a field's
*return format* (an image as array, URL or ID; a relationship as objects or
IDs) decides what comes back. Definitions can be kept as JSON files in the
theme ("local JSON") and synced, so they can be versioned and moved between
sites.

**Where it plugs in.** Location rules also cover taxonomies, users, media,
menus, comments, options pages and blocks. Page builders integrate by
*dynamic data*: a heading, image or button asks "use field X of this post".
ACF Blocks bind a field group to a reusable component.

**What went wrong for people (things not to copy).**

- A field's `name` is the storage key. Rename it and the values are
  orphaned; the hidden reference row is the only link left.
- Two rows per value, and a row per repeater cell: bloated and slow, and
  impossible to filter or search cleanly.
- A field only shows on a page if a developer writes PHP for it. Owners
  without a developer cannot use what they build.
- Values and hidden-by-logic fields are still saved, and validation rules for
  hidden required fields are undocumented, so they surprise people.
- Return formats are a per-field switch that changes what code receives.
- Shopify separates **definitions** (type, validation, who can read it) from
  values and gives each definition a storefront access level: hidden by
  default, public on purpose. That is the right default for us too.

## 2. What Kaizen already has to build on

- The page builder's block model: JSON content validated by one zod schema
  (`pageInput`) shared by browser and server, with `PRODUCT_PARTS` for
  product templates (D79), shop pieces for the cart, checkout and order
  (D117), and settings dialogs with General/Style/Advanced tabs
  (`BLOCK_EDITORS`).
- The product editor, one client component that sends one JSON to
  `saveProductAction`, validated by `productInput`, written in one
  transaction.
- The media library (D88) with alt texts in every language (D89), the
  rich text model (Tiptap JSON, `cleanRichText()`), video embeds, menu link
  kinds (`{ kind: "page" | … }`), categories and tags (D50), the claims filter
  (`findClaims()`), and `shown()`/`formatMoney` for money.
- A language model for content: a store's main language with translations
  over it (D55, D109), a store-wide AI translation worklist (D110), and
  `clone_store()` for new stores.
- `products.attributes` (jsonb, "category-specific attributes") exists and is
  read by nothing. It is a leftover and is not the answer: it has no
  definitions, no translations and no place in the editor.

## 3. Design

### 3.1 Two tables

**`commerce.field_groups`** — the definitions, per store (a null store is
Kaizen's own pages).

| column | meaning |
| --- | --- |
| `id`, `store_id` | as everywhere; every read takes a store id |
| `name`, `slug` | what the owner calls it; unique per store |
| `entities` | which kinds of things it can be on (see 3.3) |
| `location` | OR-of-AND rules narrowing which ones (3.3) |
| `fields` | the ordered field definitions, jsonb (3.2) |
| `position`, `active`, `sort` | where it shows in an editor, on/off, order |

Fields are one jsonb array in the group, not a row each, as pages hold their
blocks: nesting (a repeater's sub fields) is natural, a group saves
atomically, and the whole thing is validated by one zod schema
(`fieldGroupInput`, shared with the browser). Limits keep it sane: 50 groups
per store, 60 fields per group, nesting two deep, 100 rows per repeater.

**`commerce.field_values`** — one row per thing and language:

`(store_id, entity, entity_id, locale, values jsonb)`, primary key on the
first four. `locale` is `''` for values that are the same in every language
(numbers, choices, pictures) and the language code for the translatable ones
(text, rich text, a picture's alt text, a repeater's text cells). A read
loads at most two rows per thing. `values` is keyed by the field's **`id`**,
never its name: a field's name is a label for people and templates, so
renaming it loses nothing (ACF's biggest trap). Values are validated against
the definition on every write and are never trusted on read.

Alongside, a GIN index on `values` serves filters, and searchable text is
kept in a separate generated document (see 3.6) rather than the existing
product search column.

### 3.2 A field

```ts
type FieldDef = {
  id: string;            // immutable, `f_…`
  name: string;          // slug for humans, templates and the API; editable
  label: Translatable;   // main language + translations, like pages (D55)
  instructions?: Translatable;
  type: FieldType;
  required?: boolean;
  default?: FieldValue;
  width?: 25 | 33 | 50 | 66 | 75 | 100;   // ACF's wrapper width
  when?: RuleGroups<FieldCondition>;       // conditional logic (3.4)
  access: "public" | "private";            // Shopify's storefront access
  chat?: boolean;                          // may the chat agent say it (D81)
  filter?: boolean;                        // offered as a listing filter (D78)
  search?: boolean;                        // part of keyword search (D72)
} & TypeSettings;
```

The stored value is the *typed* value, not a per-field return format: an
image is always `{ mediaId, url, alt, … }` resolved on read through the media
library (so alt texts arrive translated), a date is an ISO string, a choice is
its key. That removes ACF's return-format switch.

### 3.3 Location: which things get which group

ACF's OR-of-AND rules, over Kaizen's things:

| entity | params for rules |
| --- | --- |
| product | kind (goods, appointment, stay, rental), category (with children), tag, audience, delivery (physical, digital), status |
| variant | as the product, plus option name |
| page, article | type, category, tag, page role (D112, D113), template |
| category, tag | kind, parent |
| store | (settings, one per store: opening hours, a brand story) |
| customer, order | none; private only (never on the storefront) |

`groupsFor(entity)` is a pure function used by editors ("which groups does
this product get?") and by the renderer. Changing a product's category
changes which groups its editor shows; values under a group that no longer
applies are kept (not lost) and simply not shown.

### 3.4 Conditional logic

ACF's shape, kept: OR of AND, evaluated over the other fields in the same
group (in a repeater, the same row). Operators: has value, has no value,
equals, not equals, contains, matches pattern, and, for numbers and dates,
greater/less than. One pure function `fieldShows(def, values)` is used by the
editor (live) and by the server. Deliberate differences from ACF: a hidden
field is **not validated** and **not shown**, and a hidden required field never
blocks saving; its value is kept, so flipping the switch back restores it.

### 3.5 Field types

Chosen for a shop, from ACF's list.

- **Basic:** text, text area, number (with unit and step), email, URL, phone.
- **Choice:** select, radio, checkbox, button group, true/false. Choices have a
  key and a translatable label.
- **Content:** rich text (Tiptap JSON, never HTML), image, gallery, file
  (through the media library), video (the page builder's embed rules),
  date, date-time, time, colour.
- **Relational:** link (a menu link: page, product, category, web address),
  product, page or article, category or tag.
- **Layout:** group (a named set of sub fields), repeater (rows of sub fields,
  min/max, layout table/list). Flexible content is later (4, phase 3).
- **Commerce:** measurement (a number with a unit: weight, length, volume),
  and a money field only in phase 3, as a price needs the market's
  currency and `shown()` rules.

Left out on purpose: raw HTML and script fields (D61 and D100 already give
owners code and CSS through the guarded routes), password, Google map (a
consent-gated third party, D58; the address as text plus a link does the job),
icon picker (the page builder has icons), user (customers are not content).

### 3.6 Editing the values

- A shared `FieldsForm` renders any group from its definition: it is the
  one place the field types' inputs live, used in the product editor (a
  panel per group: main, or side), the page editor's sidebar, the term
  manager and the store settings.
- The product editor sends the values in the same JSON as the rest
  (`productInput.fields`), and `saveProduct()` writes them in the same
  transaction, after `parseFieldValues(defs, input)` has checked, trimmed and
  dropped anything the definitions do not allow. Pages do the same in
  `savePage()`. Server actions that change values call `updateTag()`.
- **The generator:** `/admin/{store}/fields` (under Products in the store's
  admin, in `ADMIN_PAGES`), with a list of groups and one editor: name,
  fields as a drag-to-order list (dnd-kit, as the builder and menus use),
  each opening a dialog with General (label, name, type, instructions,
  required, default, choices), Presentation (width, placeholder, prefix and
  suffix), Logic (when) and Storefront (access, chat, filter, search) tabs, the
  location as a rule builder, a live preview of the form, and **presets**
  (Specifications, Size guide, Ingredients and allergens, Materials and care,
  Warranty, Designer) to start from.
- **Import and export** of groups as JSON (ACF's local JSON, without the
  drift): move a set between stores, keep it in version control, and copy a
  store's fields with `clone_store()`.
- **AI manager tools** (`list_field_groups`, `create_field_group`,
  `set_field_values`), `public`-gated where they change what shoppers see;
  the manager's text passes `findClaims()`.

### 3.7 Using them in templates

This is what ACF leaves to code; here it is visual.

1. **Phase 1: components.** A product part `fields` (a group as a
   specification table, list or cards) and `field` (one field, with a
   presentation: text, badge, image, link, button), and a page-builder block
   `customField` with the same. In a product layout they show the current
   product's values; on a page, the page's own; on a content grid's tile, the
   item's. They draw nothing when the value is empty (as other parts do), so a
   template can hold a field only some products have.
2. **Phase 2: binding.** Any text, heading, image, button, video or link block
   can bind a property to a field ("the button's link is *Datasheet*", "this
   image is *Lookbook picture*") through a small `bind` on the block, the
   builder's answer to ACF's dynamic tags. A block bound to an empty field
   draws nothing, or its fallback.
3. **Phase 3: loops and flexible content.** A block that draws a repeater's
   rows with an inner layout (a row of columns per row), and a flexible content
   type: a list of rows each of a layout the owner defined, rendered through
   the page builder's own rows.

Beyond templates, a field with the right flags also appears: as a filter in
the listing dialog (D78, from `listingFacets()`), in keyword search (D72), as
`additionalProperty` in the product's JSON-LD, in the chat agent's
`get_product` (only `chat` fields, worded by the site, never by the model,
D81), and in the store translation worklist (D110: a field's translatable
texts are listed with the product's).

### 3.8 Performance and multi-tenancy

- Definitions are read with the store (`getStore()`-style, cached per store,
  tag `fields:{storeId}`); values are read **inside the cached catalogue
  reads** for products and pages (one extra keyed read joined by entity id, no
  read per field, no N+1), so prerendered product pages stay prerendered and
  a save refreshes the same tags the catalogue already uses.
- Every query takes a store id; both tables have RLS on with no policy, like
  the rest of `commerce`. Values are checked against the store's own
  definitions; a value for another store's field is dropped.
- Money and time: amounts in fields follow the money rules (phase 3); dates
  are stored as ISO and shown in the store's time zone.

### 3.9 Safety rails (Kaizen-specific)

- **Never HTML.** Rich text is Tiptap JSON rendered as elements. No field
  carries markup, script or CSS.
- **Private by default.** A new field's access is `private`; the owner must
  make it public. Customer and order fields can never be public.
- **No legal texts.** The safety information, the right of withdrawal and the
  terms keep their own places; the generator says so beside the presets, and
  legal-looking page fields start unticked in the translation worklist as
  today (D110).
- **Claims.** AI-written values go through `findClaims()` like other AI copy
  (D76), and the AI never states a price or stock from a field.
- **Personal data.** Fields on customers are flagged personal, listed in
  what is exported or deleted for a customer, and never reach the chat agent.
- **Residency.** Everything is in the EU database; no vendor is added.

## 4. Phasing

| phase | delivers | size |
| --- | --- | --- |
| 1 | Both tables and migration; pure library (`src/lib/custom-fields.ts`: types, `fieldGroupInput`, rules, conditional logic, `parseFieldValues`) with unit tests; the generator page with presets, preview and import/export; `FieldsForm`; values in the product editor and page editor; the `fields`/`field` product parts and page block; `clone_store()`; admin map; tests including a scenario each for a product page and a page; the field types in 3.5 except repeater, relational and layout. | the bulk |
| 2 | Repeater and group; relational and link fields; variant, category and tag entities; binding on existing blocks; filter, search, JSON-LD and chat flags; store translation worklist; AI manager tools. | second |
| 3 | Loop block, flexible content, money, customer and order fields, listing tile bindings. | third |

## 5. Decisions to confirm before building

1. **Entities in phase 1.** Recommended: products, pages and articles. Variants,
   categories, the store and customers follow in phase 2. (ACF users start
   with posts and pages; shops want products first.)
2. **Values per language.** Recommended: yes, as designed (text and rich text
   translated, everything else shared). The alternative, one language only, is
   simpler but breaks in every store with more than one language (D109).
3. **Storefront default.** Recommended: private until the owner makes a field
   public, as Shopify does. ACF has no such switch because WordPress themes
   read everything.
4. **Where the generator lives.** Recommended: under Products in each store's
   admin (`/admin/{store}/fields`), with Kaizen's own pages getting the same
   for the platform later. A platform-wide preset library that store owners
   can copy is a good phase 2 addition.
5. **The leftover `products.attributes` column.** Recommended: drop it in the
   phase-1 migration; nothing reads or writes it.
