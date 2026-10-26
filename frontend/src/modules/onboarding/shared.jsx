import { useNavigate } from "react-router-dom";
import { shortDate } from "../../components/ui.jsx";

export const DOCS = [
  { k: "aadhaar", name: "Aadhaar card" },
  { k: "pan", name: "PAN card" },
  { k: "dl", name: "Driving licence" },
  { k: "passport", name: "Passport" },
  { k: "voter", name: "Voter ID" },
  { k: "exp", name: "Previous experience letters", multi: true, max: 10 },
  { k: "edu", name: "Education certificates", multi: true, max: 5 },
  { k: "bank", name: "Bank passbook or cancelled cheque" },
];
export const MAX_MB = 5;
export const DOMAIN = "wohlig.com";
export const DEPTS = ["Engineering", "Data", "DevOps & Cloud", "Gen AI", "Sales", "HR", "Finance & Admin", "Leadership"];
export const ON_TOOLS = ["claude"];   // onboarding gives Claude only for now

export const digits = (s) => String(s || "").replace(/\D/g, "");
export const V = {
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim()),
  phone: (v) => { let d = digits(v); if (d.length === 12 && d.startsWith("91")) d = d.slice(2); return /^[6-9]\d{9}$/.test(d); },
};
export const maskMail = (v) => { const [a, b] = String(v || "").split("@"); return b ? a.slice(0, 2) + "•••@" + b : ""; };
export const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
export const nameSplit = (full) => { const p = String(full || "").trim().split(/\s+/); return { first: p[0] || "", last: p.slice(1).join(" ") }; };
export const fdate = (s) => (s ? shortDate(s) : "—");

/* Work email: name.surname@wohlig.com, lowercase, no spaces or special characters, a number added if taken. */
export function makeWorkEmail(first, last, isTaken) {
  const clean = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = clean(first), b = clean(last);
  if (!a || !b) return "";
  const base = `${a}.${b}`;
  let n = 1, email = `${base}@${DOMAIN}`;
  while (isTaken(email)) { n++; email = `${base}${n}@${DOMAIN}`; }
  return email;
}

/* A file must be PDF, JPG or PNG, not empty, and no larger than MAX_MB. */
export function fileProblem(f) {
  const extOk = /\.(pdf|jpe?g|png)$/i.test(f.name), typeOk = !f.type || ["application/pdf", "image/jpeg", "image/png"].includes(f.type);
  if (!extOk || !typeOk) return `${f.name}: only PDF, JPG or PNG files are allowed.`;
  if (f.size === 0) return `${f.name}: the file is empty.`;
  if (f.size > MAX_MB * 1048576) return `${f.name}: the file is larger than ${MAX_MB} MB.`;
  return "";
}

export const ACCESS_LABEL = { employee: "Employee", hr: "HR (full rights)" };
export const ACCESS_HELP = {
  employee: "Sees the site and uses their own pages: documents, profile and leave.",
  manager: "Like an employee, and also approves leave for the people who report to them.",
  hr: "Full rights: can see and change everything, including onboarding, offboarding, leave, the audit log and everyone's logins.",
};
export const hrConfirm = (name) => confirm(`Give ${name} full HR rights?\n\nHR can see and change everything in the app: onboarding, offboarding, leave, the audit log and everyone's logins. Only do this for someone who works in HR.`);

export const docLinks = (f) => (f.id
  ? <><a href={`/api/documents/${f.id}/file`} target="_blank" rel="noopener">{f.name}</a> · <a href={`/api/documents/${f.id}/file?download=1`} download={f.name}>Save</a></>
  : f.name);

/* docs from the server (flat list) grouped as { email: { key: [file] } } */
export function groupDocs(list) {
  const out = {};
  for (const d of list || []) {
    const e = String(d.email).toLowerCase();
    ((out[e] = out[e] || {})[d.key] = (out[e] || {})[d.key] || []).push({ id: d.id, name: d.name, size: d.size });
  }
  return out;
}
export const docCount = (m) => Object.values(m || {}).reduce((n, a) => n + (a ? a.length : 0), 0);

export function DocRows({ m }) {
  return DOCS.filter((d) => (m[d.k] || []).length).map((d) => (
    <div className="doc-row" key={d.k}><div className="grow"><b>{d.name}</b>
      {m[d.k].map((f) => <div className="sub" key={f.id}>{docLinks(f)} · {fmtSize(f.size)}</div>)}</div></div>
  ));
}

export function ObTabs({ cur }) {
  const nav = useNavigate();
  return (
    <div className="subtabs" role="tablist">
      <button type="button" role="tab" className={cur === "onboard" ? "on" : ""} aria-selected={cur === "onboard"} onClick={() => nav("/app/onboarding")}>New joiner</button>
      <button type="button" role="tab" className={cur === "docs" ? "on" : ""} aria-selected={cur === "docs"} onClick={() => nav("/app/documents")}>Employee documents</button>
    </div>
  );
}
