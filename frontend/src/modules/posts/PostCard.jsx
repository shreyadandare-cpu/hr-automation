import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal from "../../components/Modal.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import { useToast } from "../../components/toast.jsx";
import { lc } from "../../lib/useLeave.js";
import { COMMENT_MAX, Svg, ago, errOf, fullDate, imgUrl, plural } from "./lib.jsx";
import ShareModal from "./ShareModal.jsx";

const CLAMP = 320;

/* Photos in a grid that suits how many there are. Double-click likes (onDoubleLike). */
export function Gallery({ ids, onOpen, onDoubleLike }) {
  const [burst, setBurst] = useState(false);
  if (!ids || !ids.length) return null;
  const dbl = () => { if (!onDoubleLike) return; onDoubleLike(); setBurst(true); setTimeout(() => setBurst(false), 800); };
  return (
    <div className={`pc-media n${Math.min(ids.length, 4)}`} onDoubleClick={dbl}>
      {ids.slice(0, 4).map((id, i) => (
        <button key={id} type="button" className="pc-shot" onClick={() => onOpen && onOpen(i)} aria-label={`Open photo ${i + 1} of ${ids.length}`} tabIndex={onOpen ? 0 : -1}>
          <img src={imgUrl(id)} alt="" loading="lazy" decoding="async" />
        </button>))}
      {burst && <span className="pc-burst" aria-hidden="true"><Svg name="heart" fill size={96} /></span>}
    </div>
  );
}

function Lightbox({ ids, start, onClose }) {
  const [i, setI] = useState(start);
  useEffect(() => {
    const keys = (e) => { if (e.key === "ArrowRight") setI((x) => Math.min(ids.length - 1, x + 1)); if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1)); };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [ids.length]);
  return (
    <Modal wide onClose={onClose}>
      <div className="pc-lightbox">
        <img src={imgUrl(ids[i])} alt={`Photo ${i + 1} of ${ids.length}`} />
        <button type="button" className="pc-lb-x" onClick={onClose} aria-label="Close"><Svg name="close" size={18} /></button>
        {ids.length > 1 && <>
          <button type="button" className="pc-lb-nav prev" onClick={() => setI(i - 1)} disabled={i === 0} aria-label="Previous photo">‹</button>
          <button type="button" className="pc-lb-nav next" onClick={() => setI(i + 1)} disabled={i === ids.length - 1} aria-label="Next photo">›</button>
          <div className="pc-dots">{ids.map((id, k) => <span key={id} className={k === i ? "on" : ""} />)}</div>
        </>}
      </div>
    </Modal>
  );
}

function Comment({ c, onRemove }) {
  return (
    <div className="pc-comment">
      <PersonAvatar email={c.author.email} name={c.author.name} />
      <div className="pc-comment-b">
        <div className="pc-bubble"><b>{c.author.name}</b>{c.author.title && <span className="pc-ctitle">{c.author.title}</span>}<div className="pc-ctext">{c.body}</div></div>
        <div className="pc-cmeta"><time dateTime={c.createdAt} title={fullDate(c.createdAt)}>{ago(c.createdAt)}</time>
          {c.canDelete && <button type="button" onClick={() => onRemove(c)}>Remove</button>}</div>
      </div>
    </div>
  );
}

