import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Modal from "../../components/Modal.jsx";
import { DownloadIcon, ViewIcon } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { copyText, drawBadge, fileSafe, fill, kb, saveBlob, saveText, toBlob } from "./kit.js";

const fileUrl = (r, dl) => `/api/digital-kit/resources/${r.id}/file${dl ? "?download=1" : ""}`;
const previewUrl = (r) => `/api/digital-kit/resources/${r.id}/preview`;
const isImage = (r) => /^image\//.test(r.mime || "");
const groupBy = (items) => { const m = new Map(); for (const r of items) { const k = r.category || "General"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return [...m.entries()]; };
const Empty = ({ children }) => <div className="empty">{children}</div>;

/* ---------- 5. Ready-to-use text ---------- */
/* A list of templates on the left, the chosen one on the right in an editor. Picking another template or pressing Reset starts from the original again. */
export function ReadyText({ items, p }) {
  const toast = useToast();
  const [id, setId] = useState(null), [text, setText] = useState(""), [q, setQ] = useState(""), [copied, setCopied] = useState(false);
  const box = useRef(null);
  const cur = items.find((r) => r.id === id) || items[0] || null;
  const original = cur ? fill(cur.body, p) : "";
  useEffect(() => { setText(original); }, [cur && cur.id, original]);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {   // the box grows with the text, so a short template does not leave a big empty box
    const el = box.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight + 2, 200), Math.round(window.innerHeight * 0.65))}px`;
  }, [text, cur && cur.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return <Empty>HR has not published any text yet.</Empty>;
  const list = items.filter((r) => !q.trim() || `${r.title} ${r.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  const copy = async () => {
    const ok = await copyText(text);
    toast(ok ? "Copied." : "Could not copy. Select the text and copy by hand.");
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600); }
  };
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="dk-rt2">
      <div className="card dk-rt2-side">
        <div className="card-h dk-rt2-h"><h3>Templates</h3><span className="dk-count">{items.length}</span>
          <div className="dk-rt2-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
            <input className="input" type="search" placeholder="Search templates" aria-label="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <ul className="dk-rt2-list">
          {list.map((r) => <li key={r.id}><button type="button" className={cur.id === r.id ? "on" : ""} aria-current={cur.id === r.id ? "true" : undefined} onClick={() => setId(r.id)}><b>{r.title}</b>{r.description && <span>{r.description}</span>}{r.audience && r.audience.length > 0 && <em className="dk-for">For your role</em>}</button></li>)}
          {!list.length && <li className="muted dk-rt2-none">Nothing matches.</li>}
        </ul>
      </div>
      <div className="card dk-rt2-edit">
        <div className="dk-rt2-top">
          <div><h3>{cur.title}</h3>{cur.description && <p className="muted">{cur.description}</p>}</div>
          <div className="dk-rt2-acts">
            <button type="button" className="btn glass sm" onClick={() => setText(original)} disabled={text === original}>Reset</button>
            <button type="button" className="btn primary sm" onClick={copy}>{copied ? "Copied \u2713" : "Copy text"}</button>
          </div>
        </div>
        <div className="card-b">
          <textarea ref={box} className="input dk-rt-box" value={text} onChange={(e) => setText(e.target.value)} aria-label={cur.title} />
          <div className="dk-rt2-foot">
            <span className="dk-pill2">Your name and details are already in</span>
            <span className="dk-pill2">Fill in the [brackets] yourself</span>
            <span className="muted dk-rt2-words">{words} {words === 1 ? "word" : "words"}</span>
          </div>
          <p className="muted dk-hint">Edit freely. Picking another template or pressing Reset brings back the original.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- shared: one row per file, with a thumbnail, what it is, and what you can do with it ---------- */
