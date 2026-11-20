import type { ReactNode } from "react";

import type {
  ContractSnapshot,
  FilledBlock,
  SnapshotSigner,
} from "@/lib/contract-fields";
import { contractText, type ContractText } from "@/lib/contract-text";
import type { BlockNode, InlineNode, RichTextDoc } from "@/lib/rich-text-doc";

/**
 * A contract as it was sent (D695): drawn from its snapshot alone, for the PDF (`contractHtml()`) and, in step 3, the signing page. Every
 * word is text, drawn by React (escaped), never HTML; formatted words (`doc`) are drawn node by node as the few elements a contract
 * takes. No hook, no script, no picture and no link, so the PDF renderer can refuse every request. Its styles are `CONTRACT_CSS`.
 */

export const CONTRACT_CSS = `
@page { size: A4; margin: 18mm; }
.kc, .kc * { box-sizing: border-box; }
.kc { color: #18181b; max-width: 210mm; margin: 0 auto; font: 10.5pt/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
.kc h1, .kc .kc-title { font-size: 18pt; line-height: 1.25; margin: 0 0 6mm; font-weight: 700; }
.kc h2 { font-size: 11.5pt; margin: 6mm 0 1.5mm; font-weight: 650; break-after: avoid; }
.kc p { margin: 0 0 3mm; white-space: pre-wrap; }
.kc ul, .kc ol { margin: 0 0 3mm; padding-left: 6mm; }
.kc ul { list-style: disc; }
.kc ol { list-style: decimal; }
.kc li { margin: 0 0 1mm; }
.kc li > p { margin: 0; }
.kc li > ul, .kc li > ol { margin: 1mm 0 0; }
.kc .kc-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin: 0 0 6mm; padding: 4mm; border: 1px solid #d4d4d8; border-radius: 2mm; }
.kc .kc-label { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #71717a; margin: 0 0 1mm; }
.kc .kc-party p { margin: 0; }
.kc table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 2mm 0 5mm; font-size: 9.5pt; }
.kc thead { display: table-header-group; }
.kc tr { break-inside: avoid; }
.kc th { text-align: left; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #52525b;
  background: #f4f4f5; border-top: 1px solid #d4d4d8; border-bottom: 1px solid #d4d4d8; padding: 2mm 2.5mm; }
.kc td { border-bottom: 1px solid #e4e4e7; padding: 2mm 2.5mm; vertical-align: top; overflow-wrap: anywhere; }
.kc .kc-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.kc tfoot td { font-weight: 650; border-top: 1px solid #a1a1aa; border-bottom: none; }
.kc .kc-quote th:nth-child(1) { width: 49%; }
.kc .kc-quote th:nth-child(2) { width: 11%; }
.kc .kc-quote th:nth-child(3), .kc .kc-quote th:nth-child(4) { width: 20%; }
.kc .kc-signatures { margin-top: 10mm; break-inside: avoid; }
.kc .kc-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.kc .kc-box { border-top: 1px solid #18181b; padding-top: 2mm; min-height: 22mm; }
.kc .kc-box p { margin: 0; }
.kc .kc-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 7.5pt; letter-spacing: 0; word-break: break-all; }
.kc .kc-nowrap { white-space: nowrap; }
.kc .kc-muted { color: #71717a; }
.kc-audit .kc-facts { border: 1px solid #e4e4e7; border-radius: 2mm; padding: .6mm 4mm; margin: 0 0 4mm; }
.kc-audit .kc-fact { display: grid; grid-template-columns: 28% 72%; gap: 3mm; padding: 1.2mm 0; border-bottom: 1px solid #f0f0f2; break-inside: avoid; }
.kc-audit .kc-fact:last-child { border-bottom: none; }
.kc-audit .kc-fact dt { margin: 0; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #71717a; padding-top: .4mm; }
.kc-audit .kc-fact dd { margin: 0; }
.kc-audit .kc-signers { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 0 0 5mm; }
.kc-audit .kc-signer { border: 1px solid #e4e4e7; border-radius: 2mm; padding: 3mm 4mm; break-inside: avoid; }
.kc-audit .kc-signer-head { margin: 0 0 2mm; padding-bottom: 2mm; border-bottom: 1px solid #f0f0f2; }
.kc-audit .kc-signer-head strong { font-weight: 650; }
.kc-audit .kc-signer dl { display: grid; grid-template-columns: 1fr 1fr; gap: 1.4mm 4mm; margin: 0; }
.kc-audit .kc-signer .kc-wide { grid-column: 1 / -1; }
.kc-audit td { padding: 1.5mm 2.5mm; }
.kc-audit h1 { margin-bottom: 4mm; }
.kc-audit h2 { margin-top: 5mm; }
.kc-audit .kc-signer dt { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #71717a; margin: 0; }
.kc-audit .kc-signer dd { margin: 0; }
.kc-audit .kc-note { margin: 3mm 0 0; font-size: 8.5pt; color: #71717a; }
`;

