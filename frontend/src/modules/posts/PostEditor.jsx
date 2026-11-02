import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal from "../../components/Modal.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import { useToast } from "../../components/toast.jsx";
import { lc } from "../../lib/useLeave.js";
import { MAX_IMAGES, POST_MAX, Svg, TITLE_MAX, errOf, imgUrl, uploadPhoto } from "./lib.jsx";
import { Gallery } from "./PostCard.jsx";

/* Create or edit a post (HR only; the server checks too). `post` = the post being edited, or null for a new one. */
export default function PostEditor({ post, onSaved, onClose }) {
  const { user } = useAuth();
  const { people } = useData();
  const toast = useToast();
  const me = (people || []).find((p) => lc(p.email) === lc(user.email));
  const [title, setTitle] = useState(post ? post.title : "");
  const [body, setBody] = useState(post ? post.body : "");
  // Photos: { key, src, id (when uploaded), local (object URL to free) }
  const [photos, setPhotos] = useState(() => (post ? post.images.map((id) => ({ key: `s${id}`, src: imgUrl(id), id })) : []));
  const [tab, setTab] = useState("write");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const fileRef = useRef(null), bodyRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.focus(); }, []);
  useEffect(() => () => photos.forEach((p) => p.local && URL.revokeObjectURL(p.local)), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const uploading = photos.some((p) => !p.id);
  const dirty = post ? title !== post.title || body !== post.body || photos.map((p) => p.id).join() !== post.images.join() : !!(title.trim() || body.trim() || photos.length);
  const canSave = !busy && !uploading && (body.trim() || photos.length) && (!post || dirty);

  const pick = (files) => {
    const room = MAX_IMAGES - photos.length;
    const list = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (list.length < files.length) toast("Only JPG, PNG or WebP photos can be added.");
    if (list.length > room) toast(`A post can have up to ${MAX_IMAGES} photos.`);
    for (const f of list.slice(0, room)) {
      const key = `n${Math.random()}`, local = URL.createObjectURL(f);
      setPhotos((ps) => [...ps, { key, src: local, local }]);
      uploadPhoto(f).then((id) => setPhotos((ps) => ps.map((p) => (p.key === key ? { ...p, id } : p))))
        .catch((e) => { toast(e.message); URL.revokeObjectURL(local); setPhotos((ps) => ps.filter((p) => p.key !== key)); });
    }
  };
  const drop = (p) => { if (p.local) URL.revokeObjectURL(p.local); setPhotos((ps) => ps.filter((x) => x.key !== p.key)); };
  const move = (i, d) => setPhotos((ps) => { const n = [...ps]; const j = i + d; if (j < 0 || j >= n.length) return ps; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const save = async () => {
    const e = {};
    if (!body.trim() && !photos.length) e.body = "Write something or add a photo.";
    if (title.length > TITLE_MAX) e.title = `Keep the title under ${TITLE_MAX} characters.`;
    if (Object.keys(e).length) { setErrors(e); setTab("write"); return; }
    setBusy(true);
    const payload = { title, body, images: photos.map((p) => p.id) };
    const r = await api(post ? "PATCH" : "POST", post ? `/api/posts/${post.id}` : "/api/posts", payload);
    setBusy(false);
    if (!r.ok) { setErrors((r.data && r.data.errors) || {}); toast(errOf(r, "Could not save the post.")); return; }
    toast(post ? "Post updated." : "Post published to everyone.");
    onSaved(r.data);
  };
  const close = () => (dirty && !busy ? setLeaving(true) : onClose());
  const preview = { id: 0, author: { email: user.email, name: me ? me.name : user.email, title: me ? me.title : "" }, title: title.trim(), body: body.trim(),
    createdAt: new Date().toISOString(), images: photos.filter((p) => p.id).map((p) => p.id) };

  return (
    <Modal wide onClose={close}>
      <div className="card-h"><h3>{post ? "Edit post" : "Create post"}</h3>
        <div className="pe-tabs" role="tablist">
          {[["write", "Write"], ["preview", "Preview"]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
        </div></div>
      {tab === "write" ? (
        <div className="card-b pe-body" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}>
          <div className="pe-who"><PersonAvatar email={user.email} name={me ? me.name : user.email} /><div><b>{me ? me.name : user.email}</b><span>Posting to everyone at Wohlig</span></div></div>
          <div className="field"><label htmlFor="pe-title">Title <span className="muted">(optional)</span></label>
            <input id="pe-title" className="input pe-title" maxLength={TITLE_MAX} placeholder="e.g. 🎉 Diwali celebration at the office" value={title}
              aria-invalid={!!errors.title} onChange={(e) => { setTitle(e.target.value); setErrors({}); }} />
            {errors.title && <span className="ferr" role="alert">{errors.title}</span>}</div>
          <div className="field"><label htmlFor="pe-body">What's happening?</label>
            <textarea ref={bodyRef} id="pe-body" className="input pe-text" rows={6} maxLength={POST_MAX} placeholder="Write your announcement…" value={body}
              aria-invalid={!!errors.body} onChange={(e) => { setBody(e.target.value); setErrors({}); }} />
            <span className="hint pe-count">{body.length.toLocaleString("en-IN")} / {POST_MAX.toLocaleString("en-IN")}</span>
            {errors.body && <span className="ferr" role="alert">{errors.body}</span>}</div>
          {photos.length > 0 && (
            <div className={`pe-photos n${photos.length}`}>
              {photos.map((p, i) => (
                <div key={p.key} className={`pe-photo ${p.id ? "" : "loading"}`}>
                  <img src={p.src} alt="" />
                  <div className="pe-photo-tools">
                    {photos.length > 1 && <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move left">‹</button>}
                    {photos.length > 1 && <button type="button" onClick={() => move(i, 1)} disabled={i === photos.length - 1} aria-label="Move right">›</button>}
                    <button type="button" onClick={() => drop(p)} aria-label="Remove photo"><Svg name="close" size={16} /></button>
                  </div>
                </div>))}
            </div>)}
          <button type="button" className={`pe-drop ${dragging ? "on" : ""}`} onClick={() => fileRef.current.click()} disabled={photos.length >= MAX_IMAGES}>
            <span className="pe-drop-ic"><Svg name="photo" /></span>
            <span><b>{photos.length >= MAX_IMAGES ? `${MAX_IMAGES} photos added` : "Upload image"}</b><small>{photos.length >= MAX_IMAGES ? "Remove one to add another." : `Drag photos here or click to choose · JPG, PNG or WebP · up to ${MAX_IMAGES}`}</small></span>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        </div>
      ) : (
        <div className="card-b pe-preview">
          {preview.body || preview.images.length || preview.title
            ? <div className="pc pc-static"><header className="pc-head"><PersonAvatar email={user.email} name={preview.author.name} />
                <div className="pc-who"><b>{preview.author.name} <span className="pc-badge">HR</span></b><span>just now</span></div></header>
                {preview.title && <h4 className="pc-title">{preview.title}</h4>}
                {preview.body && <div className="pc-text">{preview.body}</div>}
                <Gallery ids={preview.images} /></div>
            : <div className="empty">Write something or add a photo to see the preview.</div>}
        </div>
      )}
      <div className="modal-f">
        <span className="grow muted" style={{ fontSize: 13, alignSelf: "center" }}>{uploading ? "Uploading photos…" : ""}</span>
        <button type="button" className="btn glass" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={save} disabled={!canSave}>{busy ? (post ? "Saving…" : "Publishing…") : post ? "Save changes" : "Publish post"}</button>
      </div>
      {leaving && <ConfirmDialog title="Discard this post?" confirmLabel="Discard" danger onClose={() => setLeaving(false)} onConfirm={async () => { setLeaving(false); onClose(); }}>
        What you've written {post ? "since opening the editor " : ""}will be lost.</ConfirmDialog>}
    </Modal>
  );
}
