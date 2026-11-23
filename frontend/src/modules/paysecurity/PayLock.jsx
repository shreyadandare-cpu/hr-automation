import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { Icon, PageSkeleton } from "../../components/ui.jsx";
import PinInput from "./PinInput.jsx";
import Modal from "../../components/Modal.jsx";
import QRCode from "qrcode";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";

/* Pay security, in the browser. The server holds the real lock (backend/src/pay-security.js: every pay endpoint refuses without a live
   unlock); this part shows the right screen and keeps the unlock honest:
   - Pay opens only with the fingerprint (Touch ID, Face ID, device unlock), the 6-digit code from an authenticator app, or, on a device
     with no fingerprint reader, a 6-digit PIN, set up the first time after an emailed code proves who it is. Loading the page again always asks again.
   - It locks by itself after 2 idle minutes, when the browser tab is hidden, and the moment the person leaves the Pay pages.
   - While the person is active the page sends a quiet heartbeat so the server's own 2-minute limit does not run out under them.
   Nothing about the unlock is kept in the browser's storage. */
export const PAY_PATHS = ["/app/my-finances", "/app/payslips", "/app/tax", "/app/payroll", "/app/finance-reports"];
export const inPaySection = (path) => PAY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

const IDLE_MS = 2 * 60 * 1000, BEAT_MS = 25 * 1000, WATCH = ["pointerdown", "pointermove", "keydown", "scroll", "wheel", "touchstart"];
const WHY = { idle: "Pay was locked after 2 minutes without activity.", hidden: "Pay was locked because this browser tab was hidden.", manual: "You locked Pay." };
const NOTICE = {
  mismatch: "That Google account is not the one you are signed in with, so nothing was changed. Please try again with your own account.",
  stale: "Please sign in with Google again to confirm it is you, then try once more.",
  google_off: "Google confirmation is not available right now. Please contact the HR team.",
};

const Ctx = createContext(null);
export const usePay = () => useContext(Ctx);

