import { Inline } from "@/components/inline-text";
import { inlinePlain } from "@/lib/inline-text";
import type { TableBlock } from "@/lib/page-content";

/**
 * A table (D194): rows of cells, the first row its header when the block says so. On a phone it stacks (each row a card, each
 * value after its column's name) or scrolls sideways; from Medium (by the store's screen sizes, `BREAKPOINT_CLASSES`) it is a
 * table. The stacked table is still a table to screen readers: only the display of its parts changes.
 */
export function TableView({ block }: { block: TableBlock }) {
  const [first, ...rest] = block.rows;
  if (!first) return null;
  const header = Boolean(block.header) && rest.length > 0 ? first : null;
  const body = header ? rest : block.rows;
  const stack = (block.mobile ?? "stack") === "stack";
  // Written out whole so Tailwind finds every class.
  const table = stack ? "block kzb-md-table w-full border-collapse text-left" : "w-full min-w-max border-collapse text-left";
  const group = stack ? "block kzb-md-table-row-group" : "";
  const row = stack ? "block kzb-md-table-row" : "";
  const cell = stack ? "block kzb-md-table-cell" : "";
  const striped = block.striped ? "even:bg-surface" : "";
  const markup = (
    <table className={table}>
      {block.caption && <caption className="pb-3 text-left font-semibold">{<Inline text={block.caption} />}</caption>}
      {header && (
        // Stacked, the header row is hidden visually (each value carries its column's name) but stays for screen readers.
        <thead className={stack ? "sr-only kzb-md-not-sr kzb-md-table-header-group" : ""}>
          <tr className={stack ? "block kzb-md-table-row" : ""}>
            {header.map((text, c) => (
              <th key={c} scope="col" className={`border-b-2 border-border px-3 py-2 font-semibold ${cell}`}>
                <Inline text={text} />
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody className={group}>
        {body.map((cells, r) => (
          <tr key={r} className={`border-b border-border ${row} ${striped}`}>
            {cells.map((text, c) => {
              const label = header ? inlinePlain(header[c] ?? "") : "";
              const content = (
                <>
                  {/* Stacked, the value is named by its column. */}
                  {stack && label && (
                    <span aria-hidden="true" className="kzb-md-hidden mb-0.5 block text-xs font-semibold text-muted">
                      {label}
                    </span>
                  )}
                  <Inline text={text} />
                </>
              );
              return block.rowHeaders && c === 0 ? (
                <th key={c} scope="row" className={`px-3 py-2 font-semibold ${cell}`}>
                  {content}
                </th>
              ) : (
                <td key={c} className={`px-3 py-2 align-top ${cell}`}>
                  {content}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return stack ? markup : <div className="overflow-x-auto">{markup}</div>;
}
