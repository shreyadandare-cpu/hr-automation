import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { Field } from "../../components/Modal.jsx";
import { Callout, DownloadIcon, Skeleton, ViewTabs } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { BANNER_PRESETS, BANNER_THEMES, CELEBRATIONS, ICON_PROD, SIG_DEFAULT_OPTS, SIG_STYLES, aboutText, copyHtml, copyText, captionFor, drawBackground, drawBanner, drawCard, drawCelebrate, fileSafe, hashtags, headlines, jpegOf,
  pdfFromJpegs, saveBlob, saveText, signatureHtml, signaturePlain, toBlob, webLink } from "./kit.js";

/* A picture drawn on a canvas, shown as an image. It is drawn again when the inputs change. */
function Drawn({ draw, deps, alt, className = "" }) {
  const [url, setUrl] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let live = true; setBad(false);
    draw().then((c) => { if (live) setUrl(c.toDataURL("image/png")); }).catch(() => { if (live) setBad(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  if (bad) return <div className="empty">Could not draw this. Reload the page and try again.</div>;
  return url ? <img className={`dk-img ${className}`} src={url} alt={alt} /> : <div className="dk-img dk-loading" role="status" aria-label="Drawing"><Skeleton className="size-full rounded-[inherit]" /></div>;
}
const Btn = ({ children, ...p }) => <button type="button" className="btn glass sm" {...p}>{children}</button>;

/** Tells the person what is missing, and who can add it. Nothing is made up to fill a gap. */
export function MissingNotice({ missing }) {
  if (!missing.length) return null;
  return (
    <Callout>
      <b>Some of your details are missing.</b> Your kit leaves them out instead of guessing.
      <ul className="dk-missing">{missing.map((m) => <li key={m.key}><b>{m.label}:</b> {m.hint} {m.link && <Link to={m.link} className="font-bold text-accent underline underline-offset-2 hover:text-maroon">Complete my profile</Link>}</li>)}</ul>
    </Callout>
  );
}

const needTitle = (p) => !p.title;
const NeedHint = ({ p }) => (needTitle(p) ? <span className="muted dk-hint">Downloads open once HR adds your designation.</span> : null);

const SIG_APPS = {
  gmail: ["Gmail", ["Press Copy signature.", "In Gmail, click the gear, then See all settings.", "On the General tab, scroll to Signature and click Create new. Give it a name.", "Click in the box and paste.", "Under Signature defaults, choose it for new emails and replies, then click Save changes at the bottom."]],
  outlook: ["Outlook", ["Press Copy signature.", "New Outlook: Settings (the gear), Accounts, Signatures. Classic Outlook: File, Options, Mail, Signatures.", "Click New signature and give it a name.", "Click in the box and paste.", "Choose it for new messages and replies, then click Save."]],
  apple: ["Apple Mail", ["Press Copy signature.", "In Mail, open Settings, then Signatures.", "Click + to add a signature and give it a name.", "Turn off \"Always match my default message font\", click in the box and paste.", "Choose it for your account, then close the window."]],
  phone: ["Phone", ["Phone mail apps keep their own, text-only signature.", "Press Copy plain text, send it to yourself, then paste it into the app's signature setting (Gmail app: Settings, your account, Mobile signature)."]],
};
const OPT_LABELS = [["badge", "Google Cloud Premier Partner line"], ["cases", "Case studies link"], ["offices", "Office locations"], ["conf", "Confidentiality note"]];

/* The email signature builder: change the details and options on the left, the preview on the right follows. What is typed is kept on this computer. */
export function Signature({ p }) {
  const toast = useToast();
  const key = `dk-sig:${p.email}`;
  const base = { name: p.name, title: p.title, phone: p.phone, linkedin: p.linkedin, booking: "" };
  const saved = (() => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } })();
  const [f, setF] = useState({ ...base, ...(saved && saved.f) });
  const [o, setO] = useState({ ...SIG_DEFAULT_OPTS, ...(saved && saved.o) });
  const [openApp, setOpenApp] = useState("gmail");   // which "how to add it" panel is open: opening one closes the others
  const [iconsLive, setIconsLive] = useState(false);   // are the signature icons already on the live site? (they arrive with the next deploy)
  useEffect(() => { const im = new Image(); im.onload = () => setIconsLive(true); im.onerror = () => setIconsLive(false); im.src = `${ICON_PROD}/icon-mail.png?probe=${Date.now()}`; }, []);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ f, o })); } catch { /* storage blocked: the page still works */ } }, [f, o, key]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const sig = { ...f, name: f.name.trim() || p.name, title: f.title.trim(), phone: f.phone.trim(), email: p.email };
  const html = signatureHtml(sig, o, false, iconsLive), previewHtml = signatureHtml(sig, o, true), plain = signaturePlain(sig, o);   // the preview loads pictures from this site; the copy loads them from the live one
  const done = (ok, what) => toast(ok ? `${what} copied.` : "Could not copy. Select it and copy by hand.");
  const BLURB = { classic: "Logo beside your details", executive: "Stacked, with icons and the partner badge", compact: "Text only, light for replies" };
  return (
    <div className="dk-stack dk-sig">
      <div className="card"><div className="card-h"><h3><span className="dk-step">1</span>Choose a style</h3></div>
        <div className="card-b dk-stylecards" role="radiogroup" aria-label="Signature style">
          {SIG_STYLES.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={o.style === k} className={`dk-stylecard${o.style === k ? " on" : ""}`} onClick={() => setO({ ...o, style: k })}>
              <div className="dk-mini" aria-hidden="true"><div className="dk-mini-in" dangerouslySetInnerHTML={{ __html: signatureHtml(sig, { ...o, style: k }, true) }} /></div>
              <b>{l}</b><span>{BLURB[k]}</span>
            </button>))}
        </div>
      </div>

      <div className="card"><div className="card-h"><h3><span className="dk-step">2</span>What to show</h3></div>
        <div className="card-b form">
          <p className="muted dk-hint" style={{ gridColumn: "1 / -1", margin: 0 }}>Your name, designation, mobile and LinkedIn come from your profile. Change them on My profile.</p>
          <div className="dk-togglewrap" style={{ gridColumn: "1 / -1" }}>
            <span className="dk-togglelabel">Show in my signature</span>
            <div className="dk-toggles">{OPT_LABELS.map(([k, l]) => { const off = k === "badge" && o.style === "compact"; return <button key={k} type="button" className={`dk-toggle${o[k] && !off ? " on" : ""}`} aria-pressed={!!o[k] && !off} disabled={off} title={off ? "The compact style is text only, so it has no badge." : undefined} onClick={() => setO({ ...o, [k]: !o[k] })}>{o[k] && !off ? "✓ " : ""}{l}</button>; })}</div>
            <p className="muted dk-hint" style={{ margin: 0 }}>Saved on this computer. A Google photo is not offered: a picture in an email must load from the internet for every reader, and profile photos here are private.</p>
          </div>
        </div>
      </div>

      <div className="card"><div className="card-h"><h3><span className="dk-step">3</span>Preview and copy</h3></div>
        <div className="card-b">
          <div className="dk-sigbox dk-sigmail"><p className="dk-regards">Best regards,</p><div dangerouslySetInnerHTML={{ __html: previewHtml }} /></div>
          <div className="row dk-actions">
            <button type="button" className="btn primary" onClick={async () => done(await copyHtml(html, plain), "Signature")}>Copy signature</button>
            <button type="button" className="btn glass" onClick={async () => done(await copyText(plain), "Plain text")}>Copy plain text</button>
          </div>
          {o.style === "executive" && !iconsLive && <p className="muted dk-hint">The icon pictures reach the live site with the next update. Until then a copied Executive signature uses the letters E, M, W and A instead of icons; the preview already shows the icons.</p>}
          <div className="dk-acc">{Object.entries(SIG_APPS).map(([k, [l, steps]]) => (
            <details key={k} open={openApp === k}><summary onClick={(e) => { e.preventDefault(); setOpenApp(openApp === k ? null : k); }}>{l}<span className="caret" aria-hidden="true" /></summary><ol className="dk-ol">{steps.map((t) => <li key={t}>{t}</li>)}</ol></details>))}</div>
        </div>
      </div>
    </div>
  );
}

