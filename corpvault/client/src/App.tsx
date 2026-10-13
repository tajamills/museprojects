import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./safe-area";
import { api, type ApiResponse } from "./api";
import { annualCycle, CATEGORIES, dateLabel, daysUntil, entityAttention, relativeDue, workspaceAttention, type AttentionTone, type DocumentCategory, type EntityAttention, type EntityField } from "./attention";
type Workspace = ApiResponse<typeof api, "getWorkspace">;
type Entity = Workspace["entities"][number];
type Reminder = Workspace["reminders"][number];
type Tab = "overview" | "entities" | "documents" | "calendar" | "minutes" | "billing";
type Modal = "entity" | "reminder" | "document" | "meeting" | null;
const STATES = ["WY", "FL", "GA", "TX", "CA", "AL", "AK", "AZ", "AR", "CO", "CT", "DC", "DE", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "UT", "VA", "VT", "WA", "WI", "WV"];
const errText = (value: unknown) => value instanceof Error ? value.message : "Something went wrong. Please try again.";
function Icon({ name }: {
    name: Tab | "plus" | "close" | "check" | "upload" | "lock" | "info" | "user" | "clock" | "more" | "chevron";
}) {
    const paths: Record<string, ReactNode> = {
        overview: <><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></>,
        entities: <><path d="M3 21h18M5 21V8l7-4 7 4v13M9 12h2m2 0h2m-6 4h2m2 0h2"/></>,
        documents: <><path d="M6 3h8l4 4v14H6V3Zm8 0v5h5M9 13h6m-6 4h6"/></>,
        calendar: <><path d="M5 5h14v15H5V5Zm3-2v4m8-4v4M5 9h14M9 13h2m3 0h2m-7 3h2"/></>,
        minutes: <><path d="M7 3h10v18H7V3Zm3 5h4m-4 4h4m-4 4h3"/></>,
        billing: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></>,
        plus: <path d="M12 5v14M5 12h14"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, check: <path d="m5 12 4 4L19 6"/>,
        upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v5h14v-5"/></>, lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
        info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8v.3"/></>,
        user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.8 4.4-5.5 7.5-5.5s6.1 1.7 7.5 5.5"/></>,
        clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
        more: <><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></>,
        chevron: <path d="m6 9 6 6 6-6"/>,
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
    return <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="11" fill="#10151d" stroke="rgba(255,255,255,.18)"/><path d="M15.5 13v22M32.5 13 17.2 23.2M19 25.4l13.8 9.6" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
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
function Auth({ onAuth }: {
    onAuth: (token: string, email: string) => void;
}) {
    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: () => mode === "signup" ? api.signUp({ email, password }) : api.signIn({ email, password }), onSuccess: (data) => onAuth(data.token, data.email), onError: (e) => setError(errText(e)) });
    return <main className="auth-wrap"><SafeAreaTopScrim backgroundColor="var(--bg)"/><section className="auth-panel"><header className="auth-brand" aria-label="kovala"><BrandMark/><strong>kovala</strong></header><h1>Keep the back office in order.</h1><p className="auth-copy">Deadlines, documents, and decisions—organized around each business you run. Now including registered agent service: we receive your official mail and legal notices, scan them into your vault, and alert you the same day.</p><div className="auth-switch" role="group" aria-label="Sign in or create a workspace"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create workspace</button></div><form onSubmit={(e) => { e.preventDefault(); setError(""); mutation.mutate(); }}>
    <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required/></Field>
    <Field label="Password"><input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "signup" ? 8 : 1} required/></Field>
    {mode === "signup" && <p className="field-note">Use at least 8 characters.</p>}{error && <p className="error-note" role="alert">{error}</p>}
    <PrimaryButton busy={mutation.isPending}>{mode === "signup" ? "Create workspace" : "Sign in"}</PrimaryButton>
  </form></section></main>;
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
    return <div className="page"><header className="page-head"><div><p className="eyebrow">Your back office</p><h1>Good morning.</h1></div><button className="round-add" aria-label="Add reminder" onClick={() => open("reminder")}><Icon name="plus"/></button></header>{next ? <section className={`focus-deadline ${daysUntil(next.due_date) < 0 ? "is-overdue" : ""}`}><p>{daysUntil(next.due_date) < 0 ? "Needs attention" : "Next deadline"}</p><div className="focus-date"><strong>{new Date(`${next.due_date}T12:00:00`).getDate()}</strong><span>{new Date(`${next.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</span></div><div><h2>{next.title}</h2><p>{next.entity_name ?? "General"} · {relativeDue(next.due_date)}</p></div></section> : data.entities.length === 0 ? <section className="focus-clear"><span>All clear</span><h2>No open deadlines yet.</h2><button className="secondary" onClick={() => open("reminder")}>Add a reminder</button></section> : null}
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
    <div className="biz-filters"><div className="biz-chips" role="group" aria-label="Filter businesses"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button><button className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}><span className="dot dot-green" aria-hidden="true"/>Active · {counts.active}</button><button className={filter === "action" ? "active" : ""} onClick={() => setFilter("action")}><span className="dot dot-amber" aria-hidden="true"/>Action needed · {counts.action}</button><button className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}><span className="dot dot-gray" aria-hidden="true"/>Archived · {counts.archived}</button></div><label className="biz-sort"><span>Sort by</span><select aria-label="Sort businesses" value={sort} onChange={(e) => setSort(e.target.value as BizSort)}><option value="recent">Recent</option><option value="name">Name A–Z</option><option value="formation">Formation date</option></select></label></div>
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
    return <div className="page"><button className="back-button" onClick={onBack}>← All businesses</button><section className="panel-card detail-head"><div className="entity-monogram">{entity.name.slice(0, 2).toUpperCase()}</div><div className="detail-head-main"><h1>{entity.name}</h1><p>{entity.entity_type} · {entity.state}</p></div><StatusChip att={att}/></section>
    <section className="panel-card"><div className="panel-head"><h2>Needs attention</h2>{att.actionCount > 0 && <Chip tone={att.overdueCount ? "red" : "amber"} large>{att.actionCount} to handle</Chip>}</div>{att.needs.length ? att.needs.map((i) => <div className="attention-row" key={i.key}><span className={`attention-dot tone-${i.tone}`}>{i.tone === "info" ? <Icon name="calendar"/> : "!"}</span><div className="attention-main"><strong>{i.label}</strong>{i.detail && <p>{i.detail}</p>}</div>{i.field && <button className="fix-button" onClick={() => onEdit(entity, i.field)}>{i.tone === "missing" ? "Add" : "Update"}</button>}{i.docCategory && <button className="fix-button" onClick={() => onUploadDoc(entity, i.docCategory!)}>Upload</button>}</div>) : <div className="attention-row"><span className="attention-dot tone-ok"><Icon name="check"/></span><div className="attention-main"><strong>Nothing needs attention</strong><p>This business is in good shape right now.</p></div></div>}</section>
    {att.upcoming.length > 0 && <section className="panel-card"><div className="panel-head"><h2>Coming up</h2></div>{att.upcoming.map((i) => <div className="attention-row" key={i.key}><span className="attention-dot tone-info"><Icon name="calendar"/></span><div className="attention-main"><strong>{i.label}</strong>{i.detail && <p>{i.detail}</p>}</div></div>)}</section>}
    {att.done.length > 0 && <section className="panel-card"><div className="panel-head"><h2>On file</h2></div>{att.done.map((i) => <div className="attention-row" key={i.key}><span className="attention-dot tone-ok"><Icon name="check"/></span><div className="attention-main"><strong>{i.label}</strong></div></div>)}</section>}
    {deadlines.length > 0 && <section className="section"><div className="section-head"><h2>Deadlines on record</h2><button onClick={() => open("reminder")}>Add</button></div><div className="deadline-list">{deadlines.map((r) => <ReminderItem key={r.id} reminder={r} token={token}/>)}</div></section>}
    <section className="panel-card"><div className="panel-head"><h2>Details</h2><button className="fix-button" onClick={() => onEdit(entity)}>Edit details</button></div><dl className="details-list"><div><dt>Business name</dt><dd>{entity.name}</dd></div><div><dt>Type</dt><dd>{entity.entity_type}</dd></div><div><dt>Formation state</dt><dd>{entity.state}</dd></div><div><dt>Formation date</dt><dd>{entity.formation_date ? dateLabel(entity.formation_date) : "Not added"}</dd></div><div><dt>EIN</dt><dd>{entity.ein_masked ?? "Not added"}</dd></div><div><dt>Registered agent</dt><dd>{entity.registered_agent ?? "Not added"}</dd></div><div><dt>Agent renewal</dt><dd>{entity.agent_renewal_date ? dateLabel(entity.agent_renewal_date) : "Not set"}</dd></div></dl></section>
  </div>;
}
function Documents({ data, open }: {
    data: Workspace;
    open: (m: Modal) => void;
}) { const [search, setSearch] = useState(""); const filtered = data.documents.filter((d) => `${d.filename} ${d.entity_name} ${d.category}`.toLowerCase().includes(search.toLowerCase())); return <div className="page"><header className="page-head"><div><p className="eyebrow">Secure filing cabinet</p><h1>Documents</h1></div><button className="round-add" aria-label="Upload document" disabled={!data.entities.length} onClick={() => open("document")}><Icon name="plus"/></button></header><label className="search"><span className="sr-only">Search documents</span><input aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files, categories, businesses"/></label>{filtered.length ? <div className="doc-list spacious">{filtered.map((d) => <a className="doc-row" key={d.id} href={d.download_url} target="_blank" rel="noreferrer"><span className="file-stamp">{d.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span><span><strong>{d.filename}</strong><small>{d.entity_name}</small><em>{d.category}</em></span><time>{new Date(d.uploaded_at).toLocaleDateString()}</time></a>)}</div> : <Empty icon="documents" title={search ? "No matching documents" : "The filing cabinet is ready"} body={data.entities.length ? "Upload formation records, agreements, minutes, contracts, tax filings, and licenses." : "Add a business first, then attach its records."} action={data.entities.length && !search ? <button className="primary compact" onClick={() => open("document")}>Upload document</button> : undefined}/>}</div>; }
function Calendar({ data, token, open }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
}) { const [window, setWindow] = useState<"30" | "60" | "90" | "all">("90"); const filtered = data.reminders.filter((r) => window === "all" || daysUntil(r.due_date) <= Number(window)); return <div className="page"><header className="page-head"><div><p className="eyebrow">Compliance calendar</p><h1>Deadlines</h1></div><button className="round-add" aria-label="Add custom reminder" onClick={() => open("reminder")}><Icon name="plus"/></button></header><div className="segmented" role="group" aria-label="Deadline window">{(["30", "60", "90", "all"] as const).map((v) => <button key={v} className={window === v ? "active" : ""} onClick={() => setWindow(v)}>{v === "all" ? "All" : `${v} days`}</button>)}</div>{filtered.length ? <div className="deadline-list roomy">{filtered.map((r) => <ReminderItem key={r.id} reminder={r} token={token}/>)}</div> : <Empty title="No deadlines in this window" body="Try a wider range or add a custom reminder." action={<button className="primary compact" onClick={() => open("reminder")}>Add reminder</button>}/>}<aside className="notice"><p>Reminders live here in your workspace — open Kovala to see what's due.</p></aside></div>; }
function Minutes({ data, open }: {
    data: Workspace;
    open: (m: Modal) => void;
}) { const [expanded, setExpanded] = useState<number | null>(null); return <div className="page"><header className="page-head"><div><p className="eyebrow">Corporate record</p><h1>Meeting Minutes</h1></div><button className="round-add" aria-label="Record meeting minutes" disabled={!data.entities.length} onClick={() => open("meeting")}><Icon name="plus"/></button></header>{data.meetings.length ? <div className="minutes-list">{data.meetings.map((m) => <article className="minutes-card" key={m.id}><button className="minutes-summary" onClick={() => setExpanded(expanded === m.id ? null : m.id)} aria-expanded={expanded === m.id}><span className="date-block"><strong>{new Date(`${m.meeting_date}T12:00:00`).getDate()}</strong><small>{new Date(`${m.meeting_date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</small></span><span><strong>{m.entity_name}</strong><small>{m.meeting_type} · {m.meeting_time} {m.timezone}</small></span><b>{expanded === m.id ? "−" : "+"}</b></button>{expanded === m.id && <div className="minutes-detail"><p><b>Location</b>{m.location || "Not recorded"}</p><p><b>Attendees</b>{m.attendees.map((a) => `${a.name} (${a.role})`).join(", ")}</p><div><b>Agenda</b><ul>{m.agenda_items.map((a, i) => <li key={i}>{a}</li>)}</ul></div><p><b>Discussion</b>{m.discussion_summary}</p>{m.decisions.length > 0 && <div><b>Decisions</b><ul>{m.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}{m.action_items.length > 0 && <div><b>Action items</b><div className="mini-table">{m.action_items.map((a, i) => <div key={i}><strong>{a.action}</strong><span>{a.owner}</span><time>{dateLabel(a.due_date)}</time><em>{a.status}</em></div>)}</div></div>}<p><b>Recorded by</b>{m.recorded_by}</p>{m.next_meeting_date && <p><b>Next meeting</b>{dateLabel(m.next_meeting_date)}</p>}</div>}</article>)}</div> : <Empty icon="minutes" title="No minutes recorded" body={data.entities.length ? "Create a durable record of meetings, decisions, and assigned work." : "Add a business first, then record its meetings."} action={data.entities.length ? <button className="primary compact" onClick={() => open("meeting")}>Record minutes</button> : undefined}/>}</div>; }
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
    return <div className="page"><header className="page-head billing-head"><div><p className="eyebrow">Billing</p><h1>Kovala Plan</h1><p className="page-sub">$199.88/year, billed annually. Cancel anytime.</p></div>{hasBillingAccount && <button className="secondary billing-manage" disabled={portal.isPending} onClick={() => portal.mutate()}><Icon name="billing"/>{portal.isPending ? "Working…" : "Manage"}</button>}</header><section className="panel-card billing-card"><div className="billing-top"><span className="billing-bubble"><Icon name="billing"/></span><div><p className="eyebrow">Subscription</p><h2 className="billing-plan">Kovala Plan</h2><p className="quiet">$199.88/year</p></div></div>{statusQuery.isPending ? <p className="quiet billing-loading">Loading…</p> : statusQuery.isError ? <p className="error-note billing-loading">Could not load billing status.</p> : <>
    {subscribed && <><hr className="billing-divider"/><div className="billing-meta"><div><span>Billing cycle</span><strong>Annual</strong></div><div><span>Next billing date</span><strong>{periodEnd ? dateLabel(periodEnd.slice(0, 10)) : "—"}</strong></div><div><span>Payment method</span><strong>Managed in Stripe</strong></div></div></>}
    {status === "active" && <div className="billing-strip"><Icon name="info"/><div><strong>Your subscription is active</strong><p>{periodEnd ? `You're all set — your plan renews on ${dateLabel(periodEnd.slice(0, 10))}.` : "You're all set."}</p></div></div>}
    {status === "past_due" && <div className="billing-strip danger"><Icon name="info"/><div><strong>Payment issue — update your card</strong><p>Your last payment didn't go through. Choose Manage to update your payment method and keep your plan active.</p></div></div>}
    {status === "canceled" && <div className="billing-strip neutral"><Icon name="info"/><div><strong>Subscription canceled</strong><p>Your plan is no longer active. Subscribe again anytime to restart it.</p></div></div>}
    {notice && <p className="error-note billing-alert" role="alert">{notice}</p>}
    {!subscribed && <div className="billing-actions">{status === "none" && <p className="quiet">No subscription yet.</p>}<button className="primary compact" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? "Working…" : "Subscribe — $199.88/yr"}</button><p className="field-note billing-note">Checkout is secured by Stripe. Your card is charged $199.88 immediately, then once a year.</p></div>}
    {hasBillingAccount && <button className="billing-invoices" disabled={portal.isPending} onClick={() => portal.mutate()}><Icon name="documents"/>View invoices<span className="entity-open-arrow" aria-hidden="true"/></button>}
    </>}</section></div>;
}
export function App() {
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
        return <Auth onAuth={(next, nextEmail) => { localStorage.setItem("bizkeep_token", next); localStorage.setItem("bizkeep_email", nextEmail); setToken(next); setEmail(nextEmail); }}/>;
    if (workspace.isPending)
        return <div className="loading"><span></span><p>Opening your records…</p></div>;
    if (workspace.isError || !data)
        return <main className="error-page"><h1>We couldn't open this workspace.</h1><p>{errText(workspace.error)}</p><button className="primary compact" onClick={() => { localStorage.removeItem("bizkeep_token"); localStorage.removeItem("bizkeep_email"); setToken(""); }}>Return to sign in</button></main>;
    return <div className="app-shell"><SafeAreaTopScrim backgroundColor="var(--bg)"/><header className="mobile-brand"><BrandMark/><strong>kovala</strong><span>Private workspace</span></header><div className="desktop-rail"><p className="rail-brand"><BrandMark/>kovala</p><p className="rail-caption">Workspace</p><p className="rail-email">{email}</p>{(["overview", "entities", "documents", "calendar", "minutes", "billing"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => goTab(t)}><Icon name={t}/><span>{t === "overview" ? "Overview" : t === "calendar" ? "Deadlines" : t[0]?.toUpperCase() + t.slice(1)}</span></button>)}<button className="signout" onClick={() => { localStorage.clear(); setToken(""); }}>Sign out</button></div><main className="content">{tab === "overview" && <Overview data={data} token={token} open={openModal} onViewEntity={viewEntity} onGoTab={goTab}/>}{tab === "entities" && <Entities data={data} token={token} open={openModal} onEdit={(entity, focus) => setEntityEdit({ entity, focus })} selectedId={selectedEntityId} onSelect={setSelectedEntityId} onUploadDoc={openDocUpload}/>}{tab === "documents" && <Documents data={data} open={openModal}/>}{tab === "calendar" && <Calendar data={data} token={token} open={openModal}/>}{tab === "minutes" && <Minutes data={data} open={openModal}/>}{tab === "billing" && <Billing token={token}/>}</main><nav className="bottom-nav" aria-label="Main navigation">{(["overview", "entities", "documents", "calendar", "minutes", "billing"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => goTab(t)} aria-label={t === "calendar" ? "Deadlines" : t}><Icon name={t}/><span>{t === "overview" ? "Home" : t === "calendar" ? "Deadlines" : t === "documents" ? "Files" : t === "billing" ? "Billing" : t}</span></button>)}</nav>{modal && <Sheet title={modal === "entity" ? "Add business" : modal === "reminder" ? "Add reminder" : modal === "document" ? "Upload document" : "Record meeting minutes"} onClose={closeModal}>{modalBody}</Sheet>}{entityEdit && <Sheet title="Edit business" onClose={() => setEntityEdit(null)}><EntityForm token={token} entity={entityEdit.entity} focusField={entityEdit.focus} onDone={() => setEntityEdit(null)}/></Sheet>}</div>;
}
