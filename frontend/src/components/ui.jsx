/* Small building blocks shared by every page. Styled with Tailwind classes (the Wohlig theme is in styles.css). */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Tabs } from "radix-ui";

/** A 44px icon button (top bar, bell). Add its display yourself (`inline-grid`), so one that hides on some screens can say so. */
export const ICON_BTN = "size-11 flex-none cursor-pointer place-items-center rounded-field border-0 bg-transparent p-0 text-ink-dim transition-colors duration-150 hover:bg-tint hover:text-ink aria-expanded:bg-tint aria-expanded:text-ink [&>svg]:size-5";

/** A bar of actions under a card on a page: a line above, actions on the right, stacked and full width on a phone.
    (Inside a dialog the footer is styled by Modal itself; give it the plain name `modal-f`.) */
export const ACTION_BAR = "sticky bottom-0 mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-6 py-4 max-sheet:flex-col-reverse max-sheet:items-stretch max-sheet:pb-[calc(16px+env(safe-area-inset-bottom,0px))] max-sheet:[&_.btn]:w-full";

export const initials = (n) => String(n || "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/** The download arrow shown in buttons that save a file. Give the button an aria-label, since the word "Download" is not shown. */
export const DownloadIcon = () => (
  <svg className="dl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
);

/** The eye shown on buttons that open a larger preview. Give the button an aria-label. */
export const ViewIcon = () => (
  <svg className="dl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);

/** A private value (a PAN or an Aadhaar number) that stays hidden until the eye is pressed. `value` is the masked form HR holds (its presence means "on file");
 *  `fetchFull` (optional) is asked for the full number when the eye is pressed, one number at a time, and the full number is dropped again on hide and after
 *  30 seconds. If only the masked form is stored, that is shown. Only the person and HR are ever sent either. `label` names it for screen readers.
 *  The eye is a 44px button; the icons carry their own size so they never stretch. */
export function RevealValue({ value, label, fetchFull, empty = "Not on file" }) {
  const [full, setFull] = useState(null), [shown, setShown] = useState(false), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  useEffect(() => { if (!shown) return undefined; const t = setTimeout(() => { setShown(false); setFull(null); }, 30000); return () => clearTimeout(t); }, [shown]);
  if (!value) return <span className="muted">{empty}</span>;
  const toggle = async () => {
    if (shown) { setShown(false); setFull(null); return; }
    setProblem("");
    if (fetchFull) {
      setBusy(true);
      try { setFull(await fetchFull()); } catch (e) { setProblem(e && e.message ? e.message : "It could not be opened. Please try again."); setBusy(false); return; }
      setBusy(false);
    }
    setShown(true);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="font-mono" aria-live="polite">{shown ? full || value : "••••••••••"}</span>
      <button type="button" aria-pressed={shown} aria-label={`${shown ? "Hide" : "Show"} ${label}`} title={`${shown ? "Hide" : "Show"} ${label}`} disabled={busy}
        className="-my-2.5 inline-grid size-11 shrink-0 cursor-pointer place-items-center rounded-field border-0 bg-transparent p-0 text-ink-dim hover:bg-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:opacity-50"
        onClick={toggle}>
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {shown ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.5 0 2.9-.4 4.1-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>
            : <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
      </button>
      {problem && <span className="w-full text-sm text-bad" role="alert">{problem}</span>}
    </span>
  );
}

export const Smile = () => (
  <svg className="smile" viewBox="0 0 34 10" fill="none" aria-hidden="true">
    <path d="M2 2c4 5 9 6.5 15 6.5S28 7 32 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/** The head of every page: the page's name, one line on what it is for, and the page's actions on the right.
    The section the page belongs to is shown in the top bar, so `eyebrow` is not drawn; `accent`, if given, is read as the end of the title.
    A second head further down a page passes `as="h2"`; `className` is for spacing around the head only. Left out of print. */
export function SectionHead({ title, accent, sub, actions, tabs, as: Title = "h1", className = "" }) {
  const head = (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-4 print:hidden! ${tabs ? "" : className}`}>
      <div className="min-w-0 flex-[1_1_360px]">
        <Title className="m-0 font-display text-[clamp(26px,2.4vw,32px)] leading-[1.15] font-normal tracking-[-0.015em] text-heading">{title}{accent ? ` ${accent}` : ""}</Title>
        {sub && <p className="mt-1.5 mb-0 max-w-[75ch] text-[15px] text-ink-dim">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-3 max-md:w-full max-md:justify-start [&>.input]:w-[clamp(240px,24vw,340px)] max-md:[&>.input]:w-full">{actions}</div>}
    </div>
  );
  return tabs ? <div className={`flex flex-col gap-4 print:hidden! ${className}`}>{head}{tabs}</div> : head;
}

/* Underlined tabs: the strip, one tab, and the current tab's maroon underline. Shared by PageTabs and ViewTabs. */
const TAB_LIST = "m-0 flex max-w-full flex-nowrap gap-1 overflow-x-auto border-b border-line p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const TAB = "relative inline-flex min-h-11 flex-none cursor-pointer items-center rounded-t-md border-0 bg-transparent px-3.5 py-0 font-body text-[15px] leading-none font-bold whitespace-nowrap text-ink-dim no-underline hover:bg-tint-2 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent data-[state=active]:text-ink";
const TAB_ON = "text-ink after:absolute after:inset-x-2.5 after:-bottom-px after:h-[3px] after:rounded-t-[3px] after:bg-accent after:content-['']";

/** The views of one page (for example Onboarding: In onboarding, Claude requests, Documents), drawn as underlined tabs
    under the page head. Each item is [key, label, address]; the current one is marked for screen readers too.
    Filters inside a page use the pill switch (`.seg`) instead, so moving to another view never looks like filtering. */
export function PageTabs({ items, current, label = "Views" }) {
  return (
    <nav className={TAB_LIST} aria-label={label}>
      {items.filter(Boolean).map(([k, text, to]) => (
        <Link key={k} to={to} className={`${TAB} ${k === current ? TAB_ON : ""}`} aria-current={k === current ? "page" : undefined}>{text}</Link>
      ))}
    </nav>
  );
}

export const Stat = ({ value, label, alert }) => (
  <div className="card flex flex-col-reverse items-start justify-end gap-1.5 px-5 py-[18px] text-left">
    <span className={`font-display text-[30px] leading-[1.1] font-medium tracking-[-0.01em] tabular-nums max-xs:text-[26px] [&_sup]:ml-0.5 [&_sup]:text-[.42em] [&_sup]:text-accent ${alert ? "bg-linear-[110deg] from-danger to-danger-light bg-clip-text text-transparent" : ""}`}>{value}</span>
    <span className="font-body text-[13px] leading-[1.3] font-bold text-ink-dim">{label}</span>
  </div>
);

export const Callout = ({ children }) => (
  <div className="callout">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
    <div>{children}</div>
  </div>
);

/* A status pill: a dot and a word on a soft tint. Tones: ok, warn, bad, info, mute; add `busy` to make the dot blink ("info busy"). */
const PILL = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] font-body text-[12px] leading-normal font-semibold tracking-normal whitespace-nowrap before:size-1.5 before:rounded-full before:bg-current before:content-[''] [&+small]:mt-[5px]";
const PILL_TONE = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-tint text-accent", mute: "bg-paper-2 text-ink-faint", busy: "before:animate-blink motion-reduce:before:animate-none" };
/** The classes of a pill, for an element that is not a `<Pill>` (a link, a button). `tone` is a tone name; the older
    `p-warn` spelling kept in some status tables works too. No tone gives a plain pill. */
export const pill = (tone = "") => `${PILL} ${String(tone || "").split(/\s+/).map((t) => PILL_TONE[t.replace(/^p-/, "")] || "").join(" ")}`;
export const Pill = ({ tone = "mute", children }) => <span className={pill(tone)}>{children}</span>;

export function Person({ name, sub, color = "#800d35" }) {
  return (
    <div className="person">
      <span className="avatar" style={{ background: color }}>{initials(name)}</span>
      <div style={{ minWidth: 0 }}><b>{name}</b><span>{sub}</span></div>
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayLabel = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MON[m - 1]}, ${WEEK[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}`;
};
export const shortDate = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
};
export const hours = (m) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "—");

/* Icons used by the pages (the same drawings as the older pages). */
const ICON_PATHS = {
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><path d="M12 14.5v2.5" /></>,
  unlock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 7.5-1.9" /></>,
  camera: <><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  idcard: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.5-1.6 1.7-2.4 3-2.4s2.5.8 3 2.4M14 10h4M14 14h4" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  filedoc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>,
  onboard: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.5 0 2.9.4 4 1.3" /><path d="M18 14v6M15 17h6" /></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  offboard: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.5 0 2.9.4 4 1.3" /><path d="M15 17h6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" /></>,
  /* The sidebar menu */
  home: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.7-3.5 3.3-5.5 6.5-5.5s5.8 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.6 3 5.2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  laptop: <><rect x="4.5" y="5" width="15" height="10" rx="1.5" /><path d="M2.5 19h19" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  team: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M9 15.5l2 2 4-4" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  bank: <><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18" /></>,
  feed: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5" /></>,
  gift: <><rect x="3.5" y="9" width="17" height="11" rx="1.5" /><path d="M2.5 9h19M12 9v11" /><path d="M12 9C10 5 6.5 5.5 7.5 7.6 8.2 9 12 9 12 9zM12 9c2-4 5.5-3.5 4.5-1.4C15.8 9 12 9 12 9z" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.9-4 4-6.2 8-6.2s7.1 2.2 8 6.2" /></>,
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" />,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  signout: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
  /* One drawing per page, named after what the page is (2026-11-19). */
  house: <path d="M4 10.5 12 4l8 6.5V19.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  attendance: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15.5 2 2 4-4" /></>,
  luggage: <><rect x="5" y="7" width="14" height="13" rx="2" /><path d="M9 7V4.5h6V7M9 11v5M15 11v5M8 20v1.5M16 20v1.5" /></>,
  send: <><path d="M3 11.5 20.5 4l-5 16.5-4-6.5z" /><path d="m11.5 14 9-10" /></>,
  timer: <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5M18.5 6.5l1.5-1.5" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />,
  cap: <><path d="m2.5 9 9.5-4.5L21.5 9 12 13.5z" /><path d="M6.5 11.2v4.3c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.3M21.5 9v5" /></>,
  chat: <><path d="M4 4.5h10.5A1.5 1.5 0 0 1 16 6v6.5a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5z" /><path d="M16 9h4a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 1-1.5 1.5h-1v3l-4-3h-4.5a1.5 1.5 0 0 1-1.5-1.5v-1" /></>,
  lifebuoy: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /><path d="m6 6 3.5 3.5M14.5 14.5 18 18M18 6l-3.5 3.5M9.5 14.5 6 18" /></>,
  medal: <><circle cx="12" cy="15" r="5.5" /><path d="M8.6 10.6 6 3h4l2 5.2M15.4 10.6 18 3h-4l-1.1 2.9" /></>,
  inbox: <><path d="M3 13.5 5.5 5h13l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z" /><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" /></>,
  handoff: <><path d="M4 8h14.5l-3.5-3.5M20 16H5.5L9 19.5" /></>,
  wallet: <><path d="M4 8V7a2 2 0 0 1 2-2h11v3" /><rect x="4" y="8" width="17" height="12" rx="2" /><circle cx="16.5" cy="14" r="1.2" /></>,
  payslip: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9.5 7.5h5M9.5 10h5M9.5 7.5c3 0 3 5 0 5l4 4" /></>,
  tax: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="m9.8 17.2 4.5-6" /><circle cx="10" cy="11.6" r="1" /><circle cx="14.2" cy="16.8" r="1" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></>,
  pie: <><path d="M11 4.5a8 8 0 1 0 8.5 8.5H11z" /><path d="M14 3.2a8 8 0 0 1 6.8 6.8H14z" /></>,
  project: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9.2 4v16M14.8 4v16M5.5 8h2M11.2 8h1.6M16.8 8h1.7" /></>,
  megaphone: <><path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M18 9.5a3 3 0 0 1 0 5M8 15l1.2 5" /></>,
  poll: <><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M8 16v-3M12 16V8M16 16v-6" /></>,
  survey: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.8h6V4M8.5 10l1.2 1.2 2-2M8.5 15.5l1.2 1.2 2-2M13.5 10.5H16M13.5 16H16" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></>,
  cake: <><path d="M4 21h16v-6.5a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 4 14.5z" /><path d="M4 17c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0M8 13V9.5M12 13V9.5M16 13V9.5M8 6.5c0-1 .8-1.4.8-2.5M12 6.5c0-1 .8-1.4.8-2.5M16 6.5c0-1 .8-1.4.8-2.5" /></>,
  hourglass: <><path d="M6.5 3h11M6.5 21h11" /><path d="M7.5 3c0 4.5 4.5 5.5 4.5 9s-4.5 4.5-4.5 9M16.5 3c0 4.5-4.5 5.5-4.5 9s4.5 4.5 4.5 9" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4.5h11.5l-2 4 2 4H5" /></>,
  hire: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c.8-3.6 3.4-5.6 6.5-5.6 1.3 0 2.5.3 3.4.9" /><circle cx="17.3" cy="16.3" r="2.8" /><path d="m19.4 18.4 2.1 2.1" /></>,
  pen: <><path d="M4 20h4.5L19.5 9a2.1 2.1 0 0 0-3-3L5.5 17z" /><path d="m14.5 8 3 3M13 20h7" /></>,
  door: <><path d="M5.5 21V4.5A1.5 1.5 0 0 1 7 3h8.5v18" /><path d="M3 21h18M15.5 5l4 1.5V21M12 12.5h.01" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4.5l3 2" /></>,
  contrast: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" /></>,
};
export const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS[name]}</svg>
);

export const Avatar = ({ person }) => <span className="avatar" style={{ background: person.color }}>{initials(person.name)}</span>;

/* Lets a long email wrap at a dot or the @ (never in the middle of a word). */
const breakable = (s) => String(s).split(/(?=[.@])/).flatMap((part, i) => (i ? [<wbr key={`w${i}`} />, part] : [part]));

export function PersonCell({ person, sub }) {
  return (
    <div className="person">
      <Avatar person={person} />
      <div style={{ minWidth: 0 }}><b>{person.name}</b><span>{breakable(sub ?? person.email)}</span></div>
    </div>
  );
}

export function ToolIcon({ tool, state }) {
  const cls = state === "active" ? "" : state === "failed" ? "fail" : "off";
  return <span className={`app-ic ${cls}`} style={{ background: tool.color }} title={tool.name}>{tool.mono}</span>;
}

/** Tabs that switch what a page or card shows without leaving it, on Radix UI's Tabs: arrow keys move between them,
    Home and End jump to the first and last. `views` is [[key, label], ...]. (Tabs that go to another address use PageTabs.) */
export function ViewTabs({ views, view, onView, label, style }) {
  return (
    <Tabs.Root value={view} onValueChange={onView} activationMode="manual" style={{ minWidth: 0 }}>
      <Tabs.List className={TAB_LIST} aria-label={label} style={style}>
        {views.filter(Boolean).map(([k, text]) => <Tabs.Trigger key={k} value={k} className={`${TAB} ${view === k ? TAB_ON : ""}`}>{text}</Tabs.Trigger>)}
      </Tabs.List>
    </Tabs.Root>
  );
}

/** Tabs shown as the standard buttons: the open one is the maroon primary button, the others are glass. Same behaviour as ViewTabs. */
export function ButtonTabs({ views, view, onView, label }) {
  return (
    <Tabs.Root value={view} onValueChange={onView} activationMode="manual" style={{ minWidth: 0 }}>
      <Tabs.List className="m-0 flex flex-wrap gap-2 p-0" aria-label={label}>
        {views.filter(Boolean).map(([k, text]) => <Tabs.Trigger key={k} value={k} className={`btn sm ${view === k ? "primary" : "glass"}`}>{text}</Tabs.Trigger>)}
      </Tabs.List>
    </Tabs.Root>
  );
}

/* ---------- Skeletons: what a page shows while it loads. Never a "Loading…" text: the shape of the content, softly lit. ---------- */
const SK = "block animate-skel bg-[linear-gradient(90deg,var(--color-tint)_25%,var(--color-line)_50%,var(--color-tint)_75%)] bg-[length:200%_100%]";
const Busy = ({ children, className = "" }) => (
  <div role="status" aria-busy="true" className={`relative ${className}`}><span className="sr-only">Loading</span>{children}</div>
);
/** One grey bar. `className` sets its size, for example "h-4 w-40". */
export const Skeleton = ({ className = "h-4 w-full" }) => <span aria-hidden="true" className={`${SK} ${/\brounded/.test(className) ? "" : "rounded-md"} ${className}`} />;
/** A line of text that is still loading, inline. */
export const LineSkeleton = ({ width = "w-28" }) => <Busy className="inline-block align-middle"><Skeleton className={`h-3.5 ${width}`} /></Busy>;
/** Rows of a list or table body: a round face, a name and a detail line, and a short tag on the right. */
export function ListSkeleton({ rows = 5, faces = true }) {
  const widths = ["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-2/5", "w-1/3"];
  return (
    <Busy className="flex flex-col gap-0 px-5 py-2 max-sm:px-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3.5 border-t border-line py-3.5 first:border-t-0">
          {faces && <Skeleton className="size-10 flex-none rounded-full" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className={`h-3.5 ${widths[i % widths.length]}`} /><Skeleton className="h-3 w-1/5" /></div>
          <Skeleton className="h-6 w-16 flex-none rounded-full max-sm:hidden" />
        </div>))}
    </Busy>
  );
}
/** A table that is still loading: `cols` matches the table so the skeleton spans it. */
export const TableSkeletonRow = ({ cols = 4, rows = 5 }) => <tr><td colSpan={cols} className="p-0"><ListSkeleton rows={rows} /></td></tr>;
/** A card whose body is still loading: a title bar and a few lines. */
export function CardSkeleton({ lines = 3 }) {
  return (
    <Busy className="card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4"><Skeleton className="h-5 w-40" /><Skeleton className="h-8 w-24 rounded-full" /></div>
      <div className="flex flex-col gap-3 px-5 py-5">{Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-3.5 ${["w-full", "w-11/12", "w-3/4", "w-5/6"][i % 4]}`} />)}</div>
    </Busy>
  );
}
/** A whole page that is still loading: the page head, a row of figures and a list. */
export function PageSkeleton({ stats = 4, rows = 6 }) {
  return (
    <Busy className="flex flex-col gap-6">
      <div className="flex flex-col gap-3"><Skeleton className="h-8 w-56 max-sm:w-40" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      {stats > 0 && <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2">{Array.from({ length: stats }, (_, i) => (
        <div key={i} className="card flex flex-col gap-3 px-5 py-4"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-7 w-14" /><Skeleton className="h-3 w-28" /></div>))}</div>}
      <div className="card overflow-hidden p-0"><ListSkeleton rows={rows} /></div>
    </Busy>
  );
}
