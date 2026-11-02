import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { UPLOAD_DIR } from "./documents.js";
import { notify } from "./notify.js";

/*
 * Posts: the company feed. HR writes, edits and removes posts (with an optional title and up to 4 photos); everyone
 * signed in reads them, likes them (one like per person per post), comments and shares them inside the app (to colleagues
 * through the notification bell, or by copying the post's link). Roles are checked here, never only on the page.
 * Bodies are plain text; the page shows them as text, never as HTML.
 */
const TITLE_MAX = 120, POST_MAX = 3000, COMMENT_MAX = 1000, PAGE = 10, MAX_IMAGES = 4, MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PREVIEW_COMMENTS = 3, COMMENT_PAGE = 50, SHARE_MAX = 25;
const isHr = (req) => req.user && req.user.role === "hr";
const me = (req) => req.user.email.toLowerCase();
const text = (v) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const HR_ONLY = { error: "Only HR can create, edit or remove posts." };
// What the file really is, from its first bytes (never from its name or the browser's word for it).
const sniffImage = (b) =>
  b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { mime: "image/jpeg", ext: "jpg" }
  : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? { mime: "image/png", ext: "png" }
  : b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" ? { mime: "image/webp", ext: "webp" }
  : null;
const removeFiles = (names) => Promise.all(names.map((n) => fs.rm(path.join(UPLOAD_DIR, n), { force: true })));

/** Names and job titles for a set of emails. */
async function peopleBy(db, emails) {
  const list = [...new Set(emails.map((e) => e.toLowerCase()))];
  const { rows } = list.length ? await db.query("SELECT lower(work_email) AS email, name, title FROM employees WHERE lower(work_email) = ANY($1)", [list]) : { rows: [] };
  const who = Object.fromEntries(rows.map((p) => [p.email, p]));
  return (email) => { const p = who[email.toLowerCase()]; return { email, name: p ? p.name : email.split("@")[0], title: p ? p.title : "" }; };
}
const toComment = (c, person, req) => ({ id: c.id, author: person(c.author_email), body: c.body, createdAt: c.created_at,
  canDelete: isHr(req) || c.author_email.toLowerCase() === me(req) });

/** Posts with their authors, likes, latest comments and shares, newest first. */
async function load(db, req, { ids, before } = {}) {
  const { rows: posts } = ids
    ? await db.query("SELECT * FROM posts WHERE id = ANY($1) ORDER BY id DESC", [ids])
    : await db.query("SELECT * FROM posts WHERE ($1::int IS NULL OR id < $1) ORDER BY id DESC LIMIT $2", [before || null, PAGE + 1]);
  const more = !ids && posts.length > PAGE;
  const list = posts.slice(0, PAGE);
  if (!list.length) return { posts: [], more: false };
  const pids = list.map((p) => p.id);
  const [likes, likers, comments, counts, images, shares] = await Promise.all([
    db.query("SELECT post_id, count(*)::int AS n, bool_or(email = $2) AS mine FROM post_likes WHERE post_id = ANY($1) GROUP BY post_id", [pids, me(req)]),
    db.query(`SELECT post_id, email FROM (SELECT post_id, email, row_number() OVER (PARTITION BY post_id ORDER BY created_at DESC) AS k
              FROM post_likes WHERE post_id = ANY($1)) x WHERE k <= 3`, [pids]),
    db.query(`SELECT * FROM (SELECT c.*, row_number() OVER (PARTITION BY post_id ORDER BY id DESC) AS k FROM post_comments c WHERE post_id = ANY($1)) x
              WHERE k <= $2 ORDER BY id`, [pids, PREVIEW_COMMENTS]),
    db.query("SELECT post_id, count(*)::int AS n FROM post_comments WHERE post_id = ANY($1) GROUP BY post_id", [pids]),
    db.query("SELECT id, post_id FROM post_images WHERE post_id = ANY($1) ORDER BY position, id", [pids]),
    db.query("SELECT post_id, count(*)::int AS n FROM post_shares WHERE post_id = ANY($1) GROUP BY post_id", [pids]),
  ]);
  const person = await peopleBy(db, [...list.map((p) => p.author_email), ...likers.rows.map((l) => l.email), ...comments.rows.map((c) => c.author_email)]);
  const by = (rows, id) => rows.find((x) => x.post_id === id);
  return {
    more,
    posts: list.map((p) => ({
      id: p.id, author: person(p.author_email), title: p.title || "", body: p.body, createdAt: p.created_at, updatedAt: p.updated_at,
      images: images.rows.filter((i) => i.post_id === p.id).map((i) => i.id),
      likes: (by(likes.rows, p.id) || {}).n || 0, liked: !!(by(likes.rows, p.id) || {}).mine,
      likers: likers.rows.filter((l) => l.post_id === p.id).map((l) => person(l.email).name),
      commentCount: (by(counts.rows, p.id) || {}).n || 0,
      comments: comments.rows.filter((c) => c.post_id === p.id).map((c) => toComment(c, person, req)),
      shares: (by(shares.rows, p.id) || {}).n || 0,
      canManage: isHr(req),
    })),
  };
}
const one = async (req, id) => (await load(pool, req, { ids: [id] })).posts[0];
const exists = async (id) => (await pool.query("SELECT 1 FROM posts WHERE id=$1", [id])).rowCount > 0;

