import { useMemo, useState } from "react";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal from "../../components/Modal.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import { useToast } from "../../components/toast.jsx";
import { lc } from "../../lib/useLeave.js";
import { Svg, errOf, postUrl } from "./lib.jsx";

const MAX = 25;

/* Share inside the app: colleagues get a notification in their bell that opens the post; or copy the post's link. */
export default function ShareModal({ post, onShared, onClose }) {
  const { user } = useAuth();
  const { people } = useData();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const colleagues = useMemo(() => (people || []).filter((p) => p.status !== "offboarded" && lc(p.email) !== lc(user.email))
    .sort((a, b) => a.name.localeCompare(b.name)), [people, user.email]);
  const shown = colleagues.filter((p) => !q.trim() || lc(`${p.name} ${p.title} ${p.dept}`).includes(lc(q.trim()))).slice(0, 60);
  const toggle = (email) => setPicked((x) => (x.includes(email) ? x.filter((e) => e !== email) : x.length >= MAX ? (toast(`Up to ${MAX} people at a time.`), x) : [...x, email]));

  const copy = async () => {
    try { await navigator.clipboard.writeText(postUrl(post.id)); } catch { toast("Couldn't copy. The link is " + postUrl(post.id)); return; }
    toast("Link copied. Anyone signed in can open it.");
    const r = await api("POST", `/api/posts/${post.id}/share`, { via: "link" });
    if (r.ok) onShared(r.data);
  };
  const send = async () => {
    setBusy(true);
    const r = await api("POST", `/api/posts/${post.id}/share`, { to: picked, message: note });
    setBusy(false);
    if (!r.ok) { toast(errOf(r, "Could not share the post.")); return; }
    onShared(r.data);
    toast(`Shared with ${picked.length === 1 ? (colleagues.find((p) => p.email === picked[0]) || {}).name : `${picked.length} people`}.`);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <div className="card-h"><h3>Share post</h3></div>
      <div className="card-b sh-body">
        <button type="button" className="sh-link" onClick={copy}><span className="sh-link-ic"><Svg name="link" /></span>
          <span><b>Copy link</b><small>Opens this post in the HR Access Hub</small></span></button>
        <div className="sh-or"><span>or send to colleagues</span></div>
        <input className="input" type="search" placeholder="Search by name or team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search colleagues" />
        {picked.length > 0 && <div className="sh-chips">{picked.map((e) => { const p = colleagues.find((x) => x.email === e);
          return <button key={e} type="button" className="sh-chip" onClick={() => toggle(e)} aria-label={`Remove ${p ? p.name : e}`}>{p ? p.name : e}<Svg name="close" size={14} /></button>; })}</div>}
        <div className="sh-list" role="listbox" aria-multiselectable="true" aria-label="Colleagues">
          {shown.map((p) => (
            <label key={p.email} className={`sh-row ${picked.includes(p.email) ? "on" : ""}`}>
              <PersonAvatar email={p.email} name={p.name} />
              <span className="grow"><b>{p.name}</b><small>{p.title}</small></span>
              <input type="checkbox" checked={picked.includes(p.email)} onChange={() => toggle(p.email)} />
            </label>))}
          {!shown.length && <div className="empty">No one matches that search.</div>}
        </div>
        {picked.length > 0 && <input className="input" maxLength={300} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />}
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" onClick={onClose}>Close</button>
        <button type="button" className="btn primary" onClick={send} disabled={busy || !picked.length}>{busy ? "Sending…" : picked.length ? `Send to ${picked.length}` : "Send"}</button>
      </div>
    </Modal>
  );
}
