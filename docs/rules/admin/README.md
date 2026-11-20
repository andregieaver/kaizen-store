# Rules: Admin, features and integrations

The admin's rules in full, split by area. CLAUDE.md names these files in its map and keeps no line per rule: find a rule by searching
the area's file for the path, component or table you change. Each heading is unique across the rule files, and every file here is in
the list below (`src/lib/rules-index.test.ts`). A rule changes in its file.

The admin's words (bloat review step 2.50): a catalogue file of `src/lib/admin-messages` is imported only by its area module
(`src/lib/admin-words`), the three words' context files and tests, and a part or a helper takes its words as a required prop or
argument, English that code with no language reads living in a `<thing>-labels.ts` leaf (`src/lib/admin-text-reach.scan.test.ts`).
A catalogue file imports no code: only other catalogue files and the named leaves (`src/lib/admin-messages/imports.scan.test.ts`).

- [`platform.md`](platform.md): The admin's frame, accounts, security and the platform
- [`ai.md`](ai.md): The AI manager, the autopilot and AI that builds
- [`commerce.md`](commerce.md): Orders, payments, tax, shipping and selling
- [`marketing.md`](marketing.md): Customers, marketing and analytics
- [`website.md`](website.md): The website, the builder, themes and the docs portal
- [`integrations.md`](integrations.md): Data in and out, APIs and integrations
