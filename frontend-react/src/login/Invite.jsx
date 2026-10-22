import { useEffect, useState } from "react";

/* The link in the invite email. Opening it only shows a button, and pressing the button signs in. Mail scanners and
   link previews open links on their own, so the page itself must never use the one-time link up. */
export default function Invite() {
  const token = location.pathname.split("/").filter(Boolean).pop();
  const [name, setName] = useState("there");
  useEffect(() => {
    fetch(`/invite/${encodeURIComponent(token)}/info`).then((r) => r.json()).then((d) => d && d.firstName && setName(d.firstName)).catch(() => {});
  }, [token]);
  return (
    <main className="card">
      <div className="logo"><img className="lg lg-light" src="/wohlig-logo.png" alt="wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.png" alt="" /></div>
      <div className="app-name">HR Access Hub</div>
      <h1>Welcome, {name}.</h1>
      <p className="sub">HR has created your account. Open the app to start. This link works once and only for a short time.</p>
      <form method="post"><button type="submit">Open the HR Access Hub</button></form>
      <p className="hint">Next time, use “Continue with Google” on the sign-in page, or the password HR gave you.</p>
    </main>
  );
}