export function PayProvider({ children }) {
  const { pathname } = useLocation();
  const inPay = inPaySection(pathname);
  const [s, setS] = useState({ phase: "idle", reason: "", notice: "", out: 0, pinOut: 0, factors: { totp: false, passkeys: 0, pin: false } });
  const phase = useRef(s.phase);
  phase.current = s.phase;
  const last = useRef(Date.now()), booted = useRef(false), was = useRef(false);

  const refresh = useCallback(async (extra = {}) => {
    const r = await api("GET", "/api/pay/status");
    if (!r.ok) return setS((p) => ({ ...p, ...extra, phase: "error" }));
    const d = r.data;
    setS((p) => ({ ...p, ...extra, out: d.lockedOutMinutes || 0, pinOut: d.pinLockedOutMinutes || 0, factors: { totp: !!d.totp, passkeys: d.passkeys || 0, pin: !!d.pin }, phase: d.unlocked ? "open" : d.recoverOk ? "enrol" : !d.enrolled ? "setup" : "locked" }));
  }, []);

  const lock = useCallback((reason = "manual") => {
    setS((p) => ({ ...p, phase: "locked", reason: WHY[reason] ? reason : "", notice: "" }));
    return api("POST", "/api/pay/lock", { reason });
  }, []);

  /* Entering the Pay pages: the first time after the page loaded, lock whatever was open (a reload never skips the check), then ask the server. */
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

  /* A pay request that comes back "locked" (the server's limit ran out) shows the lock screen straight away. */
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
    if (!r.ok) { if (r.data && r.data.lockedOutMinutes) setS((p) => ({ ...p, out: r.data.lockedOutMinutes })); if (r.data && r.data.pinLockedOutMinutes) setS((p) => ({ ...p, pinOut: r.data.pinLockedOutMinutes })); return { ok: false, message: apiMsg(r) }; }
    await refresh({ reason: "", notice: "" });
    return { ok: true };
  };
  /* The fingerprint: the server sends a challenge, the device checks the finger or face, the server checks the answer. */
  const passkey = async (kind, quiet = false) => {
    const o = await api("POST", `/api/pay/passkey/${kind}/options`);
    if (!o.ok) return { ok: false, message: apiMsg(o) };
    let proof;
    try { proof = await (kind === "auth" ? startAuthentication({ optionsJSON: o.data }) : startRegistration({ optionsJSON: o.data })); }
    catch (e) { return { ok: false, message: e && e.name === "NotAllowedError" ? (quiet ? "" : "The fingerprint check was cancelled or timed out. Please try again.") : "This device could not use its fingerprint. Please try again or use the authenticator app." }; }
    return answer(api("POST", `/api/pay/passkey/${kind}/verify`, { response: proof }));
  };
  const value = {
    ...s, inPay, lock, refresh, canPasskey: browserSupportsWebAuthn(),
    unlockCode: (code) => answer(api("POST", "/api/pay/totp/unlock", { code })),
    unlockPin: (pin) => answer(api("POST", "/api/pay/pin/unlock", { pin })),
    setPin: (pin, confirm) => answer(api("POST", "/api/pay/pin/set", { pin, confirm })),
    unlockPasskey: (quiet) => passkey("auth", quiet),
    addPasskey: () => passkey("register"),
    totpStart: () => api("POST", "/api/pay/totp/start"),
    totpConfirm: (code) => answer(api("POST", "/api/pay/totp/confirm", { code })),
    sendCode: () => api("POST", "/api/pay/recover/email/send"),
    verifyCode: (code) => answer(api("POST", "/api/pay/recover/email/verify", { code })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Wraps a Pay page: its content appears only while Pay is unlocked; otherwise the right security screen. */
export function PayGate({ children }) {
  const pay = usePay();
  if (!pay || pay.phase === "open") return <>{pay && <PayBar />}{children}</>;
  if (pay.phase === "loading" || pay.phase === "idle") return <PageSkeleton stats={0} rows={4} />;
  if (pay.phase === "error") return <Panel icon="lock" title="Pay could not be checked" text="Wohlig One could not reach the server. Please check your connection and try again.">
    <button type="button" className="btn primary lg flex w-full" onClick={() => pay.refresh()}>Try again</button></Panel>;
  if (pay.phase === "setup") return <Prove pay={pay} first />;
  if (pay.phase === "enrol") return <Enrol pay={pay} />;
  return <Verify pay={pay} />;
}

/** The small bar inside Pay: it says Pay is unlocked, opens the security settings and locks it on request. */
function PayBar() {
  const pay = usePay(), [settings, setSettings] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("pay-finger-hint") === "1"; } catch { return false; } });
  const offer = pay.canPasskey && pay.factors.passkeys === 0 && !hidden;   // the browser can do a fingerprint, but none is registered yet
  const add = async () => { setBusy(true); setErr(""); const r = await pay.addPasskey(); setBusy(false); if (!r.ok) setErr(r.message); };
  const later = () => { setHidden(true); try { sessionStorage.setItem("pay-finger-hint", "1"); } catch { /* the hint just comes back */ } };
  return (
    <>
      {offer && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-field border border-line bg-tint px-4 py-3 print:hidden" role="status">
          <span className="text-[14px] text-ink">Open Pay with your fingerprint or Touch ID next time. {err && <b className="text-bad">{err}</b>}</span>
          <span className="flex gap-2"><button type="button" className="btn primary sm" disabled={busy} onClick={add}>{busy ? "Waiting for your fingerprint…" : "Add fingerprint"}</button>
            <button type="button" className="btn glass sm" disabled={busy} onClick={later}>Not now</button></span>
        </div>)}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3 print:hidden">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-dim"><span className="grid size-4 place-items-center text-ok [&_svg]:size-4"><Icon name="unlock" /></span>Pay is unlocked. It locks after 2 minutes without activity.</span>
        <button type="button" className="btn glass sm" onClick={() => setSettings(true)}>Security</button>
        <button type="button" className="btn glass sm" onClick={() => pay.lock("manual")}>Lock Pay</button>
        {settings && <Settings pay={pay} onClose={() => setSettings(false)} />}
      </div>
    </>
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
const linkBtn = "mx-auto w-fit border-0 bg-transparent p-0 text-[14px] font-bold text-accent underline underline-offset-2 disabled:opacity-60 disabled:no-underline";

