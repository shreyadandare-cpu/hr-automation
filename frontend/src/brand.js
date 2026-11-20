import BRAND from "../brand.config.json";

/* The brand, from the one shared file frontend/brand.config.json (the server reads it too). Screens take names, logos and
   wording from BRAND; applyBrand() writes the colours and fonts into the CSS variables the whole stylesheet uses, so the
   values in styles.css are only fallbacks. To re-brand, edit brand.config.json. */
export { BRAND };
export const PRODUCT = BRAND.product.name;
export function applyBrand(root = document.documentElement) {
  const c = BRAND.colors, set = (k, v) => v && root.style.setProperty(k, v);
  set("--brand-maroon", c.maroon); set("--brand-maroon-deep", c.maroonDeep); set("--brand-orange", c.orange); set("--brand-ivory", c.ivory);
  set("--brand-beige", c.beige); set("--brand-terracotta", c.terracotta); set("--brand-olive", c.olive); set("--brand-ink", c.ink);
  set("--brand-muted", c.muted); set("--brand-faint", c.faint); set("--brand-line", c.line); set("--brand-surface", c.surface); set("--brand-field", c.field);
  set("--brand-display", `"${BRAND.fonts.display}","Source Serif 4",Georgia,serif`);
  set("--brand-body", `"${BRAND.fonts.body}","Helvetica Neue","Segoe UI",sans-serif`);
  if (!document.title || /^Wohlig One/.test(document.title)) document.title = document.title.replace(/^Wohlig One/, PRODUCT) || PRODUCT;
}
