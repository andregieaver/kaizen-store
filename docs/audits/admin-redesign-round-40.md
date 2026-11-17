# Admin redesign, round 40: Menus, a new custom field group and Email automations on a phone

Decision D735, 17 November 2026. The boards are on the design canvas of round 40.

After round 39 these were the tallest store pages on a phone, apart from two:

- The product layout builder's preview, which round 35 already reworked.
- Activity, which grew only with the local test data. Round 32 already shows it 20 entries at a time.

| Page | Before | After |
|---|---|---|
| Menus (`/menus`) | 2,050 px | 1,075 px |
| A new custom field group (`/fields/new`) | 2,046 px | 1,007 px |
| Email automations (`/automations`) | 2,003 px | 835 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Menus (`MenuEditor`)

- **One line says what menus are.**
- **The choice of menu is one line**, with *New menu* beside it.
- **The menu itself comes first**: its name, its links, *Save menu* and *Delete menu*, then where it shows. The Save beside the name and
  the three lines on dragging are left out.
- ***Add links* is a row under the menu** that opens the eight kinds of link. It is open while the menu has no links.
- Kaizena Flow's own menus use the same editor, so they change the same way.

## A new custom field group (`FieldGroupEditor`)

- **The name stays open.**
- **Web name is a row** (*Made from the name*, or the name typed).
- **Can be used on is a row** that says the choice, for example *Products · main column · on*. It holds the boxes, the column and the
  switch.
- **Where it applies is a row** (*Everywhere it can be*, or how many sets of rules).
- **The fields keep *Add field* as the green button.** The notes on ordering are left out until there is a field.
- **The preview is a row.**

## Email automations

- **Each automation is a row of one card**: its name, *On* or *Off* and when it goes, and its one press. *Set it up* is the green button for
  the first one that is off, and a saved one has its switch.
- **Back in stock** says how many are waiting and keeps its switch.

## How this differs from the boards

- **Menus:** *Where it shows* stays under the menu as a line with its link, rather than beside the menu's name.
- **Field group:** *Save group* keeps the green colour. The green *Add field* is above it, so the page has two green buttons as before.
- **Email automations:** a row's line keeps the full sentence on when it goes, so some rows are two lines.

## Platform

- Kaizena Flow's menus use the same editor.
- Kaizena Flow has no custom fields of its own. Its plans and owners take no extra fields, so this page stays store-only.
- Kaizena Flow's emails to owners are under Platform, Emails, and have no list of automations like this one.

## Tests

- Lint, types and all unit tests pass. Seven files time out under the full run's load and pass when run alone.
- `automations.spec.ts` and `menus.spec.ts` pass against a local build.
