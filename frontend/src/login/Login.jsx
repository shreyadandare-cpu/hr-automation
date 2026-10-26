import { useEffect, useState } from "react";

const MESSAGES = {
  invite: "That invite link has expired or was already used. Ask HR to send a new one.",
  google_off: "Google sign-in is not set up yet. Use your password for now.",
  google_cancelled: "Google sign-in was cancelled.",
  google_domain: "Use your @wohlig.com Google account.",
  google_no_account: "That Google account has no HR Access Hub account yet. Ask HR to create one.",
  google_state: "That sign-in took too long or came from another page. Try again.",
  google: "Google sign-in did not work. Try again.",
};
const COMPANY_EMAIL = /^[^@\s]+@wohlig\.com$/i;

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState(true);
  const [googleNote, setGoogleNote] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("error");
    if (code) { setError(MESSAGES[code] || "Could not sign in."); history.replaceState(null, "", "/login"); }
    fetch("/api/login-options").then((r) => r.json()).then((o) => setGoogleOn(!!(o && o.google))).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!COMPANY_EMAIL.test(email.trim())) { setError("Use your @wohlig.com work email."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { location.href = "/app/dashboard"; return; }
      setError(d.error || "Could not sign in.");
    } catch (x) { setError("Could not reach the server."); }
    setBusy(false);
  };

  return (
    <main className="card">
      <div className="logo">
        <img className="lg lg-light" src="/wohlig-logo.png" alt="wohlig" /><img className="lg lg-dark" src="/wohlig-logo-dark.png" alt="" />
      </div>
      <div className="app-name">HR Access Hub</div>
      <h1>Sign in</h1>
      <p className="sub">Use your work email and the password HR gave you.</p>
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="field"><label htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="username" placeholder="name.surname@wohlig.com" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button type="submit" id="go" disabled={busy}>Sign in</button>
      </form>
      <div className="or" aria-hidden="true">or</div>
      <a className="gbtn" href="/auth/google" aria-disabled={!googleOn} onClick={(e) => { if (!googleOn) { e.preventDefault(); setGoogleNote(true); } }}>
        <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        Continue with Google
      </a>
      {googleNote && <p className="gnote">Google sign-in is not set up yet. Ask your admin to add the Google credentials.</p>}
      <p className="hint">No account or forgot your password? Ask HR.</p>
    </main>
  );
}
