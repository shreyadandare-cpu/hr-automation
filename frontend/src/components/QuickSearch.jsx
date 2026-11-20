import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { menuFor } from "../lib/menu.js";
import Modal from "./Modal.jsx";
import { Icon, initials } from "./ui.jsx";

const norm = (s) => String(s || "").toLowerCase();

/* Quick search: one box that finds any page in the menu and any colleague, from anywhere in the app.
   Opened from the top bar or with Ctrl+K (Cmd+K on a Mac). Arrow keys move, Enter opens, Escape closes. */
export default function QuickSearch({ onClose }) {
  const auth = useAuth();
  const { people } = useData();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);

  const results = useMemo(() => {
    const t = norm(q).trim();
    const pages = menuFor(auth).flatMap((g) => g.items.map(([to, label, icon]) => ({ kind: "Pages", key: to, to, label, sub: g.label || "Home", icon })))
      .filter((p) => !t || norm(p.label).includes(t) || norm(p.sub).includes(t));
    const staff = t ? (people || []).filter((p) => p.status !== "offboarded")
      .filter((p) => [p.name, p.email, p.title, p.dept, p.no].some((v) => norm(v).includes(t)))
      .slice(0, 8).map((p) => ({ kind: "People", key: p.email, to: `/app/employees/${encodeURIComponent(p.email)}`, label: p.name, sub: [p.title, p.dept].filter((x) => x && x !== "—").join(", ") || p.email, person: p })) : [];
    return [...pages.slice(0, t ? 8 : 6), ...staff];
  }, [q, people, auth]);

  useEffect(() => { setAt(0); }, [q]);
  const go = (r) => { if (!r) return; onClose(); nav(r.to); };
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[at]); }
  };
  useEffect(() => { const el = document.getElementById(`qs-${at}`); if (el) el.scrollIntoView({ block: "nearest" }); }, [at]);

  let lastKind = null;
  return (
    <Modal onClose={onClose} label="Search">
      <div className="qs flex max-h-[min(70vh,640px)] flex-col">
        <div className="flex items-center gap-3 border-b border-line py-3.5 pr-16 pl-5 text-ink-faint [&>svg]:size-5 [&>svg]:flex-none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input data-autofocus className="min-w-0 flex-1 border-0 bg-transparent px-0 py-2 font-body text-[17px] leading-[1.4] font-normal text-ink placeholder:text-ink-faint focus:outline-0" placeholder="Search pages and people" aria-label="Search pages and people" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={key} role="combobox" aria-expanded="true" aria-controls="qs-list" aria-activedescendant={results[at] ? `qs-${at}` : undefined} autoComplete="off" />
        </div>
        <ul className="m-0 flex-1 list-none overflow-y-auto p-2" id="qs-list" role="listbox" aria-label="Results">
          {results.length ? results.map((r, i) => {
            const head = r.kind !== lastKind ? <li className="px-3 pt-2.5 pb-1.5 font-body text-[12.5px] leading-none font-bold text-ink-faint" role="presentation">{r.kind}</li> : null;
            lastKind = r.kind;
            return [head,
              <li key={r.kind + r.key} id={`qs-${i}`} role="option" aria-selected={i === at} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-1.5 ${i === at ? "bg-tint" : ""}`}
                onMouseEnter={() => setAt(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
                {r.person ? <span className="avatar size-[34px] text-[12px] shadow-none" style={{ background: r.person.color }}>{initials(r.person.name)}</span> : <span className="grid size-[34px] flex-none place-items-center gap-0 rounded-[10px] bg-tint-2 text-accent [&>svg]:size-[18px]"><Icon name={r.icon} /></span>}
                <span className="flex min-w-0 flex-col gap-0.5"><b className="overflow-hidden font-bold text-ellipsis whitespace-nowrap">{r.label}</b><span className="overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-ink-faint">{r.sub}</span></span>
              </li>];
          }) : <li className="px-4 py-7 text-center text-ink-faint" role="presentation">Nothing matches “{q}”. Please try a name, an email or a page.</li>}
        </ul>
        <div className="flex flex-wrap gap-4 border-t border-line px-5 py-2.5 text-[13px] text-ink-faint [&_kbd]:mr-1" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
      </div>
    </Modal>
  );
}
