import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./safe-area";
import { api, type ApiResponse } from "./api";
import { annualCycle, CATEGORIES, dateLabel, daysUntil, entityAttention, relativeDue, workspaceAttention, type AttentionTone, type DocumentCategory, type EntityAttention, type EntityField } from "./attention";
type Workspace = ApiResponse<typeof api, "getWorkspace">;
type Entity = Workspace["entities"][number];
type Reminder = Workspace["reminders"][number];
type Tab = "overview" | "entities" | "books" | "documents" | "calendar" | "minutes" | "billing";
type Modal = "entity" | "reminder" | "document" | "meeting" | null;
const STATES = ["WY", "FL", "GA", "TX", "CA", "AL", "AK", "AZ", "AR", "CO", "CT", "DC", "DE", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "UT", "VA", "VT", "WA", "WI", "WV"];
const errText = (value: unknown) => value instanceof Error ? value.message : "Something went wrong. Please try again.";
function Icon({ name }: {
    name: Tab | "plus" | "close" | "check" | "upload" | "download" | "lock" | "info" | "user" | "clock" | "more" | "chevron" | "agreement" | "receipt" | "license" | "folder" | "flag" | "bank" | "tag";
}) {
    const paths: Record<string, ReactNode> = {
        overview: <><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></>,
        entities: <><path d="M3 21h18M5 21V8l7-4 7 4v13M9 12h2m2 0h2m-6 4h2m2 0h2"/></>,
        books: <><path d="M7 3h12v18H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M5 17a2 2 0 0 1 2-2h12"/><path d="M9.5 7.5H16M9.5 11H14"/></>,
        documents: <><path d="M6 3h8l4 4v14H6V3Zm8 0v5h5M9 13h6m-6 4h6"/></>,
        calendar: <><path d="M5 5h14v15H5V5Zm3-2v4m8-4v4M5 9h14M9 13h2m3 0h2m-7 3h2"/></>,
        minutes: <><path d="M7 3h10v18H7V3Zm3 5h4m-4 4h4m-4 4h3"/></>,
        billing: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></>,
        plus: <path d="M12 5v14M5 12h14"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, check: <path d="m5 12 4 4L19 6"/>,
        upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v5h14v-5"/></>, download: <><path d="M12 4v11m0 0 5-5m-5 5-5-5M5 15v5h14v-5"/></>, lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
        info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8v.3"/></>,
        user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.8 4.4-5.5 7.5-5.5s6.1 1.7 7.5 5.5"/></>,
        clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
        more: <><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></>,
        chevron: <path d="m6 9 6 6 6-6"/>,
        agreement: <><path d="M6 3h8l4 4v14H6V3Zm8 0v5h5"/><path d="m9.3 16.3 1.9 1.9 3.4-3.8"/></>,
        receipt: <><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4L10 21l-2-1.4L6 21V3Z"/><path d="M9.5 8h5m-5 4h5"/></>,
        license: <><circle cx="12" cy="9.5" r="5.5"/><path d="m9.5 9.6 1.8 1.8 3.2-3.5M9.6 14.3 8.2 21l3.8-2.3L15.8 21l-1.4-6.7"/></>,
        folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>,
        flag: <><path d="M6 21.5v-17"/><path d="M6 5h11.5l-2.8 3.7 2.8 3.8H6Z"/></>,
        bank: <><path d="m3 9.2 9-5.4 9 5.4"/><path d="M4.5 9.2h15"/><path d="M6.5 9.2V17m3.7-7.8V17m3.6-7.8V17m3.7-7.8V17"/><path d="M4 17h16M3.5 20.5h17"/></>,
        tag: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none"/></>,
    };
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { return <label className="field"><span>{label}</span>{children}</label>; }
/** The kovala brand mark: a near-black rounded-square tile holding a drawn
 *  white K (a stroked path in the app's icon discipline — never a typed
 *  letter, never the old copper vault-dial image). One artwork everywhere:
 *  desktop rail, mobile header, sign-in, and the favicon
 *  (client/brand-mark.svg carries the same drawing). */
function BrandMark() {
    return <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="11" fill="#111114" stroke="rgba(255,255,255,.18)"/><path d="M15.5 13v22M32.5 13 17.2 23.2M19 25.4l13.8 9.6" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
/** The filing-cabinet empty-state illustration (Layla's mockup): a drawn
 *  document page — folded corner, ruled lines — with a copper circular
 *  upload-arrow badge overlapping its lower right. Drawn in the app's icon
 *  discipline (paths and strokes), never stock art or emoji. */
function CabinetArt() {
    return <svg className="cabinet-art" viewBox="0 0 120 120" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M32 10h36l20 20v72a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6Z" fill="var(--surface)" stroke="var(--dim)" strokeWidth="2"/><path d="M68 10v20h20" fill="var(--warm-soft)" stroke="var(--dim)" strokeWidth="2"/><path d="M39 48h34M39 62h34M39 76h22" stroke="var(--dim)" strokeWidth="2.5" opacity=".55"/><circle cx="90" cy="94" r="16" fill="var(--accent)" stroke="var(--bg)" strokeWidth="3"/><path d="M90 102V86m0 0-5.5 5.5M90 86l5.5 5.5" stroke="var(--bg)" strokeWidth="2.6"/></svg>;
}
function Empty({ title, body, action, icon = "calendar" }: {
    title: string;
    body: string;
    action?: ReactNode;
    icon?: Tab;
}) { return <div className="empty"><span className="empty-art"><Icon name={icon}/></span><h3>{title}</h3><p>{body}</p>{action}</div>; }
function Sheet({ title, onClose, children }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    return <div className="overlay" role="presentation"><section className="sheet" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close"/></button></header><div className="sheet-body">{children}</div></section></div>;
}
function PrimaryButton({ children, busy }: {
    children: ReactNode;
    busy?: boolean;
}) { return <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : children}</button>; }
function Auth({ onAuth, defaultMode = "signin" }: {
    onAuth: (token: string, email: string) => void;
    /** Public CTAs (the services page) link to /?signup=1 so prospects land
     *  on the create-workspace side of the switch; a plain visit still
     *  defaults to sign in. */
    defaultMode?: "signin" | "signup";
}) {
    const [mode, setMode] = useState<"signin" | "signup">(defaultMode);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: () => mode === "signup" ? api.signUp({ email, password }) : api.signIn({ email, password }), onSuccess: (data) => onAuth(data.token, data.email), onError: (e) => setError(errText(e)) });
    return <main className="auth-wrap"><SafeAreaTopScrim backgroundColor="var(--bg)"/><section className="auth-panel"><header className="auth-brand" aria-label="kovala"><BrandMark/><strong>kovala</strong></header><h1>Keep the back office in order.</h1><p className="auth-copy">Deadlines, documents, and decisions—organized around each business you run.</p><div className="auth-switch" role="group" aria-label="Sign in or create a workspace"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create workspace</button></div><form onSubmit={(e) => { e.preventDefault(); setError(""); mutation.mutate(); }}>
    <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required/></Field>
    <Field label="Password"><input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "signup" ? 8 : 1} required/></Field>
    {mode === "signup" && <p className="field-note">Use at least 8 characters.</p>}{error && <p className="error-note" role="alert">{error}</p>}
    <PrimaryButton busy={mutation.isPending}>{mode === "signup" ? "Create workspace" : "Sign in"}</PrimaryButton>
  </form><p className="auth-services">New to kovala? <a href="/services">See what it includes<span className="entity-open-arrow" aria-hidden="true"/></a></p></section><PublicFooter/></main>;
}
/** The public footer shared by the sign-in surface and the services page:
 *  brand, the public-page links, and the support contact. It is the only
 *  footer the public site has, and the services page hangs off it. */