function Party({
  label,
  party,
  words,
}: {
  label: string;
  party: ContractSnapshot["parties"]["store"];
  words: ContractText;
}) {
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

/** Formatted words (`contract-rich.ts`): paragraphs, lists, line breaks, bold, italic and underline, as elements, never as HTML. */
function Formatted({ doc }: { doc: RichTextDoc }) {
  return <>{doc.content.map(formattedBlock)}</>;
}

function formattedBlock(node: BlockNode, index: number): ReactNode {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return <p key={index}>{formattedInline(node.content)}</p>;
    case "bulletList":
      return (
        <ul key={index}>
          {node.content.map((item, i) => (
            <li key={i}>{item.content.map(formattedBlock)}</li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={index} start={node.attrs?.start}>
          {node.content.map((item, i) => (
            <li key={i}>{item.content.map(formattedBlock)}</li>
          ))}
        </ol>
      );
    case "blockquote":
      return <div key={index}>{node.content.map(formattedBlock)}</div>;
    case "horizontalRule":
      return null;
  }
}

function formattedInline(nodes: InlineNode[] = []): ReactNode {
  if (!nodes.length) return <br />;
  return nodes.map((node, i) => {
    if (node.type === "hardBreak") return <br key={i} />;
    let out: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") out = <strong>{out}</strong>;
      else if (mark.type === "italic") out = <em>{out}</em>;
      else if (mark.type === "underline") out = <u>{out}</u>;
    }
    return <span key={i}>{out}</span>;
  });
}

function Block({
  block,
  signers,
  words,
}: {
  block: FilledBlock;
  signers: readonly SnapshotSigner[];
  words: ContractText;
}) {
  switch (block.type) {
    case "heading":
      return <h2>{block.text}</h2>;
    case "paragraph":
      return block.doc ? <Formatted doc={block.doc} /> : <p>{block.text}</p>;
    case "clause":
      return (
        <section>
          <h2>{block.title}</h2>
          {block.doc ? <Formatted doc={block.doc} /> : <p>{block.text}</p>}
        </section>
      );
    case "quote_lines":
      return (
        <table className="kc-quote">
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
                <p className="kc-label">
                  {signer.role === "store" ? words.forStore : words.forCustomer}
                </p>
                <p>{signer.name}</p>
              </div>
            ))}
          </div>
        </section>
      );
  }
}

