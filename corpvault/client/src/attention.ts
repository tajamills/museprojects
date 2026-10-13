// The attention layer — one shared module, single source of truth.
//
// Computes, for any business on file, what is missing, what is due, and what
// is in good shape — in plain language, never as raw record fields. Used by
// the Businesses list, the entity detail view, and the Overview "Needs
// attention" rollup so all three always tell the same story.
//
// Two families of flags live here:
//  - record flags, computed from the entity record itself + state rules
//    (EIN, registered agent, agent renewal, annual filing, formation date);
//  - document flags, computed from the documents filed for the business
//    (formation documents, operating agreement).
//
// Everything is computed client-side from the workspace payload; nothing here
// touches the schema or the server.

import { api, type ApiResponse } from "./api";

type Workspace = ApiResponse<typeof api, "getWorkspace">;
export type Entity = Workspace["entities"][number];
export type WorkspaceDocument = Workspace["documents"][number];

/** Document categories, exactly as stored and as offered in the upload form.
 *  Single definition — the upload form in App.tsx imports this list. */
export const CATEGORIES = ["Formation", "Operating Agreement/Bylaws", "Meeting Minutes", "Contracts", "Tax Filings", "Licenses"] as const;
export type DocumentCategory = (typeof CATEGORIES)[number];
/** The two categories the document flags below watch. */
export const FORMATION_CATEGORY: DocumentCategory = "Formation";
export const AGREEMENT_CATEGORY: DocumentCategory = "Operating Agreement/Bylaws";

export const todayKey = () => new Date().toLocaleDateString("en-CA");
export const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const daysUntil = (value: string) => Math.ceil((new Date(`${value}T12:00:00`).getTime() - new Date(`${todayKey()}T12:00:00`).getTime()) / 86400000);
export const relativeDue = (value: string) => { const d = daysUntil(value); return d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "Due today" : `Due in ${d}d`; };

export type EntityField = "name" | "formation" | "ein" | "agent" | "renewal";
export type AttentionTone = "overdue" | "missing" | "soon" | "info" | "upcoming" | "ok";
/** One attention flag. `field` deep-links the detail view's fix button to the
 *  entity edit form; `docCategory` deep-links it to the document upload form
 *  pre-set to that business and category. */
export type AttentionItem = { key: string; tone: AttentionTone; chip: string; label: string; detail?: string; field?: EntityField; docCategory?: DocumentCategory };
export type EntityAttention = { needs: AttentionItem[]; upcoming: AttentionItem[]; done: AttentionItem[]; actionCount: number; overdueCount: number; formsOn: string | null };

/** Severity order shared by every surface: overdue first, then the amber
 *  action/due-soon flags, then informational, then future/on-file items. */
export const attentionRank: Record<AttentionTone, number> = { overdue: 0, missing: 1, soon: 2, info: 3, upcoming: 4, ok: 5 };
export const byAttentionRank = (a: AttentionItem, b: AttentionItem) => attentionRank[a.tone] - attentionRank[b.tone];

/** Next occurrence (and the one just before it) of a yearly month/day deadline,
 *  counting cycles from the year after formation — the first annual obligation
 *  falls in the anniversary year, never the formation year itself. */
export function annualCycle(formation: string, month: number, day: number): {
    due: string;
    prevDue: string | null;
} {
    const pad = (n: number) => String(n).padStart(2, "0");
    const mk = (y: number) => `${y}-${pad(month)}-${pad(day)}`;
    const today = todayKey();
    let year = Number(formation.slice(0, 4)) + 1;
    let due = mk(year);
    let prevDue: string | null = null;
    while (due < today) {
        prevDue = due;
        year += 1;
        due = mk(year);
    }
    return { due, prevDue };
}

/** The attention computation for one business: the record on file, the state
 *  filing rules, and the documents filed under it. */
