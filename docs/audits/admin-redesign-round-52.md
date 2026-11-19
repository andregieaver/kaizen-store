# Admin redesign, round 52: Saved replies, Media library and Share this look as a theme on a phone

Decision D788, 19 November 2026. The boards are on the design canvas of round 52.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Saved replies (`/support/replies`) | 1,158 px | measured after the build |
| Media library (`/media`) | 1,156 px | measured after the build |
| Share this look as a theme (`/settings/design/share`) | 1,155 px | measured after the build |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Saved replies (`RepliesManager`)

- **One line says how to use them:** *Type / in the inbox to put one in.*
- **The replies come first** (or *No saved replies yet.* in a card). The list moves up with CSS `order`, on a phone only.
- **New reply is a row** (*A title, the text, a shortcut if you like*). Its heading is left for screen readers, so the row's name
  is not said twice. Those who only read the desk do not get the row.
- **What / fills in is a row** (*The customer's name, your name, the store*) that opens the placeholder card.

## Media library (`MediaLibrary`)

- **One line says what the library holds:** *Every picture and video {store} has uploaded.*
- **The notice that uploads are not set up stays.**
- **Alt texts are a row.** It names the count (*1 picture has no alt text*) and whether an AI can write them. *How* opens the card
  with its button.
- **The search is a row** (*Find a file*). It says what is shown (*Newest first · Pictures and videos*, or the words searched for).
  It is open when a search or a type is chosen.
- **The count, Choose files, Grid and List, and the files follow** without other changes.

## Share this look as a theme

- **One line says what happens:** *Your look goes to Kaizena Flow to review; your words and products stay yours.*
- **The theme's name and its one line stay open.**
- **Description, author, what's new and demo pages are one row** (*By* the person's name). The author is required. A field the
  browser flags inside the closed row opens it (`ShareMore`, `onInvalidCapture`), so nothing needed stays hidden.
- **What is sent is a row** after the form, with the full terms.

## How this differs from the boards

- **Saved replies:** the row is named *New reply*. *New saved reply* stays the heading from `sm` up, and the two never read the same.
- **Saved replies:** the empty card has no line under it. Words handed to the browser for the support area were at their budget
  (`admin-words-handed`), so the round kept within it rather than raise it.
- **Media library:** the row says *Find a file*, not *Search the library*. That is the search field's label, and the two must not
  read the same.
- **Media library:** the board put Choose files beside the count. The page already did that.
- **Share:** *Your themes* stays a button, as from `sm` up.

## Platform

- Saved replies and Media library get the same change on Kaizena Flow's pages (`/admin/platform/support/replies`,
  `/admin/platform/media`), through the same components, with a one-line lead each.
- Sharing a look as a theme is store-only: Kaizena Flow's own site is not sent to its own theme store for review.

## Tests

- Lint and types pass.
- All unit tests pass.
