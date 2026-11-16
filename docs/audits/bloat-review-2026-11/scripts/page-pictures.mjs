// Bloat review step 0.44: counts the pictures of published pages that the media library holds wider than 800 px without a middle
// (800 px) copy. Read-only: one query, one line; it exits 0 always, as it is a measure (the step's done-when reads the number).
//
//   DATABASE_URL=postgres://... node docs/audits/bloat-review-2026-11/scripts/page-pictures.mjs
//
// A page never stores the copy: the reader gives it by the picture's address (src/server/media-alts.ts), so a picture with a middle
// copy in the library cannot be missing one on a page. A number above 0 counts pictures uploaded before step 0.33, which are drawn
// with two files as before.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const [{ n }] = await sql`
    with urls as (
      select jsonb_path_query(p.published, 'strict $.**.image.url') #>> '{}' as url
      from commerce.pages p
      where p.published is not null
    )
    select count(*)::int as n
    from (select distinct url from urls) u
    join commerce.media m on m.url = u.url
    where m.kind = 'image' and m.medium_url is null and coalesce(m.width, 1600) > 800`;
  console.log(`${n} page pictures wider than 800 px have a library row with no middle copy`);
} finally {
  await sql.end();
}
