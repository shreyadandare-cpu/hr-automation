import { useEffect, useState } from "react";

/* Page numbers with gaps: 1 … 4 5 6 … 12 */
const pageNumbers = (cur, total) => {
  const keep = [...new Set([1, total, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= total))].sort((a, b) => a - b), out = [];
  keep.forEach((n, i) => { if (i && n - keep[i - 1] > 1) out.push(null); out.push(n); });
  return out;
};

/* Holds the page and page size for a list. `resetKey` sends it back to page 1 when the list changes (a new day, month or search). */
export function usePaged(items, resetKey = "", defaultSize = 10) {
  const [size, setSize] = useState(defaultSize);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size)), cur = Math.min(page, pages);
  return { rows: items.slice((cur - 1) * size, cur * size), pager: { total: items.length, page: cur, size, onPage: setPage, onSize: (n) => { setSize(n); setPage(1); } } };
}

export default function Pager({ total, page, size, onPage, onSize, sizes = [10, 25, 50] }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0, to = Math.min(total, page * size);
  return (
    <div className="pager">
      <span className="muted" style={{ fontSize: 13 }}>Showing {from}–{to} of {total}</span>
      <div className="row">
        <label>Rows per page<select className="input" value={size} onChange={(e) => onSize(Number(e.target.value))}>{sizes.map((n) => <option key={n}>{n}</option>)}</select></label>
        {pages > 1 && (
          <nav className="pg-nav" aria-label="Pages">
            <button type="button" className="pg" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
            {pageNumbers(page, pages).map((n, i) => n === null ? <span key={`g${i}`} className="pg-gap" aria-hidden="true">…</span>
              : <button key={n} type="button" className={`pg ${n === page ? "on" : ""}`} aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>{n}</button>)}
            <button type="button" className="pg" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
          </nav>
        )}
      </div>
    </div>
  );
}

/* Pages a list wherever it sits in a page. Use it as <Paged items={list} resetKey={search}>{(rows, pager) => ...}</Paged>, and put
   <Pager {...pager} /> under the table. (A separate component, so it is safe even after an early return in the page.) */
export function Paged({ items, resetKey = "", size = 10, children }) {
  const { rows, pager } = usePaged(items, resetKey, size);
  return children(rows, pager);
}
