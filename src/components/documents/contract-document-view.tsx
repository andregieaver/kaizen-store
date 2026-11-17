import type { ContractSnapshot, FilledBlock, SnapshotSigner } from "@/lib/contract-fields";
import { contractText, type ContractText } from "@/lib/contract-text";

/**
 * A contract as it was sent (D695): drawn from its snapshot alone, for the PDF (`contractHtml()`) and, in step 3, the signing page. Every
 * word is text, drawn by React (escaped), never HTML; no hook, no script, no picture and no link, so the PDF renderer can refuse every
 * request. Its styles are `CONTRACT_CSS`.
 */

export const CONTRACT_CSS = `
@page { size: A4; margin: 18mm; }
.kc, .kc * { box-sizing: border-box; }
.kc { color: #111; max-width: 210mm; margin: 0 auto; font: 10.5pt/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
.kc h1, .kc .kc-title { font-size: 18pt; line-height: 1.25; margin: 0 0 6mm; font-weight: 700; }
.kc h2 { font-size: 11.5pt; margin: 6mm 0 1.5mm; font-weight: 650; }
.kc p { margin: 0 0 3mm; white-space: pre-wrap; }
.kc .kc-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin: 0 0 6mm; padding: 4mm; border: 1px solid #d4d4d8; border-radius: 2mm; }
.kc .kc-label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: #52525b; margin: 0 0 1mm; }
.kc .kc-party p { margin: 0; }
.kc table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 10pt; }
.kc th { text-align: left; font-weight: 600; border-bottom: 1px solid #a1a1aa; padding: 1.5mm 2mm; }
.kc td { border-bottom: 1px solid #e4e4e7; padding: 1.5mm 2mm; vertical-align: top; }
.kc .kc-num { text-align: right; white-space: nowrap; }
.kc tfoot td { font-weight: 650; border-bottom: none; }
.kc .kc-signatures { margin-top: 10mm; break-inside: avoid; }
.kc .kc-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.kc .kc-box { border-top: 1px solid #111; padding-top: 2mm; min-height: 22mm; }
.kc .kc-box p { margin: 0; }
.kc .kc-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5pt; word-break: break-all; }
.kc-audit th { width: 32%; vertical-align: top; }
`;

function Party({ label, party, words }: { label: string; party: ContractSnapshot["parties"]["store"]; words: ContractText }) {
  return (
    <div className="kc-party">
      <p className="kc-label">{label}</p>
      <p>
        <strong>{party.name}</strong>
      </p>
      {party.orgNumber ? (
        <p>
          {words.orgNumber} {party.orgNumber}
        </p>
      ) : null}
      {party.address ? <p>{party.address}</p> : null}
    </div>
  );
}

