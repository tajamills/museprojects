/** Admin / owner-comp emails, shared by the account actions (actions.ts)
 * and the billing entitlement checks (billing.ts). An account whose
 * email is on this list is comped — admin role, never charged, never
 * revenue — for the base plan AND the Bank Sync add-on alike.
 *
 * The list is the union of the ADMIN_EMAILS env var and the code-level
 * list below, so either source alone is enough to comp an account. */

/** Code-level admin emails, used ALONGSIDE the ADMIN_EMAILS env var
 * (owner test account — Oct 30 order; same pattern as the owner-comp in
 * the sister apps). */
const CODE_ADMIN_EMAILS = ["bazibazi872@gmail.com"];

/** Emails (lowercased) listed in ADMIN_EMAILS get the 'admin' role on signup/login. */
export function adminEmails(): Set<string> {
    const fromEnv = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return new Set([...fromEnv, ...CODE_ADMIN_EMAILS]);
}
export function isAdminEmail(email: string): boolean {
    return adminEmails().has(email.toLowerCase());
}
