import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import BackButton from "../../components/BackButton.jsx";
import { Field } from "../../components/Modal.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import PhotoEditor from "../../components/PhotoEditor.jsx";
import { FESTIVALS, THEMES, loadImage, renderGreeting, templateName, toBlob } from "./designs.js";

const MAX_PHOTO = 5 * 1024 * 1024, MAX_TO = 10;
const dateText = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };
const when = (f) => (f.next ? `${dateText(f.next)} · ${f.inDays === 0 ? "today" : f.inDays === 1 ? "tomorrow" : `in ${f.inDays} days`}` : "Date to be announced");
const fileName = (slug, theme) => `wohlig-${slug}-${theme}-greeting.png`;

let logoCache = null;   // the Wohlig logos, loaded once
const logos = async () => (logoCache ||= Promise.all(["/wohlig-logo-dark.svg", "/wohlig-logo.svg"].map((u) => loadImage(u).catch(() => null))).then(([dark, light]) => ({ dark, light })));
/** A greeting as a small picture (a data address), for cards and thumbnails. */
async function thumb(slug, theme, extra = {}) {
  const c = await renderGreeting({ slug, theme, ...FESTIVALS[slug].say, logos: await logos(), scale: 0.4, ...extra });
  return c.toDataURL("image/jpeg", 0.85);
}

