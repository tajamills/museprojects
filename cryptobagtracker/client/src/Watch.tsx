import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

// Stolen-Funds Watch client: the public case page (rendered entirely from
// the read-only /api/watch payloads — no statistic lives in this file), the
// public address detail, the signed-in follow/feed view, and the owner
// admin panel. Language rule (spec §3): addresses are "reported" by cited
// sources; nothing here accuses anyone of anything.

type Any = any;

function useNoindex() {
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    const prev = meta.content;
    meta.content = "noindex, nofollow";
    return () => {
      if (meta) {
        if (created) meta.remove();
        else meta.content = prev;
      }
    };
  }, []);
}

async function fetchJson(url: string): Promise<Any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function shortAddr(a: string): string {
  return a.length > 24 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a;
}

function ClaimRows({ rows }: { rows: Any[] }) {
  if (!rows?.length) return null;
  return <div className="table-list">{rows.map((c) => <div key={c.key}><span><b>{c.label}</b><small>Source: {c.source.publisher} — {c.source.locator}{c.asOf ? ` · as of ${c.asOf.slice(0, 10)}` : ""}</small></span><span style={{ textAlign: "right" }}><b>{c.value}</b></span></div>)}</div>;
}

export function PublicWatchPage({ slug, onAuth, onHome }: { slug: string; onAuth: (mode: "login" | "signup") => void; onHome: () => void }) {
  useNoindex();
  const [chain, setChain] = useState("");
  const [q, setQ] = useState("");
  const [addrPage, setAddrPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const caseQuery = useQuery({ queryKey: ["watch-case", slug], queryFn: () => fetchJson(`/api/watch/cases/${slug}`), retry: false });
  const addrQuery = useQuery({
    queryKey: ["watch-addresses", slug, chain, q, addrPage],
    queryFn: () => fetchJson(`/api/watch/cases/${slug}/addresses?page=${addrPage}${chain ? `&chain=${chain}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    retry: false, enabled: caseQuery.isSuccess,
  });
  const eventsQuery = useQuery({
    queryKey: ["watch-events", slug, eventPage],
    queryFn: () => fetchJson(`/api/watch/cases/${slug}/events?page=${eventPage}`),
    retry: false, enabled: caseQuery.isSuccess,
  });

  if (caseQuery.isPending) return <div className="loading"><div className="loader"></div><p>Loading the case page…</p></div>;
  if (caseQuery.error || !caseQuery.data) return <div className="landing"><main><section className="services-hero"><p className="overline">STOLEN-FUNDS WATCH</p><h1>This page is not available.</h1><p className="lede">The case page is not open yet. When it opens, it will list reported addresses from cited sources, the figures each source reported, and confirmed movement recorded by our monitoring.</p><div className="hero-actions"><button className="quiet" onClick={onHome}>Back to home</button></div></section></main></div>;

  const d = caseQuery.data as Any;
  const reported = (addrQuery.data?.addresses ?? []).filter((a: Any) => a.section === "reported");
  const victims = (addrQuery.data?.addresses ?? []).filter((a: Any) => a.section === "victim_owned");
  const addressRow = (a: Any) => (
    <article className="wallet-item" key={`${a.chain}-${a.address}`}>
      <div>
        <span className="chain-pill">{a.chainLabel}</span>
        {a.anchor ? <span className="chain-pill">ANCHOR</span> : null}
        <h3><a href={`/watch/${slug}/address/${a.chain}/${a.address}`}>{shortAddr(a.address)}</a></h3>
        <code>{a.address}</code>
        <p>{a.role}</p>
        {a.frozenState ? <p><b>{a.frozenState}</b></p> : null}
        <p><small>Status: {a.status.replaceAll("_", " ")}{a.lastSuccessfulCheckAt ? ` · last checked ${new Date(a.lastSuccessfulCheckAt).toLocaleString()}` : " · baseline not recorded yet"}</small></p>
        {a.sources?.length ? <p><small>Reported by: {a.sources.map((s: Any) => s.publisher).join(" · ")}</small></p> : null}
      </div>
      {a.explorerUrl ? <div className="wallet-balances"><a className="quiet" href={a.explorerUrl} target="_blank" rel="noreferrer">Explorer</a></div> : null}
    </article>
  );

  return <div className="landing">
    <header className="site-nav">
      <a className="brand" href="/" onClick={(e) => { e.preventDefault(); onHome(); }}><span>CryptoBagTracker</span></a>
      <nav>
        <button className="quiet" onClick={() => onAuth("login")}>Sign in</button>
        <button className="primary" onClick={() => onAuth("signup")}>Start free trial</button>
      </nav>
    </header>
    <main>
      <section className="services-hero">
        <p className="overline">STOLEN-FUNDS WATCH</p>
        <h1>{d.case.title}</h1>
        <p className="lede">{d.case.summary}</p>
        <div className="notice warn">{d.case.caution}</div>
        <p className="fine">{d.case.statusLabel} · {d.counts.reported} reported addresses · {d.counts.victimOwned} exchange-owned addresses shown separately · {d.counts.chains} chains</p>
      </section>

      <section className="services-block">
        <h2 className="section-h">What was reported taken</h2>
        <p>Each total is shown under the firm that reported it. The figures differ because the firms counted differently — they are never merged into one number here.</p>
        <ClaimRows rows={d.incidentTotals} />
        <ClaimRows rows={d.coverageCommitment} />
        <h3 className="subhead">Attribution — as reported</h3>
        <ClaimRows rows={d.attributions} />
      </section>

      <section className="services-block">
        <h2 className="section-h">Reported freezes</h2>
        <p>{d.freezeExplainer}</p>
        <ClaimRows rows={d.freezeRows} />
        <h3 className="subhead">Freeze totals — one per source</h3>
        <ClaimRows rows={d.freezeTotals} />
      </section>

      <section className="services-block">
        <h2 className="section-h">Movement status</h2>
        <div className="table-list">{d.monitoring.map((m: Any) => <div key={m.chain}><span><b>{m.chainLabel}</b><small>{m.reportedAddresses} reported addresses</small></span><span className={m.status === "operational" ? "owned" : "external"}>{m.status === "operational" ? (m.movementDetected ? "MOVEMENT DETECTED" : "NO CONFIRMED MOVEMENT") : m.status === "stale" ? "STALE — CHECKS OVERDUE" : "NOT STARTED"}</span><small>{m.lastSuccessfulCheckAt ? `Last successful check ${new Date(m.lastSuccessfulCheckAt).toLocaleString()}` : "No successful check recorded yet"}</small></div>)}</div>
        <p className="fine">A chain marked stale is not presented as current. Movement counts as confirmed only after the chain's confirmation rule is met, and transaction details appear here 60 minutes after confirmation.</p>
      </section>

      <section className="services-block">
        <h2 className="section-h">Confirmed movement</h2>
        {eventsQuery.data?.events?.length ? <div className="timeline">{eventsQuery.data.events.map((e: Any) => <article key={e.id}><div><div className="timeline-title"><b>{e.kind.replaceAll("_", " ")}</b><strong>{Number(e.amount).toLocaleString()} {e.asset}{e.usdValueAtEvent ? ` · $${Number(e.usdValueAtEvent).toLocaleString()}` : " · value unavailable"}</strong></div><p>{e.chainLabel} · {e.chainObservedAt ? new Date(e.chainObservedAt).toLocaleString() : ""} · {e.status} · severity {e.severity}</p><p>From {e.from.section === "external" ? shortAddr(e.from.address ?? "") : <a href={`/watch/${slug}/address/${e.chain}/${e.from.address}`}>{shortAddr(e.from.address ?? "")}</a>} → To {e.to.section === "external" ? shortAddr(e.to.address ?? "") : <a href={`/watch/${slug}/address/${e.chain}/${e.to.address}`}>{shortAddr(e.to.address ?? "")}</a>}</p>{e.publicNote ? <p>{e.publicNote}</p> : null}{e.explorerUrl ? <p><a href={e.explorerUrl} target="_blank" rel="noreferrer">View transaction</a></p> : null}</div></article>)}</div> : <p>No confirmed movement has been recorded since monitoring began. That is a statement about our monitoring window — earlier history is deliberately not replayed here.</p>}
        {eventsQuery.data && eventsQuery.data.total > 50 ? <div className="form-pair"><button className="quiet" disabled={eventPage <= 1} onClick={() => setEventPage((p) => p - 1)}>Newer</button><button className="quiet" onClick={() => setEventPage((p) => p + 1)}>Older</button></div> : null}
      </section>

      <section className="services-block">
        <h2 className="section-h">Reported addresses</h2>
        <div className="form-pair">
          <label className="field"><span>Chain</span><select aria-label="Filter by chain" value={chain} onChange={(e) => { setChain(e.target.value); setAddrPage(1); }}><option value="">All chains</option><option value="ethereum">Ethereum</option><option value="arbitrum">Arbitrum</option><option value="bitcoin">Bitcoin</option><option value="tron">Tron</option><option value="xrp_ledger">XRP Ledger</option><option value="solana">Solana</option></select></label>
          <label className="field"><span>Search</span><input aria-label="Search addresses" value={q} onChange={(e) => { setQ(e.target.value); setAddrPage(1); }} placeholder="Address or role" /></label>
        </div>
        {addrQuery.isPending ? <p>Loading…</p> : <>
          <div className="list-block">{reported.map(addressRow)}</div>
          {victims.length ? <><h3 className="subhead">Exchange-owned addresses (victim side)</h3><p>These addresses belong to the exchange the funds were reported taken from. They are shown for completeness and are never described as reported attacker addresses.</p><div className="list-block">{victims.map(addressRow)}</div></> : null}
          {addrQuery.data && addrQuery.data.total > 50 ? <div className="form-pair"><button className="quiet" disabled={addrPage <= 1} onClick={() => setAddrPage((p) => p - 1)}>Previous page</button><span>Page {addrPage}</span><button className="quiet" onClick={() => setAddrPage((p) => p + 1)}>Next page</button></div> : null}
        </>}
      </section>

      <section className="services-block">
        <h2 className="section-h">Bounties and reporting</h2>
        <p>{d.bounty.intro}</p>
        <ClaimRows rows={d.bounty.rows} />
        <p className="fine">{d.bounty.officialOnly}</p>
      </section>

      <section className="services-block">
        <h2 className="section-h">How this page works</h2>
        <ul>{d.methodology.map((m: string) => <li key={m}>{m}</li>)}</ul>
        {d.corrections?.length ? <><h3 className="subhead">Corrections</h3><div className="table-list">{d.corrections.map((c: Any, i: number) => <div key={i}><span><b>{c.field.replaceAll("_", " ")}</b><small>{new Date(c.at).toLocaleDateString()}</small></span><span>{c.reason}</span></div>)}</div></> : null}
      </section>
    </main>
    <footer><span>© 2026 CryptoBagTracker. All rights reserved.</span><button onClick={onHome}>Home</button></footer>
  </div>;
}

export function PublicWatchAddress({ slug, chain, address, onHome }: { slug: string; chain: string; address: string; onHome: () => void }) {
  useNoindex();
  const query = useQuery({ queryKey: ["watch-address", chain, address], queryFn: () => fetchJson(`/api/watch/addresses/${chain}/${address}`), retry: false });
  if (query.isPending) return <div className="loading"><div className="loader"></div><p>Loading…</p></div>;
  if (query.error || !query.data) return <div className="landing"><main><section className="services-hero"><h1>Address not found on this case.</h1><div className="hero-actions"><button className="quiet" onClick={onHome}>Back to home</button></div></section></main></div>;
  const a = query.data.address as Any;
  return <div className="landing"><main>
    <section className="services-hero">
      <p className="overline">REPORTED ADDRESS — {a.chainLabel.toUpperCase()}</p>
      <h1 style={{ wordBreak: "break-all", fontSize: "1.6rem" }}>{a.address}</h1>
      <p className="lede">{a.role}</p>
      {a.frozenState ? <div className="notice warn">{a.frozenState}</div> : null}
      <p className="fine">Section: {a.section === "victim_owned" ? "Exchange-owned (victim side)" : "Reported"} · Status: {a.status.replaceAll("_", " ")}{a.lastSuccessfulCheckAt ? ` · Last checked ${new Date(a.lastSuccessfulCheckAt).toLocaleString()}` : ""}</p>
      {a.explorerUrl ? <p><a href={a.explorerUrl} target="_blank" rel="noreferrer">View on block explorer</a></p> : null}
      <div className="hero-actions"><a className="quiet" href={`/watch/${slug}`}>Back to the case page</a></div>
    </section>
    <section className="services-block">
      <h2 className="section-h">Why this address is listed</h2>
      {a.sources.map((s: Any, i: number) => <article className="faq-item" key={i}><h3>{s.publisher} — {s.title}</h3><p><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></p><p><small>{s.locator}</small></p>{s.reportedRole ? <p>Source's wording for the role: “{s.reportedRole}”</p> : null}{s.reportedSnapshot ? <p>Source's reported snapshot: “{s.reportedSnapshot}”</p> : null}</article>)}
      <p className="fine">Inclusion means only that this address was reported in a cited source. It is not a finding of ownership, control, or wrongdoing.</p>
    </section>
    <section className="services-block">
      <h2 className="section-h">Confirmed movement involving this address</h2>
      {query.data.events?.length ? <div className="timeline">{query.data.events.map((e: Any) => <article key={e.id}><div><div className="timeline-title"><b>{e.kind.replaceAll("_", " ")}</b><strong>{Number(e.amount).toLocaleString()} {e.asset}</strong></div><p>{e.chainObservedAt ? new Date(e.chainObservedAt).toLocaleString() : ""} · {e.status}</p>{e.explorerUrl ? <p><a href={e.explorerUrl} target="_blank" rel="noreferrer">View transaction</a></p> : null}</div></article>)}</div> : <p>No confirmed movement recorded since monitoring began.</p>}
    </section>
  </main></div>;
}

export function WatchView({ token }: { token: string }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["watch-state", token], queryFn: () => api.watchGetMyState({ token }), retry: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["watch-state", token] });
  const follow = useMutation({ mutationFn: () => api.watchFollowCase({ token, slug: "binance-hot-wallet-breach-2026" }), onSuccess: refresh });
  const unfollow = useMutation({ mutationFn: () => api.watchUnfollowCase({ token, slug: "binance-hot-wallet-breach-2026" }), onSuccess: refresh });
  const [minSeverity, setMinSeverity] = useState("medium");
  const [telegram, setTelegram] = useState(true);
  const [inApp, setInApp] = useState(true);
  const update = useMutation({ mutationFn: () => api.watchUpdateSubscription({ token, slug: "binance-hot-wallet-breach-2026", minSeverity: minSeverity as Any, telegramEnabled: telegram, inAppEnabled: inApp }), onSuccess: refresh });
  useEffect(() => {
    const sub = (state.data as Any)?.subscription;
    if (sub) { setMinSeverity(sub.minSeverity); setTelegram(sub.telegramEnabled); setInApp(sub.inAppEnabled); }
  }, [state.data]);
  if (state.isPending) return <div className="page"><p>Loading…</p></div>;
  if (state.error || !state.data) return <div className="page"><div className="notice warn">Could not load the watch.</div></div>;
  const d = state.data as Any;
  return <div className="page">
    <header className="page-head"><div><p className="overline">STOLEN-FUNDS WATCH</p><h1>Reported-address movement alerts</h1><p>Follow the case and get alerted on Telegram and here in the app when a reported address shows confirmed movement. Alerts are part of Premium — they deliver while your trial or subscription is active, and are recorded as skipped while it is not.</p></div></header>
    <section>
      <h2>{d.case.title}</h2>
      {d.subscription ? <>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); update.mutate(); }}>
          <label className="field"><span>Minimum severity</span><select aria-label="Minimum severity" value={minSeverity} onChange={(e) => setMinSeverity(e.target.value)}><option value="low">Low and up</option><option value="medium">Medium and up</option><option value="high">High only</option></select></label>
          <label className="check"><input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} /> Telegram alerts (uses your Telegram chat ID from Price Alerts settings)</label>
          <label className="check"><input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} /> In-app watch feed</label>
          <div className="form-pair"><button className="primary" disabled={update.isPending}>Save watch settings</button><button type="button" className="quiet" disabled={unfollow.isPending} onClick={() => unfollow.mutate()}>Stop following</button></div>
        </form>
      </> : <button className="primary" disabled={follow.isPending} onClick={() => follow.mutate()}>Follow this case</button>}
    </section>
    <section>
      <h2 className="subhead">Your watch feed</h2>
      {d.feed?.length ? <div className="timeline">{d.feed.map((f: Any, i: number) => <article key={i}><div><div className="timeline-title"><b>{f.event.kind.replaceAll("_", " ")}</b><strong>{Number(f.event.amount).toLocaleString()} {f.event.asset}{f.event.usdValueAtEvent ? ` · $${Number(f.event.usdValueAtEvent).toLocaleString()}` : ""}</strong></div><p>{f.event.chain} · {f.event.chainObservedAt ? new Date(f.event.chainObservedAt).toLocaleString() : ""} · severity {f.event.severity} · {f.deliveryStatus.replaceAll("_", " ")}</p>{f.event.publicNote ? <p>{f.event.publicNote}</p> : null}</div></article>)}</div> : <p>No watch alerts recorded for you yet. Confirmed movement on a followed case will appear here.</p>}
    </section>
    {d.isAdmin ? <WatchAdmin token={token} /> : null}
  </div>;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function WatchAdmin({ token }: { token: string }) {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["watch-admin", token], queryFn: () => api.watchAdminOverview({ token }), retry: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["watch-admin", token] });
  const [msg, setMsg] = useState("");
  const importer = useMutation({ mutationFn: (mode: "dry_run" | "commit") => api.watchAdminRunImport({ token, mode }), onSuccess: (r) => { setMsg(`Import ${r.mode ?? ""} — ${r.reportedCount} reported / ${r.victimCount} victim / active ${r.activeReportedAfterQuarantine} / quarantined ${r.quarantinedAnomalies?.length ?? 0} / seed ${String(r.seedSha256).slice(0, 12)}`); refresh(); }, onError: (e) => setMsg(e instanceof Error ? e.message : "Import failed.") });
  const switches = useMutation({ mutationFn: (patch: Any) => api.watchAdminSetCaseSwitches({ token, slug: "binance-hot-wallet-breach-2026", ...patch }), onSuccess: refresh });
  const packet = useMutation({ mutationFn: (format: "json" | "csv" | "html") => api.watchAdminExportPacket({ token, slug: "binance-hot-wallet-breach-2026", format }), onSuccess: (r) => { download(r.filename, r.content, format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/html"); setMsg(`Packet exported — SHA-256 ${r.sha256.slice(0, 16)}… · ${r.addressCount} addresses · ${r.eventCount} events`); }, onError: (e) => setMsg(e instanceof Error ? e.message : "Packet export failed.") });
  const [bTarget, setBTarget] = useState("binance_case_bounty"); const [bMethod, setBMethod] = useState(""); const [bResult, setBResult] = useState(""); const [bUrl, setBUrl] = useState("");
  const bountyCheck = useMutation({ mutationFn: () => api.watchAdminRecordBountyCheck({ token, target: bTarget, method: bMethod, resultSummary: bResult, sourceUrl: bUrl || undefined }), onSuccess: () => { setBMethod(""); setBResult(""); setBUrl(""); refresh(); }, onError: (e) => setMsg(e instanceof Error ? e.message : "Could not record the check.") });
  if (overview.isPending) return <section><h2 className="subhead">Watch admin</h2><p>Loading…</p></section>;
  if (overview.error || !overview.data) return <section><h2 className="subhead">Watch admin</h2><div className="notice warn">Could not load watch admin.</div></section>;
  const d = overview.data as Any;
  const sw = (label: string, key: string) => <label className="check"><input type="checkbox" checked={Boolean(d.case[key])} onChange={(e) => switches.mutate({ [key]: e.target.checked })} /> {label} (case switch)</label>;
  return <section>
    <h2 className="subhead">Watch admin (owner)</h2>
    <div className="notice">Environment flags — public: {String(d.flags.publicEnv)} · monitor: {String(d.flags.monitorEnv)} · alerts: {String(d.flags.alertsEnv)} · packet: {String(d.flags.packetEnv)} · import: {String(d.flags.importEnv)}. A surface runs only when its environment flag AND its case switch are both on.</div>
    <div className="form-grid">
      {sw("Public page", "publicEnabled")}
      {sw("Monitoring", "monitoringEnabled")}
      {sw("Alerts", "alertsEnabled")}
    </div>
    <p>Counts — reported: {d.counts.reported} · victim-owned: {d.counts.victimOwned} · quarantined: {d.counts.quarantined} · baselined: {d.counts.baselined}</p>
    <h3>Providers</h3>
    <div className="table-list">{d.providers.map((p: Any) => <div key={p.chain}><span><b>{p.chain}</b><small>{p.providerName} · target {p.targetCadence}</small></span><span className={p.ok ? "owned" : "external"}>{p.ok ? "OK" : "DOWN/STALE"}</span><small>{p.lastError ? `Last error: ${p.lastError}` : p.lastSuccessAt ? `Last success ${new Date(p.lastSuccessAt).toLocaleString()}` : "No success yet"}</small></div>)}</div>
    <h3>Seed import</h3>
    <div className="form-pair"><button className="quiet" disabled={importer.isPending} onClick={() => importer.mutate("dry_run")}>Dry run</button><button className="quiet" disabled={importer.isPending} onClick={() => importer.mutate("commit")}>Commit import</button></div>
    {d.importBatches?.length ? <div className="table-list">{d.importBatches.map((b: Any) => <div key={b.id}><span><b>{b.mode}</b><small>{new Date(b.at).toLocaleString()} · {b.importedBy}</small></span><small>seed {String(b.seedSha256).slice(0, 12)} · reported {b.report?.reportedCount} · victim {b.report?.victimCount} · quarantined {b.report?.quarantinedAnomalies?.length ?? 0}</small></div>)}</div> : null}
    <h3>Evidence packet (owner only)</h3>
    <div className="form-pair"><button className="quiet" disabled={packet.isPending} onClick={() => packet.mutate("json")}>JSON</button><button className="quiet" disabled={packet.isPending} onClick={() => packet.mutate("csv")}>CSV (events)</button><button className="quiet" disabled={packet.isPending} onClick={() => packet.mutate("html")}>Printable HTML</button></div>
    <h3>Record a bounty check</h3>
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); bountyCheck.mutate(); }}>
      <label className="field"><span>Target</span><input aria-label="Bounty check target" value={bTarget} onChange={(e) => setBTarget(e.target.value)} required /></label>
      <label className="field"><span>Method</span><input aria-label="Bounty check method" value={bMethod} onChange={(e) => setBMethod(e.target.value)} required placeholder="What you checked and where" /></label>
      <label className="field"><span>Result</span><input aria-label="Bounty check result" value={bResult} onChange={(e) => setBResult(e.target.value)} required /></label>
      <label className="field"><span>Source URL (optional)</span><input aria-label="Bounty check source URL" value={bUrl} onChange={(e) => setBUrl(e.target.value)} /></label>
      <button className="primary" disabled={bountyCheck.isPending}>Record check (never changes public copy)</button>
    </form>
    {d.bountyChecks?.length ? <div className="table-list">{d.bountyChecks.map((b: Any) => <div key={b.id}><span><b>{b.target}</b><small>{new Date(b.checkedAt).toLocaleString()} · {b.checkedBy} · {b.method}</small></span><span>{b.result}{b.publicStatusChanged ? " · PUBLIC STATUS CHANGED" : ""}</span></div>)}</div> : null}
    <h3>Recent corrections</h3>
    {d.corrections?.length ? <div className="table-list">{d.corrections.map((c: Any) => <div key={c.id}><span><b>{c.entityType} · {c.field}</b><small>{new Date(c.at).toLocaleString()} · {c.correctedBy}</small></span><span>{c.reason}</span></div>)}</div> : <p>None recorded.</p>}
    <h3>Delivery outcomes (recent)</h3>
    <p>{Object.entries(d.deliveryStats ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "No deliveries recorded yet."}</p>
    {msg && <div className="notice">{msg}</div>}
  </section>;
}
