import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Modal from "./Modal.jsx";
import PersonAvatar from "./PersonAvatar.jsx";
import "./birthday.css";

/* A pop-up on the dashboard, only when it is someone's birthday today. Everyone sees it once that day: the birthday person gets a personal
   greeting, everyone else a note naming who to wish. (Only the day and month are ever shared, never the year.) Nothing pops up on other days. */
const lc = (s) => String(s || "").toLowerCase();
const first = (n) => String(n || "").split(/\s+/)[0];
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: it just shows again next time */ } };
const seenKey = (email, today) => `hr_bday_seen:${lc(email)}:${today}`;
const COLORS = ["#800d35", "#f7781d", "#c85f44", "#ead9c2", "#76775a", "#ffb36b"];

const names = (list) => (list.length === 1 ? list[0] : list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

function Confetti() {
  return <div className="bd-confetti" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ "--x": `${(i * 37) % 100}%`, "--d": `${(i % 7) * 0.18}s`, "--c": COLORS[i % COLORS.length], "--r": `${(i * 53) % 360}deg` }} />)}</div>;
}
const Faces = ({ list }) => <div className="bd-faces">{list.map((p) => <div className="bd-face" key={p.email}><PersonAvatar email={p.email} name={p.name} /><b>{first(p.name)}</b>{p.title && <small>{p.title}</small>}</div>)}</div>;

export default function BirthdayPopup() {
  const { user } = useAuth();
  const [show, setShow] = useState(null);   // { mine, others, today }

  useEffect(() => {
    let live = true;
    api("GET", "/api/leave/today").then((r) => {
      if (!live || !r.ok) return;
      const d = r.data, todays = (d.birthdays || []).filter((b) => b.date === d.today);
      const mine = todays.find((b) => lc(b.email) === lc(user.email)), others = todays.filter((b) => lc(b.email) !== lc(user.email));
      if ((mine || others.length) && !read(seenKey(user.email, d.today))) setShow({ mine, others, today: d.today });
    });
    return () => { live = false; };
  }, [user.email]);

  if (!show) return null;
  const close = () => { write(seenKey(user.email, show.today), "1"); setShow(null); };

  const { mine, others } = show;
  return (
    <Modal onClose={close}>
      <div className={`bd${mine ? " bd-mine" : ""}`} role="status">
        <Confetti />
        <div className="bd-emoji" aria-hidden="true">{mine ? "🎂" : "🎉"}</div>
        {mine
          ? <><h3>Happy birthday, <em>{first(mine.name)}!</em></h3><p>Everyone at Wohlig is wishing you a wonderful year ahead.</p></>
          : <><h3>{others.length === 1 ? <>It's <em>{first(others[0].name)}</em>'s birthday today</> : others.length === 2 ? <><em>{names(others.map((p) => first(p.name)))}</em> have birthdays today</> : `${others.length} birthdays today`}</h3><p>Take a moment to wish {others.length === 1 ? "them" : "them all"} a happy birthday.</p></>}
        {mine && others.length > 0 && <><div className="bd-sub">Also celebrating today</div><Faces list={others} /></>}
        {!mine && <Faces list={others} />}
        <div className="bd-actions"><button type="button" className="btn primary" onClick={close} autoFocus>{mine ? "Thank you" : "Close"}</button></div>
      </div>
    </Modal>
  );
}