/** Title, text and photo ids from the request, with any problems. */
function readPost(b) {
  const title = text(b.title), body = text(b.body);
  const images = Array.isArray(b.images) ? [...new Set(b.images.map(idOf).filter(Boolean))] : [];
  const errors = {};
  if (title.length > TITLE_MAX) errors.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (!body && !images.length) errors.body = "Write something or add a photo to post.";
  else if (body.length > POST_MAX) errors.body = `Keep the post under ${POST_MAX} characters.`;
  if (images.length > MAX_IMAGES) errors.images = `Add up to ${MAX_IMAGES} photos.`;
  return { title, body, images, errors };
}

/** Puts the chosen photos on the post, in order: ones already on it, or your own new uploads. Returns false if one isn't allowed. */
async function attachImages(db, postId, images, email) {
  for (const [i, img] of images.entries()) {
    const { rowCount } = await db.query(
      "UPDATE post_images SET post_id=$1, position=$2 WHERE id=$3 AND (post_id=$1 OR (post_id IS NULL AND lower(uploaded_by)=$4))", [postId, i, img, email]);
    if (!rowCount) return false;
  }
  return true;
}

export function postsRouter(wrap) {
  const r = express.Router();
  r.use("/api/posts", requireAuth);

  r.get("/api/posts", wrap(async (req, res) => {
    res.json(await load(pool, req, { before: idOf(req.query.before) || null }));
  }));

  /* Photos: HR uploads one at a time (the raw picture as the body) and sends the ids with the post. */
  r.post("/api/posts/images", express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), wrap(async (req, res) => {
    if (!isHr(req)) return res.status(403).json(HR_ONLY);
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: "The photo is empty." });
    const type = sniffImage(body);
    if (!type) return res.status(400).json({ error: "Only JPG, PNG or WebP photos can be added." });
    // Photos picked but never posted are tidied away after a day.
    const { rows: stale } = await pool.query("DELETE FROM post_images WHERE post_id IS NULL AND created_at < now() - interval '1 day' RETURNING stored_name");
    await removeFiles(stale.map((s) => s.stored_name));
    const stored = `post-${crypto.randomUUID()}.${type.ext}`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, stored), body);
    const { rows } = await pool.query("INSERT INTO post_images (uploaded_by, stored_name, mime) VALUES ($1,$2,$3) RETURNING id", [me(req), stored, type.mime]);
    res.status(201).json({ id: rows[0].id });
  }));
  // A post's photo, for anyone signed in (or the uploader, before it is posted).
  r.get("/api/posts/images/:id", wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM post_images WHERE id=$1", [idOf(req.params.id)]);
    const img = rows[0];
    if (!img || (!img.post_id && img.uploaded_by.toLowerCase() !== me(req))) return res.status(404).json({ error: "No photo" });
    res.set({ "Content-Type": img.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400" });
    res.sendFile(path.join(UPLOAD_DIR, img.stored_name), (err) => { if (err && !res.headersSent) res.status(404).json({ error: "No photo" }); });
  }));

  r.get("/api/posts/:id", wrap(async (req, res) => {
    const p = await one(req, idOf(req.params.id));
    if (!p) return res.status(404).json({ error: "This post was removed or never existed." });
    res.json(p);
  }));

  r.post("/api/posts", wrap(async (req, res) => {
    if (!isHr(req)) return res.status(403).json(HR_ONLY);
    const { title, body, images, errors } = readPost(req.body || {});
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const client = await pool.connect();
    let id;
    try {
      await client.query("BEGIN");
      ({ rows: [{ id }] } = await client.query("INSERT INTO posts (author_email, title, body) VALUES ($1,$2,$3) RETURNING id", [me(req), title || null, body]));
      if (!(await attachImages(client, id, images, me(req)))) { await client.query("ROLLBACK"); return res.status(400).json({ errors: { images: "A photo could not be found. Add it again." } }); }
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    res.status(201).json(await one(req, id));
  }));

  // Edit: title, text and photos (keep, remove or add). Removed photos are deleted from disk.
  r.patch("/api/posts/:id", wrap(async (req, res) => {
    if (!isHr(req)) return res.status(403).json(HR_ONLY);
    const id = idOf(req.params.id);
    const { title, body, images, errors } = readPost(req.body || {});
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    const client = await pool.connect();
    let gone = [];
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query("UPDATE posts SET title=$2, body=$3, updated_at=now() WHERE id=$1", [id, title || null, body]);
      if (!rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "This post was removed." }); }
      ({ rows: gone } = await client.query("DELETE FROM post_images WHERE post_id=$1 AND NOT (id = ANY($2)) RETURNING stored_name", [id, images]));
      if (!(await attachImages(client, id, images, me(req)))) { await client.query("ROLLBACK"); return res.status(400).json({ errors: { images: "A photo could not be found. Add it again." } }); }
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    await removeFiles(gone.map((g) => g.stored_name));
    res.json(await one(req, id));
  }));

  r.delete("/api/posts/:id", wrap(async (req, res) => {
    if (!isHr(req)) return res.status(403).json(HR_ONLY);
    const id = idOf(req.params.id);
    const { rows: files } = await pool.query("SELECT stored_name FROM post_images WHERE post_id=$1", [id]);
    const { rowCount } = await pool.query("DELETE FROM posts WHERE id=$1", [id]);
    if (!rowCount) return res.status(404).json({ error: "That post was already removed." });
    await removeFiles(files.map((f) => f.stored_name));
    res.json({ ok: true });
  }));

  /* Likes: one per person per post (the primary key enforces it). */
  const like = (on) => wrap(async (req, res) => {
    const id = idOf(req.params.id);
    if (!(await exists(id))) return res.status(404).json({ error: "That post was removed." });
    if (on) await pool.query("INSERT INTO post_likes (post_id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, me(req)]);
    else await pool.query("DELETE FROM post_likes WHERE post_id=$1 AND email=$2", [id, me(req)]);
    res.json(await one(req, id));
  });
  r.put("/api/posts/:id/like", like(true));
  r.delete("/api/posts/:id/like", like(false));
  r.post("/api/posts/:id/like", (req, res, next) => like(!(req.body && req.body.liked === false))(req, res, next));   // { liked: true|false }

  /* Comments */
  r.get("/api/posts/:id/comments", wrap(async (req, res) => {
    const id = idOf(req.params.id);
    if (!(await exists(id))) return res.status(404).json({ error: "That post was removed." });
    const before = idOf(req.query.before) || null;
    const { rows } = await pool.query("SELECT * FROM post_comments WHERE post_id=$1 AND ($2::int IS NULL OR id < $2) ORDER BY id DESC LIMIT $3", [id, before, COMMENT_PAGE + 1]);
    const page = rows.slice(0, COMMENT_PAGE).reverse();
    const person = await peopleBy(pool, page.map((c) => c.author_email));
    res.json({ comments: page.map((c) => toComment(c, person, req)), more: rows.length > COMMENT_PAGE });
  }));
  r.post("/api/posts/:id/comments", wrap(async (req, res) => {
    const id = idOf(req.params.id);
    const body = text(req.body && req.body.body);
    if (!body) return res.status(400).json({ errors: { body: "Write a comment first." } });
    if (body.length > COMMENT_MAX) return res.status(400).json({ errors: { body: `Keep the comment under ${COMMENT_MAX} characters.` } });
    if (!(await exists(id))) return res.status(404).json({ error: "That post was removed." });
    await pool.query("INSERT INTO post_comments (post_id, author_email, body) VALUES ($1,$2,$3)", [id, me(req), body]);
    res.status(201).json(await one(req, id));
  }));
  // Your own comment, or any comment for HR (moderation).
  r.delete("/api/posts/:id/comments/:cid", wrap(async (req, res) => {
    const id = idOf(req.params.id);
    const { rows } = await pool.query("SELECT author_email FROM post_comments WHERE id=$1 AND post_id=$2", [idOf(req.params.cid), id]);
    if (!rows[0]) return res.status(404).json({ error: "That comment was already removed." });
    if (!isHr(req) && rows[0].author_email.toLowerCase() !== me(req)) return res.status(403).json({ error: "You can only remove your own comments." });
    await pool.query("DELETE FROM post_comments WHERE id=$1", [idOf(req.params.cid)]);
    res.json(await one(req, id));
  }));

  /* Share inside the app: { to: [work emails] } sends each colleague a notification linking to the post;
     { via: "link" } records that the link was copied. Both count as shares. */
  r.post("/api/posts/:id/share", wrap(async (req, res) => {
    const id = idOf(req.params.id);
    const { rows: p } = await pool.query("SELECT id, title, body FROM posts WHERE id=$1", [id]);
    if (!p[0]) return res.status(404).json({ error: "That post was removed." });
    const b = req.body || {};
    if (b.via === "link") {
      await pool.query("INSERT INTO post_shares (post_id, shared_by) VALUES ($1,$2)", [id, me(req)]);
      return res.json(await one(req, id));
    }
    const asked = Array.isArray(b.to) ? [...new Set(b.to.map((x) => String(x).toLowerCase()))].filter((x) => x !== me(req)) : [];
    if (!asked.length) return res.status(400).json({ errors: { to: "Pick at least one colleague." } });
    if (asked.length > SHARE_MAX) return res.status(400).json({ errors: { to: `Share with up to ${SHARE_MAX} people at a time.` } });
    // Only colleagues still at the company; anything else is refused rather than silently sent.
    const { rows: known } = await pool.query("SELECT lower(work_email) AS email FROM employees WHERE lower(work_email) = ANY($1) AND status <> 'offboarded'", [asked]);
    if (known.length !== asked.length) return res.status(400).json({ errors: { to: "Some of those people are not current colleagues." } });
    const sender = (await peopleBy(pool, [me(req)]))(me(req)).name;
    const what = p[0].title || (p[0].body ? p[0].body.slice(0, 80) + (p[0].body.length > 80 ? "…" : "") : "a post");
    const note = text(b.message).slice(0, 300);
    for (const { email } of known) {
      await pool.query("INSERT INTO post_shares (post_id, shared_by, shared_with) VALUES ($1,$2,$3)", [id, me(req), email]);
      await notify(email, { title: `${sender} shared a post with you`, body: note ? `“${note}” · ${what}` : what, link: `/app/posts/${id}` });
    }
    res.json(await one(req, id));
  }));

  return r;
}
