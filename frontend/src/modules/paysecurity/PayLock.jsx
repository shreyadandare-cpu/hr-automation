import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { Icon, PageSkeleton } from "../../components/ui.jsx";
import PinInput from "./PinInput.jsx";

/* The Pay PIN, in the browser. The server holds the real lock (backend/src/pay-pin.js: every pay endpoint refuses without a live
   unlock); this part shows the right screen and keeps the unlock honest:
   - Pay opens only after the PIN is entered (or created, the first time). Loading the page again always asks again.
   - It locks by itself after 2 idle minutes, when the browser tab is hidden, and the moment the person leaves the Pay pages.
   - While the person is active the page sends a quiet heartbeat so the server's own 2-minute limit does not run out under them.
   Nothing about the unlock is kept in the browser's storage. */
export const PAY_PATHS = ["/app/my-finances", "/app/payslips", "/app/tax", "/app/payroll", "/app/finance-reports"];
export const inPaySection = (path) => PAY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

const IDLE_MS = 2 * 60 * 1000, BEAT_MS = 25 * 1000, WATCH = ["pointerdown", "pointermove", "keydown", "scroll", "wheel", "touchstart"];
const WHY = { idle: "Pay was locked after 2 minutes without activity.", hidden: "Pay was locked because this browser tab was hidden.", manual: "You locked Pay." };
const NOTICE = {
  mismatch: "That Google account is not the one you are signed in with, so your PIN was not reset. Please try again with your own account.",
  stale: "Please sign in with Google again to confirm it is you, then try Forgot PIN once more.",
  google_off: "Google confirmation is not available right now. Please contact the HR team.",
};

const Ctx = createContext(null);
export const usePay = () => useContext(Ctx);

