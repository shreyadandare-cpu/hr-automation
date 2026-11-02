import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import BackButton from "../../components/BackButton.jsx";
import PersonAvatar from "../../components/PersonAvatar.jsx";
import { SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { lc } from "../../lib/useLeave.js";
import { Svg, errOf } from "./lib.jsx";
import PostCard, { PostSkeleton } from "./PostCard.jsx";
import PostEditor from "./PostEditor.jsx";

/* The company feed: HR's posts, newest first, 10 at a time (more load as you scroll). Only HR sees Create post. */
export default function Posts() {
  const { user, isHr } = useAuth();
  const { people } = useData();
  const toast = useToast();
  const [posts, setPosts] = useState(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editor, setEditor] = useState(null);   // { post } | { post: null } for a new one
  const sentinel = useRef(null);
  const me = (people || []).find((p) => lc(p.email) === lc(user.email));

  const first = useCallback(async () => {
    setFailed(false);
    const r = await api("GET", "/api/posts");
    if (!r.ok) { setFailed(true); setPosts([]); return; }
    setPosts(r.data.posts); setMore(r.data.more);
  }, []);
  useEffect(() => { first(); }, [first]);
  const older = useCallback(async () => {
    if (loadingMore || !posts || !posts.length) return;
    setLoadingMore(true);
    const r = await api("GET", `/api/posts?before=${posts[posts.length - 1].id}`);
    setLoadingMore(false);
    if (!r.ok) { toast(errOf(r)); return; }
    setPosts((ps) => [...ps, ...r.data.posts.filter((n) => !ps.some((x) => x.id === n.id))]); setMore(r.data.more);
  }, [loadingMore, posts, toast]);
  // Infinite scroll: load the next page when the end of the list comes into view.
  useEffect(() => {
    if (!more || !sentinel.current || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) older(); }, { rootMargin: "600px" });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [more, older]);

  const replace = (p) => setPosts((ps) => ps.map((x) => (x.id === p.id ? p : x)));
  const saved = (p) => { setPosts((ps) => (ps.some((x) => x.id === p.id) ? ps.map((x) => (x.id === p.id ? p : x)) : [p, ...ps])); setEditor(null); };

  return (
    <section className="section">
      <SectionHead eyebrow="Posts" title="Company" accent="feed." sub={isHr ? "Share announcements, celebrations and photos with everyone. Colleagues can like, comment and share." : "Announcements, celebrations and photos from HR. Like, comment and share them with colleagues."}
        actions={isHr ? <button type="button" className="btn primary" onClick={() => setEditor({ post: null })}><Svg name="plus" size={18} />Create post</button> : null} />
      <div className="ps-col">
        {isHr && (
          <button type="button" className="card ps-start" onClick={() => setEditor({ post: null })}>
            <PersonAvatar email={user.email} name={me ? me.name : user.email} />
            <span className="ps-start-pill">Share an update with everyone at Wohlig…</span>
            <span className="ps-start-ic" aria-hidden="true"><Svg name="photo" /></span>
          </button>)}
        {!posts ? <><PostSkeleton /><PostSkeleton /></>
          : failed ? <div className="card ps-empty"><span aria-hidden="true">⚠️</span><b>Posts couldn't be loaded</b><span>Check your connection and try again.</span><button type="button" className="btn glass sm" onClick={first}>Try again</button></div>
          : !posts.length ? <div className="card ps-empty"><span aria-hidden="true"><Svg name="megaphone" size={30} /></span><b>No posts yet</b>
              <span>{isHr ? "Share the first announcement, celebration or photo with everyone." : "When HR shares announcements and photos, they'll show up here."}</span>
              {isHr && <button type="button" className="btn primary sm" onClick={() => setEditor({ post: null })}>Create the first post</button>}</div>
          : posts.map((p) => <PostCard key={p.id} p={p} onChange={replace} onRemoved={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))} onEdit={(post) => setEditor({ post })} />)}
        {more && <div ref={sentinel} className="ps-more">{loadingMore ? <PostSkeleton /> : <button type="button" className="btn glass sm" onClick={older}>Show older posts</button>}</div>}
        {posts && posts.length > 0 && !more && <div className="ps-end">You're all caught up</div>}
      </div>
      {editor && <PostEditor post={editor.post} onSaved={saved} onClose={() => setEditor(null)} />}
    </section>
  );
}

/* One post on its own page: where shared links and notifications lead. */
export function SinglePost() {
  const { id } = useParams();
  const [p, setP] = useState(undefined);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(false);
  useEffect(() => {
    setP(undefined);
    api("GET", `/api/posts/${encodeURIComponent(id)}`).then((r) => { if (r.ok) setP(r.data); else { setError(errOf(r)); setP(null); } });
  }, [id]);
  return (
    <section className="section">
      <BackButton to="/app/posts" label="All posts" />
      <div className="ps-col">
        {p === undefined ? <PostSkeleton />
          : p === null ? <div className="card ps-empty"><span aria-hidden="true"><Svg name="megaphone" size={30} /></span><b>Post not found</b><span>{error}</span></div>
          : <PostCard key={p.id} p={p} full onChange={setP} onRemoved={() => setP(null)} onEdit={() => setEditor(true)} />}
      </div>
      {editor && p && <PostEditor post={p} onSaved={(x) => { setP(x); setEditor(false); }} onClose={() => setEditor(false)} />}
    </section>
  );
}