/* Pay is locked: the fingerprint, the code from the authenticator app, or the PIN (whichever were set up; the PIN is the way in on a device
   with no fingerprint reader). After an automatic or manual lock a short message comes first. */
function Verify({ pay }) {
  const { passkeys, totp, pin } = pay.factors, usable = passkeys > 0 && pay.canPasskey;
  const codes = [totp && "app", pin && "pin"].filter(Boolean), [pick, setPick] = useState(""), method = pick || codes[0] || "";
  const [code, setCode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [lost, setLost] = useState(false), [fallback, setFallback] = useState(false), [turnOn, setTurnOn] = useState(false);
  const needsSetup = pay.canPasskey && passkeys === 0 && !!method;   // a device that can do a fingerprint, with none registered yet
  const showCodes = !!method && (turnOn || fallback || (!usable && !needsSetup));   // the fingerprint comes first and alone; the PIN or code is only the way out when it cannot be used
  const out = method === "pin" ? pay.pinOut : pay.out, isPin = method === "pin";
  const finger = async (quiet = false) => { setBusy(true); setErr(""); const r = await pay.unlockPasskey(quiet === true); setBusy(false); if (!r.ok && r.message) setErr(r.message); };
  // Arriving at Pay with a fingerprint registered: ask for it straight away, once. (After a lock the person chooses when; a browser that needs a click first just shows the button.)
  const tried = useRef(false);
  useEffect(() => { if (usable && !pay.reason && !tried.current) { tried.current = true; finger(true); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    if (code.length !== 6) return setErr(isPin ? "Enter your 6-digit PIN." : "Enter the 6-digit code from your authenticator app.");
    setBusy(true); setErr("");
    const r = await (isPin ? pay.unlockPin(code) : pay.unlockCode(code));
    setBusy(false);
    if (!r.ok) { setErr(r.message); setCode(""); }
    else if (turnOn) pay.addPasskey();   // the PIN or code was the proof it is them: now this device's fingerprint is registered
  };
  const switchTo = (m) => { setPick(m); setCode(""); setErr(""); };
  if (lost) return <Prove pay={pay} back={() => setLost(false)} />;
  return (
    <Panel icon="lock" title="Verify Your Identity" text="Confirm it is you to open confidential payroll information.">
      <Notice>{pay.notice || (pay.reason ? WHY[pay.reason] : "")}</Notice>
      {usable && <button type="button" className="btn primary lg flex w-full" disabled={busy} onClick={() => finger()}>{busy ? "Waiting for your fingerprint…" : "Use fingerprint or Touch ID"}</button>}
      {needsSetup && !turnOn && <button type="button" className="btn primary lg flex w-full" onClick={() => setTurnOn(true)}>Set up fingerprint on this device</button>}
      {needsSetup && turnOn && <Notice>Setting up your fingerprint: enter your {isPin ? "PIN" : "authenticator code"} once, then touch the sensor. From then on the fingerprint opens Pay by itself, and the {isPin ? "PIN" : "code"} is only the way out.</Notice>}
      {(usable || needsSetup) && method && !fallback && !turnOn && <button type="button" className={linkBtn} onClick={() => setFallback(true)}>{usable ? "Cannot use your fingerprint? " : ""}Use your {isPin ? "PIN" : "authenticator code"} instead</button>}
      {showCodes && <>
        {usable && <p className="m-0 text-[13px] text-ink-faint">{isPin ? "Enter your PIN" : "Enter the code from your authenticator app"}</p>}
        <PinInput id="pay-code" label={isPin ? "6-digit PIN" : "6-digit authenticator code"} plain={!isPin} value={code} onChange={(v) => { setCode(v); setErr(""); }} onEnter={go} autoFocus disabled={busy || out > 0} invalid={!!err} />
        <button type="button" className={`btn ${usable ? "glass" : "primary"} lg flex w-full`} disabled={busy || code.length !== 6 || out > 0} onClick={go}>{busy ? "Verifying…" : "Verify"}</button>
        {codes.length > 1 && <button type="button" className={linkBtn} onClick={() => switchTo(isPin ? "app" : "pin")}>{isPin ? "Use the authenticator app instead" : "Use your PIN instead"}</button>}
      </>}
      {!method && !usable && <p className="m-0 text-[14px] text-ink-dim">The fingerprint you set up works on the device you set it up on. On this device, choose the link below to set up again.</p>}
      <Problem>{out > 0 && !err ? `Too many wrong ${isPin ? "PINs" : "codes"}. Please try again in ${out} minute${out === 1 ? "" : "s"}${codes.length > 1 || usable ? ", or use another way" : ""}.` : err}</Problem>
      <button type="button" className={linkBtn} onClick={() => setLost(true)}>{method || usable ? "Lost your phone, or forgot your PIN?" : "Set up on this device"}</button>
      <p className="m-0 text-[13px] text-ink-faint">We will email a 6-digit code to your work email address, then you can set up again.</p>
    </Panel>
  );
}

/* Choose a 6-digit PIN and type it twice (a device with no fingerprint reader, or as a spare way in). */
function PinSetup({ pay, done }) {
  const [pin, setPin] = useState(""), [again, setAgain] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr("");
    const r = await pay.setPin(pin, again);
    setBusy(false);
    if (!r.ok) setErr(r.message); else done && done();
  };
  return (
    <div className="grid gap-4">
      <PinInput id="pay-pin-new" label="Choose a 6-digit PIN" value={pin} onChange={(v) => { setPin(v); setErr(""); }} autoFocus disabled={busy} invalid={!!err} />
      <PinInput id="pay-pin-again" label="Type it again" value={again} onChange={(v) => { setAgain(v); setErr(""); }} onEnter={go} disabled={busy} invalid={!!err} />
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || pin.length !== 6 || again.length !== 6} onClick={go}>{busy ? "Saving…" : "Save PIN and open Pay"}</button>
      <p className="m-0 text-left text-[13px] text-ink-faint">Avoid easy PINs such as 123456 or 000000. You will enter this PIN whenever you open Pay.</p>
    </div>
  );
}

/* Proof of identity: a 6-digit code goes to the person's own work email; the right code opens the "set up" step.
   Google confirmation stays as the other way in, for when the email does not arrive. */
function Prove({ pay, first = false, back }) {
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
  const backBtn = back && <button type="button" className="mx-auto w-fit border-0 bg-transparent p-0 text-[14px] text-ink-dim underline underline-offset-2" onClick={back}>Back</button>;
  if (step === "ask") return (
    <Panel icon="shield" title={first ? "Secure Your Pay Section" : "Set up again"}
      text={first ? "Your salary and payroll details are confidential. First we confirm it is you: we will email a 6-digit code to your work email address. Then you choose a fingerprint, an authenticator app or a PIN." : "We will email a 6-digit code to your work email address. After that you set up your fingerprint, authenticator app or PIN again. The old ones stop working."}>
      <Notice>{pay.notice}</Notice>
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || wait > 0} onClick={send}>{busy ? "Sending…" : wait > 0 ? `Wait ${wait}s` : "Email me a code"}</button>
      {google}{backBtn}
    </Panel>);
  return (
    <Panel icon="shield" title="Enter the code" text={`We emailed a 6-digit code to ${to}. It works for 10 minutes. Check your spam folder if you cannot see it.`}>
      <PinInput id="pay-otp" label="6-digit code" plain value={code} onChange={(v) => { setCode(v); setErr(""); }} onEnter={check} autoFocus disabled={busy} invalid={!!err} />
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || code.length !== 6} onClick={check}>{busy ? "Checking…" : "Continue"}</button>
      <button type="button" className={linkBtn} disabled={busy || wait > 0} onClick={send}>{wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}</button>
      {google}{backBtn}
    </Panel>);
}

