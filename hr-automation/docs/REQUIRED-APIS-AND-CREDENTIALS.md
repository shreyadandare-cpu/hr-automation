# Required APIs and credentials

**Status key:** Not received = nothing yet. Received = given to us through the secure channel (never in chat or Git).

**Rule:** never paste a key, token or password into chat, email or Git. Send it through the secure channel, or enter it directly in the host's secret settings.

## 1. Hosting (Render, test environment)

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Render account | Runs the backend and database (test, Singapore) | none | You | render.com | In progress |
| `DATABASE_URL` | Database address | `DATABASE_URL` | Created automatically by Render | Render | Automatic |

## 2. Google Workspace (connector and sign-in)

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Test domain or trial Workspace | Safe place to test account changes | none | IT / you | Google Admin console | Not received |
| Admin account to act as | The service account acts as this user | `GOOGLE_ADMIN_EMAIL` | IT (super-admin on the test domain) | Render | Not received |
| Google Cloud project | Holds the credentials and API switches (no servers) | none | Google admin | Google Cloud console | Not received |
| APIs switched on: Admin SDK, Enterprise License Manager (Licensing), Data Transfer, Gmail (only if forwarding) | Create, suspend, sign out, Gemini licences, Drive transfer | none | Google admin | Google Cloud console | Not received |
| Service account with domain-wide delegation | Acts for the admin account | none | Google admin | Google Cloud console | Not received |
| Service account JSON key | Proves the backend is allowed to act | `GOOGLE_SERVICE_ACCOUNT_JSON` | Google admin | Render secret only | Not received |
| Scopes authorised in Admin console: `admin.directory.user`, `admin.directory.user.security`, `admin.directory.group`, `apps.licensing`, `admin.datatransfer` (optional: `gmail.settings.sharing`) | Limits what the key may do | none | Google admin | Admin console, Domain-wide delegation | Not received |
| Company domain name | Work email format | `GOOGLE_DOMAIN` | You | Render | Not received |
| Google sign-in client ID | "Continue with Google" button | `GOOGLE_CLIENT_ID` | Google admin, in Google Cloud console (OAuth client, Web application) | Render | Not received |
| Google sign-in client secret | Same sign-in | `GOOGLE_CLIENT_SECRET` | Same as above | Render secret only | Not received |
| Live site redirect address | Where Google sends people back after sign-in | `GOOGLE_REDIRECT_URI` | Set after the live site address exists | Google Cloud console and Render | Not received |
| Consent screen set to Internal | Only company accounts can sign in | none | Google Workspace admin | Google Cloud console | Not received |

## 3. Gemini

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Gemini licence in the test domain's plan | Lets us assign and remove licences | none | Google admin | Google Admin console | Not received |
| Uses the Google service account above | Same credentials | `GOOGLE_SERVICE_ACCOUNT_JSON` | — | — | Covered by section 2 |

## 4. Claude

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Anthropic Admin API key | Invites and removes team members and seats | `ANTHROPIC_ADMIN_KEY` | Organisation owner, in the Claude Admin console | Render secret only | Not received |
| Confirmation that the plan allows seat management by API | Needed before building the connector | none | Organisation owner / Anthropic | — | Not confirmed |

## 5. GitHub

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| GitHub App (preferred) or token with organisation admin rights | Adds and removes members and teams | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (or `GITHUB_TOKEN`) | Organisation owner | Render secret only | Not received |
| Organisation name | Which organisation to manage | `GITHUB_ORG` | You | Render | Not received |
| GitHub usernames for each person | GitHub identifies people by username, not email | none (stored per employee) | Each person or HR | Employee record | Not received |

## 6. Google Cloud roles (optional, later)

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Project IAM rights for the service account | Grants and removes project roles | none | Google admin | Google Cloud IAM | Not received |
| Project ID | Which project roles apply to | `GCP_PROJECT_ID` | Google admin | Render | Not received |

## 7. Flowace

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Flowace admin API key | Reads data; may support user changes | `FLOWACE_API_KEY` | Flowace admin, Company Settings → Configuration → API Key Generator | Render secret only | Not received |
| Confirmation of user management endpoints | Needed before automating removal | none | Flowace support | — | Not confirmed |

## 8. Keka (employee records)

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Employee export (CSV or Excel) | Import of employee records | none | HR, from Keka | Shared file (not in Git) | Not received |
| Keka API key (later, optional) | Live link instead of export | `KEKA_API_KEY` | Keka admin | Render secret only | Not received |

## 9. Email (for sign-up confirmation and setup links, later)

| Item | Purpose | Env name | Who creates it | Where it goes | Status |
|---|---|---|---|---|---|
| Company email sending service (for example Google Workspace SMTP relay or a transactional email provider) | Sends confirmation and setup emails | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | IT | Render secret only | Not received |

## 10. Decisions from IT and management

| Decision | Why | Who | Status |
|---|---|---|---|
| Approve the hosting region for employee data | Before the real roster is loaded | IT | After website is built |
| Confirm Abdul Majid as IT admin | Access level | Manager | Open |
| Decide whether Raj Gawand has access | Access level | Manager | Open |
| Confirm HR admin and IT admin list | Access level | Manager | Open |
| Turn Google sign-in on or off for the live site | Sign-in method | Manager and IT | Open |

## Summary: what to send first

1. Google: test domain, admin account, Cloud project, service account key, scope confirmation.
2. Claude: Admin API key.
3. GitHub: GitHub App or token, organisation name.
4. Flowace: API key, and support's answer on user endpoints.
5. Keka: employee export file.
6. IT: region approval and email sending details.
