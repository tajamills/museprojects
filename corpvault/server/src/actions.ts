// kovala server actions. Ported 1:1 from the TS-space's
// server/src/actions.ts.
//
// The SDK's `defineAction` wrappers are replaced with a plain registry of
// `{ request, response, handler }` definitions; zod validation now happens in
// the POST /actions dispatcher (server/src/index.ts). The SDK `Ctx` (which
// provided `ctx.db<typeof schema>()`, `ctx.blobs`, and `ctx.invalidateQueries()`)
// is replaced with the local `Ctx` below: a pg-backed drizzle db plus a
// local-disk blob store. `ctx.invalidateQueries()` had no meaning over HTTP
// RPC (the React Query client already invalidates on mutation success), so it
// is dropped.

import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Db } from "./db.js";
import type { BlobStore } from "./storage.js";
import { baseUrl, getStripe } from "./billing.js";

export interface Ctx {
  db: Db;
  /** Session token of the current request (null for signUp/signIn). */
  token: string | null;
  blobs: BlobStore;
  /** Request origin (for Stripe redirect URLs); null when unknown. */
  origin: string | null;
}

const sessionResponse = z.object({ token: z.string(), email: z.string(), role: z.string() });
const okResponse = z.object({ ok: z.literal(true) });
/** Emails (lowercased) listed in ADMIN_EMAILS get the 'admin' role on signup/login. */
function adminEmails(): Set<string> {
    return new Set((process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}
function isAdminEmail(email: string): boolean {
    return adminEmails().has(email.toLowerCase());
}
const entityTypes = ["LLC", "Corporation", "DBA"] as const;
const categories = ["Formation", "Operating Agreement/Bylaws", "Meeting Minutes", "Contracts", "Tax Filings", "Licenses"] as const;
const meetingTypes = ["Annual", "Special", "Organizational", "Member Decision"] as const;
function hex(bytes: Uint8Array): string { return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password: string, saltHex?: string): Promise<string> {
    const salt = saltHex ? Uint8Array.from(saltHex.match(/.{1,2}/g)?.map((x) => Number.parseInt(x, 16)) ?? []) : crypto.getRandomValues(new Uint8Array(16));
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, material, 256);
    return `${hex(salt)}:${hex(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const salt = stored.split(":")[0];
    if (!salt)
        return false;
    return (await hashPassword(password, salt)) === stored;
}
function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
async function accountFor(db: Db, token: string): Promise<number> {
    const rows = await db.select({ accountId: schema.sessions.accountId, expiresAt: schema.sessions.expiresAt })
        .from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1);
    const row = rows[0];
    if (!row || row.expiresAt.getTime() < Date.now())
        throw new Error("Your session has expired. Please sign in again.");
    return row.accountId;
}
/** Full account row for the session token (for billing actions). */
async function accountRecord(db: Db, token: string) {
    const accountId = await accountFor(db, token);
    const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).limit(1);
    const account = rows[0];
    if (!account)
        throw new Error("Your session has expired. Please sign in again.");
    return account;
}
function nextAnnual(month: number, day: number): string {
    const today = new Date();
    let year = today.getUTCFullYear();
    let date = new Date(Date.UTC(year, month - 1, day));
    if (date.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) {
        year += 1;
        date = new Date(Date.UTC(year, month - 1, day));
    }
    return date.toISOString().slice(0, 10);
}
function addUtcDays(dateValue: string, days: number): string {
    const date = new Date(`${dateValue}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function anniversaryDue(formationDate: string, day: number): string {
    const parts = formationDate.split("-").map(Number);
    const month = parts[1] ?? 1;
    return nextAnnual(month, day);
}
function generatedReminder(stateCode: string, entityType: string, formationDate: string): {
    title: string;
    dueDate: string;
    notes: string;
    sourceLabel: string;
    sourceUrl: string;
} | null {
    if (stateCode === "WY")
        return {
            title: "Wyoming annual report",
            dueDate: anniversaryDue(formationDate, 1),
            notes: "Reference rule: due on the first day of the formation anniversary month. Verify current requirements before filing.",
            sourceLabel: "Wyoming Secretary of State",
            sourceUrl: "https://wyobiz.wyo.gov/Business/AnnualReport.aspx?eFNum=201240028027035055069105029004183159149254075218",
        };
    if (stateCode === "FL")
        return {
            title: "Florida annual report",
            dueDate: nextAnnual(5, 1),
            notes: "Reference rule: file by May 1 to avoid a late fee. Verify current requirements before filing.",
            sourceLabel: "Florida Department of State",
            sourceUrl: "http://dos.fl.gov/sunbiz/manage-business/efile/annual-report",
        };
    if (stateCode === "GA")
        return {
            title: "Georgia annual registration",
            dueDate: nextAnnual(4, 1),
            notes: "Reference rule: filing window opens January 1 and closes April 1. Verify current requirements before filing.",
            sourceLabel: "Georgia Secretary of State",
            sourceUrl: "https://sos.ga.gov/how-to-guide/how-file-annual-registration",
        };
    if (stateCode === "TX")
        return {
            title: "Texas franchise-tax report",
            dueDate: nextAnnual(5, 15),
            notes: "Reference rule: annual report is generally due May 15. Verify applicability and current requirements.",
            sourceLabel: "Texas Comptroller",
            sourceUrl: "https://comptroller.texas.gov/forms/05-392.pdf",
        };
    if (stateCode === "CA" && entityType === "LLC")
        return {
            title: "California Statement of Information",
            dueDate: addUtcDays(formationDate, 90),
            notes: "Reference rule: initial filing is due within 90 days; LLCs then file every two years. Verify the current filing period.",
            sourceLabel: "California Secretary of State",
            sourceUrl: "https://www.sos.ca.gov/business-programs/cannabizfile/cannabis-forms-and-fees/limited-liability-companies-llc-california",
        };
    return null;
}
const entityShape = z.object({
    id: z.number(), name: z.string(), entity_type: z.string(), state: z.string(), formation_date: z.string(),
    ein_masked: z.string().nullable(), registered_agent: z.string().nullable(), agent_renewal_date: z.string().nullable(), created_at: z.string(),
});
const reminderShape = z.object({
    id: z.number(), entity_id: z.number().nullable(), entity_name: z.string().nullable(), title: z.string(), reminder_type: z.string(), due_date: z.string(),
    notes: z.string().nullable(), status: z.string(), source_label: z.string().nullable(), source_url: z.string().nullable(), auto_generated: z.boolean(),
});
const documentShape = z.object({
    id: z.number(), entity_id: z.number(), entity_name: z.string(), filename: z.string(), category: z.string(), mime_type: z.string(), uploaded_at: z.string(), download_url: z.string(),
});
const meetingShape = z.object({
    id: z.number(), entity_id: z.number(), entity_name: z.string(), meeting_type: z.string(), meeting_date: z.string(), meeting_time: z.string(), timezone: z.string(), location: z.string().nullable(),
    attendees: z.array(z.object({ name: z.string(), role: z.string() })), agenda_items: z.array(z.string()), discussion_summary: z.string(), decisions: z.array(z.string()),
    action_items: z.array(z.object({ action: z.string(), owner: z.string(), due_date: z.string(), status: z.string() })), next_meeting_date: z.string().nullable(), recorded_by: z.string(),
});
export const actionDefs = {
    authStatus: {
        request: z.object({ token: z.string().optional() }),
        response: z.object({ authenticated: z.boolean(), email: z.string().nullable(), role: z.string().nullable() }),
        async handler(ctx: Ctx, args: { token?: string }) {
            if (!args.token)
                return { authenticated: false, email: null, role: null };
            try {
                const accountId = await accountFor(ctx.db, args.token);
                const rows = await ctx.db.select({ email: schema.accounts.email, role: schema.accounts.role }).from(schema.accounts).where(eq(schema.accounts.id, accountId)).limit(1);
                return { authenticated: true, email: rows[0]?.email ?? null, role: rows[0]?.role ?? "user" };
            }
            catch {
                return { authenticated: false, email: null, role: null };
            }
        },
    },
    signUp: {
        request: z.object({ email: z.string().email(), password: z.string().min(8).max(128) }),
        response: sessionResponse,
        async handler(ctx: Ctx, args: { email: string; password: string }): Promise<z.infer<typeof sessionResponse>> {
            const email = args.email.trim().toLowerCase();
            const existing = await ctx.db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.email, email)).limit(1);
            if (existing.length)
                throw new Error("An account with that email already exists.");
            const passwordHash = await hashPassword(args.password);
            const role = isAdminEmail(email) ? "admin" : "user";
            const inserted = await ctx.db.insert(schema.accounts).values({ email, passwordHash, role }).returning({ id: schema.accounts.id });
            const account = inserted[0];
            if (!account)
                throw new Error("Could not create the account.");
            const token = crypto.randomUUID();
            await ctx.db.insert(schema.sessions).values({ token, accountId: account.id, expiresAt: new Date(Date.now() + 30 * 86400000) });
            return { token, email, role };
        },
    },
    signIn: {
        request: z.object({ email: z.string().email(), password: z.string().min(1).max(128) }),
        response: sessionResponse,
        async handler(ctx: Ctx, args: { email: string; password: string }): Promise<z.infer<typeof sessionResponse>> {
            const email = args.email.trim().toLowerCase();
            const rows = await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.email, email)).limit(1);
            const account = rows[0];
            if (!account || !(await verifyPassword(args.password, account.passwordHash)))
                throw new Error("Email or password is incorrect.");
            let role = account.role ?? "user";
            if (isAdminEmail(email) && role !== "admin") {
                await ctx.db.update(schema.accounts).set({ role: "admin" }).where(eq(schema.accounts.id, account.id));
                role = "admin";
            }
            const token = crypto.randomUUID();
            await ctx.db.insert(schema.sessions).values({ token, accountId: account.id, expiresAt: new Date(Date.now() + 30 * 86400000) });
            return { token, email, role };
        },
    },
    getWorkspace: {
        request: z.object({ token: z.string() }),
        response: z.object({ entities: z.array(entityShape), reminders: z.array(reminderShape), documents: z.array(documentShape), meetings: z.array(meetingShape) }),
        async handler(ctx: Ctx, args: { token: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            const [entityRows, reminderRows, documentRows, meetingRows] = await Promise.all([
                ctx.db.select().from(schema.entities).where(eq(schema.entities.accountId, accountId)).orderBy(asc(schema.entities.name)),
                ctx.db.select({ reminder: schema.reminders, entityName: schema.entities.name }).from(schema.reminders).leftJoin(schema.entities, eq(schema.reminders.entityId, schema.entities.id)).where(eq(schema.reminders.accountId, accountId)).orderBy(asc(schema.reminders.dueDate)),
                ctx.db.select({ document: schema.documents, entityName: schema.entities.name }).from(schema.documents).innerJoin(schema.entities, eq(schema.documents.entityId, schema.entities.id)).where(eq(schema.documents.accountId, accountId)).orderBy(desc(schema.documents.uploadedAt)),
                ctx.db.select({ meeting: schema.meetings, entityName: schema.entities.name }).from(schema.meetings).innerJoin(schema.entities, eq(schema.meetings.entityId, schema.entities.id)).where(eq(schema.meetings.accountId, accountId)).orderBy(desc(schema.meetings.meetingDate)),
            ]);
            const docs = documentRows.map(({ document, entityName }) => ({
                id: document.id, entity_id: document.entityId, entity_name: entityName, filename: document.filename, category: document.category,
                mime_type: document.mimeType, uploaded_at: document.uploadedAt.toISOString(), download_url: ctx.blobs.getUrl(document.blobKey),
            }));
            return {
                entities: entityRows.map((row) => ({ id: row.id, name: row.name, entity_type: row.entityType, state: row.state, formation_date: row.formationDate, ein_masked: row.einValue ? `••-•••${row.einValue.replace(/\D/g, "").slice(-4)}` : null, registered_agent: row.registeredAgent, agent_renewal_date: row.agentRenewalDate, created_at: row.createdAt.toISOString() })),
                reminders: reminderRows.map(({ reminder, entityName }) => ({ id: reminder.id, entity_id: reminder.entityId, entity_name: entityName, title: reminder.title, reminder_type: reminder.reminderType, due_date: reminder.dueDate, notes: reminder.notes, status: reminder.status, source_label: reminder.sourceLabel, source_url: reminder.sourceUrl, auto_generated: reminder.autoGenerated })),
                documents: docs,
                meetings: meetingRows.map(({ meeting, entityName }) => ({ id: meeting.id, entity_id: meeting.entityId, entity_name: entityName, meeting_type: meeting.meetingType, meeting_date: meeting.meetingDate, meeting_time: meeting.meetingTime, timezone: meeting.timezone, location: meeting.location, attendees: JSON.parse(meeting.attendeesJson) as {
                        name: string;
                        role: string;
                    }[], agenda_items: JSON.parse(meeting.agendaJson) as string[], discussion_summary: meeting.discussionSummary, decisions: JSON.parse(meeting.decisionsJson) as string[], action_items: JSON.parse(meeting.actionItemsJson) as {
                        action: string;
                        owner: string;
                        due_date: string;
                        status: string;
                    }[], next_meeting_date: meeting.nextMeetingDate, recorded_by: meeting.recordedBy })),
            };
        },
    },
    addEntity: {
        request: z.object({ token: z.string(), name: z.string().min(1).max(120), entity_type: z.enum(entityTypes), state: z.string().length(2), formation_date: z.string(), ein: z.string().max(20).optional(), registered_agent: z.string().max(120).optional(), agent_renewal_date: z.string().optional() }),
        response: z.object({ id: z.number() }),
        async handler(ctx: Ctx, args: { token: string; name: string; entity_type: "LLC" | "Corporation" | "DBA"; state: string; formation_date: string; ein?: string; registered_agent?: string; agent_renewal_date?: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            const inserted = await ctx.db.insert(schema.entities).values({ accountId, name: args.name.trim(), entityType: args.entity_type, state: args.state.toUpperCase(), formationDate: args.formation_date, einValue: args.ein?.trim() || null, registeredAgent: args.registered_agent?.trim() || null, agentRenewalDate: args.agent_renewal_date || null }).returning({ id: schema.entities.id });
            const entity = inserted[0];
            if (!entity)
                throw new Error("Could not save the entity.");
            const reference = generatedReminder(args.state.toUpperCase(), args.entity_type, args.formation_date);
            if (reference)
                await ctx.db.insert(schema.reminders).values({ accountId, entityId: entity.id, title: reference.title, reminderType: "Annual filing", dueDate: reference.dueDate, notes: reference.notes, sourceLabel: reference.sourceLabel, sourceUrl: reference.sourceUrl, autoGenerated: true });
            if (args.agent_renewal_date)
                await ctx.db.insert(schema.reminders).values({ accountId, entityId: entity.id, title: "Registered agent renewal", reminderType: "Registered agent", dueDate: args.agent_renewal_date, notes: "Renew or confirm the registered agent service.", autoGenerated: true });
            return { id: entity.id };
        },
    },
    updateEntity: {
        request: z.object({ token: z.string(), id: z.number(), name: z.string().min(1).max(120), entity_type: z.enum(entityTypes), state: z.string().length(2), formation_date: z.string().min(1), ein: z.string().max(20).optional(), registered_agent: z.string().max(120).optional(), agent_renewal_date: z.string().optional() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number; name: string; entity_type: "LLC" | "Corporation" | "DBA"; state: string; formation_date: string; ein?: string; registered_agent?: string; agent_renewal_date?: string }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ id: schema.entities.id }).from(schema.entities).where(and(eq(schema.entities.id, args.id), eq(schema.entities.accountId, accountId))).limit(1);
            if (!owned.length)
                throw new Error("That business is not available.");
            const patch: Partial<{ name: string; entityType: "LLC" | "Corporation" | "DBA"; state: string; formationDate: string; einValue: string | null; registeredAgent: string | null; agentRenewalDate: string | null }> = {
                name: args.name.trim(), entityType: args.entity_type, state: args.state.toUpperCase(), formationDate: args.formation_date,
            };
            // Optional fields: undefined = leave unchanged, "" = clear, value = set.
            // The client omits `ein` when the owner leaves it blank so the EIN on
            // file (only ever exposed masked) is never wiped by an edit.
            if (args.ein !== undefined)
                patch.einValue = args.ein.trim() || null;
            if (args.registered_agent !== undefined)
                patch.registeredAgent = args.registered_agent.trim() || null;
            if (args.agent_renewal_date !== undefined)
                patch.agentRenewalDate = args.agent_renewal_date || null;
            await ctx.db.update(schema.entities).set(patch).where(and(eq(schema.entities.id, args.id), eq(schema.entities.accountId, accountId)));
            return { ok: true };
        },
    },
    addReminder: {
        request: z.object({ token: z.string(), entity_id: z.number().nullable(), title: z.string().min(1).max(160), reminder_type: z.string().min(1).max(80), due_date: z.string(), notes: z.string().max(1000).optional() }),
        response: z.object({ id: z.number() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number | null; title: string; reminder_type: string; due_date: string; notes?: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            if (args.entity_id) {
                const owned = await ctx.db.select({ id: schema.entities.id }).from(schema.entities).where(and(eq(schema.entities.id, args.entity_id), eq(schema.entities.accountId, accountId))).limit(1);
                if (!owned.length)
                    throw new Error("That business is not available.");
            }
            const inserted = await ctx.db.insert(schema.reminders).values({ accountId, entityId: args.entity_id, title: args.title.trim(), reminderType: args.reminder_type, dueDate: args.due_date, notes: args.notes?.trim() || null }).returning({ id: schema.reminders.id });
            const row = inserted[0];
            if (!row)
                throw new Error("Could not save the reminder.");
            return { id: row.id };
        },
    },
    setReminderStatus: {
        request: z.object({ token: z.string(), id: z.number(), status: z.enum(["open", "done"]) }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number; status: "open" | "done" }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            await ctx.db.update(schema.reminders).set({ status: args.status }).where(and(eq(schema.reminders.id, args.id), eq(schema.reminders.accountId, accountId)));
            return { ok: true };
        },
    },
    addDocument: {
        request: z.object({ token: z.string(), entity_id: z.number(), filename: z.string().min(1).max(220), category: z.enum(categories), mime_type: z.string().min(1).max(120), data_base64: z.string().min(1).max(14000000) }),
        response: z.object({ id: z.number() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; filename: string; category: (typeof categories)[number]; mime_type: string; data_base64: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ id: schema.entities.id }).from(schema.entities).where(and(eq(schema.entities.id, args.entity_id), eq(schema.entities.accountId, accountId))).limit(1);
            if (!owned.length)
                throw new Error("That business is not available.");
            const bytes = decodeBase64(args.data_base64);
            if (bytes.byteLength > 10000000)
                throw new Error("Choose a file smaller than 10 MB.");
            const blobKey = `documents/${accountId}/${crypto.randomUUID()}`;
            await ctx.blobs.put(blobKey, bytes, { contentType: args.mime_type });
            const inserted = await ctx.db.insert(schema.documents).values({ accountId, entityId: args.entity_id, filename: args.filename, category: args.category, mimeType: args.mime_type, blobKey }).returning({ id: schema.documents.id });
            const row = inserted[0];
            if (!row)
                throw new Error("Could not save the document.");
            return { id: row.id };
        },
    },
    addMeeting: {
        request: z.object({ token: z.string(), entity_id: z.number(), meeting_type: z.enum(meetingTypes), meeting_date: z.string(), meeting_time: z.string(), timezone: z.string().min(1), location: z.string().max(200).optional(), attendees: z.array(z.object({ name: z.string().min(1), role: z.string().min(1) })).min(1), agenda_items: z.array(z.string().min(1)).min(1), discussion_summary: z.string().min(1), decisions: z.array(z.string().min(1)), action_items: z.array(z.object({ action: z.string().min(1), owner: z.string().min(1), due_date: z.string(), status: z.string().min(1) })), next_meeting_date: z.string().optional(), recorded_by: z.string().min(1) }),
        response: z.object({ id: z.number() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; meeting_type: (typeof meetingTypes)[number]; meeting_date: string; meeting_time: string; timezone: string; location?: string; attendees: { name: string; role: string }[]; agenda_items: string[]; discussion_summary: string; decisions: string[]; action_items: { action: string; owner: string; due_date: string; status: string }[]; next_meeting_date?: string; recorded_by: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ id: schema.entities.id }).from(schema.entities).where(and(eq(schema.entities.id, args.entity_id), eq(schema.entities.accountId, accountId))).limit(1);
            if (!owned.length)
                throw new Error("That business is not available.");
            const inserted = await ctx.db.insert(schema.meetings).values({ accountId, entityId: args.entity_id, meetingType: args.meeting_type, meetingDate: args.meeting_date, meetingTime: args.meeting_time, timezone: args.timezone, location: args.location?.trim() || null, attendeesJson: JSON.stringify(args.attendees), agendaJson: JSON.stringify(args.agenda_items), discussionSummary: args.discussion_summary, decisionsJson: JSON.stringify(args.decisions), actionItemsJson: JSON.stringify(args.action_items), nextMeetingDate: args.next_meeting_date || null, recordedBy: args.recorded_by }).returning({ id: schema.meetings.id });
            const row = inserted[0];
            if (!row)
                throw new Error("Could not save the minutes.");
            return { id: row.id };
        },
    },
    /**
     * Start a Stripe Checkout subscription for the $199/year kovala plan.
     * The plan charges IMMEDIATELY at checkout — no trial period.
     * Creates and stores a Stripe customer on first use.
     */
    createCheckoutSession: {
        request: z.object({ token: z.string() }),
        response: z.object({ url: z.string() }),
        async handler(ctx: Ctx, args: { token: string }): Promise<{ url: string }> {
            const account = await accountRecord(ctx.db, args.token);
            const stripe = getStripe();
            const priceId = process.env.STRIPE_PRICE_ID;
            if (!priceId)
                throw new Error("Billing is not configured yet.");
            if (["trialing", "active", "past_due"].includes(account.subscriptionStatus) && account.stripeCustomerId) {
                throw new Error("You already have a subscription — use Manage billing to update it.");
            }
            let customerId = account.stripeCustomerId;
            if (!customerId) {
                const customer = await stripe.customers.create({
                    email: account.email,
                    metadata: { accountId: String(account.id) },
                });
                customerId = customer.id;
                await ctx.db.update(schema.accounts).set({ stripeCustomerId: customerId }).where(eq(schema.accounts.id, account.id));
            }
            const url = baseUrl(ctx.origin);
            const session = await stripe.checkout.sessions.create({
                mode: "subscription",
                customer: customerId,
                client_reference_id: String(account.id),
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${url}/?billing=success`,
                cancel_url: `${url}/?billing=cancelled`,
            });
            if (!session.url)
                throw new Error("Could not start checkout. Try again.");
            return { url: session.url };
        },
    },
    /**
     * Stripe Customer Portal session so subscribers can update their card or
     * cancel without us handling payment details.
     */
    createPortalSession: {
        request: z.object({ token: z.string() }),
        response: z.object({ url: z.string() }),
        async handler(ctx: Ctx, args: { token: string }): Promise<{ url: string }> {
            const account = await accountRecord(ctx.db, args.token);
            const stripe = getStripe();
            if (!account.stripeCustomerId)
                throw new Error("No billing account yet — subscribe first.");
            const session = await stripe.billingPortal.sessions.create({
                customer: account.stripeCustomerId,
                return_url: baseUrl(ctx.origin),
            });
            return { url: session.url };
        },
    },
    /** Current subscription state for the signed-in account. */
    getBillingStatus: {
        request: z.object({ token: z.string() }),
        response: z.object({ status: z.string(), currentPeriodEnd: z.string().nullable() }),
        async handler(ctx: Ctx, args: { token: string }): Promise<{ status: string; currentPeriodEnd: string | null }> {
            const account = await accountRecord(ctx.db, args.token);
            const status = account.subscriptionStatus || "none";
            return {
                status,
                currentPeriodEnd: account.currentPeriodEnd ? account.currentPeriodEnd.toISOString() : null,
            };
        },
    },
};

export type ActionName = keyof typeof actionDefs;

/** Typed client-facing shape: `api.<action>(args)` → Promise<response>. */
export type ActionsClient = {
    [K in ActionName]: (
        args: z.input<(typeof actionDefs)[K]["request"]>,
    ) => Promise<z.output<(typeof actionDefs)[K]["response"]>>;
};