/* The authenticator app: a QR code (or the text key) to add, then the first code to prove it works. */
function Authenticator({ pay, done }) {
  const [setup, setSetup] = useState(null), [qr, setQr] = useState(""), [code, setCode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await pay.totpStart();
      if (!live) return;
      if (!r.ok) return setErr(apiMsg(r));
      setSetup(r.data);
      QRCode.toDataURL(r.data.uri, { width: 224, margin: 1, errorCorrectionLevel: "M" }).then((u) => live && setQr(u)).catch(() => {});
    })();
    return () => { live = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = async () => {
    setBusy(true); setErr("");
    const r = await pay.totpConfirm(code);
    setBusy(false);
    if (!r.ok) { setErr(r.message); setCode(""); } else done && done();
  };
  if (!setup) return <>{err ? <Problem>{err}</Problem> : <p className="m-0 text-[14px] text-ink-dim">Preparing…</p>}</>;
  return (
    <div className="grid gap-3 text-left">
      <ol className="m-0 grid gap-1 pl-5 text-[14px] text-ink-dim">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator or Authy).</li>
        <li>Add an account and scan this picture.</li>
        <li>Type the 6-digit code it shows.</li>
      </ol>
      <div className="grid justify-items-center gap-2">
        {qr ? <img src={qr} width="224" height="224" alt="QR code to add Wohlig One to your authenticator app" className="rounded-field border border-line" /> : <div className="size-56 animate-pulse rounded-field bg-tint" />}
        <details className="text-[13px] text-ink-dim"><summary className="cursor-pointer">Cannot scan? Type this key instead</summary><code className="mt-1 block break-all font-mono text-[14px] tracking-wider text-ink">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></details>
      </div>
      <PinInput id="pay-totp-first" label="6-digit code from the app" plain value={code} onChange={(v) => { setCode(v); setErr(""); }} onEnter={confirm} disabled={busy} invalid={!!err} />
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy || code.length !== 6} onClick={confirm}>{busy ? "Checking…" : "Confirm and open Pay"}</button>
    </div>
  );
}

