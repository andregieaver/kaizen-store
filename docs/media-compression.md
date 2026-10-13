# Compressing pictures and videos (D213)

Every picture and video is made as small as it can be while it still looks the same, in the person's own browser, before it
is uploaded; files from before are offered the same from the media library. Nothing leaves the browser but the result, and no
new service is involved.

## Pictures

`compressPicture()` (`src/lib/image-compress.ts`) resizes to at most 1600 pixels (a 480 pixel copy beside it), then searches
the quality between 50 % and 95 % (five halvings) for the lowest whose result still looks the same as the resized picture,
`looksTheSame()` in `src/lib/image-quality.ts`:

- structural similarity (SSIM) in 8 × 8 windows on brightness and on colour, a see-through picture over white and over black;
- measured at half size for pictures of 960 pixels and more (how a picture kept at twice its shown size is seen), with a
  looser bar at full size too, so fine grain is not smoothed away;
- the bar: brightness 0.985 on average and 0.93 in the worst hundredth of windows, colour 0.97, full size 0.975.

The bar was set on photos (landscapes, foliage, a portrait), a screenshot and a flat graphic, checked by eye at full size and
at twice that: today's fixed 85 % failed it on fine texture (the search goes up there, so a few files grow), and passed with
room elsewhere (10–48 % smaller).

WebP from the canvas (JPEG where a browser cannot write WebP), and AVIF where asked for (page pictures and the library's own
uploads) with the AVIF encoder's WebAssembly (`@jsquash/avif`'s single-threaded build through `src/lib/avif-encode.ts`, 3.5 MB,
loaded only when a page picture is compressed; its own `encode.js` also imports a multi-threaded build with a worker, which
the production build hung on, and which needs a cross-origin isolated page anyway), kept
only when at least a tenth smaller than the WebP; a try that cannot win stops the search, and a slow computer gives AVIF up
after six seconds a try. Product pictures, the logo, share pictures and the chat agent's picture stay WebP, as emails, feeds,
social networks and AI models read them. The site icon (a PNG, D62) is not compressed.

## Videos

`compressVideo()` (`src/lib/video-compress.ts`) re-encodes with the browser's own encoder (WebCodecs through `mediabunny`,
loaded only when a video is chosen): at most 1080p either way round, H.264 in MP4 at "very high" quality, without its sound
for a row's background. It is used only when at most 80 % of the original; otherwise, and where the browser cannot encode
H.264 (Chromium as Playwright ships it cannot), the video goes up as it was. With compressing possible, a video of up to
500 MB may be chosen; what is stored is still at most 50 MB.

## Files from before: Compress

`media.compressed_at` marks a file compressed at upload or by Compress, and a marked file is never compressed again, so a
picture cannot lose a little more each time. The library offers the rest (`compressPlan()` in `src/lib/media-compress.ts`:
not a GIF, an SVG, or the logo and icon), one file from its details or all of them, the largest first.

Pictures are kept for a year under their address by browsers and the CDN, so a smaller file never overwrites the original:
it is uploaded beside it (`src/server/media-compress.ts`), and in one transaction the library row and every place that can be
edited move to the new address (`rewriteAddresses()`: products' pictures and variants, pages' drafts and published content,
menus, saved parts, the chat agent, the site's navigation, sharing, theme and CSS, custom field values, categories' and tags'
sharing pictures and reminder emails). The original is then deleted from storage, unless the file was used where it leaves the
site (products, sharing, the chat agent: an email or a preview already sent points at it), or something that is not moved
names it: terms a shopper accepted (their snapshot never changes), or, in Kaizen's library, a store template's or design
profile's picture (written only by their own modules). A place that keeps a library
file's address is added to `rewriteAddresses()` and `mediaUses()` together (`media-compress.int.test.ts`).

## Tests

`src/lib/image-quality.test.ts` (the measure, the search, the video size), `src/lib/media-compress.test.ts` (what is offered
and kept), `src/server/media-compress.int.test.ts` (the move, in the owner's site only) and `e2e/compress.spec.ts` (the
compressor in Chromium, AVIF's WebAssembly included).
