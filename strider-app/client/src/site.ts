// SITE-WIDE HOLDING SWITCH — the single source of truth for whether
// zepostia.com presents the product or the holding page.
//
// While true: client/build.mjs bundles src/main-holding.tsx instead
// of src/main.tsx, so every route renders only the holding page
// ("Zepostia — Not open yet.") and none of the product UI — landing,
// Black Friday, services, legal, login, signup, the app — is shipped
// or presented.
//
// This is a presentation gate only: server APIs, accounts, waitlist
// rows, and posts are all untouched.
//
// To reopen the site: set this to false, rebuild, redeploy. Nothing
// else changes.
export const SITE_HIDDEN = true;
