import { SafeAreaTopScrim, fileToBase64 } from "./client-helpers";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type ApiResponse } from "./api";

type Platform = "facebook" | "instagram" | "tiktok" | "youtube" | "x";
type Page = "dashboard" | "post" | "accounts" | "settings";
type Account = ApiResponse<typeof api, "getWorkspace">["accounts"][number];
type Post = ApiResponse<typeof api, "getWorkspace">["posts"][number];
type PlatformSetting = ApiResponse<typeof api, "listPlatformSettings">["platforms"][number];

const PLATFORM_ORDER: Platform[] = ["facebook", "instagram", "tiktok", "youtube", "x"];
const PLATFORM_META: Record<Platform, { label: string; mark: string; className: string }> = {
  facebook: { label: "Facebook", mark: "f", className: "platform-facebook" },
  instagram: { label: "Instagram", mark: "◎", className: "platform-instagram" },
  tiktok: { label: "TikTok", mark: "♪", className: "platform-tiktok" },
  youtube: { label: "YouTube", mark: "▶", className: "platform-youtube" },
  x: { label: "X", mark: "X", className: "platform-x" },
};

const NAV: Array<{ id: Page; label: string; glyph: string }> = [
  { id: "dashboard", label: "Overview", glyph: "▦" },
  { id: "post", label: "Post", glyph: "+" },
  { id: "accounts", label: "Accounts", glyph: "◉" },
  { id: "settings", label: "Settings", glyph: "⌁" },
];

