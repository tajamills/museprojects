import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../schema.js";
import { sha256Hex } from "./http.js";

// Owner-only evidence packet (spec §9.3). Assembled from recorded claims,
// address-source links, confirmed events and corrections. The packet states
// its own limits on its face: these are reported addresses from cited
// sources, not findings. A SHA-256 of the canonical JSON is included so a
// filed packet can be matched to what was generated.

type Db = NodePgDatabase<typeof s>;

export const PACKET_WARNING =
  "WARNING — READ FIRST: Every address in this packet is a REPORTED address: it appeared in a published source listed in this packet. " +
  "Inclusion is not a finding of ownership, control, or wrongdoing, and no address here has been adjudicated. " +
  "Attribution statements are firm-reported assessments, not government or court findings. " +
  "A reported freeze is an issuer action reported by the sources; frozen does not mean recovered or returned. " +
  "Movement records begin at this service's monitoring baseline — earlier history was deliberately not replayed as alerts. " +
  "Public transaction details were subject to a 60-minute delay; owner records are undelayed. Verify every item against the cited source and a block explorer before relying on it.";

export interface PacketBundle {
  json: string;
  csv: string;
  html: string;
  sha256: string;
  eventCount: number;
  addressCount: number;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(v: unknown): string {
  const str = String(v ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function buildEvidencePacket(db: Db, caseId: string, generatedBy: string): Promise<PacketBundle> {
  const [watchCase] = await db.select().from(s.watchCases).where(eq(s.watchCases.id, caseId)).limit(1);
  if (!watchCase) throw new Error("Case not found.");

  const claims = await db
    .select({
      claim: s.watchCaseClaims,
      source: s.watchSources,
    })
    .from(s.watchCaseClaims)
    .innerJoin(s.watchSources, eq(s.watchCaseClaims.sourceId, s.watchSources.id))
    .where(eq(s.watchCaseClaims.caseId, caseId))
    .orderBy(asc(s.watchCaseClaims.displayOrder));

  const addresses = await db
    .select()
    .from(s.watchAddresses)
    .where(eq(s.watchAddresses.caseId, caseId))
    .orderBy(asc(s.watchAddresses.chain), asc(s.watchAddresses.address));

  const links = await db
    .select({ link: s.watchAddressSources, source: s.watchSources })
    .from(s.watchAddressSources)
    .innerJoin(s.watchSources, eq(s.watchAddressSources.sourceId, s.watchSources.id));

  const linksByAddress = new Map<string, typeof links>();
  for (const l of links) {
    const arr = linksByAddress.get(l.link.addressId) ?? [];
    if (addresses.some((a) => a.id === l.link.addressId)) {
      arr.push(l);
      linksByAddress.set(l.link.addressId, arr);
    }
  }

  const events = await db
    .select()
    .from(s.watchEvents)
    .where(eq(s.watchEvents.caseId, caseId))
    .orderBy(asc(s.watchEvents.chainObservedAt));

  const corrections = await db
    .select()
    .from(s.watchCorrections)
    .where(eq(s.watchCorrections.caseId, caseId))
    .orderBy(asc(s.watchCorrections.createdAt));

  const bountyChecks = await db
    .select()
    .from(s.watchBountyChecks)
    .where(eq(s.watchBountyChecks.caseId, caseId))
    .orderBy(asc(s.watchBountyChecks.checkedAt));

  const addressById = new Map(addresses.map((a) => [a.id, a]));
  const generatedAt = new Date().toISOString();

  const packet = {
    packet: "CryptoBagTracker Stolen-Funds Watch — owner evidence packet",
    warning: PACKET_WARNING,
    generatedAt,
    generatedBy,
    case: {
      slug: watchCase.slug,
      title: watchCase.title,
      summary: watchCase.summary,
      status: watchCase.status,
    },
    methodology: [
      "Addresses enter the watch only when a full address string is printed in an identifiable published source (watch_sources). Shortened forms and transaction hashes are rejected at import.",
      "Monitoring is baseline-first: a balance/height baseline is recorded for every address before any event can be created, and pre-baseline history is never replayed as an alert.",
      "Events are confirmed under per-chain confirmation rules before they count as confirmed movement; provisional and reorged records are labeled as such.",
      "Public transaction details are delayed 60 minutes after confirmation. This owner packet is undelayed.",
      "USD values are captured once, at event creation, from the recorded price source; an unavailable price is recorded as unavailable, never estimated.",
    ],
    claims: claims.map(({ claim, source }) => ({
      key: claim.claimKey,
      type: claim.claimType,
      label: claim.displayLabel,
      value: claim.displayValue,
      source: { publisher: source.publisher, title: source.title, url: source.url, locator: claim.sourceLocator },
      asOf: claim.asOfAt?.toISOString() ?? null,
      status: claim.status,
    })),
    addresses: addresses.map((a) => ({
      chain: a.chain,
      address: a.displayAddress,
      section: a.listSection,
      role: a.roleText,
      anchor: a.anchorPriority,
      frozenState: a.frozenState,
      status: a.status,
      baselineHeight: a.baselineHeight,
      baselineObservedAt: a.baselineObservedAt?.toISOString() ?? null,
      sources: (linksByAddress.get(a.id) ?? []).map(({ link, source }) => ({
        publisher: source.publisher,
        title: source.title,
        url: source.url,
        locator: link.sourceLocator,
        reportedRole: link.reportedRoleText,
        reportedSnapshot: link.reportedSnapshotText,
      })),
    })),
    events: events.map((e) => ({
      chain: e.chain,
      txHash: e.txHash,
      kind: e.eventKind,
      status: e.status,
      severity: e.severity,
      from: e.fromAddressId ? addressById.get(e.fromAddressId)?.displayAddress ?? null : e.externalFromAddress,
      to: e.toAddressId ? addressById.get(e.toAddressId)?.displayAddress ?? null : e.externalToAddress,
      asset: e.assetSymbol,
      amount: String(e.amountDecimal),
      usdValueAtEvent: e.usdValueAtEvent !== null ? String(e.usdValueAtEvent) : null,
      priceSource: e.priceSource,
      blockHeight: e.blockHeight,
      chainObservedAt: e.chainObservedAt?.toISOString() ?? null,
      confirmations: e.confirmations,
      publicNote: e.publicNote,
      providerPayloadHash: e.providerPayloadHash,
    })),
    corrections: corrections.map((c) => ({
      at: c.createdAt.toISOString(),
      entityType: c.entityType,
      field: c.fieldChanged,
      oldValue: c.oldValue,
      newValue: c.newValue,
      reason: c.reason,
      correctedBy: c.correctedBy,
      approvedBy: c.approvedBy,
    })),
    bountyChecks: bountyChecks.map((b) => ({
      target: b.target,
      checkedBy: b.checkedBy,
      method: b.method,
      result: b.resultSummary,
      sourceUrl: b.sourceUrl,
      checkedAt: b.checkedAt.toISOString(),
      publicStatusChanged: b.publicStatusChanged,
      approvedBy: b.approvedBy,
    })),
  };

  const json = JSON.stringify(packet, null, 2);
  const sha256 = sha256Hex(json);

  const csvHeader = ["chain", "tx_hash", "kind", "status", "severity", "from", "to", "asset", "amount", "usd_at_event", "block_height", "chain_observed_at", "confirmations"];
  const csvLines = [csvHeader.join(",")];
  for (const e of packet.events) {
    csvLines.push([e.chain, e.txHash, e.kind, e.status, e.severity, e.from ?? "", e.to ?? "", e.asset, e.amount, e.usdValueAtEvent ?? "", e.blockHeight ?? "", e.chainObservedAt ?? "", e.confirmations ?? ""].map(csvCell).join(","));
  }
  const csv = csvLines.join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Evidence packet — ${esc(watchCase.title)}</title>
<style>body{font-family:Georgia,serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}.warn{border:2px solid #900;padding:1rem;background:#fff8f8}table{border-collapse:collapse;width:100%;font-size:.82rem}td,th{border:1px solid #bbb;padding:.3rem .4rem;text-align:left;vertical-align:top}code{font-size:.78rem;word-break:break-all}.meta{color:#444;font-size:.85rem}</style>
</head><body>
<h1>Evidence packet — ${esc(watchCase.title)}</h1>
<p class="meta">Generated ${esc(generatedAt)} by ${esc(generatedBy)} · Packet SHA-256: <code>${sha256}</code></p>
<div class="warn">${esc(PACKET_WARNING)}</div>
<h2>Methodology</h2><ul>${packet.methodology.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
<h2>Reported figures (each from its cited source)</h2>
<table><tr><th>Label</th><th>Value as reported</th><th>Source</th></tr>
${packet.claims.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.value)}</td><td>${esc(c.source.publisher)} — ${esc(c.source.locator)}</td></tr>`).join("")}
</table>
<h2>Reported addresses (${packet.addresses.length})</h2>
<table><tr><th>Chain</th><th>Address</th><th>Section</th><th>Reported role</th><th>Sources</th></tr>
${packet.addresses.map((a) => `<tr><td>${esc(a.chain)}</td><td><code>${esc(a.address)}</code></td><td>${esc(a.section)}</td><td>${esc(a.role ?? "Role not specified in the source's record list")}</td><td>${a.sources.map((src) => `${esc(src.publisher)} (${esc(src.locator)})`).join("<br>")}</td></tr>`).join("")}
</table>
<h2>Movement events (${packet.events.length})</h2>
<table><tr><th>When (chain time)</th><th>Chain</th><th>Transaction</th><th>Kind / status</th><th>Amount</th><th>USD at event</th></tr>
${packet.events.map((e) => `<tr><td>${esc(e.chainObservedAt ?? "")}</td><td>${esc(e.chain)}</td><td><code>${esc(e.txHash)}</code></td><td>${esc(e.kind)} / ${esc(e.status)}</td><td>${esc(e.amount)} ${esc(e.asset)}</td><td>${esc(e.usdValueAtEvent ?? "value unavailable")}</td></tr>`).join("")}
</table>
<h2>Corrections</h2>
${packet.corrections.length === 0 ? "<p>None recorded.</p>" : `<table><tr><th>When</th><th>Field</th><th>Change</th><th>Reason</th></tr>${packet.corrections.map((c) => `<tr><td>${esc(c.at)}</td><td>${esc(c.field)}</td><td>${esc(c.oldValue ?? "")} → ${esc(c.newValue ?? "")}</td><td>${esc(c.reason)}</td></tr>`).join("")}</table>`}
</body></html>`;

  return { json, csv, html, sha256, eventCount: events.length, addressCount: addresses.length };
}
