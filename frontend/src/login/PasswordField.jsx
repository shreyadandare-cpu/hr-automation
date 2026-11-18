import { useState } from "react";

/* A password box with a Show / Hide button, used by the sign-in and invitation forms. */
export default function PasswordField({ id, label, value, onChange, autoComplete, autoFocus }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-field-box">
        <input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} autoFocus={autoFocus} required value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="auth-field-toggle" aria-pressed={shown} aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>
      </div>
    </div>
  );
}