/** Server-wide demo mode (DEMO_MODE env). Default false: demo UI chrome is hidden. */
function useServerDemoMode(): boolean {
  const config = useQuery({ queryKey: ["public-config"], queryFn: () => api.getPublicConfig({}), staleTime: 60000 });
  return config.data?.demoMode ?? false;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function PlatformBadge({ platform, small = false }: { platform: Platform; small?: boolean }) {
  const meta = PLATFORM_META[platform];
  return <span className={`platform-badge ${meta.className} ${small ? "is-small" : ""}`} aria-label={meta.label}>{meta.mark}</span>;
}

function StatusPill({ status }: { status: string }) {
  const normalized = status === "connected" || status === "published" ? "good" : status === "pending" ? "wait" : status === "cancelled" ? "muted" : "bad";
  return <span className={`status-pill status-${normalized}`}><i />{status.replace("_", " ")}</span>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-signal">···</div><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const demoMode = useServerDemoMode();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [message, setMessage] = useState("");
  const demo = useMutation({ mutationFn: () => api.createDemoSession({}) });
  const signup = useMutation({ mutationFn: (payload: { email: string; displayName: string; password: string }) => api.signup(payload) });
  const login = useMutation({ mutationFn: (payload: { email: string; password: string }) => api.login(payload) });

  const finish = (result: Awaited<ReturnType<typeof api.createDemoSession>>) => {
    setMessage(result.message);
    if (result.ok && result.sessionToken) onAuthenticated(result.sessionToken);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "signup") {
      finish(await signup.mutateAsync({
        email: String(form.get("email") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        password: String(form.get("password") ?? ""),
      }));
    } else {
      finish(await login.mutateAsync({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") }));
    }
  };

  const busy = demo.isPending || signup.isPending || login.isPending;
  return (
    <div className="auth-shell">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="auth-layout">
        <section className="auth-intro">
          <div className="auth-brand" aria-label="zepostia"><img src="/logo-mark.png" alt="" aria-hidden="true" className="brand-mark-lg" /><strong>zepostia</strong></div>
          <div className="signal-line"><span>5 channels</span><span>1 queue</span><span>0 password sharing</span></div>
          <h1>One post.<br /><em>Every signal.</em></h1>
          <p>Connect your channels through official OAuth, prepare each platform from one composer, and keep every publish state visible.</p>
          <div className="network-row" aria-label="Supported platforms">
            {PLATFORM_ORDER.map((platform) => <PlatformBadge key={platform} platform={platform} />)}
          </div>
        </section>

        <section className="auth-panel" aria-label="zepostia account access">
          {demoMode && <div className="demo-ribbon">DEMO / TEST MODE</div>}
          <div className="auth-tabs" role="tablist" aria-label="Account access mode">
            <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} role="tab" aria-selected={mode === "signup"}>Create account</button>
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} role="tab" aria-selected={mode === "login"}>Sign in</button>
          </div>
          <form onSubmit={submit}>
            {mode === "signup" && <label>Display name<input name="displayName" autoComplete="name" required minLength={2} placeholder="Your name" /></label>}
            <label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@proton.me" /></label>
            <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : 1} placeholder="At least 8 characters" /></label>
            <button className="primary-button wide" type="submit" disabled={busy}>{busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}</button>
          </form>
          {message && <p className="form-message" role="status">{message}</p>}
          {demoMode && <><div className="or-rule"><span>or</span></div>
          <button className="secondary-button wide" disabled={busy} onClick={async () => finish(await demo.mutateAsync())}>Enter a fresh demo workspace</button></>}
          <p className="auth-note">App sign-in uses email and password from any provider. Google is only involved if you later connect YouTube.</p>
        </section>
      </main>
    </div>
  );
}

function Dashboard({ accounts, posts, go }: { accounts: Account[]; posts: Post[]; go: (page: Page) => void }) {
  const demoMode = useServerDemoMode();
  const connected = accounts.filter((account) => account.status === "connected" && (demoMode || account.authMode === "oauth")).length;
  const pending = posts.filter((post) => post.status === "pending").length;
  const needsAttention = accounts.filter((account) => account.status !== "connected");
  return <div className="page-stack">
    <section className="command-hero">
      <div><span className="section-code">CONTROL ROOM</span><h1>{connected === 0 ? "Connect your first channel" : `${connected} channels standing by`}</h1><p>{connected === 0 ? (demoMode ? "Official OAuth only. Demo connections let you test the flow without contacting a platform." : "Official OAuth only. Connect your channels to start publishing.") : "Compose once, review each format, then send now or place it in the queue."}</p></div>
      <button className="primary-button" onClick={() => go(connected === 0 ? "accounts" : "post")}>{connected === 0 ? "Connect channels" : "Create post"}</button>
    </section>

    {needsAttention.length > 0 && <section className="attention-band"><strong>{needsAttention.length} account{needsAttention.length === 1 ? "" : "s"} need attention</strong><span>Reconnect before publishing. The app will not fail silently.</span><button onClick={() => go("accounts")}>Review</button></section>}

    <section className="metric-strip" aria-label="Workspace summary">
      <div><strong>{connected}<small>/ 5</small></strong><span>connected</span></div>
      <div><strong>{pending}</strong><span>queued</span></div>
      <div><strong>{posts.filter((post) => post.status === "published").length}</strong><span>published</span></div>
    </section>

    <section className="content-section">
      <div className="section-heading"><div><span className="section-code">LATEST RUNS</span><h2>Recent posts</h2></div><button className="text-button" onClick={() => go("post")}>Open posts</button></div>
      {posts.length === 0 ? <EmptyState title="No posts yet" body={demoMode ? "Your first demo publish or scheduled post will appear here." : "Your first publish or scheduled post will appear here."} action={<button className="secondary-button" onClick={() => go("post")}>Open composer</button>} /> : <PostList posts={posts.slice(0, 5)} />}
    </section>
  </div>;
}

function PostList({ posts, onCancel, onCancelBump, onAdvanceBump, cancelling }: { posts: Post[]; onCancel?: (id: number) => void; onCancelBump?: (id: number) => void; onAdvanceBump?: (id: number) => void; cancelling?: boolean }) {
  const demoMode = useServerDemoMode();
  return <div className="post-list">{posts.map((post) => <article className="post-row" key={post.id}>
    <div className="post-topline"><StatusPill status={post.status} /><time>{post.publishMode === "scheduled" ? formatDate(post.scheduledAt) : formatDate(post.createdAt)}</time></div>
    {post.youtubeTitle && <h3>{post.youtubeTitle}</h3>}
    <p>{post.body || <span className="dim-text">Media-only post</span>}</p>
    {post.mediaName && <div className="media-chip">▧ {post.mediaName}</div>}
    <div className="target-row">{post.targets.map((target, index) => <span key={`${post.id}-${target.platform}-${index}`} title={`${PLATFORM_META[target.platform].label}: ${target.status}`}><PlatformBadge platform={target.platform} small /><i className={`target-dot target-${target.status}`} /></span>)}</div>
    {post.bumpComments.length > 0 && <details className="bump-plan">
      <summary><span><i className={post.bumpEnabled ? "pulse-dot" : ""} />24-hour bump plan</span><strong>{post.bumpComments.filter((comment) => comment.status === "published").length}/{post.bumpComments.length} sent</strong></summary>
      <ol>{post.bumpComments.map((comment) => <li key={comment.id} className={`bump-${comment.status}`}><span>{comment.status === "published" ? "Sent" : comment.status === "cancelled" ? "Stopped" : formatDate(comment.scheduledAt)}</span><p>{comment.body}</p></li>)}</ol>
      {post.bumpEnabled && post.bumpComments.some((comment) => comment.status === "pending") && <div className="bump-actions">
        {onAdvanceBump && <button className="secondary-button" disabled={cancelling} onClick={() => onAdvanceBump(post.id)}>{demoMode ? "Run next demo comment" : "Run next comment"}</button>}
        {onCancelBump && <button className="danger-text" disabled={cancelling} onClick={() => onCancelBump(post.id)}>Stop remaining comments</button>}
      </div>}
    </details>}
    {post.status === "pending" && onCancel && <button className="danger-text" disabled={cancelling} onClick={() => onCancel(post.id)}>Cancel scheduled post</button>}
  </article>)}</div>;
}

function Composer({ accounts, token, onDone, goAccounts }: { accounts: Account[]; token: string; onDone: (message: string) => void; goAccounts: () => void }) {
  const demoMode = useServerDemoMode();
  const queryClient = useQueryClient();
  const connected = accounts.filter((account) => account.status === "connected" && (demoMode || account.authMode === "oauth"));
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [preview, setPreview] = useState<Platform>(connected[0]?.platform ?? "facebook");
  const [message, setMessage] = useState("");
  const [bumpEnabled, setBumpEnabled] = useState(false);
  const [bumpComments, setBumpComments] = useState(["", "", "", ""]);
  const objectUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  const selectedAccounts = connected.filter((account) => selected.includes(account.id));
  const selectedPlatforms = selectedAccounts.map((account) => account.platform);
  const requirements = [
    selectedPlatforms.includes("x") && body.length > 280 ? `X is ${body.length - 280} characters over its limit.` : null,
    (selectedPlatforms.includes("instagram") || selectedPlatforms.includes("tiktok")) && !file ? "Instagram and TikTok require media." : null,
    selectedPlatforms.includes("youtube") && (!file?.type.startsWith("video/") || !title.trim()) ? "YouTube requires a video and title." : null,
    mode === "scheduled" && !scheduledAt ? "Choose a date and time." : null,
    bumpEnabled && bumpComments.some((comment) => !comment.trim()) ? "Write all four follow-up comments, or turn off the 24-hour bump plan." : null,
  ].filter(Boolean) as string[];

  const publish = useMutation({
    mutationFn: async () => {
      const encoded = file ? await fileToBase64(file) : null;
      return api.createPost({
        sessionToken: token,
        body,
        youtubeTitle: title || undefined,
        accountIds: selected,
        publishMode: mode,
        scheduledAt: mode === "scheduled" && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        bumpComments: bumpEnabled ? bumpComments.map((comment) => comment.trim()) : undefined,
        media: encoded && file ? { name: file.name, mimeType: encoded.mimeType, dataBase64: encoded.dataBase64 } : undefined,
      });
    },
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.ok) {
        setBody(""); setTitle(""); setSelected([]); setFile(null); setScheduledAt(""); setMode("now"); setBumpEnabled(false); setBumpComments(["", "", "", ""]);
        await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
        onDone(result.message);
      }
    },
  });

  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <div className="page-stack composer-page">
    <div className="page-heading"><span className="section-code">MASTER COMPOSER</span><h1>Build once. Check every cut.</h1><p>One source post, with platform rules enforced before it enters the queue.</p></div>
    {connected.length === 0 ? <EmptyState title="No channels connected" body={demoMode ? "Run a demo OAuth connection first. No platform passwords are ever requested." : "Connect a channel first. No platform passwords are ever requested."} action={<button className="primary-button" onClick={goAccounts}>Connect a channel</button>} /> : <>
      <section className="composer-grid">
        <div className="composer-card">
        <div className="compose-form">
          <label className="field-label">Post text <span className={body.length > 280 && selectedPlatforms.includes("x") ? "limit-bad" : ""}>{body.length}{selectedPlatforms.includes("x") ? "/280 for X" : " characters"}</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} placeholder="What do you want to publish?" />
          </label>
          {selectedPlatforms.includes("youtube") && <label className="field-label">YouTube title <span>{title.length}/100</span><input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Required for YouTube" /></label>}
          <label className="upload-zone">Media
            <input aria-label="Upload image or video" type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <span>{file ? file.name : "Choose image or video · max 12 MB"}</span>
          </label>
          <fieldset className="target-fieldset"><legend>Publish to</legend><div className="target-options">{connected.map((account) => <label key={account.id} className={selected.includes(account.id) ? "target-option active" : "target-option"}>
            <input type="checkbox" checked={selected.includes(account.id)} onChange={() => toggle(account.id)} />
            <PlatformBadge platform={account.platform} /><span><strong>{PLATFORM_META[account.platform].label}</strong><small>{account.handle}</small></span>
          </label>)}</div></fieldset>
          <div className="timing-switch" role="group" aria-label="Publishing time"><button className={mode === "now" ? "active" : ""} onClick={() => setMode("now")}>Post now</button><button className={mode === "scheduled" ? "active" : ""} onClick={() => setMode("scheduled")}>Schedule</button></div>
          {mode === "scheduled" && <label className="field-label">Publish date and time<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>}
          <section className={bumpEnabled ? "bump-builder is-active" : "bump-builder"}>
            <label className="bump-toggle">
              <span><strong>Keep this post moving for 24 hours</strong><small>Stagger four comments at +1h, +6h, +12h, and +23h.</small></span>
              <input type="checkbox" checked={bumpEnabled} onChange={(event) => setBumpEnabled(event.target.checked)} aria-label="Enable 24-hour comment bump plan" />
            </label>
            {bumpEnabled && <div className="bump-fields">
              {bumpComments.map((comment, index) => {
                const hour = [1, 6, 12, 23][index] ?? 23;
                return <label key={hour}>Comment {index + 1} <span>+{hour}h</span><textarea rows={2} maxLength={500} value={comment} onChange={(event) => setBumpComments((current) => current.map((value, commentIndex) => commentIndex === index ? event.target.value : value))} placeholder={index === 0 ? "Start the conversation…" : "Add a fresh angle…"} /></label>;
              })}
              <p>Times run from the original publish time. Each comment is saved separately so the remaining sequence can be stopped without removing the post.</p>
            </div>}
          </section>
          {requirements.length > 0 && <div className="requirements" role="status">{requirements.map((item) => <p key={item}>{item}</p>)}</div>}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary-button wide" disabled={publish.isPending || selected.length === 0 || requirements.length > 0} onClick={() => publish.mutate()}>{publish.isPending ? "Preparing…" : mode === "now" ? `Publish to ${selected.length || 0}` : `Add ${selected.length || 0} to queue`}</button>
          {demoMode ? <p className="demo-action-note">Demo mode simulates the final official API response and never contacts an external account.</p> : <p className="demo-action-note">Publishing activates once your platform credentials are connected in Settings.</p>}
        </div>
        </div>

        <aside className="preview-panel">
          <div className="preview-tabs" role="tablist" aria-label="Platform preview">{PLATFORM_ORDER.filter((platform) => connected.some((account) => account.platform === platform)).map((platform) => <button key={platform} className={preview === platform ? "active" : ""} onClick={() => setPreview(platform)} role="tab" aria-selected={preview === platform}><PlatformBadge platform={platform} small /></button>)}</div>
          <div className={`platform-preview preview-${preview}`}>
            <div className="preview-account"><PlatformBadge platform={preview} /><div><strong>{connected.find((account) => account.platform === preview)?.handle ?? PLATFORM_META[preview].label}</strong><small>Sponsored nowhere · {demoMode ? "demo preview" : "preview"}</small></div></div>
            {preview === "youtube" && <h3>{title || "Your video title"}</h3>}
            {file && objectUrl ? file.type.startsWith("video/") ? <video src={objectUrl} controls preload="metadata" /> : <img src={objectUrl} alt="Selected upload preview" /> : <div className="preview-media-empty">{preview === "instagram" || preview === "tiktok" || preview === "youtube" ? "Media required" : "Media preview"}</div>}
            <p>{preview === "x" ? body.slice(0, 280) : body || "Your post will appear here."}</p>
            <div className="preview-chrome"><span>♡</span><span>○</span><span>↗</span></div>
          </div>
        </aside>
      </section>
    </>}
  </div>;
}