export function Card({ p }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const png = async (side) => { setBusy(side); try { saveBlob(await toBlob(await drawCard(p, side)), `${fileSafe(p.name)}-business-card-${side}.png`); } catch { toast("Could not make the file."); } setBusy(""); };
  const pdf = async () => {
    setBusy("pdf");
    try {
      const pages = [];
      for (const side of ["front", "back"]) { const c = await drawCard(p, side); pages.push({ jpeg: await jpegOf(c), w: c.width, h: c.height }); }
      saveBlob(pdfFromJpegs(pages, 252, 144), `${fileSafe(p.name)}-business-card.pdf`);
    } catch { toast("Could not make the file."); }
    setBusy("");
  };
  const k = [p.name, p.title, p.email, p.phone, p.location].join("|");
  return (
    <div className="card"><div className="card-h"><h3>Your business card</h3><span className="muted">3.5 × 2 in, print ready</span></div>
      <div className="card-b">
        <div className="dk-pair">
          <figure><Drawn draw={() => drawCard(p, "front")} deps={[k, "f"]} alt="Business card front" /><figcaption>Front</figcaption></figure>
          <figure><Drawn draw={() => drawCard(p, "back")} deps={["b"]} alt="Business card back" /><figcaption>Back</figcaption></figure>
        </div>
        <div className="row dk-actions">
          <button type="button" className="btn primary sm" disabled={needTitle(p) || !!busy} onClick={pdf}><DownloadIcon />PDF, both sides</button>
          <Btn disabled={needTitle(p) || !!busy} onClick={() => png("front")}><DownloadIcon />Front PNG</Btn>
          <Btn disabled={needTitle(p) || !!busy} onClick={() => png("back")}><DownloadIcon />Back PNG</Btn>
          <NeedHint p={p} />
        </div>
      </div>
    </div>
  );
}