function Block({ block, signers, words }: { block: FilledBlock; signers: readonly SnapshotSigner[]; words: ContractText }) {
  switch (block.type) {
    case "heading":
      return <h2>{block.text}</h2>;
    case "paragraph":
      return <p>{block.text}</p>;
    case "clause":
      return (
        <section>
          <h2>{block.title}</h2>
          <p>{block.text}</p>
        </section>
      );
    case "quote_lines":
      return (
        <table>
          <thead>
            <tr>
              <th>{words.item}</th>
              <th className="kc-num">{words.quantity}</th>
              <th className="kc-num">{words.unitPrice}</th>
              <th className="kc-num">{words.total}</th>
            </tr>
          </thead>
          <tbody>
            {block.lines.map((line, i) => (
              <tr key={i}>
                <td>{line.name}</td>
                <td className="kc-num">{line.quantity}</td>
                <td className="kc-num">{line.unitPrice}</td>
                <td className="kc-num">{line.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{words.totalAll}</td>
              <td className="kc-num">{block.total}</td>
            </tr>
          </tfoot>
        </table>
      );
    case "signatures":
      return (
        <section className="kc-signatures">
          <h2>{words.signatures}</h2>
          <div className="kc-boxes">
            {signers.map((signer, i) => (
              <div className="kc-box" key={i}>
                <p className="kc-label">{signer.role === "store" ? words.forStore : words.forCustomer}</p>
                <p>{signer.name}</p>
              </div>
            ))}
          </div>
        </section>
      );
  }
}

/** The contract; `level` is its title's heading: 1 in the PDF, 2 on a page that has its own title (the signing page, the admin's preview). */
export function ContractDocumentView({ snapshot, level = 1 }: { snapshot: ContractSnapshot; level?: 1 | 2 }) {
  const Title = level === 1 ? "h1" : "h2";
  const words = contractText(snapshot.language);
  // The first heading of the owner's own blocks is the document's title when it opens with one; else the contract's title is.
  const [first, ...rest] = snapshot.blocks;
  const opensWithHeading = first?.type === "heading";
  return (
    <article className="kc" lang={snapshot.language}>
      <Title className="kc-title">{opensWithHeading ? first.text : snapshot.title}</Title>
      <div className="kc-parties" aria-label={words.between}>
        <Party label={words.supplier} party={snapshot.parties.store} words={words} />
        <Party label={words.customer} party={snapshot.parties.customer} words={words} />
      </div>
      {(opensWithHeading ? rest : snapshot.blocks).map((block, i) => (
        <Block key={i} block={block} signers={snapshot.signers} words={words} />
      ))}
    </article>
  );
}

/** What the signing record says (D695 step 3): who signed, how and when, every event, and the fingerprints. */
export type ContractAudit = {
  title: string;
  language: string;
  contractId: string;
  documentSha256: string;
  sentAt: string;
  completedAt: string;
  timeZone: string;
  signers: { role: "store" | "customer" | "other"; name: string; email: string; signedName: string; signedAt: string; method: "email_code" | "admin_session"; ip: string | null }[];
  events: { kind: keyof ContractText["audit"]["kinds"]; at: string; who: string | null; ip: string | null }[];
  sealFingerprint: string;
};

/** The signing record: a page added to the sent PDF once everyone has signed, before it is sealed. Text only, as the contract is. */
export function ContractAuditView({ audit }: { audit: ContractAudit }) {
  const words = contractText(audit.language);
  const a = words.audit;
  const locale = audit.language === "nb" ? "nb-NO" : "en-GB";
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "long", timeZone: audit.timeZone });
  return (
    <article className="kc kc-audit" lang={audit.language}>
      <h1>{a.title}</h1>
      <p>{a.intro}</p>
      <table>
        <tbody>
          <tr>
            <th>{a.contract}</th>
            <td>
              {audit.title} <span className="kc-mono">({audit.contractId})</span>
            </td>
          </tr>
          <tr>
            <th>{a.document}</th>
            <td className="kc-mono">{audit.documentSha256}</td>
          </tr>
          <tr>
            <th>{a.sentAt}</th>
            <td>{when(audit.sentAt)}</td>
          </tr>
          <tr>
            <th>{a.completedAt}</th>
            <td>{when(audit.completedAt)}</td>
          </tr>
        </tbody>
      </table>
      <h2>{a.signers}</h2>
      <table>
        <thead>
          <tr>
            <th>{words.name}</th>
            <th>{a.signedName}</th>
            <th>{a.signedAt}</th>
            <th>{a.method}</th>
          </tr>
        </thead>
        <tbody>
          {audit.signers.map((s, i) => (
            <tr key={i}>
              <td>
                {s.role === "store" ? words.forStore : words.forCustomer}: {s.name}
                <br />
                <span className="kc-mono">{s.email}</span>
              </td>
              <td>{s.signedName}</td>
              <td>{when(s.signedAt)}</td>
              <td>
                {a.methods[s.method]}
                {s.ip ? (
                  <>
                    <br />
                    <span className="kc-mono">
                      {a.from} {s.ip}
                    </span>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{a.events}</h2>
      <table>
        <tbody>
          {audit.events.map((e, i) => (
            <tr key={i}>
              <td>{when(e.at)}</td>
              <td>{a.kinds[e.kind]}</td>
              <td>{e.who ?? ""}</td>
              <td className="kc-mono">{e.ip ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{a.seal}</p>
      <p className="kc-mono">{audit.sealFingerprint}</p>
    </article>
  );
}
