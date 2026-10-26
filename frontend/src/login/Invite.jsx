import { useEffect, useState } from "react";

/* The link in the invitation email. Opening the page only checks the link: nothing is used up or activated until the
   person chooses a password and presses the button. (Mail scanners open links on their own.) */
export default function Invite() {
  const token = location.pathname.split("/").filter(Boolean).pop();
  const [info, setInfo] = useState(null); // { state, firstName?, message? }
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/invite/${encodeURIComponent(token)}/info`).then((r) => r.json()).then(setInfo)
      .catch(() => setInfo({ state: "error", message: "The server can't be reached. Try again." }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Choose a password of at least 8 characters."); return; }
    if (password !== again) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/accept-invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { location.href = "/app/dashboard"; return; }
      setError(d.error || "Could not accept the invitation.");
    } catch { setError("The server can't be reached. Try again."); }
    setBusy(false);
  };

  const pending = info && info.state === "pending";
  return (
    <main className="card">
      <div className="logo"><img className="lg lg-light" src="/wohlig-logo.png" alt="wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.png" alt="" /></div>
      <div className="app-name">HR Access Hub</div>
      {!info && <p className="sub">Checking your invitation…</p>}
      {info && !pending && <>
        <h1>{info.state === "used" ? "Already accepted" : info.state === "expired" ? "Invitation expired" : "Invitation not valid"}</h1>
        <div className="err" role="alert">{info.message}</div>
        <p className="hint"><a href="/login">Go to sign in</a></p>
      </>}
      {pending && <>
        <h1>Welcome, {info.firstName}.</h1>
        <p className="sub">Choose a password to activate your account. This link works once and only for a short time.</p>
        <form onSubmit={submit} noValidate>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="field"><label htmlFor="pw1">New password</label>
            <input id="pw1" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw2">Repeat the password</label>
            <input id="pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
          <button type="submit" disabled={busy}>{busy ? "Activating…" : "Accept invitation"}</button>
        </form>
        <p className="hint">At least 8 characters. Next time, sign in with your work email and this password, or use “Continue with Google”.</p>
      </>}
    </main>
  );
}