/** The contract; `level` is its title's heading: 1 in the PDF, 2 on a page that has its own title (the signing page, the admin's preview). */
export function ContractDocumentView({
  snapshot,
  level = 1,
}: {
  snapshot: ContractSnapshot;
  level?: 1 | 2;
}) {
  const Title = level === 1 ? "h1" : "h2";
  const words = contractText(snapshot.language);
  // The first heading of the owner's own blocks is the document's title when it opens with one; else the contract's title is.
  const [first, ...rest] = snapshot.blocks;
  const opensWithHeading = first?.type === "heading";
  return (
    <article className="kc" lang={snapshot.language}>
      <Title className="kc-title">
        {opensWithHeading ? first.text : snapshot.title}
      </Title>
      <div className="kc-parties" aria-label={words.between}>
        <Party
          label={words.supplier}
          party={snapshot.parties.store}
          words={words}
        />
        <Party
          label={words.customer}
          party={snapshot.parties.customer}
          words={words}
        />
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
  signers: {
    role: "store" | "customer" | "other";
    name: string;
    email: string;
    signedName: string;
    signedAt: string;
    method: "email_code" | "admin_session";
    ip: string | null;
  }[];
  events: {
    kind: keyof ContractText["audit"]["kinds"];
    at: string;
    who: string | null;
    ip: string | null;
  }[];
  sealFingerprint: string;
};

/** The signing record: a page added to the sent PDF once everyone has signed, before it is sealed. Text only, as the contract is. */
export function ContractAuditView({ audit }: { audit: ContractAudit }) {
  const words = contractText(audit.language);
  const a = words.audit;
  const locale = audit.language === "nb" ? "nb-NO" : "en-GB";
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "long",
      timeZone: audit.timeZone,
    });
  return (
    <article className="kc kc-audit" lang={audit.language}>
      <h1>{a.title}</h1>
      <p>{a.intro}</p>
      <dl className="kc-facts">
        <div className="kc-fact">
          <dt>{a.contract}</dt>
          <dd>{audit.title}</dd>
        </div>
        <div className="kc-fact">
          <dt>{a.contractId}</dt>
          <dd className="kc-mono">{audit.contractId}</dd>
        </div>
        <div className="kc-fact">
          <dt>{a.document}</dt>
          <dd className="kc-mono">{audit.documentSha256}</dd>
        </div>
        <div className="kc-fact">
          <dt>{a.sentAt}</dt>
          <dd>{when(audit.sentAt)}</dd>
        </div>
        <div className="kc-fact">
          <dt>{a.completedAt}</dt>
          <dd>{when(audit.completedAt)}</dd>
        </div>
        <div className="kc-fact">
          <dt>{a.sealTitle}</dt>
          <dd className="kc-mono">{audit.sealFingerprint}</dd>
        </div>
      </dl>
      <h2>{a.signers}</h2>
      <div className="kc-signers">
        {audit.signers.map((s, i) => (
          <section className="kc-signer" key={i}>
            <p className="kc-signer-head">
              <span className="kc-label">
                {s.role === "store" ? words.forStore : words.forCustomer}
              </span>
              <br />
              <strong>{s.name}</strong>
            </p>
            <dl>
              <div className={s.ip ? undefined : "kc-wide"}>
                <dt>{a.signedName}</dt>
                <dd>{s.signedName}</dd>
              </div>
              {s.ip ? (
                <div>
                  <dt>{a.ip}</dt>
                  <dd className="kc-nowrap">{s.ip}</dd>
                </div>
              ) : null}
              <div className="kc-wide">
                <dt>{a.signedAt}</dt>
                <dd>{when(s.signedAt)}</dd>
              </div>
              <div className="kc-wide">
                <dt>{a.method}</dt>
                <dd>{a.methods[s.method]}</dd>
              </div>
              <div className="kc-wide">
                <dt>{a.email}</dt>
                <dd>{s.email}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
      <h2>{a.events}</h2>
      <table>
        <colgroup>
          <col style={{ width: "30%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "28%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{a.signedAt}</th>
            <th scope="col">{a.event}</th>
            <th scope="col">{a.by}</th>
            <th scope="col">{a.ip}</th>
          </tr>
        </thead>
        <tbody>
          {audit.events.map((e, i) => (
            <tr key={i}>
              <td className="kc-nowrap">{when(e.at)}</td>
              <td>{a.kinds[e.kind]}</td>
              <td>{e.who ?? ""}</td>
              <td className="kc-nowrap">{e.ip ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="kc-note">{a.sealNote}</p>
    </article>
  );
}