function PublicFooter() {
    return <footer className="public-footer"><p className="public-footer-brand"><BrandMark/><strong>kovala</strong></p><nav aria-label="Public pages"><a href="/services">Services</a><a href="/">Sign in</a><a href="/?signup=1">Create workspace</a></nav><p className="public-footer-note">Questions? Contact our <a href="mailto:kovala@cryptobagtracker.io">support team</a>.</p></footer>;
}
function EntityForm({ token, onDone, entity, focusField }: {
    token: string;
    onDone: () => void;
    entity?: Entity;
    focusField?: EntityField;
}) {
    const qc = useQueryClient();
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: async (form: FormData) => { const ein = String(form.get("ein") || "").trim(); if (entity) {
            await api.updateEntity({ token, id: entity.id, name: String(form.get("name")), entity_type: String(form.get("type")) as "LLC" | "Corporation" | "DBA", state: String(form.get("state")), formation_date: String(form.get("formation")), registered_agent: String(form.get("agent") || ""), agent_renewal_date: String(form.get("renewal") || ""), ...(ein ? { ein } : {}) });
            return;
        } await api.addEntity({ token, name: String(form.get("name")), entity_type: String(form.get("type")) as "LLC" | "Corporation" | "DBA", state: String(form.get("state")), formation_date: String(form.get("formation")), ein, registered_agent: String(form.get("agent") || ""), agent_renewal_date: String(form.get("renewal") || "") }); }, onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["workspace"] }); onDone(); }, onError: (e) => setError(errText(e)) });
    const focus = (field: EntityField) => entity ? focusField === field : field === "name";
    return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)); }}><Field label="Business name"><input name="name" required defaultValue={entity?.name} autoFocus={focus("name")}/></Field><div className="two-col"><Field label="Entity type"><select name="type" defaultValue={entity?.entity_type}><option>LLC</option><option>Corporation</option><option>DBA</option></select></Field><Field label="Formation state"><select name="state" defaultValue={entity?.state ?? "WY"}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></Field></div><Field label="Formation date"><input name="formation" type="date" required defaultValue={entity?.formation_date} autoFocus={focus("formation")}/></Field><Field label="EIN"><input name="ein" inputMode="numeric" placeholder={entity?.ein_masked ? `On file ${entity.ein_masked} — leave blank to keep it` : "Optional — displayed masked"} autoFocus={focus("ein")}/></Field><Field label="Registered agent"><input name="agent" placeholder="Name or service" defaultValue={entity?.registered_agent ?? ""} autoFocus={focus("agent")}/></Field><Field label="Registered agent renewal"><input name="renewal" type="date" defaultValue={entity?.agent_renewal_date ?? ""} autoFocus={focus("renewal")}/></Field>{entity ? <p className="form-callout">Changes save to this business only. Leave the EIN blank to keep the one already on file.</p> : <p className="form-callout">Wyoming, Florida, Georgia, Texas, and California LLC records receive a source-linked filing reminder. Always verify legal deadlines.</p>}{error && <p className="error-note">{error}</p>}<PrimaryButton busy={mutation.isPending}>{entity ? "Save changes" : "Add business"}</PrimaryButton></form>;
}
function ReminderForm({ token, entities, onDone }: {
    token: string;
    entities: Entity[];
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: (form: FormData) => api.addReminder({ token, entity_id: form.get("entity") ? Number(form.get("entity")) : null, title: String(form.get("title")), reminder_type: String(form.get("kind")), due_date: String(form.get("due")), notes: String(form.get("notes") || "") }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["workspace"] }); onDone(); }, onError: (e) => setError(errText(e)) });
    return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)); }}><Field label="Reminder"><input name="title" required autoFocus/></Field><Field label="Business"><select name="entity"><option value="">General</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><div className="two-col"><Field label="Type"><select name="kind"><option>Annual filing</option><option>Tax deadline</option><option>License renewal</option><option>Registered agent</option><option>Custom</option></select></Field><Field label="Due date"><input name="due" type="date" required/></Field></div><Field label="Notes"><textarea name="notes" rows={3}/></Field>{error && <p className="error-note">{error}</p>}<PrimaryButton busy={mutation.isPending}>Add reminder</PrimaryButton></form>;
}
function DocumentForm({ token, entities, onDone, presetEntityId, presetCategory }: {
    token: string;
    entities: Entity[];
    onDone: () => void;
    /** Deep-link presets (from an attention flag's Upload action): the form
     *  opens already set to this business and category. */
    presetEntityId?: number;
    presetCategory?: DocumentCategory;
}) {
    const qc = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: async (form: FormData) => { if (!file)
            throw new Error("Choose a file to upload."); if (file.size > 10000000)
            throw new Error("Choose a file smaller than 10 MB."); const dataBase64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] ?? ""); r.onerror = () => reject(new Error("Could not read that file.")); r.readAsDataURL(file); }); return api.addDocument({ token, entity_id: Number(form.get("entity")), filename: file.name, category: String(form.get("category")) as typeof CATEGORIES[number], mime_type: file.type || "application/octet-stream", data_base64: dataBase64 }); }, onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["workspace"] }); onDone(); }, onError: (e) => setError(errText(e)) });
    return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)); }}><Field label="Business"><select name="entity" required defaultValue={presetEntityId}>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><Field label="Category"><select name="category" defaultValue={presetCategory}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field><label className="file-drop"><Icon name="upload"/><span>{file ? file.name : "Choose a document"}</span><small>PDF, image, or office file · up to 10 MB</small><input aria-label="Choose document file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></label>{error && <p className="error-note">{error}</p>}<PrimaryButton busy={mutation.isPending}>Upload document</PrimaryButton></form>;
}
function MeetingForm({ token, entities, onDone }: {
    token: string;
    entities: Entity[];
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const [error, setError] = useState("");
    const [attendees, setAttendees] = useState([{ name: "", role: "" }]);
    const [items, setItems] = useState([{ action: "", owner: "", due_date: "", status: "Open" }]);
    const mutation = useMutation({ mutationFn: (form: FormData) => api.addMeeting({ token, entity_id: Number(form.get("entity")), meeting_type: String(form.get("type")) as "Annual" | "Special" | "Organizational" | "Member Decision", meeting_date: String(form.get("date")), meeting_time: String(form.get("time")), timezone: String(form.get("timezone")), location: String(form.get("location") || ""), attendees: attendees.filter((a) => a.name && a.role), agenda_items: String(form.get("agenda")).split("\n").map((s) => s.trim()).filter(Boolean), discussion_summary: String(form.get("summary")), decisions: String(form.get("decisions") || "").split("\n").map((s) => s.trim()).filter(Boolean), action_items: items.filter((i) => i.action && i.owner && i.due_date), next_meeting_date: String(form.get("next") || ""), recorded_by: String(form.get("recorder")) }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["workspace"] }); onDone(); }, onError: (e) => setError(errText(e)) });
    const updateAttendee = (index: number, key: "name" | "role", value: string) => setAttendees((prev) => prev.map((a, i) => i === index ? { ...a, [key]: value } : a));
    const updateItem = (index: number, key: "action" | "owner" | "due_date" | "status", value: string) => setItems((prev) => prev.map((a, i) => i === index ? { ...a, [key]: value } : a));
    return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)); }}><Field label="Company name"><select name="entity" required>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><Field label="Meeting type"><select name="type"><option>Annual</option><option>Special</option><option>Organizational</option><option>Member Decision</option></select></Field><div className="two-col"><Field label="Date"><input name="date" type="date" required/></Field><Field label="Time"><input name="time" type="time" required/></Field></div><Field label="Timezone"><input name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required/></Field><Field label="Location"><input name="location" placeholder="Office, video call, or address"/></Field><fieldset><legend>Attendees</legend>{attendees.map((a, i) => <div className="repeat-row" key={i}><input aria-label={`Attendee ${i + 1} name`} placeholder="Name" value={a.name} onChange={(e) => updateAttendee(i, "name", e.target.value)} required={i === 0}/><input aria-label={`Attendee ${i + 1} role`} placeholder="Role" value={a.role} onChange={(e) => updateAttendee(i, "role", e.target.value)} required={i === 0}/></div>)}<button type="button" className="text-button left" onClick={() => setAttendees([...attendees, { name: "", role: "" }])}>+ Add attendee</button></fieldset><Field label="Agenda items (one per line)"><textarea name="agenda" rows={3} required/></Field><Field label="Discussion summary"><textarea name="summary" rows={4} required/></Field><Field label="Decisions made (one per line)"><textarea name="decisions" rows={3}/></Field><fieldset><legend>Action items</legend>{items.map((item, i) => <div className="action-row" key={i}><input aria-label={`Action item ${i + 1}`} placeholder="Action" value={item.action} onChange={(e) => updateItem(i, "action", e.target.value)}/><input aria-label={`Action item ${i + 1} owner`} placeholder="Owner" value={item.owner} onChange={(e) => updateItem(i, "owner", e.target.value)}/><input aria-label={`Action item ${i + 1} due date`} type="date" value={item.due_date} onChange={(e) => updateItem(i, "due_date", e.target.value)}/><select aria-label={`Action item ${i + 1} status`} value={item.status} onChange={(e) => updateItem(i, "status", e.target.value)}><option>Open</option><option>In progress</option><option>Done</option></select></div>)}<button type="button" className="text-button left" onClick={() => setItems([...items, { action: "", owner: "", due_date: "", status: "Open" }])}>+ Add action item</button></fieldset><Field label="Next meeting date"><input name="next" type="date"/></Field><Field label="Recorded by"><input name="recorder" required/></Field>{error && <p className="error-note">{error}</p>}<PrimaryButton busy={mutation.isPending}>Save meeting minutes</PrimaryButton></form>;
}
function ReminderItem({ reminder, token }: {
    reminder: Reminder;
    token: string;
}) {
    const qc = useQueryClient();
    const mutation = useMutation({ mutationFn: () => api.setReminderStatus({ token, id: reminder.id, status: reminder.status === "done" ? "open" : "done" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace"] }) });
    const d = daysUntil(reminder.due_date);
    const tone = reminder.status === "done" ? "done" : d < 0 ? "overdue" : d <= 30 ? "soon" : "later";
    return <article className={`deadline ${tone}`}><button className="check-button" aria-label={reminder.status === "done" ? `Reopen ${reminder.title}` : `Mark ${reminder.title} complete`} onClick={() => mutation.mutate()} disabled={mutation.isPending}>{reminder.status === "done" && <Icon name="check"/>}</button><div className="deadline-main"><div className="deadline-top"><h3>{reminder.title}</h3><span className="due-chip">{reminder.status === "done" ? "Complete" : relativeDue(reminder.due_date)}</span></div><p>{reminder.entity_name ?? "General"} · {dateLabel(reminder.due_date)}</p>{reminder.notes && <p className="deadline-notes">{reminder.notes}</p>}{reminder.source_url && <a href={reminder.source_url} target="_blank" rel="noreferrer">{reminder.source_label} ↗</a>}</div></article>;
}
function Overview({ data, token, open, onViewEntity, onGoTab }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
    onViewEntity: (id: number) => void;
    onGoTab: (t: Tab) => void;
}) {
    const openReminders = data.reminders.filter((r) => r.status === "open");
    const overdue = openReminders.filter((r) => daysUntil(r.due_date) < 0);
    const next90 = openReminders.filter((r) => daysUntil(r.due_date) >= 0 && daysUntil(r.due_date) <= 90);
    const next = openReminders[0];
    const rollup = workspaceAttention(data);
    const rollupActionable = rollup.filter((r) => r.item.tone === "overdue" || r.item.tone === "missing" || r.item.tone === "soon").length;
    const rollupOverdue = rollup.some((r) => r.item.tone === "overdue");
    const rollupOverdueCount = rollup.filter((r) => r.item.tone === "overdue").length;
    // The rollup starts expanded on desktop widths and collapsed below the
    // 800px breakpoint (where the bottom nav replaces the rail) — on a phone
    // a dozen flags would otherwise wall off the page behind a long scroll.
    // Tapping the section header toggles it at any width.
    const [attentionOpen, setAttentionOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 800px)").matches);
    const toggleAttention = () => setAttentionOpen((v) => !v);
    return <div className="page"><header className="page-head"><div><p className="eyebrow">Your back office</p><h1>Good morning.</h1><p className="page-sub">Deadlines, documents, and open items across your businesses.</p></div><button className="round-add" aria-label="Add reminder" onClick={() => open("reminder")}><Icon name="plus"/></button></header>{next ? <section className={`focus-deadline ${daysUntil(next.due_date) < 0 ? "is-overdue" : ""}`}><p>{daysUntil(next.due_date) < 0 ? "Needs attention" : "Next deadline"}</p><div className="focus-date"><strong>{new Date(`${next.due_date}T12:00:00`).getDate()}</strong><span>{new Date(`${next.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</span></div><div><h2>{next.title}</h2><p>{next.entity_name ?? "General"} · {relativeDue(next.due_date)}</p></div></section> : data.entities.length === 0 ? <section className="focus-clear"><span>All clear</span><h2>No open deadlines yet.</h2><button className="secondary" onClick={() => open("reminder")}>Add a reminder</button></section> : null}
    <section className="pulse"><div><strong>{data.entities.length}</strong><span>Businesses</span></div><div><strong>{next90.length}</strong><span>Next 90 days</span></div><div className={overdue.length ? "danger" : ""}><strong>{overdue.length}</strong><span>Overdue</span></div></section>
    {data.entities.length > 0 && (rollup.length ? <section className={`panel-card overview-attention${attentionOpen ? "" : " is-collapsed"}`}><div className="panel-head attention-head" role="button" tabIndex={0} aria-expanded={attentionOpen} aria-label={attentionOpen ? "Hide the needs attention list" : "Show the needs attention list"} onClick={toggleAttention} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleAttention(); } }}><h2>Needs attention</h2><span className="attention-head-side">{rollupActionable > 0 && <Chip tone={rollupOverdue ? "red" : "amber"} large>{rollupActionable} to handle</Chip>}{!attentionOpen && rollupOverdueCount > 0 && <span className="attention-overdue-hint">· {rollupOverdueCount} overdue</span>}<span className={`attention-chevron${attentionOpen ? " open" : ""}`} aria-hidden="true"><Icon name="chevron"/></span></span></div>{attentionOpen && rollup.map(({ entity, item }) => <div className="attention-row rollup-row" key={`${entity.id}-${item.key}`} role="button" tabIndex={0} aria-label={`View ${entity.name}`} onClick={() => onViewEntity(entity.id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onViewEntity(entity.id); } }}><span className={`attention-dot tone-${item.tone}`}>{item.tone === "info" ? <Icon name="calendar"/> : "!"}</span><div className="attention-main"><strong>{entity.name} · {item.label}</strong>{item.detail && <p>{item.detail}</p>}</div><span className="entity-open-arrow rollup-arrow" aria-hidden="true"/></div>)}</section> : <section className="focus-clear overview-attention"><span>All clear</span><h2>Nothing needs attention right now.</h2><button className="secondary" onClick={() => open("reminder")}>Add a reminder</button></section>)}
    <section className="section"><div className="section-head"><h2>Coming up</h2><button onClick={() => open("reminder")}>Add</button></div>{openReminders.length ? <div className="deadline-list">{openReminders.slice(0, 3).map((r) => <ReminderItem key={r.id} reminder={r} token={token}/>)}</div> : <p className="quiet">Your open reminders will appear here.</p>}{openReminders.length > 3 && <button className="coming-up-more" onClick={() => onGoTab("calendar")}>See all {openReminders.length} deadlines<span className="entity-open-arrow" aria-hidden="true"/></button>}</section>
    <section className="section"><div className="section-head"><h2>Recent documents</h2><button onClick={() => open("document")} disabled={!data.entities.length}>Upload</button></div>{data.documents.length ? <div className="doc-list">{data.documents.slice(0, 3).map((d) => <a className="doc-row" key={d.id} href={d.download_url} target="_blank" rel="noreferrer"><span className="file-stamp">{d.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span><span><strong>{d.filename}</strong><small>{d.entity_name} · {d.category}</small></span><time>{new Date(d.uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></a>)}</div> : <p className="quiet">Documents you upload will stay organized by business.</p>}</section>
  </div>;
}
function Chip({ tone, large, children }: {
    tone: "amber" | "red" | "green" | "info";
    large?: boolean;
    children: ReactNode;
}) { return <span className={`chip chip-${tone}${large ? " chip-lg" : ""}`}>{children}</span>; }
function chipTone(tone: AttentionTone): "amber" | "red" | "green" | "info" { return tone === "overdue" ? "red" : tone === "missing" || tone === "soon" ? "amber" : tone === "ok" ? "green" : "info"; }
function StatusChip({ att }: {
    att: EntityAttention;
}) {
    if (att.overdueCount > 0)
        return <Chip tone="red" large><span className="chip-dot" aria-hidden="true"/>Overdue</Chip>;
    if (att.actionCount > 0)
        return <Chip tone="amber" large><span className="chip-dot" aria-hidden="true"/>Action needed</Chip>;
    if (att.formsOn)
        return <Chip tone="info" large><span className="chip-dot" aria-hidden="true"/>Forms {dateLabel(att.formsOn)}</Chip>;
    return <Chip tone="green" large><span className="chip-dot" aria-hidden="true"/>Active</Chip>;
}
type BizFilter = "all" | "active" | "action" | "archived";
type BizSort = "recent" | "name" | "formation";
/** The Renewal cell for a business row: the state annual date the app already
 *  computes (WY anniversary-month 1st, GA April 1) when it applies, else the
 *  registered-agent renewal date on file, else null (→ "Not set" + Add date). */
function renewalCell(e: Entity): { value: string; sub: string } | null {
    let due: string | null = null;
    if (e.formation_date && (e.state === "WY" || e.state === "GA"))
        due = annualCycle(e.formation_date, e.state === "WY" ? Number(e.formation_date.slice(5, 7)) : 4, 1).due;
    else if (e.agent_renewal_date)
        due = e.agent_renewal_date;
    if (!due)
        return null;
    const d = daysUntil(due);
    return { value: dateLabel(due), sub: d < 0 ? "Overdue" : d === 0 ? "Due today" : `${d} day${d === 1 ? "" : "s"} left` };
}
function Entities({ data, token, open, onEdit, selectedId, onSelect, onUploadDoc }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
    onEdit: (entity: Entity, focus?: EntityField) => void;
    selectedId: number | null;
    onSelect: (id: number | null) => void;
    onUploadDoc: (entity: Entity, category: DocumentCategory) => void;
}) {
    const qc = useQueryClient();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<BizFilter>("all");
    const [sort, setSort] = useState<BizSort>("recent");
    const [menuFor, setMenuFor] = useState<number | null>(null);
    const archiveMutation = useMutation({ mutationFn: (args: { id: number; archived: boolean }) => api.setEntityArchived({ token, id: args.id, archived: args.archived }), onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace"] }) });
    const selected = selectedId != null ? data.entities.find((e) => e.id === selectedId) : undefined;
    if (selected)
        return <EntityDetail data={data} token={token} entity={selected} open={open} onEdit={onEdit} onUploadDoc={onUploadDoc} onBack={() => onSelect(null)}/>;
    const atts = new Map(data.entities.map((e) => [e.id, entityAttention(e, data.documents)]));
    const counts = {
        active: data.entities.filter((e) => !e.archived && atts.get(e.id)!.actionCount === 0).length,
        action: data.entities.filter((e) => !e.archived && atts.get(e.id)!.actionCount > 0).length,
        archived: data.entities.filter((e) => e.archived).length,
    };
    const q = query.trim().toLowerCase();
    const visible = data.entities
        .filter((e) => filter === "archived" ? e.archived : filter === "active" ? !e.archived && atts.get(e.id)!.actionCount === 0 : filter === "action" ? !e.archived && atts.get(e.id)!.actionCount > 0 : !e.archived)
        .filter((e) => !q || e.name.toLowerCase().includes(q))
        .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "formation" ? (a.formation_date || "9999").localeCompare(b.formation_date || "9999") : b.created_at.localeCompare(a.created_at));
    return <div className="page"><header className="page-head biz-head"><div><p className="eyebrow">Ownership map</p><h1>Businesses</h1><p className="page-sub">Your companies, filings, documents and deadlines.</p></div><div className="biz-tools"><label className="search biz-search"><span className="sr-only">Search businesses</span><input aria-label="Search businesses" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search businesses..."/></label><button className="primary compact biz-add" onClick={() => open("entity")}><Icon name="plus"/>Add business</button></div></header>{data.entities.length ? <>
    <div className="biz-filters"><div className="biz-chips" role="group" aria-label="Filter businesses"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button><button className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}><span className="dot dot-green" aria-hidden="true"/>Active<span className="count-badge">{counts.active}</span></button><button className={filter === "action" ? "active" : ""} onClick={() => setFilter("action")}><span className="dot dot-amber" aria-hidden="true"/>Action needed<span className="count-badge">{counts.action}</span></button><button className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}><span className="dot dot-gray" aria-hidden="true"/>Archived<span className="count-badge">{counts.archived}</span></button></div><label className="biz-sort"><span>Sort by</span><select aria-label="Sort businesses" value={sort} onChange={(e) => setSort(e.target.value as BizSort)}><option value="recent">Recent</option><option value="name">Name A–Z</option><option value="formation">Formation date</option></select></label></div>
    {visible.length ? <div className="entity-list">{visible.map((e) => { const att = atts.get(e.id)!; const docs = data.documents.filter((d) => d.entity_id === e.id); const nextDeadline = data.reminders.find((r) => r.entity_id === e.id && r.status === "open"); const renewal = renewalCell(e); return <article className="entity-card" key={e.id} role="button" tabIndex={0} aria-label={`View ${e.name}`} onClick={() => onSelect(e.id)} onKeyDown={(ev) => { if (ev.target !== ev.currentTarget)
            return; if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onSelect(e.id);
        } }}><div className="entity-top"><div className="entity-main"><div className="entity-monogram">{e.name.slice(0, 2).toUpperCase()}</div><div className="entity-title"><h2>{e.name}</h2><p>{e.entity_type} · {e.state}</p><span className="entity-status"><StatusChip att={att}/></span></div></div><div className="entity-meta"><div className="meta-cell"><span className="meta-label"><Icon name="calendar"/>Formed</span><strong>{e.formation_date ? dateLabel(e.formation_date) : "Not added"}</strong></div><div className="meta-cell"><span className="meta-label"><Icon name="billing"/>EIN</span>{e.ein_masked ? <strong>{e.ein_masked}</strong> : <><strong className="meta-missing">Not added</strong><button className="meta-link" onClick={(ev) => { ev.stopPropagation(); onEdit(e, "ein"); }}>Add EIN</button></>}</div><div className="meta-cell"><span className="meta-label"><Icon name="user"/>Registered agent</span><strong>{e.registered_agent ?? "Not added"}</strong></div><div className="meta-cell"><span className="meta-label"><Icon name="clock"/>Renewal</span>{renewal ? <><strong>{renewal.value}</strong><span className="meta-sub">{renewal.sub}</span></> : <><strong>Not set</strong><button className="meta-link" onClick={(ev) => { ev.stopPropagation(); onEdit(e, "renewal"); }}>Add date</button></>}</div></div><div className="entity-menu-wrap" onClick={(ev) => ev.stopPropagation()}><button className="entity-menu-button" aria-label={`More actions for ${e.name}`} aria-expanded={menuFor === e.id} onClick={() => setMenuFor(menuFor === e.id ? null : e.id)}><Icon name="more"/></button>{menuFor === e.id && <div className="entity-menu" role="menu"><button onClick={() => { setMenuFor(null); onSelect(e.id); }}>View business</button><button onClick={() => { setMenuFor(null); onEdit(e); }}>Edit details</button><button disabled={archiveMutation.isPending} onClick={() => { setMenuFor(null); archiveMutation.mutate({ id: e.id, archived: !e.archived }); }}>{e.archived ? "Unarchive" : "Archive"}</button></div>}</div></div><div className="entity-subrow"><div className="entity-subitems"><button className="sub-link" onClick={(ev) => { ev.stopPropagation(); onSelect(e.id); }}><Icon name="documents"/>{docs.length} Document{docs.length === 1 ? "" : "s"}<span className="entity-open-arrow" aria-hidden="true"/></button><span className="sub-deadline"><Icon name="calendar"/>{nextDeadline ? <><strong>1 Upcoming deadline</strong><span className="sub-muted">{nextDeadline.title} · Due {dateLabel(nextDeadline.due_date)}</span></> : <span className="sub-muted">No upcoming deadlines</span>}</span></div><button className="secondary entity-view" onClick={(ev) => { ev.stopPropagation(); onSelect(e.id); }}>View business<span className="entity-open-arrow" aria-hidden="true"/></button></div></article>; })}</div> : <Empty icon="entities" title={q ? "No matching businesses" : filter === "archived" ? "Nothing archived yet" : "No businesses in this view"} body={q ? "Try a different search, or clear the filters to see every business." : filter === "archived" ? "Archived businesses keep all of their data and can be brought back from their menu at any time." : "Businesses matching this filter will appear here."} action={<button className="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>}/>}
    </> : <Empty icon="entities" title="Add your first business" body="Keep each entity's deadlines, files, and minutes in one place." action={<button className="primary compact" onClick={() => open("entity")}>Add business</button>}/>}</div>;
}
function EntityDetail({ data, token, entity, open, onEdit, onUploadDoc, onBack }: {
    data: Workspace;
    token: string;
    entity: Entity;
    open: (m: Modal) => void;
    onEdit: (entity: Entity, focus?: EntityField) => void;
    onUploadDoc: (entity: Entity, category: DocumentCategory) => void;
    onBack: () => void;
}) {
    const att = entityAttention(entity, data.documents);
    const deadlines = data.reminders.filter((r) => r.entity_id === entity.id && r.status === "open").slice(0, 5);
    return <div className="page"><button className="back-button" onClick={onBack}><span className="back-arrow" aria-hidden="true"/>All businesses</button><section className="panel-card detail-head"><div className="entity-monogram">{entity.name.slice(0, 2).toUpperCase()}</div><div className="detail-head-main"><h1>{entity.name}</h1><p>{entity.entity_type} · {entity.state}</p></div><StatusChip att={att}/></section>
    <section className="panel-card"><div className="panel-head"><h2>Needs attention</h2>{att.actionCount > 0 && <Chip tone={att.overdueCount ? "red" : "amber"} large>{att.actionCount} to handle</Chip>}</div>{att.needs.length ? att.needs.map((i) => <div className="attention-row" key={i.key}><span className={`attention-dot tone-${i.tone}`}>{i.tone === "info" ? <Icon name="calendar"/> : "!"}</span><div className="attention-main"><strong>{i.label}</strong>{i.detail && <p>{i.detail}</p>}</div>{i.field && <button className="fix-button" onClick={() => onEdit(entity, i.field)}>{i.tone === "missing" ? "Add" : "Update"}</button>}{i.docCategory && <button className="fix-button" onClick={() => onUploadDoc(entity, i.docCategory!)}>Upload</button>}</div>) : <div className="attention-row"><span className="attention-dot tone-ok"><Icon name="check"/></span><div className="attention-main"><strong>Nothing needs attention</strong><p>This business is in good shape right now.</p></div></div>}</section>
    {att.upcoming.length > 0 && <section className="panel-card"><div className="panel-head"><h2>Coming up</h2></div>{att.upcoming.map((i) => <div className="attention-row" key={i.key}><span className="attention-dot tone-info"><Icon name="calendar"/></span><div className="attention-main"><strong>{i.label}</strong>{i.detail && <p>{i.detail}</p>}</div></div>)}</section>}
    {att.done.length > 0 && <section className="panel-card"><div className="panel-head"><h2>On file</h2></div>{att.done.map((i) => <div className="attention-row" key={i.key}><span className="attention-dot tone-ok"><Icon name="check"/></span><div className="attention-main"><strong>{i.label}</strong></div></div>)}</section>}
    {deadlines.length > 0 && <section className="section"><div className="section-head"><h2>Deadlines on record</h2><button onClick={() => open("reminder")}>Add</button></div><div className="deadline-list">{deadlines.map((r) => <ReminderItem key={r.id} reminder={r} token={token}/>)}</div></section>}
    <section className="panel-card"><div className="panel-head"><h2>Details</h2><button className="fix-button" onClick={() => onEdit(entity)}>Edit details</button></div><dl className="details-list"><div><dt>Business name</dt><dd>{entity.name}</dd></div><div><dt>Type</dt><dd>{entity.entity_type}</dd></div><div><dt>Formation state</dt><dd>{entity.state}</dd></div><div><dt>Formation date</dt><dd>{entity.formation_date ? dateLabel(entity.formation_date) : "Not added"}</dd></div><div><dt>EIN</dt><dd>{entity.ein_masked ?? "Not added"}</dd></div><div><dt>Registered agent</dt><dd>{entity.registered_agent ?? "Not added"}</dd></div><div><dt>Agent renewal</dt><dd>{entity.agent_renewal_date ? dateLabel(entity.agent_renewal_date) : "Not set"}</dd></div></dl></section>
  </div>;
}
/** Category filters for the Documents page (Layla's mockup). The chips and
 *  the category select are two views of ONE filter state; the short chip
 *  labels map to the app's real categories as follows:
 *  Formation → "Formation" · Agreements → "Operating Agreement/Bylaws" ·
 *  Minutes → "Meeting Minutes" · Tax Filings → "Tax Filings" ·
 *  Licenses → "Licenses" · Documentation → "Documentation" · Other → "Contracts". */
const DOC_SHORT_LABEL: Record<string, string> = { "Formation": "Formation", "Operating Agreement/Bylaws": "Agreements", "Meeting Minutes": "Minutes", "Contracts": "Other", "Tax Filings": "Tax Filings", "Licenses": "Licenses", "Documentation": "Documentation" };
type DocFilterIcon = "documents" | "agreement" | "minutes" | "receipt" | "license" | "folder";
const DOC_FILTERS: { label: string; value: DocumentCategory | "all"; icon?: DocFilterIcon }[] = [
    { label: "All", value: "all" },
    { label: "Formation", value: "Formation", icon: "documents" },
    { label: "Agreements", value: "Operating Agreement/Bylaws", icon: "agreement" },
    { label: "Minutes", value: "Meeting Minutes", icon: "minutes" },
    { label: "Tax Filings", value: "Tax Filings", icon: "receipt" },
    { label: "Licenses", value: "Licenses", icon: "license" },
    { label: "Documentation", value: "Documentation", icon: "documents" },
    { label: "Other", value: "Contracts", icon: "folder" },
];
function Documents({ data, token, open }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
}) {
    const qc = useQueryClient();
    const deleteMutation = useMutation({ mutationFn: (id: number) => api.deleteDocument({ token, id }), onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace"] }) });
    const [search, setSearch] = useState("");
    const [business, setBusiness] = useState("all");
    const [category, setCategory] = useState<DocumentCategory | "all">("all");
    const q = search.trim().toLowerCase();
    const filtered = data.documents.filter((d) => {
        if (business !== "all" && d.entity_id !== Number(business))
            return false;
        if (category !== "all" && d.category !== category)
            return false;
        if (q && !`${d.filename} ${d.entity_name} ${d.category} ${DOC_SHORT_LABEL[d.category] ?? ""}`.toLowerCase().includes(q))
            return false;
        return true;
    });
    const clearFilters = () => { setSearch(""); setBusiness("all"); setCategory("all"); };
    return <div className="page"><header className="page-head"><div><p className="eyebrow">Secure filing cabinet</p><h1>Documents</h1><p className="page-sub">Store and organize formation records, agreements, minutes, tax filings, and more.</p></div><button className="primary compact doc-upload" disabled={!data.entities.length} onClick={() => open("document")}><Icon name="plus"/>Upload document</button></header><div className="doc-tools"><label className="search doc-search"><span className="sr-only">Search documents</span><input aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files, categories, or businesses..."/></label><select aria-label="Filter documents by business" value={business} onChange={(e) => setBusiness(e.target.value)}><option value="all">All businesses</option>{data.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select><select aria-label="Filter documents by category" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory | "all")}><option value="all">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div><div className="doc-chips" role="group" aria-label="Filter documents by category">{DOC_FILTERS.map((f) => <button key={f.label} className={category === f.value ? "active" : ""} aria-pressed={category === f.value} onClick={() => setCategory(f.value)}>{f.icon && <Icon name={f.icon}/>}{f.label}</button>)}</div>{filtered.length ? <div className="doc-list spacious">{filtered.map((d) => <div className="doc-row has-delete" key={d.id}><span className="file-stamp">{d.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span><a className="doc-link" href={d.download_url} target="_blank" rel="noreferrer"><strong>{d.filename}</strong><small>{d.entity_name}</small><em>{d.category}</em></a><time>{new Date(d.uploaded_at).toLocaleDateString()}</time><button className="doc-delete" aria-label={`Delete ${d.filename}`} disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(d.id)}>Delete</button></div>)}</div> : data.documents.length ? <div className="doc-nomatch"><p>No documents match</p><button className="secondary" onClick={clearFilters}>Clear filters</button></div> : <div className="empty cabinet-empty"><CabinetArt/><h3>The filing cabinet is ready</h3><p>Upload formation records, agreements, minutes, contracts, tax filings, licenses, and more.</p>{data.entities.length > 0 && <button className="primary compact cabinet-upload" onClick={() => open("document")}><Icon name="plus"/>Upload document</button>}<p className="cabinet-note">Files are securely stored and organized by business and category.</p></div>}</div>;
}
function Calendar({ data, token, open }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
}) { const [window, setWindow] = useState<"30" | "60" | "90" | "all">("90"); const filtered = data.reminders.filter((r) => window === "all" || daysUntil(r.due_date) <= Number(window)); return <div className="page"><header className="page-head"><div><p className="eyebrow">Compliance calendar</p><h1>Deadlines</h1><p className="page-sub">Reminders for every business, in one list.</p></div><button className="round-add" aria-label="Add custom reminder" onClick={() => open("reminder")}><Icon name="plus"/></button></header><div className="segmented" role="group" aria-label="Deadline window">{(["30", "60", "90", "all"] as const).map((v) => <button key={v} className={window === v ? "active" : ""} onClick={() => setWindow(v)}>{v === "all" ? "All" : `${v} days`}</button>)}</div>{filtered.length ? <div className="deadline-list roomy">{filtered.map((r) => <ReminderItem key={r.id} reminder={r} token={token}/>)}</div> : <Empty title="No deadlines in this window" body="Try a wider range or add a custom reminder." action={<button className="primary compact" onClick={() => open("reminder")}>Add reminder</button>}/>}<aside className="notice"><p>Reminders live here in your workspace — open Kovala to see what's due.</p></aside></div>; }
function Minutes({ data, token, open }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
}) { const [expanded, setExpanded] = useState<number | null>(null); const qc = useQueryClient(); const deleteMutation = useMutation({ mutationFn: (id: number) => api.deleteMeeting({ token, id }), onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace"] }) }); const count = data.meetings.length; const latest = count ? data.meetings.map((m) => m.meeting_date).sort().at(-1)! : null; return <div className="page"><header className="page-head"><div><p className="eyebrow">Corporate record</p><h1>Meeting Minutes</h1><p className="page-sub">A durable record of meetings, decisions, and assigned work.</p></div></header><section className="panel-card minutes-lead"><span className="minutes-bubble"><Icon name="minutes"/></span><div className="minutes-lead-main"><h2 className="minutes-lead-title">{count ? `${count} meeting${count === 1 ? "" : "s"} on record` : "No minutes recorded"}</h2><p className="quiet minutes-lead-status">{count ? `Last recorded ${dateLabel(latest!)}` : data.entities.length ? "Create a durable record of meetings, decisions, and assigned work." : "Add a business first, then record its meetings."}</p><button className="primary compact minutes-record" disabled={!data.entities.length} onClick={() => open("meeting")}><Icon name="plus"/>Record minutes</button></div></section>{count > 0 && <div className="minutes-list">{data.meetings.map((m) => <article className="minutes-card" key={m.id}><button className="minutes-summary" onClick={() => setExpanded(expanded === m.id ? null : m.id)} aria-expanded={expanded === m.id}><span className="date-block"><strong>{new Date(`${m.meeting_date}T12:00:00`).getDate()}</strong><small>{new Date(`${m.meeting_date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</small></span><span><strong>{m.entity_name}</strong><small>{m.meeting_type} · {m.meeting_time} {m.timezone}</small></span><span className={`minutes-chevron${expanded === m.id ? " open" : ""}`} aria-hidden="true"><Icon name="chevron"/></span></button>{expanded === m.id && <div className="minutes-detail"><p><b>Location</b>{m.location || "Not recorded"}</p><p><b>Attendees</b>{m.attendees.map((a) => `${a.name} (${a.role})`).join(", ")}</p><div><b>Agenda</b><ul>{m.agenda_items.map((a, i) => <li key={i}>{a}</li>)}</ul></div><p><b>Discussion</b>{m.discussion_summary}</p>{m.decisions.length > 0 && <div><b>Decisions</b><ul>{m.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}{m.action_items.length > 0 && <div><b>Action items</b><div className="mini-table">{m.action_items.map((a, i) => <div key={i}><strong>{a.action}</strong><span>{a.owner}</span><time>{dateLabel(a.due_date)}</time><em>{a.status}</em></div>)}</div></div>}<p><b>Recorded by</b>{m.recorded_by}</p>{m.next_meeting_date && <p><b>Next meeting</b>{dateLabel(m.next_meeting_date)}</p>}<button className="text-button" style={{ color: "var(--danger)" }} disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(m.id)}>Delete these minutes</button></div>}</article>)}</div>}</div>; }
type BooksMonthData = ApiResponse<typeof api, "listBooks">;
type BkCategory = BooksMonthData["categories"][number];
type BkTxn = BooksMonthData["transactions"][number];
const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number) => moneyFmt.format(cents / 100);
const moneyFlow = (cents: number, direction: string) => direction === "in" ? `+${money(cents)}` : `−${money(cents)}`;
const BK_KIND_OPTIONS: { value: string; label: string }[] = [
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
    { value: "contribution", label: "Owner contribution" },
    { value: "distribution", label: "Owner draw" },
];
function thisMonth(): string { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }
function todayLocal(): string { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; }
function monthLabel(month: string): string { const [y, m] = month.split("-").map(Number); return new Date(y ?? 2000, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
function shiftMonth(month: string, delta: number): string { const [y, m] = month.split("-").map(Number); const d = new Date(y ?? 2000, (m ?? 1) - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function lastDayOfMonth(month: string): string { const [y, m] = month.split("-").map(Number); return `${month}-${String(new Date(y ?? 2000, m ?? 1, 0).getDate()).padStart(2, "0")}`; }
/** Plaid Link is loaded on demand from Plaid's CDN — only ever requested
 *  after the server says bank connections are configured, so workspaces
 *  without the option never fetch it. */
interface PlaidLinkHandler { open: () => void }
interface PlaidLinkGlobal { create: (config: { token: string; onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void; onExit?: () => void }) => PlaidLinkHandler }
let plaidScriptPromise: Promise<void> | null = null;
function loadPlaidScript(): Promise<void> {
    if ((window as unknown as { Plaid?: PlaidLinkGlobal }).Plaid)
        return Promise.resolve();
    if (!plaidScriptPromise)
        plaidScriptPromise = new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js"; s.onload = () => resolve(); s.onerror = () => reject(new Error("Could not load the bank connection window. Check your connection and try again.")); document.head.appendChild(s); });
    return plaidScriptPromise;
}
/** The optional bank connection card on a business's Books screen. It
 *  renders NOTHING until the server reports the feature configured, and
 *  the connect choice only when no connection is active — manual entry
 *  and CSV import carry on either way. Read-only by design: there is no
 *  payment or transfer control anywhere in this card. */
function BankCard({ token, entity }: {
    token: string;
    entity: Entity;
}) {
    const qc = useQueryClient();
    const [notice, setNotice] = useState("");
    const [confirming, setConfirming] = useState(false);
    const syncedOnce = useRef(false);
    const bank = useQuery({ queryKey: ["bank", token, entity.id], queryFn: () => api.getBankConnection({ token, entity_id: entity.id }) });
    const conn = bank.data?.connection ?? null;
    const invalidateAll = () => { qc.invalidateQueries({ queryKey: ["bank", token, entity.id] }); qc.invalidateQueries({ queryKey: ["books", token, entity.id] }); qc.invalidateQueries({ queryKey: ["booksSummary", token] }); };
    const sync = useMutation({ mutationFn: () => api.syncBankConnection({ token, entity_id: entity.id }), onSuccess: (r) => { setNotice(r.added || r.updated ? `Bank sync done — ${r.added} new, ${r.updated} updated.` : "Bank sync done — nothing new."); invalidateAll(); }, onError: (e) => setNotice(errText(e)) });
    const exchange = useMutation({ mutationFn: (args: { public_token: string; institution_name?: string }) => api.exchangePlaidPublicToken({ token, entity_id: entity.id, ...args }), onSuccess: (r) => { setNotice(`Bank connected — ${r.added} transaction${r.added === 1 ? "" : "s"} imported.`); invalidateAll(); }, onError: (e) => setNotice(errText(e)) });
    const disconnect = useMutation({ mutationFn: (deleteTransactions: boolean) => api.disconnectBankConnection({ token, entity_id: entity.id, delete_transactions: deleteTransactions }), onSuccess: () => { setConfirming(false); setNotice("Bank disconnected."); invalidateAll(); }, onError: (e) => setNotice(errText(e)) });
    const checkout = useMutation({ mutationFn: () => api.createBankSyncCheckout({ token, entity_id: entity.id }), onSuccess: (r) => { window.location.href = r.url; }, onError: (e) => setNotice(errText(e)) });
    const cancelAddon = useMutation({ mutationFn: () => api.cancelBankSyncAddon({ token, entity_id: entity.id }), onSuccess: () => { setNotice("Bank sync turned off — sync is paused, and your imported transactions stay in your books."); invalidateAll(); }, onError: (e) => setNotice(errText(e)) });
    // Opening the Books screen with an active connection syncs it once —
    // but never while the add-on is inactive (a lapse pauses sync; the
    // connection and its imported transactions stay exactly as they are).
    useEffect(() => { if (conn?.status === "active" && bank.data?.sync.active && !syncedOnce.current) { syncedOnce.current = true; sync.mutate(); } }, [conn?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    if (bank.isPending || bank.isError || !bank.data)
        return null;
    if (!bank.data.configured && !conn)
        return null;
    const syncInfo = bank.data.sync;
    if (!conn) {
        if (!syncInfo.active)
            return <section className="panel-card bank-card"><div className="billing-top"><span className="billing-bubble"><Icon name="bank"/></span><div><p className="eyebrow">Bank connection</p><h2 className="bank-title">Bank connection</h2><p className="quiet">Bank sync — $8.88/mo per business. CSV import is always free.</p></div></div>{syncInfo.available && <div className="bank-actions"><button className="primary compact" disabled={checkout.isPending} onClick={() => { setNotice(""); checkout.mutate(); }}>{checkout.isPending ? "Working…" : "Turn on bank sync"}</button></div>}{notice && <p className="books-notice" role="status">{notice}</p>}</section>;
        return <section className="panel-card bank-card"><div className="billing-top"><span className="billing-bubble"><Icon name="bank"/></span><div><p className="eyebrow">Bank connection</p><h2 className="bank-title">Bank connection</h2><p className="quiet">Connect a bank (optional) — read-only, and you can disconnect anytime.</p></div></div><div className="bank-actions"><button className="primary compact" disabled={exchange.isPending} onClick={async () => { setNotice(""); try {
            const { link_token } = await api.createPlaidLinkToken({ token, entity_id: entity.id });
            await loadPlaidScript();
            const Plaid = (window as unknown as { Plaid?: PlaidLinkGlobal }).Plaid;
            if (!Plaid)
                throw new Error("Could not load the bank connection window.");
            Plaid.create({ token: link_token, onSuccess: (publicToken, metadata) => exchange.mutate({ public_token: publicToken, institution_name: metadata.institution?.name ?? undefined }) }).open();
        }
        catch (e) { setNotice(errText(e)); } }}>Connect bank</button></div>{notice && <p className="books-notice" role="status">{notice}</p>}</section>;
    }
    return <section className="panel-card bank-card"><div className="billing-top"><span className="billing-bubble"><Icon name="bank"/></span><div className="bank-head-main"><p className="eyebrow">Bank connection</p><h2 className="bank-title">{conn.institution_name ?? "Bank connection"}</h2>{conn.last_synced_at && <p className="quiet">Last synced {new Date(conn.last_synced_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}</div><Chip tone={syncInfo.active ? "green" : "amber"} large>{syncInfo.active ? "Connected" : "Sync paused"}</Chip></div>{conn.accounts.length ? <><hr className="billing-divider"/><div className="bank-accounts">{conn.accounts.map((a, i) => <div className="books-cat-row" key={`${a.name}-${i}`}><span>{a.name}{a.mask ? ` ····${a.mask}` : ""}</span><strong>{a.balance_cents != null ? money(a.balance_cents) : "—"}</strong></div>)}</div></> : <p className="quiet bank-copy">Connected — read-only. New transactions arrive when you sync.</p>}{!syncInfo.active && <div className="billing-strip neutral bank-strip"><Icon name="info"/><div><strong>Sync paused — add-on inactive</strong><p>Your imported transactions stay in your books.</p></div></div>}{confirming ? <div className="bank-confirm"><div className="billing-strip danger"><Icon name="info"/><div><strong>Disconnect this bank?</strong><p>Transactions already imported stay in your books unless you delete them.</p></div></div><div className="bank-actions"><button className="secondary" disabled={disconnect.isPending} onClick={() => disconnect.mutate(false)}>Keep transactions & disconnect</button><button className="secondary bank-danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate(true)}>Delete imported & disconnect</button><button className="text-button" onClick={() => setConfirming(false)}>Cancel</button></div></div> : <div className="bank-actions">{syncInfo.active && <button className="secondary" disabled={sync.isPending} onClick={() => { setNotice(""); sync.mutate(); }}>{sync.isPending ? "Syncing…" : "Sync now"}</button>}{!syncInfo.active && syncInfo.available && <button className="primary compact" disabled={checkout.isPending} onClick={() => { setNotice(""); checkout.mutate(); }}>{checkout.isPending ? "Working…" : "Turn on bank sync"}</button>}<button className="secondary" onClick={() => setConfirming(true)}>Disconnect</button></div>}{syncInfo.active && !syncInfo.comped && <div className="bank-actions"><button className="text-button" disabled={cancelAddon.isPending} onClick={() => { if (window.confirm("Turn off bank sync for this business? Sync pauses right away; imported transactions stay in your books.")) cancelAddon.mutate(); }}>Turn off bank sync</button></div>}{notice && <p className="books-notice" role="status">{notice}</p>}</section>;
}
/** Books root: the all-companies overview, or one business's books when a
 *  card is opened. Each business's books are a separate ledger end to end —
 *  the server fences every books query by entity, and this screen never
 *  blends two businesses' numbers outside the labeled overview rollup. */
function Books({ data, token }: {
    data: Workspace;
    token: string;
}) {
    const [entityId, setEntityId] = useState<number | null>(null);
    const entity = entityId != null ? data.entities.find((e) => e.id === entityId) : undefined;
    if (entity)
        return <EntityBooks data={data} token={token} entity={entity} onBack={() => setEntityId(null)}/>;
    return <BooksOverview token={token} entities={data.entities} onOpen={setEntityId}/>;
}
function BooksOverview({ token, entities, onOpen }: {
    token: string;
    entities: Entity[];
    onOpen: (id: number) => void;
}) {
    const summary = useQuery({ queryKey: ["booksSummary", token], queryFn: () => api.booksSummary({ token }) });
    const s = summary.data;
    return <div className="page"><header className="page-head"><div><p className="eyebrow">Bookkeeping</p><h1>Books</h1><p className="page-sub">Money in and out, kept separately for each business.</p></div></header>{summary.isPending ? <p className="quiet">Loading…</p> : summary.isError || !s ? <p className="error-note">Could not load your books. Please try again.</p> : s.entities.length === 0 ? <Empty icon="books" title="Add a business first" body="Each business gets its own books here — one company's money never mixes with another's."/> : <><section className="pulse"><div><strong>{money(s.totals.month.in_cents)}</strong><span>Money in · {monthLabel(s.month)}</span></div><div><strong>{money(s.totals.month.out_cents)}</strong><span>Money out · all businesses</span></div><div><strong>{money(s.totals.month.net_cents)}</strong><span>Left over</span></div></section><div className="books-card-list">{s.entities.map((e) => { const meta = entities.find((x) => x.id === e.entity_id); return <article className="panel-card books-card" key={e.entity_id} role="button" tabIndex={0} aria-label={`Open the books for ${e.entity_name}`} onClick={() => onOpen(e.entity_id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(e.entity_id); } }}><div className="books-card-head"><div className="entity-monogram">{e.entity_name.slice(0, 2).toUpperCase()}</div><div className="books-card-title"><h2>{e.entity_name}</h2>{meta && <p>{meta.entity_type} · {meta.state}</p>}</div><span className="entity-open-arrow" aria-hidden="true"/></div><div className="books-nums"><div><span>Money in</span><strong>{money(e.month_totals.in_cents)}</strong></div><div><span>Money out</span><strong>{money(e.month_totals.out_cents)}</strong></div><div><span>Left over</span><strong>{money(e.month_totals.net_cents)}</strong></div></div></article>; })}</div></>}
  </div>;
}
function EntityBooks({ data, token, entity, onBack }: {
    data: Workspace;
    token: string;
    entity: Entity;
    onBack: () => void;
}) {
    const qc = useQueryClient();
    const [month, setMonth] = useState(thisMonth);
    const [editing, setEditing] = useState<BkTxn | "new" | null>(null);
    const [catsOpen, setCatsOpen] = useState(false);
    const [notice, setNotice] = useState("");
    const [confirmingDeleteTxnId, setConfirmingDeleteTxnId] = useState<number | null>(null);
    const books = useQuery({ queryKey: ["books", token, entity.id, month], queryFn: () => api.listBooks({ token, entity_id: entity.id, month }) });
    const invalidate = () => { qc.invalidateQueries({ queryKey: ["books", token, entity.id] }); qc.invalidateQueries({ queryKey: ["booksSummary", token] }); };
    const deleteMutation = useMutation({ mutationFn: (id: number) => api.deleteTransaction({ token, id }), onSuccess: () => { setConfirmingDeleteTxnId(null); invalidate(); }, onError: (e) => setNotice(errText(e)) });
    const importMutation = useMutation({ mutationFn: (csv: string) => api.importTransactionsCsv({ token, entity_id: entity.id, csv }), onSuccess: (r) => { setNotice(`Imported ${r.imported} transaction${r.imported === 1 ? "" : "s"}${r.skipped ? ` · skipped ${r.skipped} row${r.skipped === 1 ? "" : "s"} that could not be read` : ""}.`); invalidate(); }, onError: (e) => setNotice(errText(e)) });
    const exportMutation = useMutation({ mutationFn: () => api.exportBooksCsv({ token, entity_id: entity.id, from: `${month}-01`, to: lastDayOfMonth(month) }), onSuccess: (r) => { const blob = new Blob([r.csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }, onError: (e) => setNotice(errText(e)) });
    const b = books.data;
    const docs = data.documents.filter((d) => d.entity_id === entity.id);
    const catMax = Math.max(1, ...(b?.category_totals ?? []).map((c) => Math.abs(c.in_cents - c.out_cents)));
    return <div className="page"><button className="back-button" onClick={onBack}><span className="back-arrow" aria-hidden="true"/>All books</button><header className="page-head books-head"><div><p className="eyebrow">{entity.name}</p><h1>Books</h1></div><div className="books-month-nav"><button className="books-month-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><span className="back-arrow" aria-hidden="true"/></button><strong className="books-month-label">{monthLabel(month)}</strong><button className="books-month-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><span className="entity-open-arrow" aria-hidden="true"/></button></div></header>{books.isPending ? <p className="quiet">Loading…</p> : books.isError || !b ? <p className="error-note">Could not load these books. Please try again.</p> : <>
    <section className="panel-card books-lead"><span className="billing-bubble books-lead-bubble"><Icon name="books"/></span><div className="books-lead-main"><div className="books-nums"><div><strong>{money(b.totals.in_cents)}</strong><span>Money in</span></div><div><strong>{money(b.totals.out_cents)}</strong><span>Money out</span></div><div><strong>{money(b.totals.net_cents)}</strong><span>Left over</span></div></div><hr className="billing-divider books-lead-divider"/><div className="books-actions"><button className="primary compact" onClick={() => setEditing("new")}><Icon name="plus"/>Add transaction</button><label className="secondary books-file-btn"><Icon name="upload"/>Import CSV<input aria-label="Import transactions from a CSV file" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) file.text().then((text) => importMutation.mutate(text)).catch(() => setNotice("Could not read that file.")); }}/></label><button className="secondary" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()}><Icon name="download"/>Export for CPA</button><button className="secondary" onClick={() => setCatsOpen(true)}><Icon name="tag"/>Categories</button></div>
    {notice && <p className="books-notice" role="status">{notice}</p>}</div></section>
    <BankCard token={token} entity={entity}/>
    <section className="panel-card"><div className="panel-head"><h2>Where the money went</h2></div>{b.category_totals.length ? b.category_totals.map((c) => { const net = c.in_cents - c.out_cents; return <div className="books-cat-row with-bar" key={c.category_id ?? "none"}><div className="books-cat-line"><span>{c.name}</span><strong className={net < 0 ? "txn-out" : ""}>{net < 0 ? `−${money(-net)}` : `+${money(net)}`}</strong></div><div className="cat-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, Math.round((Math.abs(net) / catMax) * 100))}%` }}/></div></div>; }) : <div className="books-empty"><span className="empty-art"><Icon name="books"/></span><h3>Nothing recorded this month</h3><p>Add a transaction above, or import a bank CSV.</p></div>}</section>
    <section className="panel-card"><div className="panel-head"><h2>Transactions</h2><Chip tone="info">{b.transactions.length} this month</Chip></div>{b.transactions.length ? <div className="txn-list">{b.transactions.map((t) => <div className="txn-row" key={t.id}><span className={`txn-dot ${t.status === "pending" ? "pending" : ""}`} role="img" aria-label={t.status === "pending" ? "Pending" : "Cleared"} title={t.status === "pending" ? "Pending" : "Cleared"}/><span className="txn-date"><strong>{Number(t.date.slice(8))}</strong><small>{new Date(`${t.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</small></span><span className="txn-main"><strong>{t.description}</strong><small>{t.category_name ?? "No category"}{t.source === "plaid" ? " · From bank" : ""}{t.receipt_filename ? ` · Receipt: ${t.receipt_filename}` : ""}{t.note ? ` · ${t.note}` : ""}</small></span><span className="txn-side"><strong className={t.direction === "in" ? "txn-in" : "txn-out"}>{moneyFlow(t.amount_cents, t.direction)}</strong><span className="txn-actions">{confirmingDeleteTxnId === t.id ? <><span className="delete-confirm-label">Delete this transaction?</span><button className="fix-button cat-delete" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(t.id)}>Delete</button><button className="text-button delete-cancel" onClick={() => setConfirmingDeleteTxnId(null)}>Cancel</button></> : <><button className="fix-button" onClick={() => setEditing(t)}>Edit</button><button className="fix-button cat-delete" disabled={deleteMutation.isPending} onClick={() => setConfirmingDeleteTxnId(t.id)}>Delete</button></>}</span></span></div>)}</div> : <div className="books-empty"><span className="empty-art"><Icon name="books"/></span><h3>No transactions in {monthLabel(month)}</h3><p>Add one above, or import a bank CSV.</p></div>}</section>
    </>}
    {editing && b && <Sheet title={editing === "new" ? "Add transaction" : "Edit transaction"} onClose={() => setEditing(null)}><TransactionForm token={token} entity={entity} categories={b.categories} documents={docs} txn={editing === "new" ? undefined : editing} onDone={() => setEditing(null)}/></Sheet>}
    {catsOpen && b && <Sheet title="Categories" onClose={() => setCatsOpen(false)}><CategoriesForm token={token} entity={entity} categories={b.categories}/></Sheet>}
  </div>;
}
function TransactionForm({ token, entity, categories, documents, txn, onDone }: {
    token: string;
    entity: Entity;
    categories: BkCategory[];
    documents: Workspace["documents"];
    txn?: BkTxn;
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const [direction, setDirection] = useState<"in" | "out">(txn?.direction === "out" ? "out" : "in");
    const [categoryId, setCategoryId] = useState<string>(txn?.category_id != null ? String(txn.category_id) : "");
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: async (form: FormData) => { const dollars = Number(String(form.get("amount")).replace(/[$,\s]/g, "")); if (!Number.isFinite(dollars) || dollars <= 0)
            throw new Error("Enter an amount above zero."); const payload = { date: String(form.get("date")), description: String(form.get("description")), amount_cents: Math.round(dollars * 100), direction, category_id: categoryId ? Number(categoryId) : null, status: String(form.get("status")) as "cleared" | "pending", receipt_document_id: form.get("receipt") ? Number(form.get("receipt")) : null, note: String(form.get("note") || "") }; if (txn)
            await api.updateTransaction({ token, id: txn.id, ...payload });
        else
            await api.createTransaction({ token, entity_id: entity.id, ...payload }); }, onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["books", token, entity.id] }); await qc.invalidateQueries({ queryKey: ["booksSummary", token] }); onDone(); }, onError: (e) => setError(errText(e)) });
    const visibleCats = categories.filter((c) => !c.archived && (direction === "in" ? c.kind === "income" || c.kind === "contribution" : c.kind === "expense" || c.kind === "distribution"));
    const currentCat = txn?.category_id != null ? categories.find((c) => c.id === txn.category_id) : undefined;
    const catOptions = currentCat && !visibleCats.some((c) => c.id === currentCat.id) ? [currentCat, ...visibleCats] : visibleCats;
    return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); setError(""); mutation.mutate(new FormData(e.currentTarget)); }}><div className="segmented two" role="group" aria-label="Money in or money out"><button type="button" className={direction === "in" ? "active" : ""} onClick={() => { setDirection("in"); setCategoryId(""); }}>Money in</button><button type="button" className={direction === "out" ? "active" : ""} onClick={() => { setDirection("out"); setCategoryId(""); }}>Money out</button></div><div className="two-col"><Field label="Date"><input name="date" type="date" required defaultValue={txn?.date ?? todayLocal()}/></Field><Field label="Amount"><input name="amount" inputMode="decimal" placeholder="0.00" required defaultValue={txn ? (txn.amount_cents / 100).toFixed(2) : ""}/></Field></div><Field label="Description"><input name="description" required defaultValue={txn?.description} placeholder="What was this?"/></Field><Field label="Category"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">No category</option>{catOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="two-col"><Field label="Status"><select name="status" defaultValue={txn?.status ?? "cleared"}><option value="cleared">Cleared</option><option value="pending">Pending</option></select></Field><Field label="Receipt"><select name="receipt" defaultValue={txn?.receipt_document_id != null ? String(txn.receipt_document_id) : ""}><option value="">No receipt</option>{documents.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}</select></Field></div><Field label="Note"><input name="note" defaultValue={txn?.note ?? ""} placeholder="Optional"/></Field>{error && <p className="error-note">{error}</p>}<PrimaryButton busy={mutation.isPending}>{txn ? "Save changes" : "Add transaction"}</PrimaryButton></form>;
}
function CategoryRow({ token, entity, category, onChanged }: {
    token: string;
    entity: Entity;
    category: BkCategory;
    onChanged: () => Promise<void>;
}) {
    const [name, setName] = useState(category.name);
    const [error, setError] = useState("");
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const rename = useMutation({ mutationFn: () => api.updateCategory({ token, id: category.id, name }), onSuccess: onChanged, onError: (e) => setError(errText(e)) });
    const archive = useMutation({ mutationFn: () => api.updateCategory({ token, id: category.id, archived: !category.archived }), onSuccess: onChanged, onError: (e) => setError(errText(e)) });
    const del = useMutation({ mutationFn: () => api.deleteCategory({ token, id: category.id }), onSuccess: async () => { setConfirmingDelete(false); await onChanged(); }, onError: (e) => setError(errText(e)) });
    const kindLabel = BK_KIND_OPTIONS.find((k) => k.value === category.kind)?.label ?? category.kind;
    return <div className="cat-block"><div className="cat-row"><input aria-label={`Name for ${category.name}`} value={name} onChange={(e) => setName(e.target.value)}/><span className="cat-chips"><Chip tone="info">{kindLabel}</Chip>{category.archived && <Chip tone="amber">Archived</Chip>}</span><span className="cat-actions">{confirmingDelete ? <><span className="delete-confirm-label">Delete this category?</span><button className="fix-button cat-delete" disabled={del.isPending} onClick={() => del.mutate()}>Delete</button><button className="text-button delete-cancel" onClick={() => setConfirmingDelete(false)}>Cancel</button></> : <><button className="fix-button" disabled={rename.isPending || name.trim() === category.name} onClick={() => rename.mutate()}>Save</button><button className="fix-button" disabled={archive.isPending} onClick={() => archive.mutate()}>{category.archived ? "Unarchive" : "Archive"}</button><button className="fix-button cat-delete" disabled={del.isPending} onClick={() => { setError(""); setConfirmingDelete(true); }}>Delete</button></>}</span></div>{confirmingDelete && <p className="cat-delete-help">Categories with transactions on them can't be deleted — archive those instead.</p>}{error && <p className="error-note">{error}</p>}</div>;
}
function CategoriesForm({ token, entity, categories }: {
    token: string;
    entity: Entity;
    categories: BkCategory[];
}) {
    const qc = useQueryClient();
    const [error, setError] = useState("");
    const invalidate = async () => { await qc.invalidateQueries({ queryKey: ["books", token, entity.id] }); };
    const add = useMutation({ mutationFn: (form: FormData) => api.createCategory({ token, entity_id: entity.id, name: String(form.get("name")), kind: String(form.get("kind")) as "income" | "expense" | "contribution" | "distribution" }), onSuccess: async () => { await invalidate(); }, onError: (e) => setError(errText(e)) });
    return <div className="form-grid"><form className="cat-add" onSubmit={(e) => { e.preventDefault(); setError(""); add.mutate(new FormData(e.currentTarget)); e.currentTarget.reset(); }}><Field label="New category"><input name="name" required placeholder="Category name"/></Field><Field label="Kind"><select name="kind">{BK_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></Field><button className="primary compact cat-add-btn" type="submit" disabled={add.isPending}>{add.isPending ? "Saving…" : "Add category"}</button></form>{error && <p className="error-note">{error}</p>}<div className="cat-list">{categories.map((c) => <CategoryRow key={c.id} token={token} entity={entity} category={c} onChanged={invalidate}/>)}</div><p className="form-callout">Archived categories keep their history but leave the pickers. A category with transactions on it can't be deleted — archive it instead.</p></div>;
}
function Billing({ token }: {
    token: string;
}) {
    const [notice, setNotice] = useState("");
    const statusQuery = useQuery({ queryKey: ["billing", token], queryFn: () => api.getBillingStatus({ token }), retry: false });
    const friendly = (e: unknown) => { const msg = e instanceof Error ? e.message : "Could not continue."; return /not configured/i.test(msg) ? "Billing isn't connected yet. Check back soon." : msg; };
    const checkout = useMutation({ mutationFn: () => api.createCheckoutSession({ token }), onSuccess: (r) => { window.location.href = r.url; }, onError: (e) => setNotice(friendly(e)) });
    const portal = useMutation({ mutationFn: () => api.createPortalSession({ token }), onSuccess: (r) => { window.location.href = r.url; }, onError: (e) => setNotice(friendly(e)) });
    const data = statusQuery.data as { status?: string; currentPeriodEnd?: string | null } | undefined;
    const status = data?.status ?? "none";
    const periodEnd = data?.currentPeriodEnd ?? null;
    const subscribed = status === "active" || status === "past_due";
    /** A Stripe billing account exists once a subscription has been started
     *  (active, past due, or canceled) — only those states have a real
     *  customer-portal target for the Manage button and View invoices. */
    const hasBillingAccount = subscribed || status === "canceled";
    return <div className="page"><header className="page-head billing-head"><div><p className="eyebrow">Billing</p><h1>kovala plan</h1><p className="page-sub">Manage your subscription, view usage, and update your payment details.</p></div>{hasBillingAccount && <button className="secondary billing-manage" disabled={portal.isPending} onClick={() => portal.mutate()}><Icon name="billing"/>{portal.isPending ? "Working…" : "Manage"}</button>}</header>{statusQuery.isSuccess && status === "none" ? <><section className="panel-card billing-card billing-offer"><span className="billing-hero-bubble"><Icon name="billing"/></span><div className="billing-offer-main"><h2 className="billing-offer-title">Subscription</h2><p className="quiet billing-offer-status">No subscription yet</p><button className="billing-subscribe" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? "Working…" : "Subscribe — $199.88/year"}</button><p className="field-note billing-note">Checkout is secured by Stripe. Your card is charged $199.88 immediately, then once a year.</p>{notice && <p className="error-note billing-alert" role="alert">{notice}</p>}</div><ul className="billing-perks"><li><span className="perk-badge"><Icon name="check"/></span>Access to all features</li><li><span className="perk-badge"><Icon name="check"/></span>Priority support</li><li><span className="perk-badge"><Icon name="check"/></span>Cancel anytime</li></ul></section><p className="billing-support"><Icon name="info"/><span>Questions about billing? Contact our <a href="mailto:kovala@cryptobagtracker.io">support team</a>.</span></p></> : <section className="panel-card billing-card"><div className="billing-top"><span className="billing-bubble"><Icon name="billing"/></span><div><p className="eyebrow">Subscription</p><h2 className="billing-plan">Kovala Plan</h2><p className="quiet">$199.88/year</p></div></div>{statusQuery.isPending ? <p className="quiet billing-loading">Loading…</p> : statusQuery.isError ? <p className="error-note billing-loading">Could not load billing status.</p> : <>
    {subscribed && <><hr className="billing-divider"/><div className="billing-meta"><div><span>Billing cycle</span><strong>Annual</strong></div><div><span>Next billing date</span><strong>{periodEnd ? dateLabel(periodEnd.slice(0, 10)) : "—"}</strong></div><div><span>Payment method</span><strong>Managed in Stripe</strong></div></div></>}
    {status === "active" && <div className="billing-strip"><Icon name="info"/><div><strong>Your subscription is active</strong><p>{periodEnd ? `You're all set — your plan renews on ${dateLabel(periodEnd.slice(0, 10))}.` : "You're all set."}</p></div></div>}
    {status === "past_due" && <div className="billing-strip danger"><Icon name="info"/><div><strong>Payment issue — update your card</strong><p>Your last payment didn't go through. Choose Manage to update your payment method and keep your plan active.</p></div></div>}
    {status === "canceled" && <div className="billing-strip neutral"><Icon name="info"/><div><strong>Subscription canceled</strong><p>Your plan is no longer active. Subscribe again anytime to restart it.</p></div></div>}
    {notice && <p className="error-note billing-alert" role="alert">{notice}</p>}
    {!subscribed && <div className="billing-actions"><button className="primary compact" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? "Working…" : "Subscribe — $199.88/yr"}</button><p className="field-note billing-note">Checkout is secured by Stripe. Your card is charged $199.88 immediately, then once a year.</p></div>}
    {hasBillingAccount && <button className="billing-invoices" disabled={portal.isPending} onClick={() => portal.mutate()}><Icon name="documents"/>View invoices<span className="entity-open-arrow" aria-hidden="true"/></button>}
    </>}</section>}</div>;
}
/** The public services page (/services) — the "what exactly do I get"
 *  explainer a logged-out visitor can read before creating a workspace.
 *  Copy rule: only features that are live today, stated plainly — the
 *  entity records, the deadline calendar, the needs-attention checks, the
 *  document cabinet, minutes, and Stripe-managed billing, at the real
 *  price ($199.88/year, no free trial). Composed to the Billing page's
 *  standard: warm palette, 18px cards, drawn icons, serif headlines. */
const SVC_FEATURES: {
    icon: "entities" | "calendar" | "flag" | "folder" | "minutes" | "billing";
    title: string;
    body: string;
}[] = [
    { icon: "entities", title: "Every business, one record", body: "Add each LLC or corporation you run. Its formation date and state, registered agent, and EIN stay on its record — the EIN shown masked, never in the open." },
    { icon: "calendar", title: "Deadlines, tracked for you", body: "State annual filings and registered-agent renewals sit on one calendar: Wyoming reports come due in the business's anniversary month, Georgia registrations renew January 1 to April 1, and agent renewals follow the date you set." },
    { icon: "flag", title: "Needs attention, up front", body: "Kovala checks every business and flags what is missing — an EIN, a registered agent, a renewal date, formation documents, or the operating agreement — each with a one-tap way to add or upload it." },
    { icon: "folder", title: "A filing cabinet for the paperwork", body: "Formation records, operating agreements, minutes, contracts, tax filings, and licenses, stored securely and organized by business and category — no digging through drives or email." },
    { icon: "minutes", title: "Minutes that stay on record", body: "Record annual and special meetings with attendees, agenda, decisions, and action items. The record stays with the business, ready when a bank or partner asks." },
    { icon: "billing", title: "One subscription, managed in Stripe", body: "A single annual plan covers your workspace. Checkout, receipts, and payment details are handled securely through Stripe, and you can cancel anytime." },
];
const SVC_STEPS: {
    title: string;
    body: string;
}[] = [
    { title: "Create your workspace", body: "Sign up with an email and password. Your records stay private to your workspace." },
    { title: "Add your businesses", body: "Enter each company's formation details and registered agent, add its EIN, and upload its formation documents and operating agreement." },
    { title: "Let kovala keep watch", body: "Your overview leads with what needs attention and what is coming up, so filings and renewals stay on your radar all year." },
];
const SVC_FAQ: {
    q: string;
    a: string;
}[] = [
    { q: "Is there a free trial?", a: "No. Kovala is $199.88 per year, charged when you subscribe — one plan with every feature, no tiers to sort through." },
    { q: "Can I track more than one business?", a: "Yes — add every LLC or corporation you run. Each keeps its own record, deadlines, documents, and minutes, and the overview rolls up what needs attention across all of them." },
    { q: "Does kovala file my annual reports for me?", a: "No. Kovala tracks the dates, keeps the records together, and flags what is missing — you, your registered agent, or your accountant still makes the filing itself." },
    { q: "How are my renewal dates worked out?", a: "From each business's formation date and state: Wyoming annual reports come due on the first of the anniversary month, and Georgia registrations renew in the January 1 – April 1 window. Registered-agent renewals use the date you set on the business's record." },
    { q: "How do I change my card or cancel?", a: "From the Billing tab in your workspace. Payment details are managed securely through Stripe — kovala does not store your card number — and you can cancel anytime." },
];
function ServicesPage() {
    return <div className="svc-wrap"><SafeAreaTopScrim backgroundColor="var(--bg)"/><header className="svc-topbar"><a className="auth-brand svc-brand" href="/" aria-label="kovala — back to sign in"><BrandMark/><strong>kovala</strong></a><nav className="svc-topnav" aria-label="Account"><a className="svc-signin" href="/">Sign in</a><a className="primary compact svc-topcta" href="/?signup=1">Create workspace</a></nav></header>
    <section className="svc-hero"><p className="eyebrow">Services</p><h1>every business you run, in one place.</h1><p className="svc-lede">Kovala is the back-office record keeper for owners running one or more LLCs: formation records, deadlines, documents, and meeting minutes for each business — with a standing list of anything that is missing or due.</p></section>
    <section className="svc-section" aria-label="What kovala includes"><div className="svc-grid">{SVC_FEATURES.map((f) => <article className="panel-card svc-card" key={f.title}><div className="svc-card-head"><span className="svc-icon-bubble"><Icon name={f.icon}/></span><h3>{f.title}</h3></div><p>{f.body}</p></article>)}</div></section>
    <section className="svc-section" aria-label="How it works"><h2 className="svc-h2">how it works</h2><div className="svc-steps">{SVC_STEPS.map((s, i) => <article className="panel-card svc-step" key={s.title}><span className="svc-step-num" aria-hidden="true">{i + 1}</span><h3>{s.title}</h3><p>{s.body}</p></article>)}</div></section>
    <section className="svc-section" aria-label="Price"><h2 className="svc-h2">one plan, one price</h2><section className="panel-card billing-card billing-offer svc-price"><span className="billing-hero-bubble"><Icon name="billing"/></span><div className="billing-offer-main"><h3 className="billing-offer-title">kovala plan</h3><p className="quiet billing-offer-status">$199.88/year · No free trial</p><a className="billing-subscribe svc-cta-anchor" href="/?signup=1">Create your workspace</a><p className="field-note billing-note">Checkout is secured by Stripe. Your card is charged $199.88 when you subscribe, then once a year.</p></div><ul className="billing-perks"><li><span className="perk-badge"><Icon name="check"/></span>Access to all features</li><li><span className="perk-badge"><Icon name="check"/></span>Priority support</li><li><span className="perk-badge"><Icon name="check"/></span>Cancel anytime</li></ul></section><p className="billing-support"><Icon name="info"/><span>Questions about billing? Contact our <a href="mailto:kovala@cryptobagtracker.io">support team</a>.</span></p></section>
    <section className="svc-section" aria-label="Questions"><h2 className="svc-h2">questions</h2><div className="svc-faq">{SVC_FAQ.map((item) => <div className="svc-faq-item" key={item.q}><h3>{item.q}</h3><p>{item.a}</p></div>)}</div></section>
    <section className="panel-card svc-cta-card"><h2>ready when you are.</h2><p>Create a workspace and add your first business — the record keeping starts the same day.</p><div className="svc-cta-row"><a className="primary svc-cta-anchor" href="/?signup=1">Create your workspace</a><span className="svc-cta-signin">Already have a workspace? <a href="/">Sign in</a></span></div></section>
    <PublicFooter/></div>;
}
export function App() {
    // Public route: /services is readable logged out (the server's catch-all
    // serves this SPA for every path). It renders before any hook runs, and
    // the path cannot change without a full page load, so the early return
    // is stable across renders. Every other path keeps the existing
    // state-based tab routing.
    if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/services")
        return <ServicesPage/>;
    const [token, setToken] = useState(() => localStorage.getItem("bizkeep_token") ?? "");
    const [email, setEmail] = useState(() => localStorage.getItem("bizkeep_email") ?? "");
    const [tab, setTab] = useState<Tab>("overview");
    const [modal, setModal] = useState<Modal>(null);
    const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
    const [docPreset, setDocPreset] = useState<{
        entityId: number;
        category: DocumentCategory;
    } | null>(null);
    const [entityEdit, setEntityEdit] = useState<{
        entity: Entity;
        focus?: EntityField;
    } | null>(null);
    const workspace = useQuery({ queryKey: ["workspace", token], queryFn: () => api.getWorkspace({ token }), enabled: Boolean(token), retry: false });
    const data = workspace.data;
    const closeModal = () => { setModal(null); setDocPreset(null); };
    /** Plain modal opens never carry a document-upload preset. */
    const openModal = (m: Modal) => { setDocPreset(null); setModal(m); };
    /** Attention-flag deep link: open the upload form set to one business + category. */
    const openDocUpload = (entity: Entity, category: DocumentCategory) => { setDocPreset({ entityId: entity.id, category }); setModal("document"); };
    /** Rollup click-through: jump straight to that business's detail view. */
    const viewEntity = (id: number) => { setSelectedEntityId(id); setTab("entities"); };
    /** Nav buttons always land on the Businesses list, as before. */
    const goTab = (t: Tab) => { if (t === "entities")
        setSelectedEntityId(null); setTab(t); };
    const modalBody = useMemo(() => { if (!modal || !data)
        return null; const done = closeModal; if (modal === "entity")
        return <EntityForm token={token} onDone={done}/>; if (modal === "reminder")
        return <ReminderForm token={token} entities={data.entities} onDone={done}/>; if (modal === "document")
        return <DocumentForm token={token} entities={data.entities} onDone={done} presetEntityId={docPreset?.entityId} presetCategory={docPreset?.category}/>; return <MeetingForm token={token} entities={data.entities} onDone={done}/>; }, [modal, data, token, docPreset]);
    if (!token)
        return <Auth defaultMode={typeof window !== "undefined" && new URLSearchParams(window.location.search).has("signup") ? "signup" : "signin"} onAuth={(next, nextEmail) => { localStorage.setItem("bizkeep_token", next); localStorage.setItem("bizkeep_email", nextEmail); setToken(next); setEmail(nextEmail); }}/>;
    if (workspace.isPending)
        return <div className="loading"><span></span><p>Opening your records…</p></div>;
    if (workspace.isError || !data)
        return <main className="error-page"><h1>We couldn't open this workspace.</h1><p>{errText(workspace.error)}</p><button className="primary compact" onClick={() => { localStorage.removeItem("bizkeep_token"); localStorage.removeItem("bizkeep_email"); setToken(""); }}>Return to sign in</button></main>;
    return <div className="app-shell"><SafeAreaTopScrim backgroundColor="var(--bg)"/><header className="mobile-brand"><BrandMark/><strong>kovala</strong><span>Private workspace</span></header><div className="desktop-rail"><p className="rail-brand"><BrandMark/>kovala</p><p className="rail-caption">Workspace</p><p className="rail-email">{email}</p>{(["overview", "entities", "books", "documents", "calendar", "minutes", "billing"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => goTab(t)}><Icon name={t}/><span>{t === "overview" ? "Overview" : t === "calendar" ? "Deadlines" : t[0]?.toUpperCase() + t.slice(1)}</span></button>)}<button className="signout" onClick={() => { localStorage.clear(); setToken(""); }}>Sign out</button></div><main className={tab === "entities" && selectedEntityId == null ? "content wide" : "content"}>{tab === "overview" && <Overview data={data} token={token} open={openModal} onViewEntity={viewEntity} onGoTab={goTab}/>}{tab === "entities" && <Entities data={data} token={token} open={openModal} onEdit={(entity, focus) => setEntityEdit({ entity, focus })} selectedId={selectedEntityId} onSelect={setSelectedEntityId} onUploadDoc={openDocUpload}/>}{tab === "books" && <Books data={data} token={token}/>}{tab === "documents" && <Documents data={data} token={token} open={openModal}/>}{tab === "calendar" && <Calendar data={data} token={token} open={openModal}/>}{tab === "minutes" && <Minutes data={data} token={token} open={openModal}/>}{tab === "billing" && <Billing token={token}/>}</main><nav className="bottom-nav" aria-label="Main navigation">{(["overview", "entities", "books", "documents", "calendar", "minutes", "billing"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => goTab(t)} aria-label={t === "calendar" ? "Deadlines" : t}><Icon name={t}/><span>{t === "overview" ? "Home" : t === "calendar" ? "Deadlines" : t === "documents" ? "Files" : t === "billing" ? "Billing" : t}</span></button>)}</nav>{modal && <Sheet title={modal === "entity" ? "Add business" : modal === "reminder" ? "Add reminder" : modal === "document" ? "Upload document" : "Record meeting minutes"} onClose={closeModal}>{modalBody}</Sheet>}{entityEdit && <Sheet title="Edit business" onClose={() => setEntityEdit(null)}><EntityForm token={token} entity={entityEdit.entity} focusField={entityEdit.focus} onDone={() => setEntityEdit(null)}/></Sheet>}</div>;
}