/* One post. `full` (the single-post page) opens every comment straight away. */
export default function PostCard({ p, full = false, onChange, onRemoved, onEdit }) {
  const { user } = useAuth();
  const { people } = useData();
  const toast = useToast();
  const myName = ((people || []).find((x) => lc(x.email) === lc(user.email)) || {}).name;
  const [expanded, setExpanded] = useState(full);
  const [menu, setMenu] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [share, setShare] = useState(false);
  const [confirm, setConfirm] = useState(null);   // { kind: "post" } | { kind: "comment", c }
  const [allComments, setAllComments] = useState(null);   // every comment, once loaded
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(false);
  const inputRef = useRef(null), menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const out = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [menu]);
  const loadComments = async () => {
    const r = await api("GET", `/api/posts/${p.id}/comments`);
    if (r.ok) setAllComments(r.data.comments); else toast(errOf(r));
  };
  useEffect(() => { if (full && p.commentCount > p.comments.length) loadComments(); }, [full]);   // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (method, url, body) => {
    setBusy(true);
    const r = await api(method, url, body);
    setBusy(false);
    if (!r.ok) { toast(errOf(r)); return null; }
    return r.data;
  };
  const update = (d) => { onChange(d); if (allComments) loadComments(); };
  const like = async (on) => {
    if (on) { setPop(true); setTimeout(() => setPop(false), 450); }
    // Shown at once, then replaced by what the server says.
    onChange({ ...p, liked: on, likes: Math.max(0, p.likes + (on ? 1 : -1)) });
    const d = await send(on ? "PUT" : "DELETE", `/api/posts/${p.id}/like`);
    onChange(d || p);
  };
  const addComment = async (e) => {
    e.preventDefault();
    if (!comment.trim() || busy) return;
    const d = await send("POST", `/api/posts/${p.id}/comments`, { body: comment });
    if (d) { setComment(""); update(d); }
  };
  const doConfirm = async () => {
    if (confirm.kind === "post") {
      if (await send("DELETE", `/api/posts/${p.id}`)) { toast("Post deleted."); setConfirm(null); onRemoved(p.id); return; }
    } else {
      const d = await send("DELETE", `/api/posts/${p.id}/comments/${confirm.c.id}`);
      if (d) { update(d); toast("Comment removed."); }
    }
    setConfirm(null);
  };
  const focusComment = () => inputRef.current && inputRef.current.focus();

  const long = p.body.length > CLAMP && !expanded;
  const text = long ? p.body.slice(0, CLAMP).replace(/\s+\S*$/, "") : p.body;
  const shown = allComments || p.comments;
  const hidden = p.commentCount - shown.length;
  const others = p.likers.filter((n) => n !== myName);
  const likeLine = !p.likes ? null : p.liked
    ? (p.likes === 1 ? <>Liked by <b>you</b></> : <>Liked by <b>you</b> and <b>{plural(p.likes - 1, "other")}</b></>)
    : (others[0] ? <>Liked by <b>{others[0]}</b>{p.likes > 1 && <> and <b>{plural(p.likes - 1, "other")}</b></>}</> : <b>{plural(p.likes, "like")}</b>);

  return (
    <article className="card pc" aria-labelledby={`pc-${p.id}-who`}>
      <header className="pc-head">
        <PersonAvatar email={p.author.email} name={p.author.name} />
        <div className="pc-who" id={`pc-${p.id}-who`}>
          <b>{p.author.name} <span className="pc-badge">HR</span></b>
          <span><Link to={`/app/posts/${p.id}`} title={fullDate(p.createdAt)}><time dateTime={p.createdAt}>{ago(p.createdAt)}</time></Link>
            {p.updatedAt && <span title={`Edited ${fullDate(p.updatedAt)}`}> · Edited</span>}{p.author.title ? ` · ${p.author.title}` : ""}</span>
        </div>
        {p.canManage && <div className="pc-menu" ref={menuRef}>
          <button type="button" className="pc-icon" aria-label="Post options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Svg name="more" /></button>
          {menu && <div className="pc-pop" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); onEdit(p); }}><Svg name="edit" size={18} />Edit post</button>
            <button type="button" role="menuitem" className="bad" onClick={() => { setMenu(false); setConfirm({ kind: "post" }); }}><Svg name="trash" size={18} />Delete post</button>
          </div>}
        </div>}
      </header>

      {p.title && <h3 className="pc-title">{p.title}</h3>}
      {p.body && <div className="pc-text">{text}{long && <>… <button type="button" className="pc-more" onClick={() => setExpanded(true)}>more</button></>}</div>}
      <Gallery ids={p.images} onOpen={setPhoto} onDoubleLike={() => !p.liked && like(true)} />

      <div className="pc-actions">
        <button type="button" className={`pc-act like ${p.liked ? "on" : ""} ${pop ? "pop" : ""}`} onClick={() => like(!p.liked)} disabled={busy} aria-pressed={p.liked} aria-label={p.liked ? "Unlike" : "Like"}>
          <Svg name="heart" fill={p.liked} /><span>{p.likes ? p.likes.toLocaleString("en-IN") : ""}</span></button>
        <button type="button" className="pc-act" onClick={focusComment} aria-label="Comment"><Svg name="comment" /><span>{p.commentCount ? p.commentCount.toLocaleString("en-IN") : ""}</span></button>
        <button type="button" className="pc-act" onClick={() => setShare(true)} aria-label="Share"><Svg name="share" /><span>{p.shares ? p.shares.toLocaleString("en-IN") : ""}</span></button>
      </div>
      {likeLine && <div className="pc-likes">{likeLine}</div>}

      <div className="pc-comments">
        {hidden > 0 && <button type="button" className="pc-viewall" onClick={loadComments}>View all {plural(p.commentCount, "comment")}</button>}
        {shown.map((c) => <Comment key={c.id} c={c} onRemove={(x) => setConfirm({ kind: "comment", c: x })} />)}
        <form className="pc-reply" onSubmit={addComment}>
          <PersonAvatar email={user.email} name={myName || user.email} />
          <input ref={inputRef} placeholder="Write a comment…" value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)} aria-label="Write a comment" />
          <button type="submit" disabled={busy || !comment.trim()}>Post</button>
        </form>
      </div>

      {photo !== null && <Lightbox ids={p.images} start={photo} onClose={() => setPhoto(null)} />}
      {share && <ShareModal post={p} onShared={onChange} onClose={() => setShare(false)} />}
      {confirm && <ConfirmDialog danger title={confirm.kind === "post" ? "Delete this post?" : "Remove this comment?"} confirmLabel={confirm.kind === "post" ? "Delete post" : "Remove"}
        onClose={() => setConfirm(null)} onConfirm={doConfirm}>
        {confirm.kind === "post" ? "It disappears for everyone, with its photos, likes, comments and shares. This can't be undone." : "The comment is removed for everyone."}</ConfirmDialog>}
    </article>
  );
}

/* A grey stand-in card while posts load. */
export const PostSkeleton = () => (
  <div className="card pc pc-skel" aria-hidden="true">
    <div className="pc-head"><span className="avatar skel-c" /><div style={{ flex: 1 }}><span className="skel" style={{ width: "40%" }} /><span className="skel" style={{ width: "22%" }} /></div></div>
    <div style={{ padding: "0 18px 14px" }}><span className="skel" style={{ width: "90%" }} /><span className="skel" style={{ width: "70%" }} /></div>
    <div className="skel-media" />
  </div>
);
