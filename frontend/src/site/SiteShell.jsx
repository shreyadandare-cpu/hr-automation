import { BRAND } from "../brand.js";

/* The frame of the public pages: the logo on a clean bar, the page, and a short footer. No decoration behind forms. */
export default function SiteShell({ children, title }) {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <a href="/careers" className="flex items-center gap-3 no-underline" aria-label={`${BRAND.company.name} careers`}>
            <img src={BRAND.logos.light} alt={BRAND.company.name} className="lg-light h-8 w-auto" />
            <img src={BRAND.logos.dark} alt={BRAND.company.name} className="lg-dark h-8 w-auto" />
          </a>
          {title && <span className="font-display text-[17px] text-ink-dim">{title}</span>}
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 max-sm:py-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-[14px] text-ink-faint">{BRAND.company.legalName}</footer>
    </div>
  );
}