export function entityAttention(e: Entity, documents: WorkspaceDocument[]): EntityAttention {
    const needs: AttentionItem[] = [];
    const upcoming: AttentionItem[] = [];
    const done: AttentionItem[] = [];
    let formsOn: string | null = null;
    if (!e.formation_date) {
        needs.push({ key: "formation", tone: "missing", chip: "Formation date missing", label: "Formation date missing", detail: "Add the date this business was formed — every deadline counts from it.", field: "formation" });
    }
    else if (daysUntil(e.formation_date) > 0) {
        formsOn = e.formation_date;
        needs.push({ key: "forms", tone: "info", chip: `Forms ${dateLabel(e.formation_date)}`, label: `Forms on ${dateLabel(e.formation_date)}`, detail: "Not formed yet — deadlines count from the formation date." });
        done.push({ key: "formation-date", tone: "ok", chip: "", label: `Formation date set · ${dateLabel(e.formation_date)}` });
    }
    else {
        done.push({ key: "formation-date", tone: "ok", chip: "", label: `Formed ${dateLabel(e.formation_date)}` });
    }
    if (!e.ein_masked)
        needs.push({ key: "ein", tone: "missing", chip: "EIN missing", label: "EIN missing", detail: "Add the federal tax ID so filings, banking, and payroll records match.", field: "ein" });
    else
        done.push({ key: "ein", tone: "ok", chip: "", label: `EIN on file · ${e.ein_masked}` });
    if (!e.registered_agent)
        needs.push({ key: "agent", tone: "missing", chip: "Agent not added", label: "Registered agent not added", detail: "Name the person or service that receives official mail and legal notices.", field: "agent" });
    else
        done.push({ key: "agent", tone: "ok", chip: "", label: `Registered agent · ${e.registered_agent}` });
    if (!e.agent_renewal_date) {
        needs.push({ key: "renewal", tone: "missing", chip: "Agent renewal not set", label: "Registered agent renewal date not set", detail: "Set the renewal date so the agent service never lapses unnoticed.", field: "renewal" });
    }
    else {
        const d = daysUntil(e.agent_renewal_date);
        if (d < 0)
            needs.push({ key: "renewal", tone: "overdue", chip: "Agent renewal overdue", label: "Registered agent renewal overdue", detail: `Was due ${dateLabel(e.agent_renewal_date)} — ${relativeDue(e.agent_renewal_date)}. Renew or confirm the service.`, field: "renewal" });
        else if (d <= 60)
            needs.push({ key: "renewal", tone: "soon", chip: "Agent renewal soon", label: `Registered agent renewal due ${dateLabel(e.agent_renewal_date)}`, detail: `${relativeDue(e.agent_renewal_date)} — renew or confirm the service.`, field: "renewal" });
        else
            done.push({ key: "renewal", tone: "ok", chip: "", label: `Agent renewal · ${dateLabel(e.agent_renewal_date)}` });
    }
    // Document flags: the founding paperwork itself, computed from what is
    // actually filed under this business. They apply to every business —
    // including ones that have not formed yet, same as the record flags.
    const filed = documents.filter((d) => d.entity_id === e.id);
    if (filed.some((d) => d.category === FORMATION_CATEGORY))
        done.push({ key: "doc-formation", tone: "ok", chip: "", label: "Formation documents on file" });
    else
        needs.push({ key: "doc-formation", tone: "missing", chip: "Formation documents missing", label: "Formation documents missing", detail: "Upload the certificate or articles of formation — the founding record for this business.", docCategory: FORMATION_CATEGORY });
    if (filed.some((d) => d.category === AGREEMENT_CATEGORY))
        done.push({ key: "doc-agreement", tone: "ok", chip: "", label: "Operating agreement on file" });
    else
        needs.push({ key: "doc-agreement", tone: "missing", chip: "Operating agreement missing", label: "Operating agreement missing", detail: "Upload the operating agreement or bylaws — the rules this business runs by.", docCategory: AGREEMENT_CATEGORY });
    if (e.formation_date && (e.state === "WY" || e.state === "GA")) {
        const isWY = e.state === "WY";
        const name = isWY ? "Wyoming annual report" : "Georgia annual registration";
        const { due, prevDue } = annualCycle(e.formation_date, isWY ? Number(e.formation_date.slice(5, 7)) : 4, 1);
        const windowOpen = !isWY && todayKey() >= `${due.slice(0, 4)}-01-01`;
        if (daysUntil(due) <= 60 || windowOpen)
            needs.push({ key: "annual", tone: "soon", chip: "Annual filing due", label: `${name} due ${dateLabel(due)}`, detail: isWY ? "Due on the first day of the anniversary month. Verify current requirements before filing." : "Filing window January 1 – April 1. Verify current requirements before filing." });
        else if (prevDue)
            needs.push({ key: "annual", tone: "overdue", chip: "Annual filing overdue", label: `${name} overdue`, detail: `Was due ${dateLabel(prevDue)}. File as soon as possible and verify any late fees.` });
        else
            upcoming.push({ key: "annual", tone: "upcoming", chip: "", label: name, detail: isWY ? `Due ${dateLabel(due)}` : `Window January 1 – April 1 · due ${dateLabel(due)}` });
    }
    needs.sort(byAttentionRank);
    return { needs, upcoming, done, actionCount: needs.filter((i) => i.tone === "overdue" || i.tone === "missing" || i.tone === "soon").length, overdueCount: needs.filter((i) => i.tone === "overdue").length, formsOn };
}

/** One flagged gap in the Overview rollup: which business, and which flag. */
export type RollupEntry = { entity: Entity; item: AttentionItem };

/** Every attention flag across every business in the workspace, worst first:
 *  overdue, then action-needed/due-soon, then informational. Archived
 *  businesses are excluded — archiving is the owner's way of saying a
 *  business no longer needs watching. */
export function workspaceAttention(data: Workspace): RollupEntry[] {
    return data.entities
        .filter((entity) => !entity.archived)
        .flatMap((entity) => entityAttention(entity, data.documents).needs.map((item) => ({ entity, item })))
        .sort((a, b) => byAttentionRank(a.item, b.item));
}
