import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./safe-area";
import { api, type ApiResponse } from "./api";
type Workspace = ApiResponse<typeof api, "getWorkspace">;
type Entity = Workspace["entities"][number];
type Reminder = Workspace["reminders"][number];
type Tab = "overview" | "entities" | "documents" | "calendar" | "minutes" | "billing";
type Modal = "entity" | "reminder" | "document" | "meeting" | null;
const STATES = ["WY", "FL", "GA", "TX", "CA", "AL", "AK", "AZ", "AR", "CO", "CT", "DC", "DE", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "UT", "VA", "VT", "WA", "WI", "WV"];
const CATEGORIES = ["Formation", "Operating Agreement/Bylaws", "Meeting Minutes", "Contracts", "Tax Filings", "Licenses"] as const;
const todayKey = () => new Date().toLocaleDateString("en-CA");
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const daysUntil = (value: string) => Math.ceil((new Date(`${value}T12:00:00`).getTime() - new Date(`${todayKey()}T12:00:00`).getTime()) / 86400000);
const relativeDue = (value: string) => { const d = daysUntil(value); return d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "Due today" : `Due in ${d}d`; };
const errText = (value: unknown) => value instanceof Error ? value.message : "Something went wrong. Please try again.";
function Icon({ name }: {
    name: Tab | "plus" | "close" | "check" | "upload" | "lock";
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
    };
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { return <label className="field"><span>{label}</span>{children}</label>; }
function Empty({ title, body, action }: {
    title: string;
    body: string;
    action?: ReactNode;
}) { return <div className="empty"><span className="empty-mark">◇</span><h3>{title}</h3><p>{body}</p>{action}</div>; }
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
    const [mode, setMode] = useState<"signin" | "signup">("signup");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: () => mode === "signup" ? api.signUp({ email, password }) : api.signIn({ email, password }), onSuccess: (data) => onAuth(data.token, data.email), onError: (e) => setError(errText(e)) });
    return <main className="auth-wrap"><SafeAreaTopScrim backgroundColor="var(--bg)"/><section className="auth-panel"><header className="auth-brand" aria-label="kovala"><img src="/logo.png" alt="kovala" className="brand-logo" /></header><h1>Keep the back office in order.</h1><p className="auth-copy">Deadlines, documents, and decisions—organized around each business you run.</p><form onSubmit={(e) => { e.preventDefault(); setError(""); mutation.mutate(); }}>
    <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required/></Field>
    <Field label="Password"><input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "signup" ? 8 : 1} required/></Field>
    {mode === "signup" && <p className="field-note">Use at least 8 characters.</p>}{error && <p className="error-note" role="alert">{error}</p>}
    <PrimaryButton busy={mutation.isPending}>{mode === "signup" ? "Create workspace" : "Sign in"}</PrimaryButton>
  </form><button className="text-button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}>{mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}</button></section></main>;
}
function EntityForm({ token, onDone }: {
    token: string;
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: (form: FormData) => api.addEntity({ token, name: String(form.get("name")), entity_type: String(form.get("type")) as "LLC" | "Corporation" | "DBA", state: String(form.get("state")), formation_date: String(form.get("formation")), ein: String(form.get("ein") || ""), registered_agent: String(form.get("agent") || ""), agent_renewal_date: String(form.get("renewal") || "") }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["workspace"] }); onDone(); }, onError: (e) => setError(errText(e)) });
    return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)); }}><Field label="Business name"><input name="name" required autoFocus/></Field><div className="two-col"><Field label="Entity type"><select name="type"><option>LLC</option><option>Corporation</option><option>DBA</option></select></Field><Field label="Formation state"><select name="state" defaultValue="WY">{STATES.map((s) => <option key={s}>{s}</option>)}</select></Field></div><Field label="Formation date"><input name="formation" type="date" required/></Field><Field label="EIN"><input name="ein" inputMode="numeric" placeholder="Optional — displayed masked"/></Field><Field label="Registered agent"><input name="agent" placeholder="Name or service"/></Field><Field label="Registered agent renewal"><input name="renewal" type="date"/></Field><p className="form-callout">Wyoming, Florida, Georgia, Texas, and California LLC records receive a source-linked filing reminder. Always verify legal deadlines.</p>{error && <p className="error-note">{error}</p>}<PrimaryButton busy={mutation.isPending}>Add business</PrimaryButton></form>;
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
function DocumentForm({ token, entities, onDone }: {
    token: string;
    entities: Entity[];
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState("");
    const mutation = useMutation({ mutationFn: async (form: FormData) => { if (!file)
            throw new Error("Choose a file to upload."); if (file.size > 10000000)
            throw new Error("Choose a file smaller than 10 MB."); const dataBase64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] ?? ""); r.onerror = () => reject(new Error("Could not read that file.")); r.readAsDataURL(file); }); return api.addDocument({ token, entity_id: Number(form.get("entity")), filename: file.name, category: String(form.get("category")) as typeof CATEGORIES[number], mime_type: file.type || "application/octet-stream", data_base64: dataBase64 }); }, onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["workspace"] }); onDone(); }, onError: (e) => setError(errText(e)) });
    return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mutation.mutate(new FormData(e.currentTarget)); }}><Field label="Business"><select name="entity" required>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><Field label="Category"><select name="category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field><label className="file-drop"><Icon name="upload"/><span>{file ? file.name : "Choose a document"}</span><small>PDF, image, or office file · up to 10 MB</small><input aria-label="Choose document file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></label>{error && <p className="error-note">{error}</p>}<PrimaryButton busy={mutation.isPending}>Upload document</PrimaryButton></form>;
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
function Overview({ data, token, open }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
}) {
    const openReminders = data.reminders.filter((r) => r.status === "open");
    const overdue = openReminders.filter((r) => daysUntil(r.due_date) < 0);
    const next90 = openReminders.filter((r) => daysUntil(r.due_date) >= 0 && daysUntil(r.due_date) <= 90);
    const next = openReminders[0];
    return <div className="page"><header className="page-head"><div><p className="eyebrow">Your back office</p><h1>Good morning.</h1></div><button className="round-add" aria-label="Add reminder" onClick={() => open("reminder")}><Icon name="plus"/></button></header>{next ? <section className={`focus-deadline ${daysUntil(next.due_date) < 0 ? "is-overdue" : ""}`}><p>{daysUntil(next.due_date) < 0 ? "Needs attention" : "Next deadline"}</p><div className="focus-date"><strong>{new Date(`${next.due_date}T12:00:00`).getDate()}</strong><span>{new Date(`${next.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</span></div><div><h2>{next.title}</h2><p>{next.entity_name ?? "General"} · {relativeDue(next.due_date)}</p></div></section> : <section className="focus-clear"><span>All clear</span><h2>No open deadlines yet.</h2><button className="secondary" onClick={() => open("reminder")}>Add a reminder</button></section>}
    <section className="pulse"><div><strong>{data.entities.length}</strong><span>Businesses</span></div><div><strong>{next90.length}</strong><span>Next 90 days</span></div><div className={overdue.length ? "danger" : ""}><strong>{overdue.length}</strong><span>Overdue</span></div></section>
    <section className="section"><div className="section-head"><h2>Coming up</h2><button onClick={() => open("reminder")}>Add</button></div>{openReminders.length ? <div className="deadline-list">{openReminders.slice(0, 4).map((r) => <ReminderItem key={r.id} reminder={r} token={token}/>)}</div> : <p className="quiet">Your open reminders will appear here.</p>}</section>
    <section className="section"><div className="section-head"><h2>Recent documents</h2><button onClick={() => open("document")} disabled={!data.entities.length}>Upload</button></div>{data.documents.length ? <div className="doc-list">{data.documents.slice(0, 3).map((d) => <a className="doc-row" key={d.id} href={d.download_url} target="_blank" rel="noreferrer"><span className="file-stamp">{d.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span><span><strong>{d.filename}</strong><small>{d.entity_name} · {d.category}</small></span><time>{new Date(d.uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></a>)}</div> : <p className="quiet">Documents you upload will stay organized by business.</p>}</section>
  </div>;
}
function Entities({ data, open }: {
    data: Workspace;
    open: (m: Modal) => void;
}) { return <div className="page"><header className="page-head"><div><p className="eyebrow">Ownership map</p><h1>Businesses</h1></div><button className="round-add" aria-label="Add business" onClick={() => open("entity")}><Icon name="plus"/></button></header>{data.entities.length ? <div className="entity-list">{data.entities.map((e) => <article className="entity-card" key={e.id}><div className="entity-monogram">{e.name.slice(0, 2).toUpperCase()}</div><div className="entity-title"><h2>{e.name}</h2><p>{e.entity_type} · {e.state}</p></div><dl><div><dt>Formed</dt><dd>{dateLabel(e.formation_date)}</dd></div><div><dt>EIN</dt><dd>{e.ein_masked ?? "Not added"}</dd></div><div><dt>Registered agent</dt><dd>{e.registered_agent ?? "Not added"}</dd></div><div><dt>Renewal</dt><dd>{e.agent_renewal_date ? dateLabel(e.agent_renewal_date) : "Not set"}</dd></div></dl></article>)}</div> : <Empty title="Add your first business" body="Keep each entity's deadlines, files, and minutes in one place." action={<button className="primary compact" onClick={() => open("entity")}>Add business</button>}/>}</div>; }
function Documents({ data, open }: {
    data: Workspace;
    open: (m: Modal) => void;
}) { const [search, setSearch] = useState(""); const filtered = data.documents.filter((d) => `${d.filename} ${d.entity_name} ${d.category}`.toLowerCase().includes(search.toLowerCase())); return <div className="page"><header className="page-head"><div><p className="eyebrow">Secure filing cabinet</p><h1>Documents</h1></div><button className="round-add" aria-label="Upload document" disabled={!data.entities.length} onClick={() => open("document")}><Icon name="plus"/></button></header><label className="search"><span className="sr-only">Search documents</span><input aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files, categories, businesses"/></label>{filtered.length ? <div className="doc-list spacious">{filtered.map((d) => <a className="doc-row" key={d.id} href={d.download_url} target="_blank" rel="noreferrer"><span className="file-stamp">{d.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span><span><strong>{d.filename}</strong><small>{d.entity_name}</small><em>{d.category}</em></span><time>{new Date(d.uploaded_at).toLocaleDateString()}</time></a>)}</div> : <Empty title={search ? "No matching documents" : "The filing cabinet is ready"} body={data.entities.length ? "Upload formation records, agreements, minutes, contracts, tax filings, and licenses." : "Add a business first, then attach its records."} action={data.entities.length && !search ? <button className="primary compact" onClick={() => open("document")}>Upload document</button> : undefined}/>}</div>; }
function Calendar({ data, token, open }: {
    data: Workspace;
    token: string;
    open: (m: Modal) => void;
}) { const [window, setWindow] = useState<"30" | "60" | "90" | "all">("90"); const filtered = data.reminders.filter((r) => window === "all" || daysUntil(r.due_date) <= Number(window)); return <div className="page"><header className="page-head"><div><p className="eyebrow">Compliance calendar</p><h1>Deadlines</h1></div><button className="round-add" aria-label="Add custom reminder" onClick={() => open("reminder")}><Icon name="plus"/></button></header><div className="segmented" role="group" aria-label="Deadline window">{(["30", "60", "90", "all"] as const).map((v) => <button key={v} className={window === v ? "active" : ""} onClick={() => setWindow(v)}>{v === "all" ? "All" : `${v} days`}</button>)}</div>{filtered.length ? <div className="deadline-list roomy">{filtered.map((r) => <ReminderItem key={r.id} reminder={r} token={token}/>)}</div> : <Empty title="No deadlines in this window" body="Try a wider range or add a custom reminder." action={<button className="primary compact" onClick={() => open("reminder")}>Add reminder</button>}/>}<aside className="notice"><strong>In-app reminders only</strong><p>Email and SMS delivery can connect here in a later release. For now, deadlines appear whenever you open this workspace.</p></aside></div>; }
function Minutes({ data, open }: {
    data: Workspace;
    open: (m: Modal) => void;
}) { const [expanded, setExpanded] = useState<number | null>(null); return <div className="page"><header className="page-head"><div><p className="eyebrow">Corporate record</p><h1>Meeting minutes</h1></div><button className="round-add" aria-label="Record meeting minutes" disabled={!data.entities.length} onClick={() => open("meeting")}><Icon name="plus"/></button></header>{data.meetings.length ? <div className="minutes-list">{data.meetings.map((m) => <article className="minutes-card" key={m.id}><button className="minutes-summary" onClick={() => setExpanded(expanded === m.id ? null : m.id)} aria-expanded={expanded === m.id}><span className="date-block"><strong>{new Date(`${m.meeting_date}T12:00:00`).getDate()}</strong><small>{new Date(`${m.meeting_date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</small></span><span><strong>{m.entity_name}</strong><small>{m.meeting_type} · {m.meeting_time} {m.timezone}</small></span><b>{expanded === m.id ? "−" : "+"}</b></button>{expanded === m.id && <div className="minutes-detail"><p><b>Location</b>{m.location || "Not recorded"}</p><p><b>Attendees</b>{m.attendees.map((a) => `${a.name} (${a.role})`).join(", ")}</p><div><b>Agenda</b><ul>{m.agenda_items.map((a, i) => <li key={i}>{a}</li>)}</ul></div><p><b>Discussion</b>{m.discussion_summary}</p>{m.decisions.length > 0 && <div><b>Decisions</b><ul>{m.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}{m.action_items.length > 0 && <div><b>Action items</b><div className="mini-table">{m.action_items.map((a, i) => <div key={i}><strong>{a.action}</strong><span>{a.owner}</span><time>{dateLabel(a.due_date)}</time><em>{a.status}</em></div>)}</div></div>}<p><b>Recorded by</b>{m.recorded_by}</p>{m.next_meeting_date && <p><b>Next meeting</b>{dateLabel(m.next_meeting_date)}</p>}</div>}</article>)}</div> : <Empty title="No minutes recorded" body={data.entities.length ? "Create a durable record of meetings, decisions, and assigned work." : "Add a business first, then record its meetings."} action={data.entities.length ? <button className="primary compact" onClick={() => open("meeting")}>Record minutes</button> : undefined}/>}</div>; }
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
    const label = status === "active" ? "Active" : status === "past_due" ? "Payment issue — update your card" : status === "canceled" ? "Canceled" : "No subscription yet";
    const subscribed = status === "active" || status === "past_due";
    return <div className="page"><header className="page-head"><div><p className="eyebrow">Billing</p><h1>kovala plan</h1><p>$199.88/year, billed annually. Cancel anytime.</p></div></header><section className="section"><div className="section-head"><h2>Subscription</h2></div>{statusQuery.isPending ? <p className="quiet">Loading…</p> : statusQuery.isError ? <p className="error-note">Could not load billing status.</p> : <p><strong>{label}</strong>{status === "active" && periodEnd ? ` · renews ${dateLabel(periodEnd.slice(0, 10))}` : null}</p>}{notice && <p className="error-note" role="alert">{notice}</p>}{subscribed ? <button className="primary compact" disabled={portal.isPending} onClick={() => portal.mutate()}>{portal.isPending ? "Working…" : "Manage billing"}</button> : <button className="primary compact" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? "Working…" : "Subscribe — $199.88/yr"}</button>}<p className="field-note billing-note">Checkout is secured by Stripe. Your card is charged $199.88 immediately, then once a year.</p></section></div>;
}
export function App() {
    const [token, setToken] = useState(() => localStorage.getItem("bizkeep_token") ?? "");
    const [email, setEmail] = useState(() => localStorage.getItem("bizkeep_email") ?? "");
    const [tab, setTab] = useState<Tab>("overview");
    const [modal, setModal] = useState<Modal>(null);
    const workspace = useQuery({ queryKey: ["workspace", token], queryFn: () => api.getWorkspace({ token }), enabled: Boolean(token), retry: false });
    const data = workspace.data;
    const modalBody = useMemo(() => { if (!modal || !data)
        return null; const done = () => setModal(null); if (modal === "entity")
        return <EntityForm token={token} onDone={done}/>; if (modal === "reminder")
        return <ReminderForm token={token} entities={data.entities} onDone={done}/>; if (modal === "document")
        return <DocumentForm token={token} entities={data.entities} onDone={done}/>; return <MeetingForm token={token} entities={data.entities} onDone={done}/>; }, [modal, data, token]);
    if (!token)
        return <Auth onAuth={(next, nextEmail) => { localStorage.setItem("bizkeep_token", next); localStorage.setItem("bizkeep_email", nextEmail); setToken(next); setEmail(nextEmail); }}/>;
    if (workspace.isPending)
        return <div className="loading"><span></span><p>Opening your records…</p></div>;
    if (workspace.isError || !data)
        return <main className="error-page"><h1>We couldn't open this workspace.</h1><p>{errText(workspace.error)}</p><button className="primary compact" onClick={() => { localStorage.removeItem("bizkeep_token"); localStorage.removeItem("bizkeep_email"); setToken(""); }}>Return to sign in</button></main>;
    return <div className="app-shell"><SafeAreaTopScrim backgroundColor="var(--bg)"/><header className="mobile-brand"><img src="/logo-mark.png" alt="" aria-hidden="true" className="brand-mark" /><strong>kovala</strong><span>Private workspace</span></header><div className="desktop-rail"><p className="rail-brand"><img src="/logo-mark.png" alt="" aria-hidden="true" className="brand-mark" />kovala</p><p className="rail-caption">Workspace</p><p className="rail-email">{email}</p>{(["overview", "entities", "documents", "calendar", "minutes", "billing"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}><Icon name={t}/><span>{t === "overview" ? "Overview" : t === "calendar" ? "Deadlines" : t[0]?.toUpperCase() + t.slice(1)}</span></button>)}<button className="signout" onClick={() => { localStorage.clear(); setToken(""); }}>Sign out</button></div><main className="content">{tab === "overview" && <Overview data={data} token={token} open={setModal}/>}{tab === "entities" && <Entities data={data} open={setModal}/>}{tab === "documents" && <Documents data={data} open={setModal}/>}{tab === "calendar" && <Calendar data={data} token={token} open={setModal}/>}{tab === "minutes" && <Minutes data={data} open={setModal}/>}{tab === "billing" && <Billing token={token}/>}</main><nav className="bottom-nav" aria-label="Main navigation">{(["overview", "entities", "documents", "calendar", "minutes", "billing"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)} aria-label={t === "calendar" ? "Deadlines" : t}><Icon name={t}/><span>{t === "overview" ? "Home" : t === "calendar" ? "Deadlines" : t === "documents" ? "Files" : t === "billing" ? "Billing" : t}</span></button>)}</nav>{modal && <Sheet title={modal === "entity" ? "Add business" : modal === "reminder" ? "Add reminder" : modal === "document" ? "Upload document" : "Record meeting minutes"} onClose={() => setModal(null)}>{modalBody}</Sheet>}</div>;
}