/* Festival Wishes (everyone): pick a festival, then on one page choose a look, write the greeting and share the finished picture. */
export default function Festivals() {
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [fest, setFest] = useState(null);   // the festival being worked on
  const load = useCallback(async () => {
    const r = await api("GET", "/api/festivals");
    if (!r.ok) { setFailed(true); return; }
    setFailed(false); setList(r.data.items.filter((f) => FESTIVALS[f.slug]));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (failed) return <div className="fw"><div className="card"><div className="empty">Festival Wishes could not be loaded. <button type="button" className="btn link" onClick={load}>Try again</button></div></div></div>;
  if (!list) return <div className="fw"><div className="card"><div className="empty">Loading…</div></div></div>;
  if (fest) return <Studio key={fest.slug} fest={fest} onBack={() => setFest(null)} />;

  const shown = list.filter((f) => `${f.name} ${f.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  const soon = q.trim() ? [] : shown.filter((f) => f.next).slice(0, 2);
  return (
    <div className="fw">
      <BackButton />
      <SectionHead eyebrow="For everyone" title="Festival" accent="wishes" sub="Pick a festival, choose a Wohlig-branded template, add your message and share the greeting with anyone." big={false}
        actions={<input className="input" style={{ minWidth: 240 }} type="search" placeholder="Search festivals…" aria-label="Search festivals" value={q} onChange={(e) => setQ(e.target.value)} />} />
      {!!soon.length && <>
        <h3 className="fw-h">Coming up</h3>
        <div className="fw-grid fw-soon">{soon.map((f) => <FestivalCard key={f.slug} f={f} onOpen={() => setFest(f)} big />)}</div>
      </>}
      <h3 className="fw-h">{q.trim() ? `Results for "${q.trim()}"` : "All festivals"}</h3>
      {shown.length ? <div className="fw-grid">{shown.map((f) => <FestivalCard key={f.slug} f={f} onOpen={() => setFest(f)} />)}</div>
        : <div className="card"><div className="empty">No festival matches your search.</div></div>}
    </div>
  );
}

function FestivalCard({ f, onOpen, big }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let on = true; thumb(f.slug, "creative").then((u) => on && setSrc(u)).catch(() => {}); return () => { on = false; }; }, [f.slug]);
  return (
    <article className={`card fw-card${big ? " big" : ""}`}>
      <button type="button" className="fw-pic" onClick={onOpen} aria-label={`Explore ${f.name} templates`}>{src ? <img src={src} alt="" /> : <span className="fw-ph">{FESTIVALS[f.slug].emoji}</span>}</button>
      <div className="fw-body">
        <h3>{FESTIVALS[f.slug].emoji} {f.name}</h3>
        <p>{f.description}</p>
        <span className="muted">{when(f)}</span>
        <button type="button" className="btn primary sm" onClick={onOpen}>Explore templates</button>
      </div>
    </article>
  );
}

/* ---------- one page: the looks, the words, the photo, and sharing ---------- */
function Studio({ fest, onBack }) {
  const { user } = useAuth();
  const { people } = useData();
  const toast = useToast();
  const me = (people || []).find((p) => p.email.toLowerCase() === user.email.toLowerCase());
  const mine = me && me.photoV ? `/api/profile/photo?email=${encodeURIComponent(user.email)}&v=${me.photoV}` : "";
  const [theme, setTheme] = useState(THEMES[0]);
  const [f, setF] = useState({ ...FESTIVALS[fest.slug].say, sender: "Team Wohlig", recipient: "", align: "left" });
  const [photo, setPhoto] = useState(null);   // { url, label }
  const [adjust, setAdjust] = useState(false);
  const [looks, setLooks] = useState({});     // small pictures of the four looks
  const [pic, setPic] = useState("");         // the live preview
  const [final, setFinal] = useState(null);   // the full-size PNG, prepared quietly after you stop typing
  const [err, setErr] = useState("");
  const [to, setTo] = useState([]);           // colleagues to share with
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");       // which share action is running
  const [result, setResult] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const live = useRef(0), full = useRef(0);
  const others = (people || []).filter((p) => p.email.toLowerCase() !== user.email.toLowerCase());

  useEffect(() => {   // the four looks, drawn once with the starting words
    let on = true;
    (async () => { for (const t of THEMES) { const u = await thumb(fest.slug, t.id).catch(() => ""); if (!on) return; setLooks((p) => ({ ...p, [t.id]: u })); } })();
    return () => { on = false; };
  }, [fest.slug]);
  const draw = useCallback(async (scale) => {
    const img = photo ? await loadImage(photo.url).catch(() => null) : null;
    return renderGreeting({ slug: fest.slug, theme: theme.id, ...f, photo: img, logos: await logos(), scale });
  }, [fest.slug, theme.id, f, photo]);
  useEffect(() => {   // the preview follows what you do, then the full-size picture is made so Download, Copy and Share are instant
    const a = ++live.current, b = ++full.current;
    setFinal(null);
    const t1 = setTimeout(async () => { try { const c = await draw(0.5); if (a === live.current) setPic(c.toDataURL("image/jpeg", 0.9)); } catch (e) { if (a === live.current) setErr(e.message); } }, 200);
    const t2 = setTimeout(async () => { try { const blob = await toBlob(await draw(2)); if (b === full.current) setFinal(blob); } catch (e) { if (b === full.current) setErr(e.message); } }, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [draw]);

  const upload = async (file) => {
    setErr("");
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type) || !/\.(jpe?g|png)$/i.test(file.name)) return setErr("Use a JPG, JPEG or PNG picture.");
    if (file.size > MAX_PHOTO) return setErr("The picture is larger than 5 MB. Choose a smaller one.");
    const url = URL.createObjectURL(file);
    try { await loadImage(url); } catch { URL.revokeObjectURL(url); return setErr("That file could not be read as a picture."); }
    setPhoto((old) => { if (old && old.url.startsWith("blob:")) URL.revokeObjectURL(old.url); return { url, label: file.name }; });
  };
  const changePhoto = (ph) => setPhoto((old) => { if (old && old.url.startsWith("blob:") && (!ph || ph.url !== old.url)) URL.revokeObjectURL(old.url); return ph; });

  /* ---- sharing ---- */
  const name = fileName(fest.slug, theme.id);
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare && !!final && navigator.canShare({ files: [new File([final], name, { type: "image/png" })] });
  const download = () => { const url = URL.createObjectURL(final); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  const copy = async (quiet) => {
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error("unsupported");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": final })]);
      if (!quiet) toast("Image copied. Paste it into WhatsApp, email or any chat.");
      return true;
    } catch { if (!quiet) { download(); toast("Copying images is not available here, so the image was downloaded instead."); } return false; }
  };
  const deviceShare = async () => {
    try { await navigator.share({ files: [new File([final], name, { type: "image/png" })], title: `${fest.name} greeting`, text: `${fest.name} wishes from Wohlig` }); }
    catch (e) { if (e && e.name !== "AbortError") toast("Sharing did not work on this device. Use Send by email or Copy image."); }
  };
  const email = async () => {
    setBusy("email"); setResult(null); setErr("");
    try {
      const blob = await toBlob(await draw(1));   // a lighter picture for the email
      const r = await fetch(`/api/festivals/share?slug=${encodeURIComponent(fest.slug)}&to=${encodeURIComponent(to.join(","))}&note=${encodeURIComponent(note)}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
      const data = await r.json().catch(() => null);
      if (r.status === 401) { location.href = "/login"; return; }
      if (!r.ok) throw new Error((data && data.error) || "The email could not be sent.");
      setResult(data);
      toast(data.sent.length ? `Sent to ${data.sent.length} ${data.sent.length === 1 ? "person" : "people"}.` : "Nothing was sent.");
      if (data.sent.length && !data.failed.length) { setTo([]); setNote(""); }
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const name1 = (e) => (people.find((p) => p.email === e) || {}).name || e;
  const ready = !!final;

  return (
    <div className="fw">
      <button type="button" className="back" onClick={onBack}><span className="back-ar" aria-hidden="true">←</span>All festivals</button>
      <SectionHead eyebrow={when(fest)} title={fest.name} accent="greeting" sub="Choose a look, write your message, then share it. The picture on the right is exactly what you will send." big={false} />
      {err && <div className="err" role="alert" style={{ background: "var(--bad-soft)", color: "var(--bad)", padding: "10px 14px", borderRadius: 12 }}>{err}</div>}
      <div className="fw-edit">
        <div style={{ display: "grid", gap: 22, minWidth: 0 }}>
          <div className="card"><div className="card-b" style={{ paddingTop: 22 }}>
            <span className="lab" style={{ font: "600 13px/1.2 var(--body)" }}>Choose a template</span>
            <div className="fw-looks" role="group" aria-label="Templates">
              {THEMES.map((t) => (
                <button key={t.id} type="button" className={theme.id === t.id ? "on" : ""} aria-pressed={theme.id === t.id} onClick={() => setTheme(t)}>
                  {looks[t.id] ? <img src={looks[t.id]} alt="" /> : <span className="fw-ph">…</span>}<b>{t.name}</b>
                </button>))}
            </div>
            <span className="muted">{templateName(fest.slug, theme)}: {theme.note}</span>
          </div></div>
          <div className="card"><div className="card-b fw-form" style={{ paddingTop: 22 }}>
            <Field id="fw-h" label="Headline"><input id="fw-h" className="input" maxLength={40} value={f.heading} onChange={(e) => set("heading", e.target.value)} /></Field>
            <Field id="fw-e" label="Emphasis, in italic"><input id="fw-e" className="input" maxLength={40} value={f.emphasis} onChange={(e) => set("emphasis", e.target.value)} /></Field>
            <div className="wide"><Field id="fw-m" label="Your greeting message" hint={`${f.message.length}/240`}><textarea id="fw-m" className="input" rows={3} maxLength={240} value={f.message} onChange={(e) => set("message", e.target.value)} /></Field></div>
            <Field id="fw-s" label="From (your name)"><input id="fw-s" className="input" maxLength={60} value={f.sender} onChange={(e) => set("sender", e.target.value)} /></Field>
            <Field id="fw-r" label="To (optional)" hint="Adds “Dear …” above the message."><input id="fw-r" className="input" maxLength={60} placeholder="Recipient's name" value={f.recipient} onChange={(e) => set("recipient", e.target.value)} /></Field>
            <div className="wide"><div className="field"><span className="lab">Text placement</span>
              <div className="fw-seg" role="group" aria-label="Text placement">{[["left", "Left aligned"], ["center", "Centred"]].map(([k, label]) => <button key={k} type="button" className={f.align === k ? "on" : ""} aria-pressed={f.align === k} onClick={() => set("align", k)}>{label}</button>)}</div></div></div>
            <div className="wide"><div className="field"><span className="lab">Photograph (optional)</span>
              <div className="fw-photo">
                {photo && <img src={photo.url} alt="Your photo" />}
                <label className="btn glass sm" style={{ cursor: "pointer" }}>{photo ? "Replace photo" : "Upload a photo"}<input type="file" hidden accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} /></label>
                {mine && (!photo || photo.url !== mine) && <button type="button" className="btn glass sm" onClick={() => changePhoto({ url: mine, label: "Profile photo" })}>Use my profile photo</button>}
                {photo && <button type="button" className="btn glass sm" onClick={() => setAdjust(true)}>Adjust or crop</button>}
                {photo && <button type="button" className="btn glass sm" onClick={() => changePhoto(null)}>Remove photo</button>}
              </div><span className="hint">JPG or PNG, up to 5 MB. The photo is only drawn onto the greeting on your device.</span></div></div>
          </div></div>
        </div>

        <div className="fw-side">
          <div className="fw-prev">{pic ? <img src={pic} alt="Live preview of your greeting" /> : <div className="fw-ph">Drawing the preview…</div>}</div>
          <div className="card fw-sharebox"><div className="card-b" style={{ paddingTop: 18, display: "grid", gap: 14 }}>
            <div className="field">
              <label htmlFor="fw-to">Share with a colleague</label>
              <PeoplePicker id="fw-to" people={others} value={to} onChange={(v) => setTo(v.slice(0, MAX_TO))} multi placeholder="Search by name…" />
              <span className="hint">Up to {MAX_TO} people. They get the greeting by email.</span>
            </div>
            {to.length > 0 && <input className="input" maxLength={300} placeholder="Add a short note (optional)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />}
            <div className="fw-btns">
              <button type="button" className="btn primary" disabled={!to.length || busy === "email"} onClick={email}>{busy === "email" ? "Sending…" : "Send by email"}</button>
            </div>
            {result && (
              <div className="muted" role="status">
                {result.sent.length > 0 && <div>Emailed to {result.sent.map(name1).join(", ")}.</div>}
                {result.skipped.length > 0 && <div>No email is sent to {result.skipped.map(name1).join(", ")}. Use Download or Copy image instead.</div>}
                {result.failed.length > 0 && <div style={{ color: "var(--bad)" }}>Could not reach {result.failed.map((x) => name1(x.email)).join(", ")}.</div>}
              </div>)}
            <hr />
            <div className="fw-btns">
              <button type="button" className="btn glass" disabled={!ready} onClick={download}>Download</button>
              <button type="button" className="btn glass" disabled={!ready} onClick={() => copy(false)}>Copy image</button>
              {canShare && <button type="button" className="btn glass" onClick={deviceShare}>Share…</button>}
            </div>
            <span className="muted">{ready ? "Ready. Download, Copy image and Share use the full-size picture." : "Getting the full-size picture ready…"}</span>
          </div></div>
        </div>
      </div>
      {adjust && photo && <PhotoEditor src={photo.url} onApply={(url) => { changePhoto({ url, label: "Adjusted photo" }); setAdjust(false); }} onClose={() => setAdjust(false)} />}
    </div>
  );
}
