/*
 * A server running against a local database (development on a laptop, or a test run) never reaches real services: no email
 * through SendGrid, no Google Workspace accounts, no Claude invitations. It logs what it would have done instead, so test runs
 * can never mail or create anything for real people at Wohlig. LIVE_SERVICES_LOCAL=true allows it for a deliberate local check.
 */
export const localOnly = () => /@?(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(process.env.DATABASE_URL || "") && process.env.LIVE_SERVICES_LOCAL !== "true";
