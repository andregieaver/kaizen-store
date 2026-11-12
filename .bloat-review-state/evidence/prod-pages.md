# Production's documents, fetched 11 Nov 2026 (commit 411ac34, Brotli)

| Page | Document raw | RSC payload | Share | On the wire | Script tags |
|---|---|---|---|---|---|
| https://demo.kaizenstore.site/no (demo store home) | 203 KB | 149 KB | 73% | 24.5 KB | 18 |
| https://demo.kaizenstore.site/no/cart (empty cart) | 162 KB | 123 KB | 76% | 19.9 KB | 21 |
| https://kaizenaflow.com/ (Kaizena Flow's front page) | 338 KB | 244 KB | 72% | 38.2 KB | 18 |

The local build's shares (about 70%) hold in production, and production's documents are larger (real content, real header and footer).
After load, production's demo home, products and search pages each made 55 to 58 requests in 5 s (router prefetches), no loop.
