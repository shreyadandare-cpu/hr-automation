import { useEffect, useState } from "react";
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
/* One template at a time: pick it, change anything in the box, then copy. Picking another template or pressing Reset starts from the original again. */
export function ReadyText({ items, p }) {
  const toast = useToast();
  const [id, setId] = useState(null), [text, setText] = useState("");
  const cur = items.find((r) => r.id === id) || items[0] || null;
  const original = cur ? fill(cur.body, p) : "";
  useEffect(() => { setText(original); }, [cur && cur.id, original]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return <Empty>HR has not published any text yet.</Empty>;
  const copy = async () => toast((await copyText(text)) ? "Copied." : "Could not copy. Select the text and copy by hand.");
  return (
    <div className="card"><div className="card-b dk-rt">
      <div className="dk-rt-head"><h3>Ready-to-use text</h3><p className="muted">On-brand words for everyday moments, already signed with your name. Swap anything in [brackets].</p></div>
      <div className="dk-pills" role="tablist" aria-label="Templates">
        {items.map((r) => <button key={r.id} type="button" role="tab" aria-selected={cur.id === r.id} className={cur.id === r.id ? "on" : ""} onClick={() => setId(r.id)}>{r.title}</button>)}
      </div>
      {cur.description && <p className="muted dk-desc" style={{ margin: 0 }}>{cur.description}</p>}
      <textarea className="input dk-rt-box" rows={14} value={text} onChange={(e) => setText(e.target.value)} aria-label={cur.title} />
      <p className="muted dk-hint" style={{ margin: 0 }}>Edit anything here before copying. Your changes stay until you press Reset or pick another template.</p>
      <div className="row dk-actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn primary" onClick={copy}>Copy text</button>
        <button type="button" className="btn glass" onClick={() => setText(original)} disabled={text === original}>Reset</button>
      </div>
    </div></div>
  );
}

/* ---------- 6. Templates ---------- */
function Preview({ onClose, view }) {
  return <Modal onClose={onClose} wide><div className="card-h"><h3>{view.title}</h3></div>
    <div className="card-b">{view.src ? <img className="dk-full" src={view.src} alt={view.title} /> : <pre className="dk-text">{view.text}</pre>}</div>
    <div className="modal-f">{view.download && <a className="btn primary" href={view.download} download><DownloadIcon />Download</a>}<button type="button" className="btn glass" onClick={onClose}>Close</button></div></Modal>;
}
/** Round icon buttons, as on the brand guidelines page: an eye to view, an arrow to download. */
const IconView = ({ title, onClick }) => <button type="button" className="dk-dlbtn" onClick={onClick} aria-label={`View ${title}`} title="View"><ViewIcon /></button>;
const IconDownload = ({ title, href, name }) => <a className="dk-dlbtn primary" href={href} download={name} aria-label={`Download ${title}`} title="Download"><DownloadIcon /></a>;

export function Templates({ items, p }) {
  const [view, setView] = useState(null);
  const textOf = (r) => fill(r.body, p);
  const viewOf = (r) => (r.hasFile ? { title: r.title, src: r.hasPreview ? previewUrl(r) : fileUrl(r), download: fileUrl(r, true) } : { title: r.title, text: textOf(r) });
  const canView = (r) => (r.hasFile ? isImage(r) || r.hasPreview : !!r.body);
  return (
    <div className="dk-stack">
      <div className="dk-grid">
        {items.map((r) => (
          <div className="card" key={r.id}><div className="card-h"><h3>{r.title}</h3>{r.version > 1 && <span className="muted">v{r.version}</span>}</div>
            <div className="card-b">
              {r.hasPreview && <button type="button" className="dk-pvbtn" onClick={() => setView(viewOf(r))} aria-label={`View ${r.title}`}><img className={`dk-thumb dk-doc${r.mime && r.mime.includes("presentation") ? " wide" : ""}`} src={previewUrl(r)} alt="" loading="lazy" /></button>}
              {r.hasFile && isImage(r) && <img className="dk-thumb" src={fileUrl(r)} alt="" loading="lazy" />}
              {r.hasFile && !isImage(r) && !r.hasPreview && <div className="dk-logo light dk-fileic" aria-hidden="true">{(r.filename || "file").split(".").pop().toUpperCase()}</div>}
              <div className="dk-tfoot">
                <p className="muted dk-desc">{r.description}{r.hasFile && r.size ? ` (${(r.filename || "").split(".").pop().toUpperCase()}, ${kb(r.size)})` : ""}</p>
                <div className="dk-icons">
                  {canView(r) && <IconView title={r.title} onClick={() => setView(viewOf(r))} />}
                  {r.hasFile && r.mime === "application/pdf" && <a className="dk-dlbtn" href={fileUrl(r)} target="_blank" rel="noopener noreferrer" aria-label={`View ${r.title}`} title="View"><ViewIcon /></a>}
                  {r.hasFile ? <IconDownload title={r.title} href={fileUrl(r, true)} name={r.filename} />
                    : r.body && <button type="button" className="dk-dlbtn primary" onClick={() => saveText(textOf(r), `${fileSafe(r.title)}.txt`)} aria-label={`Download ${r.title}`} title="Download"><DownloadIcon /></button>}
                </div>
              </div></div></div>))}
      </div>
      {!items.length && <Empty>HR has not published any templates yet. Decks, statements of work, letterheads and other document templates appear here when they do.</Empty>}
      {view && <Preview onClose={() => setView(null)} view={view} />}
    </div>
  );
}

/* ---------- 7. Downloads ---------- */
/* The same set as the brand guidelines page. "v" makes browsers fetch the current file, not a copy they kept before the logos changed. */
const V = "?v=3";
const BRAND = [
  { title: "Wordmark", desc: "PNG · light backgrounds", href: "/wohlig-logo.png", name: "wohlig-wordmark-maroon.png", tone: "light" },
  { title: "Wordmark, reversed", desc: "PNG · maroon & dark", href: "/wohlig-logo-dark.png", name: "wohlig-wordmark-ivory.png", tone: "dark" },
  { title: "Wordmark", desc: "SVG · any size", href: "/wohlig-logo.svg", name: "wohlig-wordmark-maroon.svg", tone: "light" },
  { title: "Wordmark, reversed", desc: "SVG · maroon & dark, any size", href: "/wohlig-logo-dark.svg", name: "wohlig-wordmark-ivory.svg", tone: "dark" },
  { title: "Smile mark", desc: "SVG · stickers, small items", href: "/wohlig-smile-mark.svg", name: "wohlig-smile-mark.svg", tone: "light", mark: true },
  { title: "Smile mark", desc: "PNG · profile photos, avatars", href: "/wohlig-smile-mark.png", name: "wohlig-smile-mark.png", tone: "light", mark: true },
];
const BADGE = { title: "Premier Partner badge", desc: "PNG · transparent circle", href: "/wohlig-premier-partner-badge.png", name: "wohlig-premier-partner-badge.png", tone: "light", mark: true };
const ZIP = { title: "All logos", desc: "ZIP · every file above + usage notes", href: "/wohlig-logos.zip", name: "wohlig-logos.zip", tone: "zip" };

function Tile({ it, onPreview }) {
  const label = `Download ${it.title}, ${it.desc}`;
  return (
    <div className={`dk-dlitem${it.tone === "zip" ? " zip" : ""}`}>
      {it.tone === "zip"
        ? <span className={`dk-dlthumb zip`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></svg></span>
        : onPreview ? <button type="button" className={`dk-dlthumb ${it.tone}`} onClick={onPreview} aria-label={`Preview ${it.title}`}><img src={it.thumb} alt="" loading="lazy" /></button>
        : <span className={`dk-dlthumb ${it.tone}${it.mark ? " mark" : ""}`} aria-hidden="true">{it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <b>{it.ext}</b>}</span>}
      <div className="dk-dltext"><b>{it.title}</b><span>{it.desc}</span></div>
      <div className="dk-icons">
        {onPreview && <IconView title={it.title} onClick={onPreview} />}
        <a className="dk-dlbtn primary" href={it.href} download={it.name} aria-label={label} title="Download"><DownloadIcon /></a>
      </div>
    </div>
  );
}
const fromResource = (r) => {
  const ext = (r.filename || "file").split(".").pop().toUpperCase();
  return { title: r.title, desc: r.description || `${ext}${r.size ? ` · ${kb(r.size)}` : ""}`, href: fileUrl(r, true), name: r.filename || r.title, tone: "light", thumb: isImage(r) ? fileUrl(r) : null, ext, res: r };
};

export function Downloads({ items, extra, p, photoV }) {
  const toast = useToast();
  const [view, setView] = useState(null), [busy, setBusy] = useState(false);
  const badge = async () => { setBusy(true); try { saveBlob(await toBlob(await drawBadge(p, photoV ? `/api/profile/photo?v=${photoV}` : "")), `${fileSafe(p.name)}-employee-badge.png`); } catch { toast("Could not make the file."); } setBusy(false); };
  const all = [...items, ...(extra.card || []), ...(extra.background || []), ...(extra.linkedin || [])].filter((r) => r.hasFile);
  const main = all.filter((r) => !r.category).map(fromResource), others = groupBy(all.filter((r) => r.category));
  const brand = [...BRAND, ...main.map((m) => m), BADGE, ZIP].map((it) => (it.res || it.tone === "zip" ? it : { ...it, href: it.href + V, thumb: it.href + V }));
  return (
    <div className="dk-stack">
      <div className="card"><div className="card-b dk-dl">
        <div className="dk-rt-head"><h3>Downloads</h3><p className="muted">Logo files for slides, documents, print and profiles: PNG, SVG, or every logo as one ZIP.</p></div>
        <div className="dk-dlgrid">{brand.map((it) => <Tile key={it.href + it.title} it={it} onPreview={it.res ? (isImage(it.res) ? () => setView({ title: it.res.title, src: fileUrl(it.res), download: fileUrl(it.res, true) }) : null) : it.tone !== "zip" ? () => setView({ title: it.title, src: it.href, download: it.href }) : null} />)}</div>
        <p className="muted dk-hint" style={{ margin: 0 }}>Use the logo files as they are. Do not redraw, recolour or stretch them.</p>
      </div></div>
      {others.map(([cat, rs]) => (
        <div className="card" key={cat}><div className="card-b dk-dl"><div className="dk-rt-head"><h3>{cat}</h3></div>
          <div className="dk-dlgrid">{rs.map(fromResource).map((it) => <Tile key={it.res.id} it={it} onPreview={isImage(it.res) ? () => setView({ title: it.res.title, src: fileUrl(it.res), download: fileUrl(it.res, true) }) : null} />)}</div></div></div>))}
      <div className="card"><div className="card-b dk-row"><div><b>Your employee badge</b><p className="muted dk-desc" style={{ margin: "4px 0 0" }}>A badge with your name, designation and employee number{photoV ? ", and your profile photo" : ". Add a profile photo in My profile to put it on the badge"}.{!p.title ? " Opens once HR adds your designation." : ""}</p></div>
        <button type="button" className="btn primary sm" disabled={!p.title || busy} onClick={badge}><DownloadIcon />PNG</button></div></div>
      {view && <Preview onClose={() => setView(null)} view={view} />}
    </div>
  );
}
