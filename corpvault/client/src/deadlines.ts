// The seeded deadlines register (Nov 5, 2026) — the per-business deadline
// facts from the formation papers, shown inside each business's Deadlines
// panel next to that business's own reminders. Register entries are
// read-only reference: a live deadline the owner acts on is a reminder
// (added from the panel's Add button). This module is edited when the
// underlying facts change — an EIN lands, a renewal date is set, a
// formation completes.

export type RegisterDeadline = {
    title: string;
    detail: string;
    /** ISO date (YYYY-MM-DD) when the item carries one; null for a
     *  standing fact or a date still to be supplied. */
    due: string | null;
    /** Short state label shown in place of a due date ("On file",
     *  "Date needed", "Owed"). */
    tag?: string;
};

const REGISTER: Record<string, RegisterDeadline[]> = {
    "Sovereign Throne LLC": [
        { title: "EIN — obtained", detail: "Issued Thu Nov 5, 2026. No Form 8832 and no Form 2553 — the Throne stays a disregarded entity by default.", due: null, tag: "On file" },
        { title: "Wyoming annual report", detail: "Due the first day of the anniversary month each year. License tax $60 minimum.", due: "2027-11-01", tag: "Yearly" },
        { title: "Registered agent renewal", detail: "Northwest Registered Agent — the renewal date is read from the Northwest account and set on this business's record.", due: null, tag: "Date needed" },
    ],
    "Kenani Tech LLC": [
        { title: "EIN filing", detail: "Filed by the owner with the IRS — one EIN per responsible party per day.", due: "2026-11-10" },
        { title: "Wyoming annual report", detail: "Due the first day of the anniversary month each year. License tax $60 minimum.", due: "2027-11-01", tag: "Yearly" },
        { title: "Registered agent renewal", detail: "Northwest Registered Agent — the renewal date is read from the Northwest account and set on this business's record.", due: null, tag: "Date needed" },
    ],
    "Arrotek Management Services LLC": [
        { title: "Formation completion", detail: "Expected from Northwest around Nov 20, 2026 — verify the paper landed before the EIN filing.", due: "2026-11-20", tag: "Expected" },
        { title: "Correct the formation date on file", detail: "Kovala currently reads Nov 3, 2026 — correct it to the actual Georgia completion date when the paper lands.", due: null, tag: "Owed" },
        { title: "EIN filing", detail: "Filed by the owner with the IRS, after formation completes.", due: "2026-11-23" },
        { title: "Georgia annual registration", detail: "Filing window January 1 – April 1 each year, $50. First registration in 2027.", due: "2027-04-01", tag: "Yearly" },
        { title: "Registered agent renewal", detail: "Northwest Registered Agent (GA) — the renewal date is read from the Northwest account and set on this business's record.", due: null, tag: "Date needed" },
    ],
};

/** The register entries for one business, matched by its exact name —
 *  an empty list for any business the register does not cover. */
export function registerDeadlines(entityName: string): RegisterDeadline[] {
    return REGISTER[entityName] ?? [];
}
