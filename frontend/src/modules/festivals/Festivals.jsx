import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { Icon, SectionHead, CardSkeleton, Skeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import PhotoEditor from "../../components/PhotoEditor.jsx";
import { FESTIVALS, THEMES, loadImage, renderGreeting, templateName, toBlob } from "./designs.js";
import { artCanvas, artFor, artThumb } from "./images.js";
import { BRAND } from "../../brand.js";
import { festivalTheme } from "../../components/FestivalLook.jsx";

const HIDDEN = new Set(["eid-ul-adha"]);   // Eid is listed once (as Eid-ul-Fitr, which carries the Eid greeting)
const MAX_PHOTO = 5 * 1024 * 1024, MAX_TO = 10, UPCOMING_DAYS = 45;   // a festival is listed from this many days before its date
const dateText = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };
const when = (f) => (f.next ? `${dateText(f.next)} · ${f.inDays === 0 ? "today" : f.inDays === 1 ? "tomorrow" : `in ${f.inDays} days`}` : "Date to be announced");
const fileName = (slug, theme) => `wohlig-${slug}-${theme}-greeting.png`;

let logoCache = null;   // the Wohlig logos, loaded once
const logos = async () => (logoCache ||= Promise.all([BRAND.logos.dark, BRAND.logos.light].map((u) => loadImage(u).catch(() => null))).then(([dark, light]) => ({ dark, light })));
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
  const [all, setAll] = useState(false);   // show every festival, not only the upcoming ones
  const [fest, setFest] = useState(null);   // the festival being worked on
  const load = useCallback(async () => {
    const r = await api("GET", "/api/festivals");
    if (!r.ok) { setFailed(true); return; }
    setFailed(false); setList(r.data.items.filter((f) => FESTIVALS[f.slug] && !HIDDEN.has(f.slug)));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (failed) return <div className="fw"><div className="card"><div className="empty">Festival Wishes could not be loaded. <button type="button" className="btn link" onClick={load}>Try again</button></div></div></div>;
  if (!list) return <div className="fw"><CardSkeleton lines={4} /></div>;
  if (fest) return <Studio key={fest.slug} fest={fest} onBack={() => setFest(null)} />;

  const term = q.trim().toLowerCase();
  const dated = list.filter((f) => f.next).sort((a, b) => a.inDays - b.inDays);
  const near = dated.filter((f) => f.inDays <= UPCOMING_DAYS);
  const upcoming = near.length ? near : dated.slice(0, 1);   // what is coming up; the nearest one when nothing falls in the window
  const shown = term || all ? list.filter((f) => `${f.name} ${f.description}`.toLowerCase().includes(term)) : upcoming;
  return (
    <div className="fw">
      <SectionHead eyebrow="For everyone" title="Festival wishes" sub="Pick an upcoming festival and share its Wohlig greeting with anyone, by email or as a picture."
        actions={<input className="input" style={{ minWidth: 240 }} type="search" placeholder="Search all festivals…" aria-label="Search all festivals" value={q} onChange={(e) => setQ(e.target.value)} />} />
      <LookSwitch list={list} reload={load} />
      <h3 className="fw-h">{term ? `Results for "${q.trim()}"` : all ? "All festivals" : near.length ? "Coming up" : "Next festival"}</h3>
      {shown.length ? <div className="fw-grid">{shown.map((f) => <FestivalCard key={f.slug} f={f} onOpen={() => setFest(f)} />)}</div>
        : <div className="card"><div className="empty">{term ? "No festival matches your search." : "No festival date is set yet. HR can add dates under Festival dates."}</div></div>}
      {!term && (all || list.length > shown.length) && <p className="muted">{all ? "Showing every festival." : `Other festivals appear here ${UPCOMING_DAYS} days before their date.`} <button type="button" className="btn link" onClick={() => setAll(!all)}>{all ? "Show only upcoming" : "Show all festivals"}</button></p>}
    </div>
  );
}

function FestivalCard({ f, onOpen, big }) {
  const [src, setSrc] = useState("");
  useEffect(() => { const art = artFor(f.slug); if (art) { let live = true; artThumb(art).then((u) => live && setSrc(u)).catch(() => {}); return () => { live = false; }; } let on = true; thumb(f.slug, "traditional").then((u) => on && setSrc(u)).catch(() => {}); return () => { on = false; }; }, [f.slug]);
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

/* ---------- one page: the templates, the words, the photo, and sharing ---------- */
function Studio({ fest, onBack }) {
  const { user } = useAuth();
  const { people } = useData();
  const toast = useToast();
  const me = (people || []).find((p) => p.email.toLowerCase() === user.email.toLowerCase());
  const mine = me && me.photoV ? `/api/profile/photo?email=${encodeURIComponent(user.email)}&v=${me.photoV}` : "";
  const art = artFor(fest.slug);   // a ready-made picture for this festival, offered as the first template
  const templates = art ? [{ id: "original", name: "Original", note: "The ready-made Wohlig greeting exactly as designed. Its words cannot be changed; choose another template to write your own." }, ...THEMES] : THEMES;
  const [theme, setTheme] = useState(templates[0]);
  const original = theme.id === "original";
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
    if (art) artThumb(art).then((u) => on && setLooks((p) => ({ ...p, original: u }))).catch(() => {});
    return () => { on = false; };
  }, [fest.slug]);
  const draw = useCallback(async (scale) => {
    if (original) return artCanvas(art);
    const img = photo ? await loadImage(photo.url).catch(() => null) : null;
    return renderGreeting({ slug: fest.slug, theme: theme.id, ...f, photo: img, logos: await logos(), scale });
  }, [fest.slug, theme.id, f, photo, original, art]);
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
      <SectionHead eyebrow={when(fest)} title={fest.name} accent="greeting" sub="Choose a look, write your message, then share it. The picture on the right is exactly what you will send." />
      {err && <div className="err" role="alert" style={{ background: "var(--bad-soft)", color: "var(--bad)", padding: "10px 14px", borderRadius: 12 }}>{err}</div>}
      <div className="fw-edit">
        <div style={{ display: "grid", gap: 22, minWidth: 0 }}>
          <div className="card"><div className="card-b" style={{ paddingTop: 22 }}>
            <span className="lab" style={{ font: "600 13px/1.2 var(--body)" }}>Choose a template</span>
            <div className="fw-looks" role="group" aria-label="Templates">
              {templates.map((t) => (
                <button key={t.id} type="button" className={theme.id === t.id ? "on" : ""} aria-pressed={theme.id === t.id} onClick={() => setTheme(t)}>
                  {looks[t.id] ? <img src={looks[t.id]} alt="" /> : <Skeleton className="aspect-square w-full rounded-field" />}<b>{t.name}</b>
                </button>))}
            </div>
            <span className="muted">{original ? `Original: ${theme.note}` : `${templateName(fest.slug, theme)}: ${theme.note}`}</span>
          </div></div>
          {!original && <div className="card"><div className="card-b fw-form" style={{ paddingTop: 22 }}>
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
          </div></div>}
        </div>

        <div className="fw-side">
          <div className="fw-prev">{pic ? <img src={pic} alt="Live preview of your greeting" /> : <Skeleton className="aspect-square w-full rounded-card" />}</div>
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

/* HR: the festival look on the sign-in page and dashboard banner (components/FestivalLook.jsx). It turns on by itself from a few
   days before each festival date (brand.config.json festivalLook.daysBefore). HR can switch it off, and preview any festival. */
const MOTION = { lanterns: "lanterns and sparks", colours: "bursts of colour", snow: "snow", crescents: "crescent moons", gulal: "gulal", dandiya: "dandiya sticks", sparks: "sparks", confetti: "confetti" };
function LookSwitch({ list, reload }) {
  const manages = useAuth().canAll("festivals.manage");   // the festival look and dates, company-wide
  const toast = useToast();
  const [state, setState] = useState(null);
  const [dates, setDates] = useState(false);
  useEffect(() => { if (manages) fetch("/api/festival-look").then((r) => r.json()).then(setState).catch(() => {}); }, [manages]);
  if (!manages || !state) return null;
  const days = Math.max(0, Number(BRAND.festivalLook && BRAND.festivalLook.daysBefore) || 0) || 1;
  const undated = list.filter((f) => !f.next);
  const flip = async () => {
    const r = await api("PUT", "/api/festivals/look", { on: !state.on });
    if (!r.ok) { toast(apiMsg(r)); return; }
    setState(r.data); toast(r.data.on ? "The festival look is on for festival days." : "The festival look is off.");
  };
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-[1_1_320px]">
        <b className="font-display text-[17px] font-medium text-heading">Festival look on the sign-in page and dashboard</b>
        <p className="m-0 mt-1 text-[14px] text-ink-dim">{state.on ? (state.festival ? `On now: ${state.festival.name}.` : `On. It appears by itself from ${days === 1 ? "the day" : `${days} days`} before each festival date until the festival day ends: the festival's colours across the portal, its greeting, and a short celebration once a day.`) : "Off. The sign-in page and dashboard keep their usual look."}</p>
        <p className="m-0 mt-2 text-[14px] text-ink-dim">Preview:{" "}
          {list.map((f, i) => <span key={f.slug}>{i ? ", " : ""}<a className="font-bold text-accent underline underline-offset-2" href={`/app/dashboard?festival=${f.slug}`}>{f.name}</a>{MOTION[festivalTheme(f.slug).burst] ? ` (${MOTION[festivalTheme(f.slug).burst]})` : ""}</span>)}.
          {" "}<a className="font-bold text-accent underline underline-offset-2" href="/app/festivals?festival=off">End the preview</a>.</p>
        {undated.length > 0 && <p className="m-0 mt-2 text-[14px] text-warn">{undated.map((f) => f.name).join(", ")} {undated.length === 1 ? "has" : "have"} no date ahead, so {undated.length === 1 ? "its" : "their"} look will not appear. Please add the next date under Festival dates.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn glass sm" onClick={() => setDates(true)}>Festival dates</button>
        <button type="button" role="switch" aria-checked={state.on} onClick={flip} className={`btn ${state.on ? "glass" : "primary"} sm`}>{state.on ? "Turn off" : "Turn on"}</button>
      </div>
      {dates && <DatesDialog list={list} reload={reload} onClose={() => setDates(false)} />}
    </div>
  );
}

/* HR: the dates each festival falls on. A festival's look, banner and greeting appear only around these dates, and dates of
   lunar festivals change every year, so HR adds next year's here (and corrects a moon-sighted Eid by a day). */
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
function DatesDialog({ list, reload, onClose }) {
  const toast = useToast();
  const [day, setDay] = useState({}), [err, setErr] = useState({}), [busy, setBusy] = useState("");
  const add = async (f) => {
    const d = day[f.slug] || "";
    if (!d) { setErr({ ...err, [f.slug]: "Please choose a date." }); return; }
    setBusy(f.slug); const r = await api("POST", `/api/festivals/${f.slug}/dates`, { day: d }); setBusy("");
    if (!r.ok) { setErr({ ...err, [f.slug]: apiMsg(r) }); return; }
    setErr({ ...err, [f.slug]: "" }); setDay({ ...day, [f.slug]: "" }); await reload(); toast(`${f.name} on ${longDate(d)} is added.`);
  };
  const remove = async (f, d) => {
    setBusy(f.slug); const r = await api("DELETE", `/api/festivals/${f.slug}/dates/${d}`); setBusy("");
    if (!r.ok) { toast(apiMsg(r)); return; }
    await reload(); toast(`${f.name} on ${longDate(d)} is removed.`);
  };
  return (
    <Modal wide onClose={onClose} label="Festival dates">
      <div className="card-h"><h3>Festival dates</h3></div>
      <div className="card-b">
        <p className="m-0 mb-4 text-[14px] text-ink-dim">Each festival&rsquo;s look appears from {Math.max(0, Number(BRAND.festivalLook && BRAND.festivalLook.daysBefore) || 0)} days before its date. Dates of Diwali, Holi, Eid and the other lunar festivals change every year, so please add next year&rsquo;s when they are announced. Eid depends on the moon: if it moves by a day, remove the old date and add the new one.</p>
        <ul className="m-0 flex list-none flex-col gap-0 p-0">
          {list.map((f) => (
            <li key={f.slug} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-line py-3.5 first:border-t-0">
              <div className="min-w-0 flex-[1_1_220px]">
                <b className="font-display text-[16px] font-medium text-heading">{f.name}</b>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {f.dates.length ? f.dates.map((d) => (
                    <span key={d} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-tint py-0.5 pr-1 pl-3 text-[14px] text-ink">
                      {longDate(d)}
                      <button type="button" className="inline-grid size-7 place-items-center rounded-full border-0 bg-transparent p-0 text-ink-dim hover:bg-surface hover:text-bad focus-visible:outline-2 focus-visible:outline-orange [&_svg]:size-3.5" aria-label={`Remove ${longDate(d)}`} disabled={busy === f.slug} onClick={() => remove(f, d)}><Icon name="close" /></button>
                    </span>)) : <span className="text-[14px] text-warn">No date ahead</span>}
                </div>
              </div>
              <div className="flex flex-[0_1_300px] flex-wrap items-start gap-2">
                <div className="min-w-[170px] flex-1">
                  <input type="date" className="input" aria-label={`New date for ${f.name}`} value={day[f.slug] || ""} onChange={(e) => setDay({ ...day, [f.slug]: e.target.value })} aria-invalid={!!err[f.slug]} />
                  {err[f.slug] && <p role="alert" className="m-0 mt-1 text-[13.5px] text-bad">{err[f.slug]}</p>}
                </div>
                <button type="button" className="btn glass sm min-h-11" disabled={busy === f.slug} onClick={() => add(f)}>Add date</button>
              </div>
            </li>))}
        </ul>
      </div>
      <div className="modal-f"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
