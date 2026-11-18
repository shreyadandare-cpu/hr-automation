import { useEffect, useState } from "react";
import AuthLayout from "./AuthLayout.jsx";
import PasswordField from "./PasswordField.jsx";

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
    <AuthLayout>
      {!info && <p className="auth-sub" role="status">Checking your invitation…</p>}
      {info && !pending && <>
        <h1>{info.state === "used" ? "Already accepted" : info.state === "expired" ? "Invitation expired" : "Invitation not valid"}</h1>
        <div className="auth-alert" role="alert">{info.message}</div>
        <a className="btn primary lg block" href="/login">Go to sign in</a>
      </>}
      {pending && <>
        <h1>Welcome, {info.firstName}.</h1>
        <p className="auth-sub">Choose a password to activate your account. This link works once and only for a short time.</p>
        <form onSubmit={submit} noValidate>
          {error && <div className="auth-alert" role="alert">{error}</div>}
          <PasswordField id="pw1" label="New password" autoComplete="new-password" autoFocus value={password} onChange={setPassword} />
          <PasswordField id="pw2" label="Repeat the password" autoComplete="new-password" value={again} onChange={setAgain} />
          <button type="submit" className="btn primary lg block" disabled={busy}>{busy ? "Activating…" : "Accept invitation"}</button>
        </form>
        <p className="auth-hint">Next time, sign in with “Continue with Google” using your @wohlig.com account.</p>
      </>}
    </AuthLayout>
  );
}