export function PayProvider({ children }) {
  const { pathname } = useLocation();
  const inPay = inPaySection(pathname);
  const [s, setS] = useState({ phase: "idle", reason: "", notice: "", out: 0 });
  const phase = useRef(s.phase);
  phase.current = s.phase;
  const last = useRef(Date.now()), booted = useRef(false), was = useRef(false);

  const refresh = useCallback(async (extra = {}) => {
    const r = await api("GET", "/api/pay/status");
    if (!r.ok) return setS((p) => ({ ...p, ...extra, phase: "error" }));
    const d = r.data;
    setS((p) => ({ ...p, ...extra, out: d.lockedOutMinutes || 0, phase: !d.pinSet ? "setup" : d.recoverOk ? "reset" : d.unlocked ? "open" : "locked" }));
  }, []);

  const lock = useCallback((reason = "manual") => {
    setS((p) => ({ ...p, phase: "locked", reason: WHY[reason] ? reason : "", notice: "" }));
    return api("POST", "/api/pay/lock", { reason });
  }, []);

  /* Entering the Pay pages: the first time after the page loaded, lock whatever was open (a reload never skips the PIN), then ask the server. */
  useEffect(() => {
    if (inPay && !was.current) {
      setS((p) => ({ ...p, phase: "loading", reason: "" }));
      const q = new URLSearchParams(location.search), flag = q.get("paypin");
      if (flag) { q.delete("paypin"); history.replaceState(null, "", `${location.pathname}${q.toString() ? `?${q}` : ""}${location.hash}`); }
      (async () => {
        if (!booted.current) { booted.current = true; await api("POST", "/api/pay/lock", { reason: "navigated" }); }
        await refresh({ notice: NOTICE[flag] || "" });
      })();
    }
    if (!inPay && was.current && phase.current !== "locked") { api("POST", "/api/pay/lock", { reason: "navigated" }); setS((p) => ({ ...p, phase: "locked", reason: "" })); }
    was.current = inPay;
  }, [inPay, refresh]);

  /* A pay request that comes back "locked" (the server's limit ran out) shows the PIN screen straight away. */
  useEffect(() => {
    const onLocked = () => { if (inPay && phase.current === "open") { setS((p) => ({ ...p, phase: "locked", reason: "idle" })); } };
    window.addEventListener("pay-locked", onLocked);
    return () => window.removeEventListener("pay-locked", onLocked);
  }, [inPay]);

  /* While Pay is open: watch for activity, send the heartbeat, lock after idle time or when the tab is hidden or closed. */
  useEffect(() => {
    if (!(inPay && s.phase === "open")) return undefined;
    last.current = Date.now();
    const bump = () => { last.current = Date.now(); };
    WATCH.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const beat = setInterval(async () => {
      if (Date.now() - last.current > BEAT_MS + 5000) return;   // nobody has touched the page lately: no heartbeat, the server's limit runs
      const r = await api("POST", "/api/pay/touch");
      if (r.status === 423) setS((p) => ({ ...p, phase: "locked", reason: "idle" }));
    }, BEAT_MS);
    const watch = setInterval(() => { if (Date.now() - last.current > IDLE_MS) lock("idle"); }, 5000);
    const hide = () => { if (document.hidden) lock("hidden"); };
    const gone = () => { navigator.sendBeacon && navigator.sendBeacon("/api/pay/lock", new Blob([JSON.stringify({ reason: "navigated" })], { type: "application/json" })); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", gone);
    return () => {
      WATCH.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(beat); clearInterval(watch);
      document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", gone);
    };
  }, [inPay, s.phase, lock]);

  const answer = async (call) => {
    const r = await call;
    if (!r.ok) { if (r.data && r.data.lockedOutMinutes) setS((p) => ({ ...p, out: r.data.lockedOutMinutes })); return { ok: false, message: apiMsg(r) }; }
    await refresh({ reason: "", notice: "" });
    return { ok: true };
  };
  const value = {
    ...s, inPay, lock, refresh,
    unlock: (pin) => answer(api("POST", "/api/pay/unlock", { pin })),
    create: (pin, confirm) => answer(api("POST", "/api/pay/pin", { pin, confirm })),
    sendCode: () => api("POST", "/api/pay/recover/email/send"),
    verifyCode: (code) => answer(api("POST", "/api/pay/recover/email/verify", { code })),
    reset: (pin, confirm) => answer(api("POST", "/api/pay/recover/reset", { pin, confirm })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Wraps a Pay page: its content appears only while Pay is unlocked; otherwise the right PIN screen. */
export function PayGate({ children }) {
  const pay = usePay();
  if (!pay || pay.phase === "open") return <>{pay && <PayBar />}{children}</>;
  if (pay.phase === "loading" || pay.phase === "idle") return <PageSkeleton stats={0} rows={4} />;
  if (pay.phase === "error") return <Panel icon="lock" title="Pay could not be checked" text="Wohlig One could not reach the server. Please check your connection and try again.">
    <button type="button" className="btn primary lg flex w-full" onClick={() => pay.refresh()}>Try again</button></Panel>;
  if (pay.phase === "setup") return <Setup pay={pay} />;
  if (pay.phase === "reset") return <Setup pay={pay} recover />;
  return <Verify pay={pay} />;
}

/** The small bar inside Pay: it says Pay is unlocked and locks it on request. */
function PayBar() {
  const pay = usePay();
  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-3 print:hidden">
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-dim"><span className="grid size-4 place-items-center text-ok [&_svg]:size-4"><Icon name="unlock" /></span>Pay is unlocked. It locks after 2 minutes without activity.</span>
      <button type="button" className="btn glass sm" onClick={() => pay.lock("manual")}>Lock Pay</button>
    </div>
  );
}

function Panel({ icon, title, text, children }) {
  return (
    <div className="mx-auto mt-6 w-full max-w-[460px] rounded-card border border-line bg-surface px-8 py-9 text-center shadow-[var(--shadow-card)] max-xs:px-5">
      <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-tint text-accent [&_svg]:size-7"><Icon name={icon} /></span>
      <h1 className="m-0 font-display text-[26px] leading-[1.2] font-normal text-heading">{title}</h1>
      <p className="mt-2 mb-6 text-[15px] text-ink-dim">{text}</p>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}
const Problem = ({ children }) => (children ? <p role="alert" className="m-0 rounded-field bg-bad-soft px-3.5 py-2.5 text-left text-[14px] text-bad">{children}</p> : null);
const Notice = ({ children }) => (children ? <p role="status" className="m-0 rounded-field bg-warn-soft px-3.5 py-2.5 text-left text-[14px] text-warn">{children}</p> : null);

/* First time (or a new PIN after Forgot PIN): choose a 6-digit PIN and type it twice. */
function Setup({ pay, recover = false }) {
  const [pin, setPin] = useState(""), [again, setAgain] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    if (pin.length !== 6) return setErr("Enter exactly 6 digits, numbers only.");
    if (pin !== again) return setErr("The two PINs do not match.");
    setBusy(true); setErr("");
    const r = await (recover ? pay.reset(pin, again) : pay.create(pin, again));
    setBusy(false);
    if (!r.ok) setErr(r.message);
  };
  return (
    <Panel icon="shield" title={recover ? "Create a New PIN" : "Secure Your Pay Section"}
      text={recover ? "Thank you for confirming it is you. Choose a new 6-digit PIN for your Pay section." : "Create a personal 6-digit security PIN to protect your confidential salary and payroll information."}>
      <PinInput id="pay-pin-new" label={recover ? "New 6-digit PIN" : "Enter 6-digit PIN"} value={pin} onChange={(v) => { setPin(v); setErr(""); }} autoFocus disabled={busy} invalid={!!err} />
      <PinInput id="pay-pin-again" label="Confirm 6-digit PIN" value={again} onChange={(v) => { setAgain(v); setErr(""); }} onEnter={go} disabled={busy} invalid={!!err} />
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || pin.length !== 6 || again.length !== 6} onClick={go}>{busy ? "Saving…" : recover ? "Save new PIN" : "Set PIN"}</button>
      <p className="m-0 text-[13px] text-ink-faint">Avoid easy PINs such as 123456 or 000000. You will enter this PIN whenever you open Pay.</p>
    </Panel>
  );
}

/* Pay is locked: enter the PIN. After an automatic or manual lock a short message comes first, with a button to unlock again. */
function Verify({ pay }) {
  const [pin, setPin] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [ask, setAsk] = useState(!pay.reason), [forgot, setForgot] = useState(false);
  const out = pay.out;
  const go = async () => {
    if (pin.length !== 6) return setErr("Enter your 6-digit PIN.");
    setBusy(true); setErr("");
    const r = await pay.unlock(pin);
    setBusy(false);
    if (!r.ok) { setErr(r.message); setPin(""); }
  };
  if (forgot) return <Forgot pay={pay} back={() => setForgot(false)} />;
  if (!ask) return (
    <Panel icon="lock" title="Pay is locked" text={WHY[pay.reason] || "Pay is locked to keep your salary information private."}>
      <button type="button" className="btn primary lg flex w-full" onClick={() => setAsk(true)}>Unlock Pay</button>
    </Panel>);
  return (
    <Panel icon="lock" title="Verify Your Identity" text="Enter your security PIN to access confidential payroll information.">
      <Notice>{pay.notice}</Notice>
      <PinInput id="pay-pin" label="6-digit PIN" value={pin} onChange={(v) => { setPin(v); setErr(""); }} onEnter={go} autoFocus disabled={busy || out > 0} invalid={!!err} />
      <Problem>{out > 0 && !err ? `Too many wrong PINs. Please try again in ${out} minute${out === 1 ? "" : "s"}, or use Forgot PIN.` : err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || pin.length !== 6 || out > 0} onClick={go}>{busy ? "Verifying…" : "Verify"}</button>
      <button type="button" className="mx-auto w-fit border-0 bg-transparent p-0 text-[14px] font-bold text-accent underline underline-offset-2" onClick={() => setForgot(true)}>Forgot PIN?</button>
      <p className="m-0 text-[13px] text-ink-faint">To reset your PIN we email a 6-digit code to your work email address.</p>
    </Panel>
  );
}

/* Forgot PIN: a 6-digit code goes to the person's own work email; the right code opens the "Create a New PIN" step.
   Google confirmation stays as the other way in, for when the email does not arrive. */
function Forgot({ pay, back }) {
  const [step, setStep] = useState("ask"), [to, setTo] = useState(""), [code, setCode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [wait, setWait] = useState(0), [noMail, setNoMail] = useState(false);
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const send = async () => {
    setBusy(true); setErr("");
    const r = await pay.sendCode();
    setBusy(false);
    if (!r.ok) { setErr(apiMsg(r)); if (r.data && r.data.waitSeconds) setWait(r.data.waitSeconds); if (r.data && r.data.code === "PAY_NO_EMAIL") setNoMail(true); return; }
    setTo(r.data.to); setWait(r.data.resendSeconds); setCode(""); setStep("code");
  };
  const check = async () => {
    if (code.length !== 6) return setErr("Enter the 6-digit code from the email.");
    setBusy(true); setErr("");
    const r = await pay.verifyCode(code);
    setBusy(false);
    if (!r.ok) { setErr(r.message); setCode(""); }
  };
  const google = <a className="text-[14px] font-bold text-accent underline underline-offset-2" href="/auth/google/pay-recover">{noMail ? "Confirm with Google instead" : "No email? Confirm with Google instead"}</a>;
  const backBtn = <button type="button" className="mx-auto w-fit border-0 bg-transparent p-0 text-[14px] text-ink-dim underline underline-offset-2" onClick={back}>Back to PIN</button>;
  if (step === "ask") return (
    <Panel icon="shield" title="Reset your PIN" text="We will email a 6-digit code to your work email address. Enter it here to choose a new PIN.">
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || wait > 0} onClick={send}>{busy ? "Sending…" : wait > 0 ? `Wait ${wait}s` : "Email me a code"}</button>
      {google}{backBtn}
    </Panel>);
  return (
    <Panel icon="shield" title="Enter the code" text={`We emailed a 6-digit code to ${to}. It works for 10 minutes. Check your spam folder if you cannot see it.`}>
      <PinInput id="pay-otp" label="6-digit code" plain value={code} onChange={(v) => { setCode(v); setErr(""); }} onEnter={check} autoFocus disabled={busy} invalid={!!err} />
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || code.length !== 6} onClick={check}>{busy ? "Checking…" : "Continue"}</button>
      <button type="button" className="mx-auto w-fit border-0 bg-transparent p-0 text-[14px] font-bold text-accent underline underline-offset-2 disabled:opacity-60 disabled:no-underline" disabled={busy || wait > 0} onClick={send}>{wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}</button>
      {google}{backBtn}
    </Panel>);
}