/* Welcome & celebrations: a square LinkedIn card and a ready caption. The photo stays on the device: it is only drawn into the download. */
export function Celebrate({ p }) {
  const toast = useToast();
  const [sub, setSub] = useState("card");
  const [occ, setOcc] = useState("welcome"), [theme, setTheme] = useState("maroon"), [hl, setHl] = useState(""), [em, setEm] = useState("");
  const [photo, setPhoto] = useState(""), [caption, setCaption] = useState(captionFor("welcome", p));
  const O = CELEBRATIONS[occ];
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  const pick = (k) => { setOcc(k); setHl(""); setEm(""); setCaption(captionFor(k, p)); };
  const opts = { occasion: occ, theme, headline: hl.trim(), emphasis: em.trim(), name: p.name, title: p.title, photoUrl: photo };
  const addPhoto = (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) { toast("Choose a PNG, JPG or WebP picture."); return; }
    if (f.size > 10 * 1048576) { toast("That picture is over 10 MB. Choose a smaller one."); return; }
    setPhoto(URL.createObjectURL(f));
  };
  const download = async () => { try { saveBlob(await toBlob(await drawCelebrate(opts)), `${fileSafe(p.name)}-${occ}-card.png`); } catch { toast("Could not make the file."); } };
  const copy = async () => toast((await copyText(caption)) ? "Caption copied." : "Could not copy. Select it and copy by hand.");
  return (
    <div className="dk-stack">
      <ViewTabs view={sub} onView={setSub} label="Welcome & celebrations views" views={[["card", "Card"], ["caption", "Caption & hashtags"]]} />
      <div className="card" style={sub === "card" ? undefined : { display: "none" }}><div className="card-h"><h3>Welcome &amp; celebrations</h3><span className="muted">1080 × 1080, for LinkedIn</span></div>
        <div className="card-b dk-celebrate">
          <div className="dk-cel-form">
            <div className="dk-bn-row" role="group" aria-label="Occasion">
              {Object.entries(CELEBRATIONS).map(([k, v]) => <button key={k} type="button" className={`dk-toggle${occ === k ? " on" : ""}`} aria-pressed={occ === k} onClick={() => pick(k)}>{v.label}</button>)}
            </div>
            <div className="dk-bn-fields">
              <Field id="ce-h" label="Headline"><input className="input" id="ce-h" value={hl} maxLength={40} placeholder={O.h} onChange={(e) => setHl(e.target.value)} /></Field>
              <Field id="ce-e" label="Emphasis, in italic"><input className="input" id="ce-e" value={em} maxLength={30} placeholder={O.e} onChange={(e) => setEm(e.target.value)} /></Field>
            </div>
            <div className="seg" role="radiogroup" aria-label="Theme">{[["maroon", "Maroon"], ["light", "Warm light"]].map(([k, l]) => <label key={k}><input type="radio" name="cet" checked={theme === k} onChange={() => setTheme(k)} /><span>{l}</span></label>)}</div>
            <div className="row dk-actions">
              <label className="btn glass sm" style={{ cursor: "pointer" }}>{photo ? "Change photo" : "Add your photo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={addPhoto} style={{ display: "none" }} /></label>
              {photo && <Btn onClick={() => setPhoto("")}>Remove photo</Btn>}
            </div>
            <p className="muted dk-hint" style={{ margin: 0 }}>Name and designation come from your profile. Your photo stays on your device: it is only drawn into the download.</p>
          </div>
          <div className="dk-cel-view">
            <Drawn draw={() => drawCelebrate(opts)} deps={[occ, theme, hl, em, photo, p.name, p.title]} alt="Celebration card preview" />
            <div><button type="button" className="btn primary" onClick={download}><DownloadIcon />Download card</button></div>
          </div>
        </div>
      </div>
      <div className="card" style={sub === "caption" ? undefined : { display: "none" }}><div className="card-h"><h3>Caption</h3><span className="muted">edit before you post</span></div>
        <div className="card-b"><textarea className="input" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="Caption" />
          <div className="row dk-actions"><button type="button" className="btn primary sm" onClick={copy}>Copy caption</button><Btn onClick={() => setCaption(captionFor(occ, p))}>Reset caption</Btn></div>
          <p className="muted dk-hint">Fill in the [brackets] with your own words.</p>
          <h4 className="dk-subh">Hashtags</h4>
          <Hashtags p={p} base={O.tags} topic={occ} text={caption} setText={setCaption} where="your caption" /></div></div>
    </div>
  );
}

