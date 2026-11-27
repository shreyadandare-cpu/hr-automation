import { api, apiMsg } from "../api.js";

/* Passkeys: confirm a punch with the phone's own fingerprint, face or screen lock (WebAuthn). The fingerprint never leaves the
   phone; Wohlig One keeps only a public key. The server's checks are in backend/src/passkey-rules.js. */
const buf = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** This browser can make and use passkeys. */
export const passkeysWork = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

/** The browser's error, in words a person can act on. */
function why(e) {
  const n = e && e.name;
  if (n === "NotAllowedError" || n === "AbortError") return "The fingerprint or face check was cancelled. Please try again.";
  if (n === "InvalidStateError") return "This phone is already set up.";
  if (n === "SecurityError") return "Fingerprint or face unlock works only on the Wohlig One address. Please open it from there.";
  return "Your fingerprint or face unlock could not be used. Please check that a screen lock is set on this phone, then try again.";
}

/** Sets up a passkey on this phone. Returns an error message, or "" when it worked. */
export async function setUpPasskey(label) {
  if (!passkeysWork()) return "This browser cannot use fingerprint or face unlock. Please update it, or use Chrome or Safari.";
  const s = await api("POST", "/api/passkeys/register/start");
  if (!s.ok) return apiMsg(s);
  const o = s.data;
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: buf(o.challenge), rp: o.rp, user: { id: buf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.algs.map((alg) => ({ type: "public-key", alg })),
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      excludeCredentials: o.exclude.map((id) => ({ type: "public-key", id: buf(id) })), attestation: "none", timeout: 120000 } });
  } catch (e) { return why(e); }
  const r = cred.response;
  const publicKey = typeof r.getPublicKey === "function" ? r.getPublicKey() : null;
  if (!publicKey) return "This browser cannot set up fingerprint or face unlock. Please update it, or use Chrome or Safari.";
  const f = await api("POST", "/api/passkeys/register/finish", { id: cred.id, clientDataJSON: b64u(r.clientDataJSON),
    authenticatorData: b64u(r.getAuthenticatorData()), publicKey: b64u(publicKey), alg: r.getPublicKeyAlgorithm(), label });
  return f.ok ? "" : apiMsg(f);
}

/** Asks for the fingerprint or face before a punch. Returns { answer } to send with the punch, or { error }. */
export async function confirmWithPasskey() {
  if (!passkeysWork()) return { error: "This browser cannot use fingerprint or face unlock. Please update it, or use Chrome or Safari." };
  const c = await api("POST", "/api/attendance/punch/challenge");
  if (!c.ok) return { error: apiMsg(c) };
  try {
    const a = await navigator.credentials.get({ publicKey: { challenge: buf(c.data.challenge), rpId: c.data.rpId,
      allowCredentials: c.data.allow.map((id) => ({ type: "public-key", id: buf(id) })), userVerification: "required", timeout: 120000 } });
    const r = a.response;
    return { answer: { id: a.id, clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature) } };
  } catch (e) { return { error: why(e) }; }
}

/** A short name for this phone, to tell passkeys apart: "iPhone", "Android phone", "Mac"… */
export function deviceName() {
  const ua = navigator.userAgent || "";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android phone";
  if (/mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows computer";
  return "This device";
}
