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
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Db } from "./db.js";
import type { BlobStore } from "./storage.js";
import { baseUrl, getStripe, reconcileSubscriptionFromStripe } from "./billing.js";
import { createPlaidLinkToken, decryptToken, encryptToken, exchangePlaidPublicToken, getPlaidAccounts, getPlaidBalances, getPlaidInstitutionName, plaidConfigured, removePlaidItem, syncPlaidTransactions, tokenEncryptionReady, type PlaidSyncTransaction } from "./plaid.js";

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
    ein_masked: z.string().nullable(), registered_agent: z.string().nullable(), agent_renewal_date: z.string().nullable(), archived: z.boolean(), created_at: z.string(),
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
// ---------------------------------------------------------------------------
// Bookkeeping (Phase 1). Books are scoped PER ENTITY: a category or a
// transaction belongs to exactly one business of one account, and every
// query below is fenced by both ids so books can never mix. Amounts are
// integer cents and `direction` carries the sign, so a stored amount is
// never negative. "Money in / Money out" are the only totals words — the
// module deliberately avoids accounting jargon (no debit/credit).
// ---------------------------------------------------------------------------
const bkKinds = ["income", "expense", "contribution", "distribution"] as const;
type BkKind = (typeof bkKinds)[number];
const bkDefaultCategories: { name: string; kind: BkKind }[] = [
    { name: "Sales", kind: "income" },
    { name: "Subscriptions", kind: "income" },
    { name: "Other income", kind: "income" },
    { name: "Filing & legal", kind: "expense" },
    { name: "Software & subscriptions", kind: "expense" },
    { name: "Hosting & services", kind: "expense" },
    { name: "Marketing", kind: "expense" },
    { name: "Contractors", kind: "expense" },
    { name: "Bank fees", kind: "expense" },
    { name: "Equipment", kind: "expense" },
    { name: "Other expense", kind: "expense" },
    { name: "Owner contribution", kind: "contribution" },
    { name: "Owner draw", kind: "distribution" },
];
const bkCategoryShape = z.object({ id: z.number(), name: z.string(), kind: z.string(), sort_order: z.number(), archived: z.boolean() });
const bkTransactionShape = z.object({
    id: z.number(), date: z.string(), description: z.string(), amount_cents: z.number(), direction: z.string(),
    category_id: z.number().nullable(), category_name: z.string().nullable(), status: z.string(),
    receipt_document_id: z.number().nullable(), receipt_filename: z.string().nullable(), source: z.string(), note: z.string().nullable(),
});
const bkTotalsShape = z.object({ in_cents: z.number(), out_cents: z.number(), net_cents: z.number() });
const bkMonthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const bkDatePattern = /^\d{4}-\d{2}-\d{2}$/;
function bkMonthRange(month: string): { start: string; end: string } {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    return { start: `${month}-01`, end: `${next}-01` };
}
function currentBkMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
async function requireBkEntity(db: Db, accountId: number, entityId: number): Promise<void> {
    const owned = await db.select({ id: schema.entities.id }).from(schema.entities).where(and(eq(schema.entities.id, entityId), eq(schema.entities.accountId, accountId))).limit(1);
    if (!owned.length)
        throw new Error("That business is not available.");
}
/** Seed the default category set the first time an entity's books are used. */
async function ensureBkCategories(db: Db, accountId: number, entityId: number): Promise<void> {
    const existing = await db.select({ id: schema.bkCategories.id }).from(schema.bkCategories).where(eq(schema.bkCategories.entityId, entityId)).limit(1);
    if (existing.length)
        return;
    await db.insert(schema.bkCategories).values(bkDefaultCategories.map((c, i) => ({ accountId, entityId, name: c.name, kind: c.kind, sortOrder: i })));
}
async function requireBkCategory(db: Db, accountId: number, entityId: number, categoryId: number): Promise<void> {
    const rows = await db.select({ id: schema.bkCategories.id }).from(schema.bkCategories).where(and(eq(schema.bkCategories.id, categoryId), eq(schema.bkCategories.entityId, entityId), eq(schema.bkCategories.accountId, accountId))).limit(1);
    if (!rows.length)
        throw new Error("That category is not available for this business.");
}
async function requireBkReceipt(db: Db, accountId: number, entityId: number, documentId: number): Promise<void> {
    const rows = await db.select({ id: schema.documents.id }).from(schema.documents).where(and(eq(schema.documents.id, documentId), eq(schema.documents.entityId, entityId), eq(schema.documents.accountId, accountId))).limit(1);
    if (!rows.length)
        throw new Error("That document is not available for this business.");
}
/** Minimal CSV row splitter: quoted fields, escaped quotes, CRLF tolerant. */
function parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    const pushField = () => { row.push(field); field = ""; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i]!;
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 1; }
                else
                    quoted = false;
            }
            else
                field += ch;
        }
        else if (ch === '"')
            quoted = true;
        else if (ch === ",")
            pushField();
        else if (ch === "\n")
            pushRow();
        else if (ch !== "\r")
            field += ch;
    }
    if (field.length > 0 || row.length > 0)
        pushRow();
    return rows.filter((r) => r.some((c) => c.trim().length > 0));
}
/** Normalize 'YYYY-MM-DD' or 'M/D/YYYY' to 'YYYY-MM-DD'; null if unparseable. */
function normalizeBkDate(raw: string): string | null {
    const value = raw.trim();
    if (bkDatePattern.test(value))
        return value;
    const m = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m)
        return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
    return null;
}
/** Parse a CSV amount ("$1,234.56", "-45.50", "(45.50)") → signed cents; null if unparseable or zero. */
function parseBkAmountCents(raw: string): number | null {
    let value = raw.trim().replace(/[$,\s]/g, "");
    if (!value)
        return null;
    let negative = false;
    if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1, -1); }
    if (value.startsWith("-")) { negative = true; value = value.slice(1); }
    if (value.startsWith("+"))
        value = value.slice(1);
    if (!/^\d+(\.\d{1,2})?$/.test(value))
        return null;
    const cents = Math.round(Number(value) * 100);
    if (!Number.isFinite(cents) || cents <= 0)
        return null;
    return negative ? -cents : cents;
}
function csvCell(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
// --- Bank connections (Phase 2, Plaid — read-only, opt-in per business) ----
const bkBankConnectionShape = z.object({
    id: z.number(), institution_name: z.string().nullable(),
    accounts: z.array(z.object({ name: z.string(), mask: z.string().nullable(), balance_cents: z.number().nullable() })),
    status: z.string(), last_synced_at: z.string().nullable(),
});
type BkConnectionRow = typeof schema.bkBankConnections.$inferSelect;
/** The client-facing shape of a connection. The encrypted access token is
 *  deliberately NOT part of it — it never leaves the server. */
function bkConnectionPublic(row: BkConnectionRow): z.infer<typeof bkBankConnectionShape> {
    let accounts: { name: string; mask: string | null; balance_cents: number | null }[] = [];
    if (row.accountsJson) {
        try {
            const parsed = JSON.parse(row.accountsJson) as { name?: string; mask?: string | null; balance_cents?: number | null }[];
            if (Array.isArray(parsed))
                accounts = parsed.map((a) => ({ name: a.name ?? "Account", mask: a.mask ?? null, balance_cents: a.balance_cents ?? null }));
        }
        catch { accounts = []; }
    }
    return { id: row.id, institution_name: row.institutionName, accounts, status: row.status, last_synced_at: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null };
}
async function activeBkConnection(db: Db, accountId: number, entityId: number): Promise<BkConnectionRow | null> {
    const rows = await db.select().from(schema.bkBankConnections).where(and(eq(schema.bkBankConnections.entityId, entityId), eq(schema.bkBankConnections.accountId, accountId), eq(schema.bkBankConnections.status, "active"))).limit(1);
    return rows[0] ?? null;
}
function requirePlaidReady(): void {
    if (!plaidConfigured())
        throw new Error("Bank connections are not turned on for Kovala yet.");
    if (!tokenEncryptionReady())
        throw new Error("Bank connections are not fully configured on the server yet.");
}
/** One Plaid transactions/sync pass for a connection: added rows insert,
 *  modified rows update in place, removed rows delete — all keyed by the
 *  Plaid transaction_id in external_id, so re-syncs never duplicate. A
 *  pending transaction that posts arrives as an added row pointing back at
 *  the pending row's id (pending_transaction_id): it UPDATES that row and
 *  adopts the posted id instead of creating a second row. Plaid's sign
 *  convention is positive = money out of the account. Balances refresh
 *  alongside the pass. */
async function syncBkConnection(db: Db, accountId: number, conn: BkConnectionRow): Promise<{ added: number; updated: number; removed: number }> {
    const accessToken = decryptToken(conn.accessTokenEnc);
    let cursor = conn.transactionsCursor ?? undefined;
    let added = 0;
    let updated = 0;
    let removed = 0;
    const upsert = async (t: PlaidSyncTransaction): Promise<"added" | "updated"> => {
        const values = {
            txnDate: t.date,
            description: (t.name || "Bank transaction").slice(0, 240),
            amountCents: Math.max(1, Math.round(Math.abs(t.amount) * 100)),
            direction: t.amount > 0 ? "out" as const : "in" as const,
            status: t.pending ? "pending" as const : "cleared" as const,
        };
        const byPosted = await db.select({ id: schema.bkTransactions.id }).from(schema.bkTransactions).where(and(eq(schema.bkTransactions.entityId, conn.entityId), eq(schema.bkTransactions.externalId, t.transaction_id))).limit(1);
        if (byPosted[0]) {
            await db.update(schema.bkTransactions).set({ ...values, updatedAt: new Date() }).where(eq(schema.bkTransactions.id, byPosted[0].id));
            return "updated";
        }
        if (t.pending_transaction_id) {
            const byPending = await db.select({ id: schema.bkTransactions.id }).from(schema.bkTransactions).where(and(eq(schema.bkTransactions.entityId, conn.entityId), eq(schema.bkTransactions.externalId, t.pending_transaction_id))).limit(1);
            if (byPending[0]) {
                await db.update(schema.bkTransactions).set({ ...values, externalId: t.transaction_id, updatedAt: new Date() }).where(eq(schema.bkTransactions.id, byPending[0].id));
                return "updated";
            }
        }
        await db.insert(schema.bkTransactions).values({ accountId, entityId: conn.entityId, ...values, categoryId: null, receiptDocumentId: null, source: "plaid", externalId: t.transaction_id, note: null });
        return "added";
    };
    for (let page = 0; page < 10; page += 1) {
        const res = await syncPlaidTransactions(accessToken, cursor);
        for (const t of res.added) {
            if ((await upsert(t)) === "added")
                added += 1;
            else
                updated += 1;
        }
        for (const t of res.modified) {
            if ((await upsert(t)) === "added")
                added += 1;
            else
                updated += 1;
        }
        for (const r of res.removed) {
            const gone = await db.delete(schema.bkTransactions).where(and(eq(schema.bkTransactions.entityId, conn.entityId), eq(schema.bkTransactions.externalId, r.transaction_id))).returning({ id: schema.bkTransactions.id });
            removed += gone.length;
        }
        cursor = res.nextCursor;
        if (!res.hasMore)
            break;
    }
    let accountsJson = conn.accountsJson;
    try {
        const accounts = await getPlaidBalances(accessToken);
        if (accounts.length)
            accountsJson = JSON.stringify(accounts);
    }
    catch { /* keep the last known balances */ }
    await db.update(schema.bkBankConnections).set({ transactionsCursor: cursor ?? null, accountsJson, lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(schema.bkBankConnections.id, conn.id));
    return { added, updated, removed };
}
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
                entities: entityRows.map((row) => ({ id: row.id, name: row.name, entity_type: row.entityType, state: row.state, formation_date: row.formationDate, ein_masked: row.einValue ? `••-•••${row.einValue.replace(/\D/g, "").slice(-4)}` : null, registered_agent: row.registeredAgent, agent_renewal_date: row.agentRenewalDate, archived: row.archived, created_at: row.createdAt.toISOString() })),
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
    /** Soft archive: the business keeps all of its data and can be brought
     *  back at any time; it simply leaves the default Businesses views and
     *  the Overview attention rollup. There is no hard delete. */
    setEntityArchived: {
        request: z.object({ token: z.string(), id: z.number(), archived: z.boolean() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number; archived: boolean }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ id: schema.entities.id }).from(schema.entities).where(and(eq(schema.entities.id, args.id), eq(schema.entities.accountId, accountId))).limit(1);
            if (!owned.length)
                throw new Error("That business is not available.");
            await ctx.db.update(schema.entities).set({ archived: args.archived }).where(and(eq(schema.entities.id, args.id), eq(schema.entities.accountId, accountId)));
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
    deleteDocument: {
        request: z.object({ token: z.string(), id: z.number() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ blobKey: schema.documents.blobKey }).from(schema.documents).where(and(eq(schema.documents.id, args.id), eq(schema.documents.accountId, accountId))).limit(1);
            const doc = owned[0];
            if (!doc)
                throw new Error("That document is not available.");
            await ctx.db.delete(schema.documents).where(and(eq(schema.documents.id, args.id), eq(schema.documents.accountId, accountId)));
            await ctx.blobs.delete(doc.blobKey);
            return { ok: true };
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
    deleteMeeting: {
        request: z.object({ token: z.string(), id: z.number() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            await ctx.db.delete(schema.meetings).where(and(eq(schema.meetings.id, args.id), eq(schema.meetings.accountId, accountId)));
            return { ok: true };
        },
    },
    /** One business's books for one month: its categories, that month's
     *  transactions (newest first), the month's Money in / out / Left over,
     *  and the same split per category. First use seeds the defaults. */
    listBooks: {
        request: z.object({ token: z.string(), entity_id: z.number(), month: z.string().regex(bkMonthPattern).optional() }),
        response: z.object({
            entity_id: z.number(), month: z.string(),
            categories: z.array(bkCategoryShape),
            transactions: z.array(bkTransactionShape),
            totals: bkTotalsShape,
            category_totals: z.array(z.object({ category_id: z.number().nullable(), name: z.string(), kind: z.string().nullable(), in_cents: z.number(), out_cents: z.number() })),
        }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; month?: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            await ensureBkCategories(ctx.db, accountId, args.entity_id);
            const month = args.month ?? currentBkMonth();
            const { start, end } = bkMonthRange(month);
            const [categoryRows, txnRows] = await Promise.all([
                ctx.db.select().from(schema.bkCategories).where(eq(schema.bkCategories.entityId, args.entity_id)).orderBy(asc(schema.bkCategories.sortOrder), asc(schema.bkCategories.name)),
                ctx.db.select({ txn: schema.bkTransactions, categoryName: schema.bkCategories.name, categoryKind: schema.bkCategories.kind, receiptFilename: schema.documents.filename })
                    .from(schema.bkTransactions)
                    .leftJoin(schema.bkCategories, eq(schema.bkTransactions.categoryId, schema.bkCategories.id))
                    .leftJoin(schema.documents, eq(schema.bkTransactions.receiptDocumentId, schema.documents.id))
                    .where(and(eq(schema.bkTransactions.entityId, args.entity_id), eq(schema.bkTransactions.accountId, accountId), gte(schema.bkTransactions.txnDate, start), lt(schema.bkTransactions.txnDate, end)))
                    .orderBy(desc(schema.bkTransactions.txnDate), desc(schema.bkTransactions.id)),
            ]);
            let inCents = 0;
            let outCents = 0;
            const byCategory = new Map<string, { category_id: number | null; name: string; kind: string | null; in_cents: number; out_cents: number }>();
            const transactions = txnRows.map(({ txn, categoryName, receiptFilename }) => {
                if (txn.direction === "in")
                    inCents += txn.amountCents;
                else
                    outCents += txn.amountCents;
                const key = txn.categoryId != null ? `c${txn.categoryId}` : "none";
                const bucket = byCategory.get(key) ?? { category_id: txn.categoryId, name: categoryName ?? "No category", kind: null, in_cents: 0, out_cents: 0 };
                if (txn.direction === "in")
                    bucket.in_cents += txn.amountCents;
                else
                    bucket.out_cents += txn.amountCents;
                byCategory.set(key, bucket);
                return {
                    id: txn.id, date: txn.txnDate, description: txn.description, amount_cents: txn.amountCents, direction: txn.direction,
                    category_id: txn.categoryId, category_name: categoryName, status: txn.status,
                    receipt_document_id: txn.receiptDocumentId, receipt_filename: receiptFilename, source: txn.source, note: txn.note,
                };
            });
            const kindById = new Map(categoryRows.map((c) => [c.id, c.kind as string]));
            const categoryTotals = [...byCategory.values()]
                .map((b) => ({ ...b, kind: b.category_id != null ? kindById.get(b.category_id) ?? null : null }))
                .sort((a, b) => (b.in_cents + b.out_cents) - (a.in_cents + a.out_cents));
            return {
                entity_id: args.entity_id, month,
                categories: categoryRows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, sort_order: c.sortOrder, archived: c.archived })),
                transactions,
                totals: { in_cents: inCents, out_cents: outCents, net_cents: inCents - outCents },
                category_totals: categoryTotals,
            };
        },
    },
    createTransaction: {
        request: z.object({ token: z.string(), entity_id: z.number(), date: z.string().regex(bkDatePattern), description: z.string().min(1).max(240), amount_cents: z.number().int().positive().max(2000000000), direction: z.enum(["in", "out"]), category_id: z.number().nullable().optional(), status: z.enum(["cleared", "pending"]).optional(), receipt_document_id: z.number().nullable().optional(), note: z.string().max(1000).optional() }),
        response: z.object({ id: z.number() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; date: string; description: string; amount_cents: number; direction: "in" | "out"; category_id?: number | null; status?: "cleared" | "pending"; receipt_document_id?: number | null; note?: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            await ensureBkCategories(ctx.db, accountId, args.entity_id);
            if (args.category_id != null)
                await requireBkCategory(ctx.db, accountId, args.entity_id, args.category_id);
            if (args.receipt_document_id != null)
                await requireBkReceipt(ctx.db, accountId, args.entity_id, args.receipt_document_id);
            const inserted = await ctx.db.insert(schema.bkTransactions).values({ accountId, entityId: args.entity_id, txnDate: args.date, description: args.description.trim(), amountCents: args.amount_cents, direction: args.direction, categoryId: args.category_id ?? null, status: args.status ?? "cleared", receiptDocumentId: args.receipt_document_id ?? null, source: "manual", note: args.note?.trim() || null }).returning({ id: schema.bkTransactions.id });
            const row = inserted[0];
            if (!row)
                throw new Error("Could not save the transaction.");
            return { id: row.id };
        },
    },
    updateTransaction: {
        request: z.object({ token: z.string(), id: z.number(), date: z.string().regex(bkDatePattern), description: z.string().min(1).max(240), amount_cents: z.number().int().positive().max(2000000000), direction: z.enum(["in", "out"]), category_id: z.number().nullable(), status: z.enum(["cleared", "pending"]), receipt_document_id: z.number().nullable(), note: z.string().max(1000).optional() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number; date: string; description: string; amount_cents: number; direction: "in" | "out"; category_id: number | null; status: "cleared" | "pending"; receipt_document_id: number | null; note?: string }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ entityId: schema.bkTransactions.entityId }).from(schema.bkTransactions).where(and(eq(schema.bkTransactions.id, args.id), eq(schema.bkTransactions.accountId, accountId))).limit(1);
            const txn = owned[0];
            if (!txn)
                throw new Error("That transaction is not available.");
            if (args.category_id != null)
                await requireBkCategory(ctx.db, accountId, txn.entityId, args.category_id);
            if (args.receipt_document_id != null)
                await requireBkReceipt(ctx.db, accountId, txn.entityId, args.receipt_document_id);
            await ctx.db.update(schema.bkTransactions).set({ txnDate: args.date, description: args.description.trim(), amountCents: args.amount_cents, direction: args.direction, categoryId: args.category_id, status: args.status, receiptDocumentId: args.receipt_document_id, note: args.note?.trim() || null, updatedAt: new Date() }).where(and(eq(schema.bkTransactions.id, args.id), eq(schema.bkTransactions.accountId, accountId)));
            return { ok: true };
        },
    },
    deleteTransaction: {
        request: z.object({ token: z.string(), id: z.number() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            await ctx.db.delete(schema.bkTransactions).where(and(eq(schema.bkTransactions.id, args.id), eq(schema.bkTransactions.accountId, accountId)));
            return { ok: true };
        },
    },
    createCategory: {
        request: z.object({ token: z.string(), entity_id: z.number(), name: z.string().min(1).max(80), kind: z.enum(bkKinds) }),
        response: z.object({ id: z.number() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; name: string; kind: BkKind }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            await ensureBkCategories(ctx.db, accountId, args.entity_id);
            const top = await ctx.db.select({ sortOrder: schema.bkCategories.sortOrder }).from(schema.bkCategories).where(eq(schema.bkCategories.entityId, args.entity_id)).orderBy(desc(schema.bkCategories.sortOrder)).limit(1);
            const inserted = await ctx.db.insert(schema.bkCategories).values({ accountId, entityId: args.entity_id, name: args.name.trim(), kind: args.kind, sortOrder: (top[0]?.sortOrder ?? -1) + 1 }).returning({ id: schema.bkCategories.id });
            const row = inserted[0];
            if (!row)
                throw new Error("Could not save the category.");
            return { id: row.id };
        },
    },
    updateCategory: {
        request: z.object({ token: z.string(), id: z.number(), name: z.string().min(1).max(80).optional(), archived: z.boolean().optional() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number; name?: string; archived?: boolean }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ id: schema.bkCategories.id }).from(schema.bkCategories).where(and(eq(schema.bkCategories.id, args.id), eq(schema.bkCategories.accountId, accountId))).limit(1);
            if (!owned.length)
                throw new Error("That category is not available.");
            const patch: Partial<{ name: string; archived: boolean }> = {};
            if (args.name !== undefined)
                patch.name = args.name.trim();
            if (args.archived !== undefined)
                patch.archived = args.archived;
            if (Object.keys(patch).length)
                await ctx.db.update(schema.bkCategories).set(patch).where(and(eq(schema.bkCategories.id, args.id), eq(schema.bkCategories.accountId, accountId)));
            return { ok: true };
        },
    },
    /** A category with transactions on it cannot be deleted (history would
     *  lose its labels) — archive it instead; unused ones delete cleanly. */
    deleteCategory: {
        request: z.object({ token: z.string(), id: z.number() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; id: number }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            const owned = await ctx.db.select({ id: schema.bkCategories.id }).from(schema.bkCategories).where(and(eq(schema.bkCategories.id, args.id), eq(schema.bkCategories.accountId, accountId))).limit(1);
            if (!owned.length)
                throw new Error("That category is not available.");
            const used = await ctx.db.select({ id: schema.bkTransactions.id }).from(schema.bkTransactions).where(eq(schema.bkTransactions.categoryId, args.id)).limit(1);
            if (used.length)
                throw new Error("That category is in use — archive it instead of deleting it.");
            await ctx.db.delete(schema.bkCategories).where(and(eq(schema.bkCategories.id, args.id), eq(schema.bkCategories.accountId, accountId)));
            return { ok: true };
        },
    },
    /** Import a bank-style CSV (header row with date / description / amount
     *  columns; an optional category column is matched by name). Negative
     *  or parenthesized amounts become money out, positive become money
     *  in. Rows that don't parse are counted as skipped, never guessed. */
    importTransactionsCsv: {
        request: z.object({ token: z.string(), entity_id: z.number(), csv: z.string().min(1).max(2000000) }),
        response: z.object({ imported: z.number(), skipped: z.number() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; csv: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            await ensureBkCategories(ctx.db, accountId, args.entity_id);
            const rows = parseCsvRows(args.csv);
            const header = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
            const dateIdx = header.findIndex((c) => c.includes("date"));
            const descIdx = header.findIndex((c) => c.includes("desc") || c.includes("memo") || c.includes("payee") || c.includes("name"));
            const amountIdx = header.findIndex((c) => c.includes("amount"));
            const categoryIdx = header.findIndex((c) => c.includes("categor"));
            const statusIdx = header.findIndex((c) => c.includes("status"));
            if (dateIdx < 0 || amountIdx < 0)
                throw new Error("That CSV needs a header row with date and amount columns.");
            const categoryRows = await ctx.db.select({ id: schema.bkCategories.id, name: schema.bkCategories.name }).from(schema.bkCategories).where(eq(schema.bkCategories.entityId, args.entity_id));
            const categoryByName = new Map(categoryRows.map((c) => [c.name.trim().toLowerCase(), c.id]));
            let imported = 0;
            let skipped = 0;
            const dataRows = rows.slice(1, 1001);
            skipped += Math.max(0, rows.length - 1 - dataRows.length);
            for (const row of dataRows) {
                const date = normalizeBkDate(row[dateIdx] ?? "");
                const description = descIdx >= 0 ? (row[descIdx] ?? "").trim() : "";
                const signed = parseBkAmountCents(row[amountIdx] ?? "");
                if (!date || !description || signed == null) {
                    skipped += 1;
                    continue;
                }
                const categoryName = categoryIdx >= 0 ? (row[categoryIdx] ?? "").trim().toLowerCase() : "";
                const status = statusIdx >= 0 && (row[statusIdx] ?? "").trim().toLowerCase() === "pending" ? "pending" as const : "cleared" as const;
                await ctx.db.insert(schema.bkTransactions).values({ accountId, entityId: args.entity_id, txnDate: date, description: description.slice(0, 240), amountCents: Math.abs(signed), direction: signed < 0 ? "out" : "in", categoryId: categoryName ? categoryByName.get(categoryName) ?? null : null, status, source: "csv", note: null });
                imported += 1;
            }
            return { imported, skipped };
        },
    },
    /** Per-entity totals by category for a month and a year, plus the
     *  all-companies rollup. Archived businesses are left out, matching
     *  the default Businesses views. */
    booksSummary: {
        request: z.object({ token: z.string(), month: z.string().regex(bkMonthPattern).optional(), year: z.number().int().min(2000).max(2100).optional() }),
        response: z.object({
            month: z.string(), year: z.number(),
            entities: z.array(z.object({
                entity_id: z.number(), entity_name: z.string(),
                month_totals: bkTotalsShape, year_totals: bkTotalsShape,
                categories: z.array(z.object({ category_id: z.number().nullable(), name: z.string(), kind: z.string().nullable(), month_in_cents: z.number(), month_out_cents: z.number(), year_in_cents: z.number(), year_out_cents: z.number() })),
            })),
            totals: z.object({ month: bkTotalsShape, year: bkTotalsShape }),
        }),
        async handler(ctx: Ctx, args: { token: string; month?: string; year?: number }) {
            const accountId = await accountFor(ctx.db, args.token);
            const month = args.month ?? currentBkMonth();
            const year = args.year ?? Number(month.slice(0, 4));
            const mRange = bkMonthRange(month);
            const yStart = `${year}-01-01`;
            const yEnd = `${year + 1}-01-01`;
            const from = mRange.start < yStart ? mRange.start : yStart;
            const to = mRange.end > yEnd ? mRange.end : yEnd;
            const [entityRows, txnRows] = await Promise.all([
                ctx.db.select({ id: schema.entities.id, name: schema.entities.name }).from(schema.entities).where(and(eq(schema.entities.accountId, accountId), eq(schema.entities.archived, false))).orderBy(asc(schema.entities.name)),
                ctx.db.select({ txn: schema.bkTransactions, categoryName: schema.bkCategories.name, categoryKind: schema.bkCategories.kind })
                    .from(schema.bkTransactions)
                    .leftJoin(schema.bkCategories, eq(schema.bkTransactions.categoryId, schema.bkCategories.id))
                    .where(and(eq(schema.bkTransactions.accountId, accountId), gte(schema.bkTransactions.txnDate, from), lt(schema.bkTransactions.txnDate, to))),
            ]);
            type CatBucket = { category_id: number | null; name: string; kind: string | null; month_in_cents: number; month_out_cents: number; year_in_cents: number; year_out_cents: number };
            const perEntity = new Map<number, { month: { in: number; out: number }; year: { in: number; out: number }; cats: Map<string, CatBucket> }>();
            for (const e of entityRows)
                perEntity.set(e.id, { month: { in: 0, out: 0 }, year: { in: 0, out: 0 }, cats: new Map() });
            const rollup = { month: { in: 0, out: 0 }, year: { in: 0, out: 0 } };
            for (const { txn, categoryName, categoryKind } of txnRows) {
                const bucket = perEntity.get(txn.entityId);
                if (!bucket)
                    continue;
                const inMonth = txn.txnDate >= mRange.start && txn.txnDate < mRange.end;
                const inYear = txn.txnDate >= yStart && txn.txnDate < yEnd;
                const key = txn.categoryId != null ? `c${txn.categoryId}` : "none";
                const cat = bucket.cats.get(key) ?? { category_id: txn.categoryId, name: categoryName ?? "No category", kind: categoryKind, month_in_cents: 0, month_out_cents: 0, year_in_cents: 0, year_out_cents: 0 };
                if (txn.direction === "in") {
                    if (inMonth) { bucket.month.in += txn.amountCents; rollup.month.in += txn.amountCents; cat.month_in_cents += txn.amountCents; }
                    if (inYear) { bucket.year.in += txn.amountCents; rollup.year.in += txn.amountCents; cat.year_in_cents += txn.amountCents; }
                }
                else {
                    if (inMonth) { bucket.month.out += txn.amountCents; rollup.month.out += txn.amountCents; cat.month_out_cents += txn.amountCents; }
                    if (inYear) { bucket.year.out += txn.amountCents; rollup.year.out += txn.amountCents; cat.year_out_cents += txn.amountCents; }
                }
                bucket.cats.set(key, cat);
            }
            const totalsOf = (t: { in: number; out: number }) => ({ in_cents: t.in, out_cents: t.out, net_cents: t.in - t.out });
            return {
                month, year,
                entities: entityRows.map((e) => {
                    const bucket = perEntity.get(e.id)!;
                    return {
                        entity_id: e.id, entity_name: e.name,
                        month_totals: totalsOf(bucket.month), year_totals: totalsOf(bucket.year),
                        categories: [...bucket.cats.values()].sort((a, b) => (b.month_in_cents + b.month_out_cents + b.year_in_cents + b.year_out_cents) - (a.month_in_cents + a.month_out_cents + a.year_in_cents + a.year_out_cents)),
                    };
                }),
                totals: { month: totalsOf(rollup.month), year: totalsOf(rollup.year) },
            };
        },
    },
    /** The CPA handoff: one business's transactions as CSV over an optional
     *  date range (both bounds inclusive), oldest first. Money in and
     *  Money out are separate columns so the sheet reads without signs. */
    exportBooksCsv: {
        request: z.object({ token: z.string(), entity_id: z.number(), from: z.string().regex(bkDatePattern).optional(), to: z.string().regex(bkDatePattern).optional() }),
        response: z.object({ csv: z.string(), filename: z.string() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; from?: string; to?: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            const entityRows = await ctx.db.select({ name: schema.entities.name }).from(schema.entities).where(eq(schema.entities.id, args.entity_id)).limit(1);
            const conditions = [eq(schema.bkTransactions.entityId, args.entity_id), eq(schema.bkTransactions.accountId, accountId)];
            if (args.from)
                conditions.push(gte(schema.bkTransactions.txnDate, args.from));
            if (args.to)
                conditions.push(lt(schema.bkTransactions.txnDate, addUtcDays(args.to, 1)));
            const rows = await ctx.db.select({ txn: schema.bkTransactions, categoryName: schema.bkCategories.name })
                .from(schema.bkTransactions)
                .leftJoin(schema.bkCategories, eq(schema.bkTransactions.categoryId, schema.bkCategories.id))
                .where(and(...conditions))
                .orderBy(asc(schema.bkTransactions.txnDate), asc(schema.bkTransactions.id));
            const dollars = (cents: number) => (cents / 100).toFixed(2);
            const lines = ["Date,Description,Category,Money in,Money out,Status,Source,Note"];
            for (const { txn, categoryName } of rows) {
                lines.push([
                    txn.txnDate,
                    csvCell(txn.description),
                    csvCell(categoryName ?? ""),
                    txn.direction === "in" ? dollars(txn.amountCents) : "",
                    txn.direction === "out" ? dollars(txn.amountCents) : "",
                    txn.status,
                    txn.source,
                    csvCell(txn.note ?? ""),
                ].join(","));
            }
            const slug = (entityRows[0]?.name ?? "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "business";
            return { csv: lines.join("\n"), filename: `kovala-books-${slug}.csv` };
        },
    },
    /** Whether the optional bank connection can be offered at all (it is
     *  configured server-side via PLAID_* env), plus this business's
     *  connection state. The client renders the connect option only when
     *  configured is true; an existing connection is always reported so
     *  it can be synced or disconnected. */
    getBankConnection: {
        request: z.object({ token: z.string(), entity_id: z.number() }),
        response: z.object({ configured: z.boolean(), connection: bkBankConnectionShape.nullable() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            const conn = await activeBkConnection(ctx.db, accountId, args.entity_id);
            return { configured: plaidConfigured() && tokenEncryptionReady(), connection: conn ? bkConnectionPublic(conn) : null };
        },
    },
    /** Step 1 of connecting: a Plaid Link token for this business. */
    createPlaidLinkToken: {
        request: z.object({ token: z.string(), entity_id: z.number() }),
        response: z.object({ link_token: z.string() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            requirePlaidReady();
            const { linkToken } = await createPlaidLinkToken(String(accountId));
            return { link_token: linkToken };
        },
    },
    /** Step 2: exchange the Link public token, store the item (access
     *  token encrypted at rest), and run the first sync. One active
     *  connection per business — reconnecting retires the previous item
     *  at Plaid and marks its row revoked. */
    exchangePlaidPublicToken: {
        request: z.object({ token: z.string(), entity_id: z.number(), public_token: z.string().min(1).max(500), institution_name: z.string().max(160).optional() }),
        response: z.object({ connection: bkBankConnectionShape, added: z.number(), updated: z.number(), removed: z.number() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number; public_token: string; institution_name?: string }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            requirePlaidReady();
            const exchanged = await exchangePlaidPublicToken(args.public_token);
            const previous = await activeBkConnection(ctx.db, accountId, args.entity_id);
            if (previous) {
                try { await removePlaidItem(decryptToken(previous.accessTokenEnc)); }
                catch { /* the old item is already gone at Plaid */ }
                await ctx.db.update(schema.bkBankConnections).set({ status: "revoked", updatedAt: new Date() }).where(eq(schema.bkBankConnections.id, previous.id));
            }
            const institutionName = (await getPlaidInstitutionName(exchanged.accessToken)) ?? args.institution_name ?? null;
            let accountsJson: string | null = null;
            try {
                const accounts = await getPlaidAccounts(exchanged.accessToken);
                if (accounts.length)
                    accountsJson = JSON.stringify(accounts);
            }
            catch { accountsJson = null; }
            const inserted = await ctx.db.insert(schema.bkBankConnections).values({ accountId, entityId: args.entity_id, plaidItemId: exchanged.itemId, accessTokenEnc: encryptToken(exchanged.accessToken), institutionName, accountsJson, status: "active" }).returning();
            const conn = inserted[0];
            if (!conn)
                throw new Error("Could not save the bank connection.");
            const result = await syncBkConnection(ctx.db, accountId, conn);
            const fresh = await activeBkConnection(ctx.db, accountId, args.entity_id);
            return { connection: bkConnectionPublic(fresh ?? conn), added: result.added, updated: result.updated, removed: result.removed };
        },
    },
    /** Manual sync ("Sync now", and the Books screen fires it once on
     *  load when a connection is active). */
    syncBankConnection: {
        request: z.object({ token: z.string(), entity_id: z.number() }),
        response: z.object({ added: z.number(), updated: z.number(), removed: z.number(), last_synced_at: z.string().nullable() }),
        async handler(ctx: Ctx, args: { token: string; entity_id: number }) {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            requirePlaidReady();
            const conn = await activeBkConnection(ctx.db, accountId, args.entity_id);
            if (!conn)
                throw new Error("No bank is connected to this business.");
            const result = await syncBkConnection(ctx.db, accountId, conn);
            const fresh = await activeBkConnection(ctx.db, accountId, args.entity_id);
            return { ...result, last_synced_at: fresh?.lastSyncedAt ? fresh.lastSyncedAt.toISOString() : null };
        },
    },
    /** Disconnect: remove the item at Plaid (best effort — the local
     *  revoke always lands, even if Plaid is unreachable or the server's
     *  Plaid env was removed, so a user can never be trapped connected),
     *  mark the connection revoked, and optionally delete the transactions
     *  that came from this connection (source = 'plaid' rows only;
     *  manual and CSV rows are never touched). */
    disconnectBankConnection: {
        request: z.object({ token: z.string(), entity_id: z.number(), delete_transactions: z.boolean() }),
        response: okResponse,
        async handler(ctx: Ctx, args: { token: string; entity_id: number; delete_transactions: boolean }): Promise<z.infer<typeof okResponse>> {
            const accountId = await accountFor(ctx.db, args.token);
            await requireBkEntity(ctx.db, accountId, args.entity_id);
            const conn = await activeBkConnection(ctx.db, accountId, args.entity_id);
            if (!conn)
                throw new Error("No bank is connected to this business.");
            if (plaidConfigured() && tokenEncryptionReady()) {
                try { await removePlaidItem(decryptToken(conn.accessTokenEnc)); }
                catch { /* item already removed at Plaid — still revoke locally */ }
            }
            await ctx.db.update(schema.bkBankConnections).set({ status: "revoked", updatedAt: new Date() }).where(eq(schema.bkBankConnections.id, conn.id));
            if (args.delete_transactions)
                await ctx.db.delete(schema.bkTransactions).where(and(eq(schema.bkTransactions.entityId, args.entity_id), eq(schema.bkTransactions.accountId, accountId), eq(schema.bkTransactions.source, "plaid")));
            return { ok: true };
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
            let account = await accountRecord(ctx.db, args.token);
            // Self-heal: reconcile the local row from Stripe's actual
            // state (throttled) so a completed checkout stranded by a
            // lost webhook delivery is repaired on this read; re-read
            // the row when the reconcile changed anything.
            const changed = await reconcileSubscriptionFromStripe(ctx.db, account);
            if (changed) {
                account = await accountRecord(ctx.db, args.token);
            }
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