const PLATFORMS = {
  meet: ["Google Meet", ["Download the picture below.", "Join or start a meeting, then click the three dots, Apply visual effects.", "Click Add (the + tile), choose the downloaded picture, and close the panel."]],
  zoom: ["Zoom", ["Download the picture below.", "In Zoom, open Settings, Backgrounds & Effects. During a call, click the arrow next to Stop Video, then Choose Virtual Background.", "Click the + and Add Image, then pick the downloaded picture."]],
  teams: ["Microsoft Teams", ["Download the picture below.", "Before joining, click Effects and avatars. During a call, open More, then Effects and avatars.", "Choose Video effects, then New (the + tile), and pick the downloaded picture."]],
};
export function Background({ p }) {
  const toast = useToast();
  const [theme, setTheme] = useState("light"), [show, setShow] = useState(true), [plat, setPlat] = useState("meet");
  const o = { theme, name: p.name, title: p.title, showName: show };
  const save = async () => { try { saveBlob(await toBlob(await drawBackground(o)), `${fileSafe(p.name)}-call-background.png`); } catch { toast("Could not make the file."); } };
  return (
    <div className="dk-stack">
      <div className="card"><div className="card-b dk-cb">
        <div className="dk-cb-head"><h3 className="dk-bn-h">Video-call background</h3><p className="muted">For Google Meet, Zoom and Teams: your name and designation on a Wohlig background, 1920×1080.</p></div>
        <div className="dk-cb-body">
          <div className="dk-cb-side">
            <div className="seg" role="radiogroup" aria-label="Theme">{BANNER_THEMES.map(([k, l]) => <label key={k}><input type="radio" name="cbt" checked={theme === k} onChange={() => setTheme(k)} /><span>{l}</span></label>)}</div>
            <label className="dk-cb-check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show my name &amp; designation</label>
            <p className="muted dk-hint" style={{ margin: 0 }}>Uses the name and designation from your record. Your app may show it mirrored to you; others see it the right way round.</p>
            <div><button type="button" className="btn primary" onClick={save}><DownloadIcon />Download background</button></div>
          </div>
          <Drawn draw={() => drawBackground(o)} deps={[theme, show, p.name, p.title]} alt="Call background preview" />
        </div>
      </div></div>
      <div className="card"><div className="card-h"><h3>Use it in a call</h3></div>
        <div className="card-b">
          <div className="seg" role="radiogroup" aria-label="Program">{Object.entries(PLATFORMS).map(([k, [l]]) => <label key={k}><input type="radio" name="plat" checked={plat === k} onChange={() => setPlat(k)} /><span>{l}</span></label>)}</div>
          <ol className="dk-ol">{PLATFORMS[plat][1].map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
      </div>
    </div>
  );
}

/* Hashtag chips: the standard ones plus ideas from Gemini AI. Clicking one copies it and adds it to the text box it belongs to
   (the About text or the caption), on a hashtag line at the end. Gemini sees only the designation and department, never the name or contact details. */
function Hashtags({ p, base, topic, text, setText, where }) {
  const toast = useToast();
  const [ai, setAi] = useState([]), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const key = `dk-aitags:${p.email}:${topic}`;
  const ask = async (quiet, have) => {
    setBusy(true); setErr("");
    const r = await api("POST", "/api/digital-kit/hashtag-ai", { avoid: [...base, ...have.filter((t) => !base.includes(t))], topic });   // the standard ones count as already shown
    setBusy(false);
    if (!r.ok) { if (!quiet) setErr(apiMsg(r)); return; }
    const all = [...have, ...r.data.hashtags.filter((t) => !have.some((x) => x.toLowerCase() === t.toLowerCase()))];
    setAi(all);
    try { sessionStorage.setItem(key, JSON.stringify(all)); } catch { /* storage blocked: it just asks again next time */ }
  };
  useEffect(() => {   // ideas appear by themselves, kept for the visit; a quiet first try shows nothing if Gemini is off or busy
    setAi([]); setErr("");
    try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (Array.isArray(c) && c.length) { setAi(c); return; } } catch { /* ask instead */ }
    ask(true, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const isAi = (t) => !base.some((x) => x.toLowerCase() === t.toLowerCase()) && ai.some((x) => x.toLowerCase() === t.toLowerCase());
  const tags = [...base, ...ai.filter((t) => !base.some((x) => x.toLowerCase() === t.toLowerCase()))];
  const has = (t) => new RegExp(`(^|\\s)${t}(?=\\s|$)`, "i").test(text);
  const use = async (t) => {
    const copied = await copyText(t);
    setText((a) => {   // add it to the hashtag line at the end, or start one
      if (new RegExp(`(^|\\s)${t}(?=\\s|$)`, "i").test(a)) return a;
      const body = a.replace(/\s+$/, ""), rows = body.split("\n"), last = rows[rows.length - 1].trim();
      if (last && /^(#\w+\s*)+$/.test(last)) { rows[rows.length - 1] = `${last} ${t}`; return rows.join("\n"); }
      return `${body}\n\n${t}`;
    });
    toast(copied ? `${t} copied and added to ${where}.` : `${t} added to ${where}. Could not copy it, select it and copy by hand.`);
  };
  return (
    <div className="dk-hashbox">
      <div className="chips" role="group" aria-label="Hashtags">
        {tags.map((t) => <button type="button" key={t} className={`dk-hash${has(t) ? " on" : ""}${isAi(t) ? " ai" : ""}`} aria-pressed={has(t)} title={`Click to copy and add to ${where}`} onClick={() => use(t)}>{t}</button>)}
      </div>
      {busy && <p className="muted dk-hint">Gemini is thinking of hashtags…</p>}
      {err && <p className="ferr" role="alert" style={{ margin: "8px 0 0" }}>{err}</p>}
      <div className="row dk-actions">
        <button type="button" className="btn glass sm" disabled={busy} onClick={() => ask(false, ai)}>{ai.length ? "More from Gemini AI" : "Suggest with Gemini AI"}</button>
        <Btn onClick={async () => toast((await copyText(tags.join(" "))) ? "Hashtags copied." : "Could not copy. Select them and copy by hand.")}>Copy all</Btn>
      </div>
      <p className="muted dk-hint">Click a hashtag to copy it and add it to {where}. The ones with a star come from Gemini AI, which sees only your designation and department.</p>
    </div>
  );
}

export function LinkedIn({ p }) {
  const toast = useToast();
  const [sub, setSub] = useState("headline");
  const [ai, setAi] = useState([]), [aiBusy, setAiBusy] = useState(false), [aiErr, setAiErr] = useState("");   // headlines Gemini wrote for me
  // Exactly three ideas are shown: Gemini's three once they arrive, the three standard ones until then (or if Gemini is off).
  // A headline HR has set takes the first of the three.
  const base = headlines(p), setBy = base.filter((h) => h.tag === "Set by HR"), std = base.filter((h) => h.tag !== "Set by HR");
  const hs = [...setBy, ...(ai.length ? ai.map((text) => ({ text, tag: "Gemini AI" })) : std)].slice(0, 3), [pick, setPick] = useState(0), [about, setAbout] = useState(aboutText(p));
  const aiKey = `dk-ai:${p.email}`;
  // Gemini's suggestions appear by themselves when this page opens (kept for the visit, so going back and forth doesn't ask again);
  // "Suggest again" asks for new ones. A quiet first try shows nothing if Gemini is off or busy, the standard headlines are still there.
  const suggest = async (quiet = false) => {
    setAiBusy(true); setAiErr("");
    const r = await api("POST", "/api/digital-kit/headline-ai", { avoid: ai });
    setAiBusy(false);
    if (!r.ok) { if (!quiet) setAiErr(apiMsg(r)); return; }
    setAi(r.data.headlines); setPick(setBy.length);
    try { sessionStorage.setItem(aiKey, JSON.stringify(r.data.headlines)); } catch { /* storage blocked: it just asks again next time */ }
  };
  useEffect(() => {
    try { const c = JSON.parse(sessionStorage.getItem(aiKey) || "null"); if (Array.isArray(c) && c.length) { setAi(c); return; } } catch { /* ask instead */ }
    suggest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [theme, setTheme] = useState("light"), [preset, setPreset] = useState(0), [bh, setBh] = useState(""), [be, setBe] = useState("");
  const copy = async (t, what) => toast((await copyText(t)) ? `${what} copied.` : "Could not copy. Select it and copy by hand.");
  // Your own words win; with nothing typed, the chosen tagline is used.
  const own = bh.trim() || be.trim(), pr = BANNER_PRESETS[preset];
  const bopts = (guide) => ({ theme, headline: own ? bh.trim() : pr.h, emphasis: own ? be.trim() : pr.e, name: p.name, guide });
  const banner = async () => { try { saveBlob(await toBlob(await drawBanner(bopts(false))), `${fileSafe(p.name)}-linkedin-banner.png`); } catch { toast("Could not make the file."); } };
  return (
    <div className="dk-stack">
      <ViewTabs view={sub} onView={setSub} label="Digital kit LinkedIn views" views={[["headline", "Headline"], ["banner", "Profile banner"], ["about", "Hashtags & About"]]} />
      <div className="card" style={sub === "headline" ? undefined : { display: "none" }}><div className="card-h"><h3>Headline</h3><button type="button" className="btn glass sm" disabled={aiBusy} onClick={() => suggest(false)}>Suggest with Gemini AI</button></div>
        <div className="card-b dk-list">
          {hs.map((h, i) => (
            <div className={`dk-opt${pick === i ? " on" : ""}`} key={h.text}>
              <label><input type="radio" name="hl" checked={pick === i} onChange={() => setPick(i)} /><span>{h.text}{h.tag && <em className="dk-tag">{h.tag}</em>}</span></label>
            </div>))}
          {aiBusy && <span className="muted">Gemini is writing your headline ideas…</span>}
          {aiErr && <p className="ferr" role="alert" style={{ margin: 0 }}>{aiErr}</p>}
          <p className="muted dk-hint" style={{ margin: 0 }}>Gemini sees only your designation and department, never your name or contact details. Check what it writes before you use it.</p>
          <div className="row dk-actions"><button type="button" className="btn primary sm" onClick={() => copy(hs[pick].text, "Headline")}>Copy headline</button>
            <a className="btn link sm" href={p.linkedin || "https://www.linkedin.com/"} target="_blank" rel="noopener noreferrer">{p.linkedin ? "Open my LinkedIn" : "Open LinkedIn"}</a></div>
          {!p.linkedin && <p className="muted dk-hint">Add your LinkedIn link in <Link to="/app/profile">My profile</Link> and this opens your own page.</p>}
        </div>
      </div>
      <div className="card" style={sub === "banner" ? undefined : { display: "none" }}><div className="card-b dk-bn">
        <div><h3 className="dk-bn-h">Your profile banner</h3><p className="muted dk-bn-sub">1584×396 for your personal LinkedIn cover. The left side stays clear because your profile photo sits there.</p></div>
        <div className="dk-bn-row">
          <div className="seg" role="radiogroup" aria-label="Theme">{BANNER_THEMES.map(([k, l]) => <label key={k}><input type="radio" name="bnt" checked={theme === k} onChange={() => setTheme(k)} /><span>{l}</span></label>)}</div>
          {BANNER_PRESETS.map((x, i) => <button key={x.label} type="button" className={`dk-toggle${!own && preset === i ? " on" : ""}`} aria-pressed={!own && preset === i} onClick={() => { setPreset(i); setBh(""); setBe(""); }}>{x.label}</button>)}
        </div>
        <div className="dk-bn-fields">
          <Field id="bn-h" label={<>Headline <span className="muted">(optional, your own words)</span></>}><input className="input" id="bn-h" value={bh} maxLength={60} placeholder={pr.h} onChange={(e) => setBh(e.target.value)} /></Field>
          <Field id="bn-e" label={<>Emphasis, in italic <span className="muted">(optional)</span></>}><input className="input" id="bn-e" value={be} maxLength={30} placeholder={pr.e} onChange={(e) => setBe(e.target.value)} /></Field>
        </div>
        <Drawn draw={() => drawBanner(bopts(true))} deps={[theme, preset, bh, be, p.name]} alt="LinkedIn banner preview" />
        <p className="muted dk-hint" style={{ margin: 0 }}>The dashed circle shows where LinkedIn puts your profile photo. It is only a guide and isn't in the download.</p>
        <div><button type="button" className="btn primary" onClick={banner}><DownloadIcon />Download banner</button></div>
      </div></div>
      <div className="dk-pair2" style={sub === "about" ? undefined : { display: "none" }}>
        <div className="card"><div className="card-h"><h3>Hashtags</h3></div>
          <div className="card-b"><Hashtags p={p} base={hashtags(p)} topic="about" text={about} setText={setAbout} where="your About text" /></div></div>
        <div className="card"><div className="card-h"><h3>About section</h3><span className="muted">edit before you use it</span></div>
          <div className="card-b"><textarea className="input" rows={7} value={about} onChange={(e) => setAbout(e.target.value)} aria-label="About section" />
            <div className="row dk-actions"><Btn onClick={() => copy(about, "About text")}>Copy</Btn><Btn onClick={() => saveText(about, `${fileSafe(p.name)}-linkedin-about.txt`)}><DownloadIcon />Text file</Btn></div>
            <p className="muted dk-hint">Fill in the [brackets] with your own words.</p></div></div>
      </div>
    </div>
  );
}
