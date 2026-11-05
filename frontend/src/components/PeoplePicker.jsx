import { useEffect, useMemo, useRef, useState } from "react";

/* Type a name to find people, click one to add them. With `multi` the chosen people stay as chips with a remove button; without it
   one person is chosen at a time. `people` are { email, name, no, title }; `value` is the chosen email (or a list of emails). */
export default function PeoplePicker({ id, people, value, onChange, multi = false, placeholder = "Search by name, ID or role…", empty = "No one matches." }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [at, setAt] = useState(0);
  const box = useRef(null);
  const chosen = multi ? value : value ? [value] : [];
  const byEmail = useMemo(() => new Map((people || []).map((p) => [p.email, p])), [people]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (people || []).filter((p) => !chosen.includes(p.email) && (!s || `${p.name} ${p.no || ""} ${p.title || ""} ${p.email}`.toLowerCase().includes(s))).slice(0, 8);
  }, [people, q, chosen]);
  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const pick = (p) => { onChange(multi ? [...chosen, p.email] : p.email); setQ(""); setOpen(multi); };
  const remove = (email) => onChange(multi ? chosen.filter((x) => x !== email) : "");
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAt((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && open && matches[at]) { e.preventDefault(); pick(matches[at]); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
    else if (e.key === "Backspace" && !q && multi && chosen.length) remove(chosen[chosen.length - 1]);
  };
  const showInput = multi || !chosen.length;
  return (
    <div ref={box} style={{ position: "relative" }}>
      {chosen.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: showInput ? 8 : 0 }}>
          {chosen.map((email) => { const p = byEmail.get(email); return (
            <span key={email} className="pill p-info" style={{ fontWeight: 500, padding: "5px 6px 5px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {p ? p.name : email}
              <button type="button" aria-label={`Remove ${p ? p.name : email}`} onClick={() => remove(email)}
                style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>×</button>
            </span>); })}
        </div>)}
      {showInput && <input id={id} className="input" type="search" autoComplete="off" placeholder={multi && chosen.length ? "Add another person…" : placeholder} value={q} role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={key} />}
      {open && showInput && (
        <div id={`${id}-list`} role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 30, marginTop: 4, maxHeight: 240, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "0 14px 34px rgba(30,30,90,.18)" }}>
          {matches.length ? matches.map((p, i) => (
            <button key={p.email} type="button" role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => pick(p)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", border: 0, cursor: "pointer", color: "inherit", font: "inherit", background: i === at ? "var(--tint)" : "transparent" }}>
              <b>{p.name}</b>{p.no ? <span className="muted"> · {p.no}</span> : null}{p.title ? <div className="muted" style={{ fontSize: 13 }}>{p.title}</div> : null}
            </button>)) : <div className="muted" style={{ padding: "10px 14px" }}>{empty}</div>}
        </div>)}
    </div>
  );
}
