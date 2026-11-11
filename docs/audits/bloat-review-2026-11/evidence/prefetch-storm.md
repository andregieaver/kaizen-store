# A prefetch loop on listing and search pages (local build only, as far as checked)

Found while measuring, 11 Nov 2026. On the local production build (`pnpm start`, stores at `/s/{store}/{market}/...` addresses,
`NEXT_PUBLIC_STORE_DOMAIN` unset), a category page and the search page never go quiet: the client router sends the same
segment prefetch about 160 times a second for as long as the page is open.

- `/s/demo/no/category/belysning`: 2,686 requests in 8 s after load; 1,316 `Fetch` + 1,313 `Other` (preflight-like twins) for one
  link, e.g. `/s/demo/no/category/hjem?_rsc=...` or `/s/demo/no/p/demo-handlenett?_rsc=...` (which link varies by run).
- `/s/demo/no/search?q=lampe`: 2,160 in 8 s, for `/s/demo/no/search?_rsc=...`.
- Request headers of one: `rsc: 1`, `next-router-prefetch: 1`,
  `next-router-segment-prefetch: /s/$d$store/$d$market/@drawer/!KF9fU0xPVF9fKQ/$c$rest/__PAGE__`,
  `next-url: /s/demo/no/category/belysning`. So it is the `@drawer` parallel slot's catch-all (`[...rest]`) page segment of the
  target route that is asked for again and again. Each answer is 200.
- The home page, `/products`, a product page, the cart and the admin do not do it (38 to 107 requests in all).
- Production, checked for 5 s each on `https://demo.kaizenstore.site/no/search?q=lampe`, `/no/products` and `/no`: 55 to 58
  requests, no loop. Production serves stores on their own hosts (a rewrite to `/s/...`), and may be on another commit.

Reproduce: `node scripts/storm.mjs "http://localhost:3000/s/demo/no/search?q=lampe" 8 phone` (the app is running on
port 3000 during this review; the script prints the repeated address, its headers and the initiator).

Why it matters even if production is spared: CI's e2e jobs run against exactly these `/s/...` addresses, so every listing and
search spec runs under a request flood (the code review notes "one unrelated test timed out under load"); and it shows a route
shape (`@drawer` slot with a catch-all) whose prefetch answer the client cannot keep.
