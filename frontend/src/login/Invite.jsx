import { useEffect, useState } from "react";
import AuthLayout from "./AuthLayout.jsx";

/* The link in the invitation email. Opening the page only checks the link and sends the person to Google sign-in; no password is chosen. */
export default function Invite() {
  const token = location.pathname.split("/").filter(Boolean).pop();
  const [info, setInfo] = useState(null); // { state, firstName?, message? }
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    fetch(`/invite/${encodeURIComponent(token)}/info`).then((r) => r.json()).then(setInfo)
      .catch(() => setInfo({ state: "error", message: "The server can't be reached. Try again." }));
  }, [token]);

  const pending = info && info.state === "pending";
  return (
    <AuthLayout>
      {!info && <p className="auth-sub" role="status">Checking your invitation…</p>}
      {info && !pending && <>
        <h1>{info.state === "used" ? "Already accepted" : info.state === "expired" ? "Invitation expired" : "Invitation not valid"}</h1>
        <div className="auth-alert" role="alert">{info.message}</div>
        <a className="btn primary lg flex w-full" href="/login">Go to sign in</a>
      </>}
      {pending && !accepted && <>
        <h1>Welcome, {info.firstName}.</h1>
        <p className="auth-sub">You have been invited to Wohlig One. Please accept the invitation to continue.</p>
        <button type="button" className="btn primary lg flex w-full" onClick={() => setAccepted(true)}>Accept invitation</button>
      </>}
      {pending && accepted && <>
        <h1>Thank you, {info.firstName}.</h1>
        <p className="auth-sub">Sign in with your Wohlig Google account to get started.</p>
        <a className="btn primary lg flex w-full" href="/auth/google">
          <span className="auth-g">
          <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        </span>
          Continue with Google
        </a>
        <p className="auth-hint">Please use your @wohlig.com account. You will not need a password.</p>
      </>}
    </AuthLayout>
  );
}