function Preview({ onClose, view }) {
  return <Modal onClose={onClose} wide><div className="card-h"><h3>{view.title}</h3></div>
    <div className="card-b">{view.src ? <img className="dk-full" src={view.src} alt={view.title} /> : <pre className="dk-text">{view.text}</pre>}</div>
    <div className="modal-f">{view.download && <a className="btn primary" href={view.download} download><DownloadIcon />Download</a>}<button type="button" className="btn glass" onClick={onClose}>Close</button></div></Modal>;
}
const IconView = ({ title, onClick }) => <button type="button" className="dk-dlbtn" onClick={onClick} aria-label={`View ${title}`} title="View"><ViewIcon /></button>;
const IconDownload = ({ title, href, name }) => <a className="btn primary sm" href={href} download={name} aria-label={`Download ${title}`}><DownloadIcon />Download</a>;

/** it: { title, desc, tags[], thumb?, tone?, mark?, href, name, onView? } */
function Row({ it }) {
  return (
    <li className="dk-row2">
      {it.onView ? <button type="button" className={`dk-thumb2 ${it.tone || "light"}${it.mark ? " mark" : ""}${it.doc ? " doc" : ""}`} onClick={it.onView} aria-label={`View ${it.title}`}>{it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <b>{it.tags[0]}</b>}</button>
        : <span className={`dk-thumb2 ${it.tone || "light"}${it.mark ? " mark" : ""}`} aria-hidden="true">{it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <b>{it.tags[0]}</b>}</span>}
      <div className="dk-row2-text"><b>{it.title}</b>{it.desc && <span>{it.desc}</span>}</div>
      <div className="dk-tags">{it.tags.map((x) => <i key={x}>{x}</i>)}</div>
      <div className="dk-icons">{it.onView && <IconView title={it.title} onClick={it.onView} />}<IconDownload title={it.title} href={it.href} name={it.name} /></div>
    </li>
  );
}
const Group = ({ title, note, children }) => <div className="card dk-grp"><div className="card-h"><h3>{title}</h3>{note && <span className="muted">{note}</span>}</div><ul className="dk-rows">{children}</ul></div>;
const extOf = (r) => (r.filename || "file").split(".").pop().toUpperCase();

/* ---------- 6. Templates ---------- */
export function Templates({ items, p }) {
  const [view, setView] = useState(null);
  const textOf = (r) => fill(r.body, p);
  const rows = items.map((r) => {
    const canView = r.hasFile ? isImage(r) || r.hasPreview : !!r.body;
    const open = () => setView(r.hasFile ? { title: r.title, src: r.hasPreview ? previewUrl(r) : fileUrl(r), download: fileUrl(r, true) } : { title: r.title, text: textOf(r) });
    return r.hasFile
      ? { key: r.id, title: r.title, desc: r.description, tags: [extOf(r), ...(r.size ? [kb(r.size)] : []), ...(r.version > 1 ? [`v${r.version}`] : [])], thumb: r.hasPreview ? `${previewUrl(r)}?thumb=1` : isImage(r) ? fileUrl(r) : null, doc: r.hasPreview, href: fileUrl(r, true), name: r.filename, onView: canView ? open : null }
      : { key: r.id, title: r.title, desc: r.description, tags: ["TXT"], href: `data:text/plain;charset=utf-8,${encodeURIComponent(textOf(r))}`, name: `${fileSafe(r.title)}.txt`, onView: canView ? open : null };
  });
  return (
    <div className="dk-stack">
      {rows.length ? <Group title="Document templates" note={`${rows.length} available`}>{rows.map((it) => <Row key={it.key} it={it} />)}</Group>
        : <Empty>HR has not published any templates yet. Decks, statements of work, letterheads and other document templates appear here when they do.</Empty>}
      {view && <Preview onClose={() => setView(null)} view={view} />}
    </div>
  );
}

