import fs from "node:fs";

/* The brand, from the one shared file frontend/brand.config.json (also read by the interface). Product and company names,
   the email domain and colours come from here, so the portal can be re-branded by editing that file. */
export const BRAND = JSON.parse(fs.readFileSync(new URL("../../frontend/brand.config.json", import.meta.url), "utf8"));
export const PRODUCT = BRAND.product.name;
export const COMPANY_LEGAL = BRAND.company.legalName;
export const MAROON = BRAND.colors.maroon;
/** The sign-off at the end of every email. */
export const SIGN_OFF = `${PRODUCT}\n${COMPANY_LEGAL.toUpperCase()}`;
