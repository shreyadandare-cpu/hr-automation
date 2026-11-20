import { Suspense, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { DropdownMenu, NavigationMenu, Tooltip } from "radix-ui";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../data.jsx";
import { applyTheme, currentTheme, setThemeChoice, themeChoice } from "../theme.js";
import { ICON_BTN, Icon, initials, PageSkeleton } from "./ui.jsx";
import { useToast } from "./toast.jsx";
import { findItem, menuFor } from "../lib/menu.js";
import QuickSearch from "./QuickSearch.jsx";
import NotificationBell from "./NotificationBell.jsx";
import NextHolidayPopup from "./NextHolidayPopup.jsx";
import { BRAND, PRODUCT } from "../brand.js";
import { FestivalChip, FestiveFrame, useFestivalLook } from "./FestivalLook.jsx";

/* Class strings shared inside the shell. Colours, shadows and the 1024px `rail` breakpoint come from the theme in styles.css. */
const FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
/* The round face: a photo, or initials on the accent colour. Add a size and a shadow. */
const FACE = "inline-grid flex-none place-items-center overflow-hidden rounded-full border-0 bg-accent p-0 font-body leading-none font-semibold text-white [&>img]:block [&>img]:size-full [&>img]:object-cover";
const MENU_ITEM = "block w-full cursor-pointer rounded-field border-0 bg-transparent px-3 py-2.5 text-left font-display text-[14.5px] leading-[1.2] font-medium text-ink no-underline select-none data-highlighted:bg-tint data-highlighted:outline-0";

/* Light, dark or the device's setting, chosen inside the account menu. */
function Appearance() {
  const [choice, setChoice] = useState(themeChoice());
  useEffect(() => {   // following the device: change when the device does
    if (choice !== "system" || !window.matchMedia) return;
    const m = matchMedia("(prefers-color-scheme: dark)"), on = () => applyTheme(currentTheme());
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [choice]);
  const pick = (c) => { setThemeChoice(c); setChoice(c); };
  return (
    <div className="px-3 pt-1.5 pb-2.5">
      <div className="mb-2 font-body text-[13px] font-bold text-ink-dim" id="appearance-label">Appearance</div>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-tint p-1" role="radiogroup" aria-labelledby="appearance-label">
        {[["light", "Light"], ["dark", "Dark"], ["system", "Device"]].map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={choice === k} onClick={() => pick(k)}
            className={`h-9 cursor-pointer rounded-full border-0 px-2 font-body text-[14px] leading-none font-bold transition-colors duration-150 ${FOCUS} ${choice === k ? "bg-surface text-accent shadow-raised" : "bg-transparent text-ink-dim hover:text-ink"}`}>{label}</button>))}
      </div>
    </div>
  );
}

/* The account menu, on Radix UI's Dropdown Menu: arrow keys move through it, typing jumps to an item, Escape closes it. */
function AccountMenu({ photo }) {
  const { user, isHr } = useAuth();
  const nav = useNavigate();
  const face = photo ? <img src={photo} alt="" /> : initials(user.name);
  const signOut = async () => { await api("POST", "/api/logout"); location.href = "/login"; };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={`${FACE} ml-2 size-[38px] cursor-pointer text-[13px] shadow-avatar hover:shadow-avatar-on data-[state=open]:shadow-avatar-on`} aria-label="Account menu" title={`${user.name}, account menu`} style={{ background: photo ? "transparent" : undefined }}>{face}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="z-70 max-w-[calc(100%-32px)] min-w-[270px] rounded-[20px] border border-edge bg-surface p-2 shadow-pop" align="end" sideOffset={10}>
          <div className="mb-1.5 flex items-center gap-3 border-b border-line px-3 pt-2.5 pb-3">
            <span className={`${FACE} size-11 cursor-default text-[15px] shadow-avatar`} style={{ background: photo ? "transparent" : undefined }}>{face}</span>
            <div className="min-w-0 [&>span]:block [&>span]:text-[12.5px] [&>span]:[overflow-wrap:anywhere] [&>span]:text-ink-faint"><b className="block font-semibold">{user.name}</b><span>{user.email}</span><span>{isHr ? "HR" : "Employee"}</span></div>
          </div>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => nav("/app/profile")}>My profile</DropdownMenu.Item>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => nav("/app/account")}>Account and password</DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-1 my-1.5 h-px bg-line" />
          <Appearance />
          <DropdownMenu.Separator className="mx-1 my-1.5 h-px bg-line" />
          <DropdownMenu.Item className={MENU_ITEM} onSelect={signOut}>Sign out</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* A short name shown when the pointer rests on an icon button, or it takes keyboard focus (Radix UI Tooltip). */
