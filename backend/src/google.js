import fs from "node:fs";
import { JWT } from "google-auth-library";

const API = "https://admin.googleapis.com/admin/directory/v1/users";
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
const adminEmail = process.env.GOOGLE_ADMIN_EMAIL;

/** "live" when a service account and admin email are configured, otherwise "simulated". */
export const googleMode = keyFile && adminEmail ? "live" : "simulated";

let client;
function authClient() {
  if (!client) {
    const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
    client = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
      subject: adminEmail, // the service account acts as this Workspace admin
    });
  }
  return client;
}

const message = (err) => err.response?.data?.error?.message || err.message || "Google request failed";

/**
 * Creates the work email as an active Google Workspace user. The password is the default one and
 * Google makes the person choose a new one at first sign-in.
 * Returns { status: "active" | "simulated" }. Throws an Error with a readable message on failure.
 */
export async function createGoogleUser({ email, first, last, password, personalEmail }) {
  if (googleMode === "simulated") return { status: "simulated" };
  const c = authClient();
  try {
    // A retry after a half-finished attempt: the user may already exist.
    await c.request({ url: `${API}/${encodeURIComponent(email)}` });
    return { status: "active" };
  } catch (err) {
    if (err.response?.status !== 404) throw new Error(message(err));
  }
  try {
    await c.request({
      url: API,
      method: "POST",
      data: {
        primaryEmail: email,
        name: { givenName: first, familyName: last },
        password,
        changePasswordAtNextLogin: true,
        suspended: false,
        recoveryEmail: personalEmail,
      },
    });
    return { status: "active" };
  } catch (err) {
    throw new Error(message(err));
  }
}