/* ---------- 7. Downloads ---------- */
/* "v" makes browsers fetch the current file, not a copy they kept before the logos changed. */
const V = "?v=3";
const LOGOS = [   // one row per logo, with both formats to download
  { title: "Wohlig wordmark, maroon", desc: "For light backgrounds", file: "wohlig-logo", name: "wohlig-wordmark-maroon", tone: "light" },
  { title: "Wohlig wordmark, ivory", desc: "For maroon and dark backgrounds", file: "wohlig-logo-dark", name: "wohlig-wordmark-ivory", tone: "dark" },
  { title: "Smile mark", desc: "For profile photos, avatars and small items", file: "wohlig-smile-mark", name: "wohlig-smile-mark", tone: "light", mark: true },
];
/** One logo, two buttons: PNG and SVG. */
function LogoRow({ l }) {
  return (
    <li className="dk-row2 dk-logorow">
      <span className={`dk-thumb2 ${l.tone}${l.mark ? " mark" : ""}`} aria-hidden="true"><img src={`/${l.file}.png${V}`} alt="" loading="lazy" /></span>
      <div className="dk-row2-text"><b>{l.title}</b><span>{l.desc}</span></div>
      <div className="dk-icons">
        <a className="btn primary sm" href={`/${l.file}.png${V}`} download={`${l.name}.png`} aria-label={`Download ${l.title} as PNG`}><DownloadIcon />PNG</a>
        <a className="btn primary sm" href={`/${l.file}.svg${V}`} download={`${l.name}.svg`} aria-label={`Download ${l.title} as SVG`}><DownloadIcon />SVG</a>
      </div>
    </li>
  );
}
const BADGE = { title: "Google Cloud Premier Partner badge", desc: "Transparent circle, keep it in its own colours", href: "/wohlig-premier-partner-badge.png", name: "wohlig-premier-partner-badge.png", tags: ["PNG"], tone: "light", mark: true };
const ZIP = { title: "All logo files in one ZIP", desc: "Every logo above, plus usage notes", href: "/wohlig-logos.zip", name: "wohlig-logos.zip", tags: ["ZIP"], tone: "zip" };

export function Downloads({ items, extra, p, photoV }) {
  const toast = useToast();
  const [view, setView] = useState(null), [busy, setBusy] = useState(false);
  const badge = async () => { setBusy(true); try { saveBlob(await toBlob(await drawBadge(p, photoV ? `/api/profile/photo?v=${photoV}` : "")), `${fileSafe(p.name)}-employee-badge.png`); } catch { toast("Could not make the file."); } setBusy(false); };
  const all = [...items, ...(extra.card || []), ...(extra.background || []), ...(extra.linkedin || [])].filter((r) => r.hasFile);
  const mk = (it) => ({ ...it, key: it.href, href: it.href + V, thumb: it.tone === "zip" ? null : it.href + V, onView: it.tone === "zip" ? null : () => setView({ title: it.title, src: it.href + V, download: it.href + V }) });
  const fromRes = (r) => ({ key: r.id, title: r.title, desc: r.description, tags: [extOf(r), ...(r.size ? [kb(r.size)] : [])], thumb: isImage(r) ? fileUrl(r) : null, href: fileUrl(r, true), name: r.filename || r.title, onView: isImage(r) ? () => setView({ title: r.title, src: fileUrl(r), download: fileUrl(r, true) }) : null });
  const mainRes = all.filter((r) => !r.category).map(fromRes), others = groupBy(all.filter((r) => r.category));
  return (
    <div className="dk-stack dk-compact">
      <Group title="Logos" note="Use them as they are: do not redraw, recolour or stretch.">{LOGOS.map((l) => <LogoRow key={l.file} l={l} />)}</Group>
      <Group title="Badge, social and more" note="Partner badge, LinkedIn pictures, the full logo ZIP and your own badge.">
        {[mk(BADGE), ...mainRes, ...others.flatMap(([, rs]) => rs.map(fromRes)), mk(ZIP)].map((it) => <Row key={it.key} it={it} />)}
        <li className="dk-row2">
          <span className="dk-thumb2 light" aria-hidden="true"><b>BADGE</b></span>
          <div className="dk-row2-text"><b>Your employee badge</b><span>Your name, designation and employee number{photoV ? ", and your profile photo" : ". Add a profile photo in My profile to put it on the badge"}.{!p.title ? " Opens once HR adds your designation." : ""}</span></div>
          <div className="dk-tags"><i>PNG</i></div>
          <div className="dk-icons"><button type="button" className="btn primary sm" disabled={!p.title || busy} onClick={badge}><DownloadIcon />Download</button></div>
        </li>
      </Group>
      {view && <Preview onClose={() => setView(null)} view={view} />}
    </div>
  );
}
