# Domain Connect templates (D315 6)

Kaizena Flow's two Domain Connect templates, generated from `domainConnectTemplate()` in `src/lib/domain-connect.ts`
(`src/lib/domain-connect.test.ts` fails when these files and the code disagree):

* `kaizenaflow.com.store.json`: a domain itself (an A record and the `_kaizen` proof record).
* `kaizenaflow.com.store-host.json`: a name under a domain (a CNAME and the proof record).

*Connect automatically* appears on a store's Domains page only for a waiting domain whose DNS provider has taken the template in, and
only once the signing key is set. Until then nothing changes for anyone. What it takes, none of which code can do:

1. **A key pair.** `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out dc.key` and
   `openssl pkey -in dc.key -pubout -outform DER | base64 -w0 > dc.pub.b64`.
2. **The public key in DNS.** TXT records at `_dcpubkeyv1.kaizenaflow.com`, one per 200 characters of `dc.pub.b64`:
   `p=1,a=RS256,d=…`, `p=2,a=RS256,d=…` (`publicKeyRecords()` writes them).
3. **The private key in Vercel.** The environment variable `DOMAIN_CONNECT_PRIVATE_KEY` with the PEM of `dc.key` (newlines may be
   written as `\n`). Keep it nowhere else.
4. **The templates submitted** as a pull request to <https://github.com/Domain-Connect/Templates>, then each DNS provider takes them in on
   its own schedule (Cloudflare, GoDaddy, one.com, Domeneshop, Loopia, Simply and others list their onboarding there).