/* After proof of identity: choose how Pay will open (a fingerprint, an authenticator app or a PIN; more can be added later in Security). */
function Enrol({ pay }) {
  const [mode, setMode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [others, setOthers] = useState(false);
  const finger = async () => { setBusy(true); setErr(""); const r = await pay.addPasskey(); setBusy(false); if (!r.ok) setErr(r.message); };
  if (mode === "app") return (
    <Panel icon="shield" title="Set up your authenticator app" text="This works on any phone. You will type a code from it whenever you open Pay.">
      <Authenticator pay={pay} />
      <button type="button" className="mx-auto w-fit border-0 bg-transparent p-0 text-[14px] text-ink-dim underline underline-offset-2" onClick={() => setMode("")}>Back</button>
    </Panel>);
  if (mode === "pin") return (
    <Panel icon="shield" title="Choose your PIN" text="A 6-digit PIN for Pay, for when this device has no fingerprint reader.">
      <PinSetup pay={pay} />
      <button type="button" className="mx-auto w-fit border-0 bg-transparent p-0 text-[14px] text-ink-dim underline underline-offset-2" onClick={() => setMode("")}>Back</button>
    </Panel>);
  if (pay.canPasskey && !others) return (
    <Panel icon="shield" title="Set up your fingerprint" text="Thank you for confirming it is you. Use the fingerprint or Touch ID of this device to open Pay.">
      <Problem>{err}</Problem>
      <button type="button" className="btn primary lg flex w-full" disabled={busy} onClick={finger}>{busy ? "Waiting for your fingerprint…" : "Use fingerprint or Touch ID"}</button>
      <p className="m-0 text-[13px] text-ink-faint">The fingerprint stays on this device: Wohlig One never sees it.</p>
      <button type="button" className={linkBtn} disabled={busy} onClick={() => setOthers(true)}>No fingerprint reader? Use a PIN or authenticator app</button>
    </Panel>);
  return (
    <Panel icon="shield" title={pay.canPasskey ? "Choose another way to open Pay" : "Choose how to open Pay"} text="Pick a way to unlock Pay. You can add another one later under Security.">
      <Problem>{err}</Problem>
      {pay.canPasskey ? <button type="button" className="btn primary lg flex w-full" disabled={busy} onClick={finger}>{busy ? "Waiting for your fingerprint…" : "Use fingerprint or Touch ID"}</button>
        : <Notice>{`A fingerprint is not available here. It needs a secure address (https, or localhost) and a browser on a device with Touch ID, Face ID or a fingerprint reader. You are on ${location.origin}.`}</Notice>}
      <button type="button" className={`btn ${pay.canPasskey ? "glass" : "primary"} lg flex w-full`} disabled={busy} onClick={() => setMode("app")}>Use an authenticator app</button>
      <button type="button" className="btn glass lg flex w-full" disabled={busy} onClick={() => setMode("pin")}>Use a PIN</button>
      <p className="m-0 text-[13px] text-ink-faint">The authenticator app works on any phone. The PIN is the simple choice when the device has no fingerprint reader.</p>
    </Panel>);
}

/* Security settings, from inside an unlocked Pay: what is set up, add the fingerprint of this device, set up the authenticator app, remove a fingerprint. */
function Settings({ pay, onClose }) {
  const [info, setInfo] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [app, setApp] = useState(false), [pinForm, setPinForm] = useState(false);
  const load = useCallback(async () => { const r = await api("GET", "/api/pay/factors"); if (r.ok) setInfo(r.data); else setErr(apiMsg(r)); }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => { setBusy(true); setErr(""); const r = await pay.addPasskey(); setBusy(false); if (!r.ok) setErr(r.message); else load(); };
  const removePin = async () => { setBusy(true); setErr(""); const r = await api("DELETE", "/api/pay/pin"); setBusy(false); if (!r.ok) setErr(apiMsg(r)); else load(); };
  const remove = async (id) => { setBusy(true); setErr(""); const r = await api("DELETE", `/api/pay/passkey/${id}`); setBusy(false); if (!r.ok) setErr(apiMsg(r)); else load(); };
  return (
    <Modal onClose={onClose}>
      <div className="card-h"><h3>Pay security</h3></div>
      <div className="card-b grid gap-4 text-left">
        <Problem>{err}</Problem>
        {!info ? <p className="m-0 text-ink-dim">Loading…</p> : app ? <Authenticator pay={pay} done={() => { setApp(false); load(); }} /> : pinForm ? <PinSetup pay={pay} done={() => { setPinForm(false); load(); }} /> : <>
          <section className="grid gap-2">
            <h3 className="m-0 text-[15px]">Authenticator app</h3>
            {info.totp ? <p className="m-0 text-[14px] text-ink-dim">Set up. You type its 6-digit code to open Pay.</p>
              : <><p className="m-0 text-[14px] text-ink-dim">Not set up. It works on any phone and is the way in if you lose a device.</p><button type="button" className="btn glass sm w-fit" onClick={() => setApp(true)}>Set up authenticator app</button></>}
          </section>
          <section className="grid gap-2">
            <h3 className="m-0 text-[15px]">Fingerprint, Touch ID and Face ID</h3>
            {info.passkeys.length ? <ul className="m-0 grid list-none gap-2 p-0">{info.passkeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 rounded-field border border-line px-3 py-2 text-[14px]">
                <span><b>{k.name || "Device"}</b><span className="block text-[12px] text-ink-faint">Added {new Date(k.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}{k.lastUsedAt ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}</span></span>
                <button type="button" className="btn glass sm" disabled={busy} onClick={() => remove(k.id)}>Remove</button></li>))}</ul>
              : <p className="m-0 text-[14px] text-ink-dim">None yet.</p>}
            {pay.canPasskey ? <button type="button" className="btn glass sm w-fit" disabled={busy} onClick={add}>{busy ? "Waiting…" : "Add this device's fingerprint"}</button> : <p className="m-0 text-[13px] text-ink-faint">This browser cannot use a fingerprint.</p>}
          </section>
          <section className="grid gap-2">
            <h3 className="m-0 text-[15px]">PIN</h3>
            <p className="m-0 text-[14px] text-ink-dim">{info.pin ? "Set up. Use it on a device with no fingerprint reader." : "Not set up. A simple way in for a device with no fingerprint reader."}</p>
            <div className="flex gap-2"><button type="button" className="btn glass sm" disabled={busy} onClick={() => setPinForm(true)}>{info.pin ? "Change PIN" : "Set a PIN"}</button>
              {info.pin && <button type="button" className="btn glass sm" disabled={busy} onClick={removePin}>Remove PIN</button>}</div>
          </section>
          <p className="m-0 text-[13px] text-ink-faint">Lost a device? Lock Pay, then choose "Lost your phone, or forgot your PIN?". We email a code and everything is set up again.</p>
        </>}
      </div>
    </Modal>
  );
}