function FacebookPagePicker({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const queryClient = useQueryClient();
  const pages = useQuery({ queryKey: ["fb-pages", token], queryFn: () => api.listFacebookPages({ sessionToken: token }) });
  const select = useMutation({
    mutationFn: (pageId: string) => api.selectFacebookPage({ sessionToken: token, pageId }),
    onSuccess: async (result) => {
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
      await queryClient.invalidateQueries({ queryKey: ["fb-pages", token] });
    },
  });
  if (!pages.data?.ok || (pages.data.pages?.length ?? 0) < 2) return null;
  return <label className="page-picker"><span>Posting as</span><select
    aria-label="Facebook Page"
    value={pages.data.selectedPageId ?? ""}
    disabled={select.isPending}
    onChange={(event) => select.mutate(event.target.value)}
  >{pages.data.pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>;
}

function InstagramAccountPicker({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["ig-accounts", token], queryFn: () => api.listInstagramAccounts({ sessionToken: token }) });
  const select = useMutation({
    mutationFn: (igUserId: string) => api.selectInstagramAccount({ sessionToken: token, igUserId }),
    onSuccess: async (result) => {
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
      await queryClient.invalidateQueries({ queryKey: ["ig-accounts", token] });
    },
  });
  if (!accounts.data?.ok || (accounts.data.accounts?.length ?? 0) < 2) return null;
  return <label className="page-picker"><span>Posting as</span><select
    aria-label="Instagram account"
    value={accounts.data.selectedIgUserId ?? ""}
    disabled={select.isPending}
    onChange={(event) => select.mutate(event.target.value)}
  >{accounts.data.accounts.map((account) => <option key={account.igUserId} value={account.igUserId}>@{account.username} · {account.pageName}</option>)}</select></label>;
}

function Accounts({ accounts, settings, token, onMessage }: { accounts: Account[]; settings: PlatformSetting[]; token: string; onMessage: (message: string) => void }) {
  const demoMode = useServerDemoMode();
  const queryClient = useQueryClient();
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null);
  const connect = useMutation({
    mutationFn: (platform: Platform) => api.connectDemoAccount({ sessionToken: token, platform }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
    onSettled: () => setBusyPlatform(null),
  });
  const connectFb = useMutation({
    mutationFn: () => api.connectFacebook({ sessionToken: token }),
    onSuccess: async (result) => {
      if (result.ok && result.mode === "oauth" && result.authUrl) {
        window.location.href = result.authUrl;
        return;
      }
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    },
    onSettled: () => setBusyPlatform(null),
  });
  const connectIg = useMutation({
    mutationFn: () => api.connectInstagram({ sessionToken: token }),
    onSuccess: async (result) => {
      if (result.ok && result.mode === "oauth" && result.authUrl) {
        window.location.href = result.authUrl;
        return;
      }
      onMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["workspace", token] });
    },
    onSettled: () => setBusyPlatform(null),
  });
  const disconnect = useMutation({
    mutationFn: (accountId: number) => api.disconnectAccount({ sessionToken: token, accountId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  return <div className="page-stack">
    <div className="page-heading"><span className="section-code">OFFICIAL OAUTH ONLY</span><h1>Connect channels without sharing passwords.</h1><p>{demoMode ? "Every connection is isolated per platform. In demo mode, the authorization step is simulated and no external service is contacted." : "Every connection is isolated per platform. Add your credentials in Settings to enable live connections."}</p></div>
    <div className="oauth-rule"><strong>What this app never does</strong><span>No browser automation · no credential stuffing · no platform password forms</span></div>
    <div className="connect-list">{PLATFORM_ORDER.map((platform) => {
      const meta = PLATFORM_META[platform];
      const setting = settings.find((item) => item.platform === platform);
      const account = accounts.find((item) => item.platform === platform && (demoMode || item.authMode === "oauth"));
      const needsReconnect = account && account.status !== "connected";
      const isFacebook = platform === "facebook";
      const isInstagram = platform === "instagram";
      const connectBusy = busyPlatform === platform;
      const startConnect = () => { setBusyPlatform(platform); if (isFacebook) connectFb.mutate(); else if (isInstagram) connectIg.mutate(); else connect.mutate(platform); };
      const connectLabel = connectBusy ? "Connecting…" : demoMode ? "Run demo OAuth" : "Connect";
      return <article className="connect-row" key={platform}>
        <div className="connect-main"><PlatformBadge platform={platform} /><div><h2>{meta.label}</h2><p>{setting?.warning ?? "Official OAuth connection."}</p></div></div>
        {account ? <div className="connect-state"><div><strong>{account.handle}</strong><StatusPill status={account.status} />{account.authMode === "oauth" && <span className="auth-mode-tag">live</span>}</div>{needsReconnect ? <button className="warning-button" onClick={startConnect}>Reconnect</button> : <button className="quiet-button" disabled={disconnect.isPending} onClick={() => disconnect.mutate(account.id)}>Disconnect</button>}</div> : <div className="connect-state"><span className="status-pill status-muted"><i />Not connected</span><button className="secondary-button" disabled={connect.isPending || connectFb.isPending || connectIg.isPending} onClick={startConnect}>{connectLabel}</button></div>}
        {isFacebook && account?.authMode === "oauth" && <FacebookPagePicker token={token} onMessage={onMessage} />}
        {isInstagram && account?.authMode === "oauth" && <InstagramAccountPicker token={token} onMessage={onMessage} />}
        <details><summary>If connecting fails</summary><p>{setting?.failureHint ?? "Review the platform setup in Settings and try again."}</p></details>
      </article>;
    })}</div>
  </div>;
}

function Queue({ posts, token, onMessage, embedded }: { posts: Post[]; token: string; onMessage: (message: string) => void; embedded?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending" | "published" | "failed">("all");
  const cancel = useMutation({
    mutationFn: (postId: number) => api.cancelPost({ sessionToken: token, postId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  const cancelBump = useMutation({
    mutationFn: (postId: number) => api.cancelBumpPlan({ sessionToken: token, postId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  const advanceBump = useMutation({
    mutationFn: (postId: number) => api.advanceBumpDemo({ sessionToken: token, postId }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["workspace", token] }); },
  });
  const filtered = filter === "all" ? posts : posts.filter((post) => post.status === filter);
  return <div className={embedded ? "queue-embedded" : "page-stack"}>
    {!embedded && <div className="page-heading"><span className="section-code">DELIVERY QUEUE</span><h1>Every post has a visible state.</h1><p>Pending items can be cancelled. Failures stay attached to the affected platform instead of disappearing into a generic error.</p></div>}
    {embedded && <div className="section-heading"><div><span className="section-code">SCHEDULE</span><h2>Queued and past posts</h2></div></div>}
    <div className="filter-row" role="group" aria-label="Filter posts">{(["all", "pending", "published", "failed"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {filtered.length === 0 ? <EmptyState title={filter === "all" ? "Queue is empty" : `No ${filter} posts`} body="Posts you publish or schedule will land here with per-platform status." /> : <PostList posts={filtered} onCancel={(id) => cancel.mutate(id)} onCancelBump={(id) => cancelBump.mutate(id)} onAdvanceBump={(id) => advanceBump.mutate(id)} cancelling={cancel.isPending || cancelBump.isPending || advanceBump.isPending} />}
  </div>;
}

function PostPage({ accounts, posts, token, onMessage, goAccounts }: { accounts: Account[]; posts: Post[]; token: string; onMessage: (message: string) => void; goAccounts: () => void }) {
  return <div className="page-stack post-page">
    <Composer accounts={accounts} token={token} onDone={onMessage} goAccounts={goAccounts} />
    <Queue posts={posts} token={token} onMessage={onMessage} embedded />
  </div>;
}

function MetaPlatformCard({ setting, isAdmin, metaConfigured, token, onMessage }: { setting: PlatformSetting; isAdmin: boolean; metaConfigured: boolean; token: string; onMessage: (message: string) => void }) {
  const test = useMutation({
    mutationFn: () => api.testMetaCredentials({ sessionToken: token }),
    onSuccess: (result) => onMessage(result.message),
  });
  const steps = setting.platform === "facebook"
    ? ["Hit Connect on the Accounts page.", "Log in with Facebook and approve zepostia.", "Choose the Pages you want zepostia to post to."]
    : ["Switch your Instagram to a professional account (creator or business) in the Instagram app.", "Link that Instagram account to one of your Facebook Pages (Page settings → Linked accounts).", "Then hit Connect on the Accounts page and approve zepostia."];
  return <details className="settings-card" open>
    <summary><span><PlatformBadge platform={setting.platform} /><strong>{setting.label}</strong></span><span>No setup needed</span></summary>
    <div className="settings-body">
      {setting.platform === "facebook" && <video className="setup-video" controls preload="metadata" src="/facebook-setup-tutorial.mp4"><p>Watch the step-by-step Facebook setup walkthrough.</p></video>}
      <div className="go-live-list">{steps.map((step, i) => <p key={i}><b>{i + 1}</b><span>{step}</span></p>)}</div>
      {isAdmin && <p className="secret-note">Owner Meta app: {metaConfigured ? "configured" : "not configured — set FACEBOOK_APP_ID and FACEBOOK_CLIENT_SECRET on the server"}.</p>}
      {isAdmin && setting.platform === "facebook" && <button className="secondary-button" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? "Testing…" : "Test Meta connection"}</button>}
      {!isAdmin && <p className="secret-note">Connect with {setting.label} on the Accounts page — no setup needed.</p>}
    </div>
  </details>;
}

function PlatformSettingsCard({ setting, token, onMessage, isAdmin, metaConfigured }: { setting: PlatformSetting; token: string; onMessage: (message: string) => void; isAdmin: boolean; metaConfigured: boolean }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(setting.clientId);
  const [clientSecret, setClientSecret] = useState("");
  useEffect(() => { setClientId(setting.clientId); }, [setting.clientId]);
  const save = useMutation({
    mutationFn: () => api.savePlatformConfig({ sessionToken: token, platform: setting.platform, clientId, secretReference: "", clientSecret }),
    onSuccess: async (result) => { onMessage(result.message); await queryClient.invalidateQueries({ queryKey: ["settings", token] }); },
  });
  if (setting.platform === "facebook" || setting.platform === "instagram") {
    return <MetaPlatformCard setting={setting} isAdmin={isAdmin} metaConfigured={metaConfigured} token={token} onMessage={onMessage} />;
  }
  return <details className="settings-card" open>
    <summary><span><PlatformBadge platform={setting.platform} /><strong>{setting.label}</strong></span><span>Set up credentials</span></summary>
    <div className="settings-body">
      <div className="go-live-list"><p><b>1</b><span>Create:</span> {setting.developerApp}</p><p><b>2</b><span>Collect:</span> {setting.credentialFields}</p><p><b>3</b><span>Callback:</span> Deploy the app on your host, then add the exact OAuth callback URL for that deployment (see DEPLOY.md).</p><p><b>4</b><span>Permissions:</span> Request only sign-in, profile/account discovery, and content publishing scopes.</p></div>
      <label>App ID (Client ID)<input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Paste your App ID" /></label>
      <label>App Secret<input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Paste your App Secret" /></label>
      <p className="secret-note">Your secret is encrypted before it is stored and never shown again.</p>
      <button className="secondary-button" disabled={save.isPending || !clientId.trim()} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save configuration"}</button>
    </div>
  </details>;
}

function BillingSection({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const statusQuery = useQuery({
    queryKey: ["billing", token],
    queryFn: () => api.getBillingStatus({ sessionToken: token }),
    retry: false,
  });
  const friendly = (e: unknown) => {
    const msg = e instanceof Error ? e.message : "Could not continue.";
    return /not configured/i.test(msg) ? "Billing isn't connected yet. Check back soon." : msg.replace(/^action \w+ error: /, "");
  };
  const checkout = useMutation({
    mutationFn: () => api.createCheckoutSession({ sessionToken: token }),
    onSuccess: (result) => { window.location.href = result.url; },
    onError: (e) => onMessage(friendly(e)),
  });
  const portal = useMutation({
    mutationFn: () => api.createPortalSession({ sessionToken: token }),
    onSuccess: (result) => { window.location.href = result.url; },
    onError: (e) => onMessage(friendly(e)),
  });
  const status = statusQuery.data?.status ?? "none";
  const subscribed = ["trialing", "active", "past_due"].includes(status);
  const label = status === "trialing" ? "Free trial" : status === "active" ? "Active" : status === "past_due" ? "Past due" : status === "canceled" ? "Canceled" : "No subscription";
  const trialEnd = statusQuery.data?.trialEndsAt ? new Date(statusQuery.data.trialEndsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  const renews = status === "active" && statusQuery.data?.currentPeriodEnd ? new Date(statusQuery.data.currentPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  return <section className="profile-block" aria-label="Billing">
    <div><span className="section-code">BILLING</span><h2>zepostia plan</h2><p>$19.88/month, billed monthly. Cancel anytime.</p></div>
    {statusQuery.isPending ? <p>Loading…</p> : statusQuery.isError ? <p>Could not load billing status.</p> : <>
      <p><strong>{label}</strong>{trialEnd ? ` · first charge ${trialEnd}` : null}{renews ? ` · renews ${renews}` : null}</p>
      {subscribed
        ? <button className="secondary-button" disabled={portal.isPending} onClick={() => portal.mutate()}>{portal.isPending ? "Working…" : "Manage billing"}</button>
        : <button className="primary-button" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? "Working…" : "Start subscription"}</button>}
      {!subscribed && <p className="secret-note">14-day free trial — your card is collected at checkout and charged $19.88 on day 15. Checkout is secured by Stripe.</p>}
    </>}
  </section>;
}

function Settings({ settings, token, user, metaConfigured, onMessage, onSignOut }: { settings: PlatformSetting[]; token: string; user: { email: string; displayName: string; role: string }; metaConfigured: boolean; onMessage: (message: string) => void; onSignOut: () => void }) {
  const isAdmin = user.role === "admin";
  return <div className="page-stack">
    <div className="page-heading"><span className="section-code">GO-LIVE CHECKLIST</span><h1>Five modular connections. One rulebook.</h1><p>This build stays in demo mode until each official developer app, callback, permission review, and server-side secret is ready.</p></div>
    <section className="security-manifest"><h2>Credential boundary</h2><p>Client IDs may be stored here. Client secrets, refresh tokens, and access tokens must live in a deployment secret vault and only be read by server-side OAuth and publishing handlers. Platform passwords are never accepted.</p></section>
    <section className="settings-list">{settings.map((setting) => <PlatformSettingsCard key={setting.platform} setting={setting} token={token} onMessage={onMessage} isAdmin={isAdmin} metaConfigured={metaConfigured} />)}</section>
    <BillingSection token={token} onMessage={onMessage} />
    <section className="profile-block"><div><span className="section-code">APP ACCOUNT</span><h2>{user.displayName}</h2><p>{user.email}</p></div><button className="quiet-button" onClick={onSignOut}>Sign out</button></section>
  </div>;
}

export function App() {
  const demoMode = useServerDemoMode();
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem("marketing-app-session") ?? "");
  const [page, setPage] = useState<Page>("dashboard");
  const [toast, setToast] = useState("");
  const workspace = useQuery({
    queryKey: ["workspace", sessionToken],
    queryFn: () => api.getWorkspace({ sessionToken }),
    enabled: Boolean(sessionToken),
  });
  const settings = useQuery({
    queryKey: ["settings", sessionToken],
    queryFn: () => api.listPlatformSettings({ sessionToken }),
    enabled: Boolean(sessionToken),
  });

  useEffect(() => {
    if (workspace.data && !workspace.data.authenticated) {
      localStorage.removeItem("marketing-app-session");
      setSessionToken("");
    }
  }, [workspace.data]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  // Facebook OAuth lands back here via /oauth/facebook/callback -> /?oauth=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (oauth === "facebook_ok") setToast("Facebook connected — posting as your Page.");
    else if (oauth === "facebook_error") setToast(`Facebook connection failed: ${params.get("reason") ?? "unknown error"}`);
    else if (oauth === "instagram_ok") setToast("Instagram connected — posting as your professional account.");
    else if (oauth === "instagram_error") setToast(`Instagram connection failed: ${params.get("reason") ?? "unknown error"}`);
    else return;
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const authenticate = (token: string) => { localStorage.setItem("marketing-app-session", token); setSessionToken(token); };
  const signOut = () => { localStorage.removeItem("marketing-app-session"); setSessionToken(""); setPage("dashboard"); };

  if (!sessionToken) return <AuthScreen onAuthenticated={authenticate} />;
  if (workspace.isPending || settings.isPending) return <div className="loading-screen"><SafeAreaTopScrim backgroundColor="var(--bg)" /><span className="loading-mark">///</span><p>Opening control room…</p></div>;
  if (workspace.error || !workspace.data?.authenticated) return <div className="loading-screen"><p>We could not open this workspace.</p><button className="secondary-button" onClick={signOut}>Return to sign in</button></div>;

  const data = workspace.data;
  const user = data.user;
  if (!user) return null;
  return <div className="app-shell">
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    <header className="mobile-header">
      <strong className="mobile-brand"><img src="/logo-mark.png" alt="" aria-hidden="true" className="brand-mark" />zepostia<span aria-hidden="true">///</span></strong>
      <div className="mobile-status">{demoMode && <><span className="live-dot" /><span>Demo</span></>}<button aria-label="Open settings" onClick={() => setPage("settings")}>⌁</button></div>
    </header>
    <aside className="side-rail">
      <div className="rail-brand"><img src="/logo-mark.png" alt="" aria-hidden="true" className="brand-mark" />zepostia<span aria-hidden="true">///</span></div>
      {demoMode && <div className="mode-stamp"><span className="live-dot" /><strong>DEMO</strong><small>official APIs only</small></div>}
      <nav aria-label="Primary navigation">{NAV.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><span>{item.glyph}</span>{item.label}</button>)}</nav>
      <div className="rail-user"><strong>{user.displayName}</strong><small>{user.email}</small></div>
    </aside>
    <main className="main-canvas">
      {page === "dashboard" && <Dashboard accounts={data.accounts} posts={data.posts} go={setPage} />}
      {page === "post" && <PostPage accounts={data.accounts} posts={data.posts} token={sessionToken} onMessage={setToast} goAccounts={() => setPage("accounts")} />}
      {page === "accounts" && <Accounts accounts={data.accounts} settings={settings.data?.platforms ?? []} token={sessionToken} onMessage={setToast} />}
      {page === "settings" && <Settings settings={settings.data?.platforms ?? []} token={sessionToken} user={user} metaConfigured={settings.data?.metaConfigured ?? false} onMessage={setToast} onSignOut={signOut} />}
    </main>
    <nav className="bottom-nav" aria-label="Primary navigation">{NAV.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><span>{item.glyph}</span><small>{item.label}</small></button>)}</nav>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