function Tip({ text, side = "bottom", children }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="z-80 rounded-md bg-ink px-2.5 py-1.5 font-body text-[12.5px] leading-[1.2] font-bold text-paper shadow-tip" side={side} sideOffset={6}>{text}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

/* After the Claude admin has invited this person, they are asked to say when they have accepted it (nothing tells the app otherwise). */
function ClaudeInviteBanner() {
  const { user } = useAuth();
  const { people, claudeMode, reload } = useData();
  const toast = useToast();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("claude-invite-later") === "1"; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const me = people && people.find((p) => String(p.email).toLowerCase() === String(user.email).toLowerCase());
  if (hidden || claudeMode !== "simulated" || !me || !me.grants || me.grants.claude !== "invited") return null;
  const yes = async () => {
    setBusy(true);
    const r = await api("POST", "/api/tool-access/claude/confirm");
    setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); await reload(); return; }
    toast("Thanks. Your Claude access is marked as active."); await reload();
  };
  const later = () => { try { sessionStorage.setItem("claude-invite-later", "1"); } catch { /* the banner just comes back next time */ } setHidden(true); };
  return (
    <div className="callout mx-(--page-pad) mt-4 mb-0"><div className="row" style={{ width: "100%" }}>
      <div style={{ flex: 1, minWidth: 240 }}><b>Claude invite received?</b> You have been invited to Claude at your work email. Please accept the email from Claude, then select Yes.</div>
      <button type="button" className="btn primary sm" disabled={busy} onClick={yes}>{busy ? "Saving…" : "Yes, I have access"}</button>
      <button type="button" className="btn glass sm" disabled={busy} onClick={later}>Not yet</button>
    </div></div>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/* The sections across the top bar, as on wohlig.com: a section with one page is a link; the others open their pages in a
   panel when pointed at, clicked or reached with the keyboard (Radix UI Navigation Menu). Each page shows its icon on a
   small beige square, like wohlig.com's menus. The section you are in is marked. HR's long list opens in two columns. */
const TOP_ITEM = `inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-3.5 font-body text-[15px] leading-none font-normal whitespace-nowrap no-underline transition-colors duration-150 max-2xl:px-2.5 ${FOCUS}`;
function TopNav({ groups, section, here }) {
  return (
    <NavigationMenu.Root className="relative ml-auto hidden rail:block" delayDuration={60} aria-label="Sections">
      <NavigationMenu.List className="m-0 flex list-none items-center gap-0.5 p-0">
        {groups.map((g, gi) => {
          const on = section === g;
          const tone = on ? "bg-tint font-bold! text-accent" : "text-ink-dim hover:bg-tint hover:text-ink data-[state=open]:bg-tint data-[state=open]:text-ink";
          if (g.items.length === 1) return (
            <NavigationMenu.Item key={g.label}>
              <NavigationMenu.Link asChild active={on}><Link to={g.items[0][0]} aria-current={on ? "page" : undefined} className={`${TOP_ITEM} ${tone}`}>{g.label}</Link></NavigationMenu.Link>
            </NavigationMenu.Item>);
          const twoCols = g.items.length > 10, endSide = gi >= groups.length - 2;
          return (
            <NavigationMenu.Item key={g.label} className="relative">
              <NavigationMenu.Trigger className={`${TOP_ITEM} ${tone} group/top`}>
                {g.label}
                <svg viewBox="0 0 12 8" width="10" height="7" aria-hidden="true" className="transition-transform duration-150 group-data-[state=open]/top:rotate-180 motion-reduce:transition-none"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </NavigationMenu.Trigger>
              <NavigationMenu.Content className={`absolute top-[calc(100%+14px)] z-70 rounded-[26px] border border-edge bg-surface p-2.5 shadow-navpanel dark:shadow-pop ${endSide ? "right-0" : "left-1/2 -translate-x-1/2"} ${twoCols ? "grid w-[min(560px,calc(100vw-48px))] grid-cols-2 gap-x-1.5 gap-y-0.5" : "flex w-max min-w-[260px] flex-col gap-0.5"}`}>
                {g.items.map(([to, label, icon]) => {
                  const cur = here && here.item[0] === to;
                  return (
                    <NavigationMenu.Link key={to} asChild active={cur}>
                      <Link to={to} aria-current={cur ? "page" : undefined}
                        className={`flex min-h-12 items-center gap-3 rounded-[16px] px-2.5 py-1.5 no-underline transition-colors duration-150 hover:bg-tint focus-visible:bg-tint ${FOCUS}`}>
                        <span className={`grid size-9 flex-none place-items-center gap-0 rounded-[12px] [&>svg]:size-[18px] ${cur ? "bg-maroon text-ivory" : "bg-tint-2 text-accent"}`}><Icon name={icon} /></span>
                        <span className={`font-display text-[15.5px] leading-tight ${cur ? "font-semibold text-accent" : "font-medium text-ink"}`}>{label}</span>
                      </Link>
                    </NavigationMenu.Link>);
                })}
              </NavigationMenu.Content>
            </NavigationMenu.Item>);
        })}
      </NavigationMenu.List>
    </NavigationMenu.Root>
  );
}

/* The menu on phones and tablets (under 1024px): a sheet that slides in from the left. "Find a page" filters every page
   as you type; Dashboard and To do are quick tiles; each section folds open and shut (the one you are in starts open);
   the page you are on is marked. Your name and sign-out sit at the bottom. Escape or the dimmed page closes it. */
function MenuSheet({ open, onClose, groups, section, here, user, isHr, face, photo }) {
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState(() => new Set(section ? [section.label] : []));
  useEffect(() => { if (open) { setQ(""); setOpened(new Set(section ? [section.label] : [])); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const t = q.trim().toLowerCase();
  const quick = groups.filter((g) => g.items.length === 1);
  const folders = groups.filter((g) => g.items.length > 1);
  const isOpen = (g) => (t ? true : opened.has(g.label));   // while finding, every section with a match is open
  const flip = (g) => setOpened((s) => { const n = new Set(s); n.has(g.label) ? n.delete(g.label) : n.add(g.label); return n; });
  const signOut = async () => { await api("POST", "/api/logout"); location.href = "/login"; };
  const shown = (g) => g.items.filter(([, label]) => !t || label.toLowerCase().includes(t) || g.label.toLowerCase().includes(t));
  const anyHit = folders.some((g) => shown(g).length) || quick.some((g) => !t || g.items[0][1].toLowerCase().includes(t) || g.label.toLowerCase().includes(t));
  return (
    <>
      <aside aria-label="Menu" aria-hidden={!open} inert={!open ? "" : undefined}
        className={`print:hidden! rail:hidden! fixed inset-y-2 left-2 z-40 flex w-[min(360px,calc(100vw-16px))] flex-col overflow-hidden rounded-[28px] border border-edge bg-surface shadow-navpanel transition-[translate,opacity] duration-[280ms] ease-brand motion-reduce:transition-none dark:shadow-pop ${open ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-[calc(100%+16px)] opacity-0"}`}>
        <div className="flex flex-none items-center justify-between gap-2 px-4 pt-4 pb-3">
          <a className={`inline-flex min-w-0 items-center gap-2.5 rounded-md text-ink no-underline ${FOCUS}`} href="/app/dashboard" aria-label={`${PRODUCT}, dashboard`}>
            <img className="block h-7 w-auto dark:hidden" src={BRAND.logos.light} alt="" /><img className="hidden h-7 w-auto dark:block" src={BRAND.logos.dark} alt="" />
            <span className="border-l border-line-2 pl-2.5 font-display text-[19px] leading-none font-normal text-ink-dim">{BRAND.product.short}</span>
          </a>
          <button className={`inline-grid ${ICON_BTN} rounded-full bg-tint`} type="button" aria-label="Close menu" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="flex-none px-4 pb-3">
          <label className="sr-only" htmlFor="menu-find">Find a page</label>
          <input id="menu-find" type="search" autoComplete="off" placeholder="Find a page" value={q} onChange={(e) => setQ(e.target.value)}
            className="input h-11 rounded-full! pl-[42px]! [background-image:var(--search-ic)]! [background-position:14px_center]! [background-repeat:no-repeat]! [background-size:18px]!" />
        </div>
        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-color:var(--line-2)_transparent] [scrollbar-width:thin]" aria-label="All pages">
          {/* Quick tiles: the sections that are a single page (Dashboard, To do). */}
          {quick.length > 0 && <div className="mb-2 grid grid-cols-2 gap-2 px-1">
            {quick.filter((g) => !t || g.items[0][1].toLowerCase().includes(t) || g.label.toLowerCase().includes(t)).map((g) => {
              const [to, label, icon] = g.items[0], on = here && here.item[0] === to;
              return <Link key={to} to={to} aria-current={on ? "page" : undefined}
                className={`flex min-h-[72px] flex-col justify-between gap-2 rounded-[18px] p-3 no-underline transition-colors duration-150 [&>svg]:size-5 ${FOCUS} ${on ? "bg-maroon text-ivory" : "bg-tint text-ink hover:bg-tint-2"}`}>
                <Icon name={icon} /><span className="font-display text-[16px] leading-tight font-medium">{label}</span></Link>;
            })}
          </div>}
          {folders.map((g) => {
            const list = shown(g);
            if (!list.length) return null;
            const o = isOpen(g), cur = section === g, id = `menu-sec-${g.label.replace(/\W+/g, "-")}`;
            return (
              <div key={g.label} className={`mt-1 rounded-[20px] transition-colors duration-150 ${o ? "bg-tint-2" : ""}`}>
                <button type="button" aria-expanded={o} aria-controls={id} onClick={() => flip(g)} disabled={!!t}
                  className={`flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-[20px] border-0 bg-transparent px-3 text-left disabled:cursor-default ${FOCUS}`}>
                  <span className={`grid size-9 flex-none place-items-center gap-0 rounded-[12px] [&>svg]:size-[18px] ${cur ? "bg-maroon text-ivory" : "bg-tint text-accent"}`}><Icon name={g.icon} /></span>
                  <span className={`flex-1 font-display text-[17px] leading-tight font-medium ${cur ? "text-accent" : "text-ink"}`}>{g.label}</span>
                  <span className="text-[13px] font-bold text-ink-faint">{list.length}</span>
                  <svg viewBox="0 0 12 8" width="11" height="8" aria-hidden="true" className={`text-ink-faint transition-transform duration-200 motion-reduce:transition-none ${o ? "rotate-180" : ""}`}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {/* Folding: the list's height animates through a grid row, so long sections open smoothly. */}
                <div id={id} className={`grid gap-0 transition-[grid-template-rows] duration-200 ease-brand motion-reduce:transition-none ${o ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <ul className="m-0 min-h-0 list-none overflow-hidden px-2 py-0">
                    {list.map(([to, label, icon]) => {
                      const on = here && here.item[0] === to;
                      return <li key={to} className="last:pb-2"><Link to={to} aria-current={on ? "page" : undefined} tabIndex={o ? undefined : -1}
                        className={`relative flex min-h-11 items-center gap-3 rounded-[14px] px-3 font-body text-[15px] leading-[1.2] no-underline transition-colors duration-150 [&>svg]:size-[18px] [&>svg]:flex-none ${FOCUS} ${on ? "bg-surface font-bold text-accent shadow-raised before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent before:content-['']" : "text-ink-dim hover:bg-surface hover:text-ink"}`}>
                        <Icon name={icon} /><span className="truncate">{label}</span></Link></li>;
                    })}
                  </ul>
                </div>
              </div>);
          })}
          {!anyHit && <p className="m-0 px-3 py-6 text-center text-ink-faint">No page matches "{q}". Please try another word.</p>}
        </nav>
        <div className="flex flex-none items-center gap-3 border-t border-line px-4 py-3">
          <Link className={`flex min-w-0 flex-1 items-center gap-3 rounded-field p-1.5 text-ink no-underline hover:bg-tint ${FOCUS}`} to="/app/profile">
            <span className={`${FACE} size-10 text-[13px] shadow-avatar`} style={{ background: photo ? "transparent" : undefined }}>{face}</span>
            <span className="flex min-w-0 flex-col gap-0.5"><b className="truncate font-body text-[15px] leading-tight font-bold">{user.name}</b><span className="text-[13px] text-ink-dim">{isHr ? "HR" : "Employee"}</span></span>
          </Link>
          <button type="button" className="btn glass sm" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-35 animate-scrim-in bg-scrim backdrop-blur-[2px] rail:hidden motion-reduce:animate-none" onClick={onClose} aria-hidden="true" />}
    </>
  );
}

/* The layout, as on wohlig.com: one top bar with the logo, the sections (each opens its pages), search, notifications and
   the account menu. There is no side rail (moved into the top bar 2026-11-19 at the user's request). On screens under
   1024px the sections move into a drawer that lists every page, opened from the menu button. */
export default function Shell() {
  const auth = useAuth();
  const { user, isHr } = auth;
  const { profile } = useData();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const fest = useFestivalLook();
  const [searching, setSearching] = useState(false);
  const groups = menuFor(auth);
  const here = findItem(groups, pathname);
  const section = here ? groups.find((g) => g.label === here.group) : null;
  const photo = profile && profile.photoV ? `/api/profile/photo?v=${profile.photoV}` : "";

  /* On phones the menu is a drawer: it closes when a page is chosen or Escape is pressed, and the page behind it does not scroll. */
  useEffect(() => { setMenuOpen(false); setSearching(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const esc = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", esc);
    document.body.classList.add("no-scroll");
    return () => { document.removeEventListener("keydown", esc); document.body.classList.remove("no-scroll"); };
  }, [menuOpen]);
  /* Ctrl+K (Cmd+K on a Mac) opens quick search from anywhere, and so does "/" when you are not typing in a field. */
  useEffect(() => {
    const k = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSearching(true); }
      else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setSearching(true); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  const face = photo ? <img src={photo} alt="" /> : initials(user.name);
  return (
    <Tooltip.Provider delayDuration={350}>
    {/* `gap-0`: the older `.grid` rule still sets a gap on anything named `grid`. */}
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] gap-0 print:block">
      <a className="fixed -top-[60px] left-3 z-80 rounded-field bg-surface px-4 py-2.5 text-ink shadow-skip focus:top-3" href="#main">Skip to content</a>
      <FestiveFrame fest={fest} />
      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} groups={groups} section={section} here={here} user={user} isHr={isHr} face={face} photo={photo} />
      {/* From 1024px up the sections live in the top bar (TopNav); the aside above is the phone and tablet drawer only. */}

      <div className="flex min-w-0 flex-col">
        {/* The top bar floats over the page as a rounded glass capsule, as on wohlig.com. */}
        <header className="print:hidden! sticky top-0 z-30 px-(--page-pad) pt-3.5 pb-1 max-md:px-3 max-md:pt-2.5">
          <div className="mx-auto flex h-[66px] max-w-[1296px] items-center gap-2 rounded-full border border-white/95 bg-paper/72 pr-2.5 pl-6 shadow-navcap backdrop-blur-[12px] backdrop-saturate-[1.4] dark:border-ivory/10 dark:bg-surface/80 dark:shadow-pop max-md:h-14 max-md:pr-1.5 max-md:pl-2">
            <button className={`hidden max-rail:inline-grid ${ICON_BTN}`} type="button" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
            <a className={`inline-flex flex-none items-center gap-2.5 rounded-md no-underline ${FOCUS}`} href="/app/dashboard" aria-label={`${PRODUCT}, dashboard`}>
              <img className="block h-[28px] w-auto max-md:h-6 dark:hidden" src={BRAND.logos.light} alt="" /><img className="hidden h-[28px] w-auto max-md:h-6 dark:block" src={BRAND.logos.dark} alt="" /><span className="border-l border-line-2 pl-2.5 font-display text-[18px] leading-none font-normal text-ink-dim max-sm:hidden">One</span>
            </a>
            <FestivalChip fest={fest} />
            <TopNav groups={groups} section={section} here={here} />
            <div className="ml-auto flex flex-none items-center gap-1 rail:ml-2">
              {/* Quick search: the icon, or Ctrl+K (Cmd+K on a Mac), or "/" when not typing. */}
              <Tip text={`Search pages and people (${isMac ? "⌘K" : "Ctrl K"})`}>
                <button type="button" className={`inline-grid ${ICON_BTN}`} onClick={() => setSearching(true)} aria-label="Search pages and people" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                </button>
              </Tip>
              <NotificationBell />
              <AccountMenu photo={photo} />
            </div>
          </div>
        </header>
        <ClaudeInviteBanner />
        <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-(--page-pad) pt-8 pb-12 focus:outline-0 max-md:gap-5 max-md:pt-6 max-md:pb-10 print:max-w-none! print:p-0! [&>.section]:gap-6 [&>div>.section]:gap-6" id="main" tabIndex={-1}>
          {/* Pages load on first open (App.jsx); while one does, the frame stays and the page area waits quietly. */}
          <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
        </main>
      </div>
      {searching && <QuickSearch onClose={() => setSearching(false)} />}
      <NextHolidayPopup />
    </div>
    </Tooltip.Provider>
  );
}
