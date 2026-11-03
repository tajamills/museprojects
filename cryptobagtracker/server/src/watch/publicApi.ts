import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, ilike, inArray, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../schema.js";
import { effectivePublic } from "./flags.js";
import { CASE_SLUG } from "./seedData.js";

// Public read-only watch API (spec §5.3). Everything renders from claim and
// address-source records — no statistic is hard-coded here. While the public
// flag is off (environment AND case switch), every route answers 404: a
// dark feature does not confirm its own existence. All responses carry
// X-Robots-Tag: noindex — the page ships noindex until Layla approves
// indexing at launch.

type Db = NodePgDatabase<typeof s>;

const EXPLORERS: Record<string, { address: string; tx: string }> = {
  ethereum: { address: "https://etherscan.io/address/", tx: "https://etherscan.io/tx/" },
  arbitrum: { address: "https://arbiscan.io/address/", tx: "https://arbiscan.io/tx/" },
  bitcoin: { address: "https://mempool.space/address/", tx: "https://mempool.space/tx/" },
  tron: { address: "https://tronscan.org/#/address/", tx: "https://tronscan.org/#/transaction/" },
  xrp_ledger: { address: "https://xrpscan.com/account/", tx: "https://xrpscan.com/tx/" },
  solana: { address: "https://solscan.io/account/", tx: "https://solscan.io/tx/" },
};

export function explorerUrl(chain: string, kind: "address" | "tx", id: string): string | null {
  const e = EXPLORERS[chain];
  return e ? `${e[kind]}${id}` : null;
}

const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  bitcoin: "Bitcoin",
  tron: "Tron",
  xrp_ledger: "XRP Ledger",
  solana: "Solana",
};

const hits = new Map<string, number[]>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const window = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  window.push(now);
  hits.set(ip, window);
  return window.length > 120;
}

async function loadPublicCase(db: Db, slug: string) {
  const [watchCase] = await db.select().from(s.watchCases).where(eq(s.watchCases.slug, slug)).limit(1);
  if (!watchCase || watchCase.isTest) return null;
  if (!effectivePublic(watchCase)) return null;
  return watchCase;
}

function claimView(c: typeof s.watchCaseClaims.$inferSelect, source: typeof s.watchSources.$inferSelect) {
  return {
    key: c.claimKey,
    label: c.displayLabel,
    value: c.displayValue,
    source: { publisher: source.publisher, title: source.title, url: source.url, locator: c.sourceLocator },
    asOf: c.asOfAt?.toISOString() ?? null,
  };
}

export function registerWatchPublicRoutes(app: Express, db: Db): void {
  app.use("/api/watch", (req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (rateLimited(req)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  });

  app.get("/api/watch/cases/:slug", async (req, res) => {
    const watchCase = await loadPublicCase(db, req.params.slug);
    if (!watchCase) return notFound(res);
    const claims = await db
      .select({ claim: s.watchCaseClaims, source: s.watchSources })
      .from(s.watchCaseClaims)
      .innerJoin(s.watchSources, eq(s.watchCaseClaims.sourceId, s.watchSources.id))
      .where(and(eq(s.watchCaseClaims.caseId, watchCase.id), eq(s.watchCaseClaims.status, "current")))
      .orderBy(asc(s.watchCaseClaims.displayOrder));
    const byType = (t: string) => claims.filter((r) => r.claim.claimType === t).map((r) => claimView(r.claim, r.source));

    const addresses = await db
      .select()
      .from(s.watchAddresses)
      .where(and(eq(s.watchAddresses.caseId, watchCase.id), inArray(s.watchAddresses.listSection, ["reported", "victim_owned"])));
    const byChainMap = new Map<string, { reported: number; victim: number; lastSuccessfulCheckAt: string | null; movementDetected: boolean }>();
    for (const a of addresses) {
      const cur = byChainMap.get(a.chain) ?? { reported: 0, victim: 0, lastSuccessfulCheckAt: null, movementDetected: false };
      if (a.listSection === "reported") cur.reported++;
      else cur.victim++;
      if (a.lastSuccessfulCheckAt && (!cur.lastSuccessfulCheckAt || a.lastSuccessfulCheckAt.toISOString() > cur.lastSuccessfulCheckAt)) {
        cur.lastSuccessfulCheckAt = a.lastSuccessfulCheckAt.toISOString();
      }
      if (a.status === "reported_movement_detected") cur.movementDetected = true;
      byChainMap.set(a.chain, cur);
    }
    const monitoring = [...byChainMap.entries()].map(([chain, v]) => {
      const stale = !v.lastSuccessfulCheckAt || Date.now() - new Date(v.lastSuccessfulCheckAt).getTime() > 60 * 60_000;
      return {
        chain,
        chainLabel: CHAIN_LABELS[chain] ?? chain,
        status: !v.lastSuccessfulCheckAt ? "not_started" : stale ? "stale" : "operational",
        lastSuccessfulCheckAt: v.lastSuccessfulCheckAt,
        movementDetected: v.movementDetected,
        reportedAddresses: v.reported,
      };
    });

    const corrections = await db
      .select()
      .from(s.watchCorrections)
      .where(eq(s.watchCorrections.caseId, watchCase.id))
      .orderBy(desc(s.watchCorrections.createdAt))
      .limit(25);

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      case: {
        slug: watchCase.slug,
        title: watchCase.title,
        summary: watchCase.summary,
        statusLabel: "Reported case — figures are as reported by each cited source",
        caution:
          "An address appears here only because it was reported in a cited published source. Inclusion is not a finding of ownership, control, or wrongdoing.",
      },
      counts: {
        reported: addresses.filter((a) => a.listSection === "reported").length,
        victimOwned: addresses.filter((a) => a.listSection === "victim_owned").length,
        chains: byChainMap.size,
      },
      incidentTotals: byType("incident_total"),
      coverageCommitment: byType("coverage_commitment"),
      attributions: byType("attribution"),
      freezeExplainer:
        "Frozen is not the same as recovered. A freeze is applied by a token issuer or a network body and stops movement; it does not return funds to anyone. Bitcoin cannot be frozen at the network level — no issuer exists to freeze it — so Bitcoin figures never appear in this table.",
      freezeRows: byType("freeze"),
      freezeTotals: byType("freeze_total"),
      monitoring,
      bounty: {
        intro:
          "As of the review date in the panel, no case-specific Binance bounty has been posted in the sources checked. The routes below are the ones that exist. Nothing here files a report for you, and this page never asks you to contact an investigator or an agency through it.",
        rows: byType("bounty"),
        officialOnly:
          "Use official agency channels only. Do not send keys, seed phrases, documents or funds to anyone claiming to process a bounty.",
      },
      methodology: [
        "An address is included only when its full string was printed in an identifiable published source. Shortened forms and transaction hashes are rejected at import.",
        "The victim-owned addresses are shown separately and are never described as reported attacker addresses.",
        "Monitoring is baseline-first: a baseline is recorded for each address before movement tracking starts, and earlier history is never replayed as an alert.",
        "A movement counts as confirmed only after the chain's confirmation rule is met. Transaction details are shown publicly 60 minutes after confirmation.",
        "Every figure on this page carries its source. Where sources disagreed, each figure is shown separately under its own source — never merged.",
      ],
      corrections: corrections.map((c) => ({
        at: c.createdAt.toISOString(),
        field: c.fieldChanged,
        reason: c.reason,
      })),
    });
  });

  app.get("/api/watch/cases/:slug/addresses", async (req, res) => {
    const watchCase = await loadPublicCase(db, req.params.slug);
    if (!watchCase) return notFound(res);
    const chain = typeof req.query.chain === "string" ? req.query.chain : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = 50;
    const conds = [
      eq(s.watchAddresses.caseId, watchCase.id),
      inArray(s.watchAddresses.listSection, ["reported", "victim_owned"]),
    ];
    if (chain) conds.push(eq(s.watchAddresses.chain, chain));
    if (status) conds.push(eq(s.watchAddresses.status, status));
    if (q) conds.push(or(ilike(s.watchAddresses.address, `%${q}%`), ilike(s.watchAddresses.roleText, `%${q}%`))!);
    const rows = await db
      .select()
      .from(s.watchAddresses)
      .where(and(...conds))
      .orderBy(asc(s.watchAddresses.listSection), asc(s.watchAddresses.chain), asc(s.watchAddresses.address));
    const links = await db
      .select({ link: s.watchAddressSources, source: s.watchSources })
      .from(s.watchAddressSources)
      .innerJoin(s.watchSources, eq(s.watchAddressSources.sourceId, s.watchSources.id));
    const linksByAddress = new Map<string, typeof links>();
    for (const l of links) {
      const arr = linksByAddress.get(l.link.addressId) ?? [];
      arr.push(l);
      linksByAddress.set(l.link.addressId, arr);
    }
    const total = rows.length;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      total,
      page,
      pageSize,
      addresses: pageRows.map((a) => addressView(a, linksByAddress.get(a.id) ?? [])),
    });
  });

  app.get("/api/watch/cases/:slug/events", async (req, res) => {
    const watchCase = await loadPublicCase(db, req.params.slug);
    if (!watchCase) return notFound(res);
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = 50;
    const now = new Date();
    const rows = await db
      .select()
      .from(s.watchEvents)
      .where(
        and(
          eq(s.watchEvents.caseId, watchCase.id),
          inArray(s.watchEvents.status, ["confirmed", "finalized"]),
          lte(s.watchEvents.publicVisibleFrom, now),
        ),
      )
      .orderBy(desc(s.watchEvents.chainObservedAt));
    const addresses = await db.select().from(s.watchAddresses).where(eq(s.watchAddresses.caseId, watchCase.id));
    const byId = new Map(addresses.map((a) => [a.id, a]));
    const total = rows.length;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({
      total,
      page,
      pageSize,
      events: pageRows.map((e) => eventView(e, byId)),
    });
  });

  app.get("/api/watch/addresses/:chain/:address", async (req, res) => {
    const [watchCase] = await db.select().from(s.watchCases).where(eq(s.watchCases.slug, CASE_SLUG)).limit(1);
    if (!watchCase || watchCase.isTest || !effectivePublic(watchCase)) return notFound(res);
    const chain = req.params.chain;
    const address = req.params.address;
    const key = chain === "ethereum" || chain === "arbitrum" ? address.toLowerCase() : address;
    const [row] = await db
      .select()
      .from(s.watchAddresses)
      .where(
        and(
          eq(s.watchAddresses.caseId, watchCase.id),
          eq(s.watchAddresses.chain, chain),
          eq(s.watchAddresses.addressKey, key),
          inArray(s.watchAddresses.listSection, ["reported", "victim_owned"]),
        ),
      )
      .limit(1);
    if (!row) return notFound(res);
    const links = await db
      .select({ link: s.watchAddressSources, source: s.watchSources })
      .from(s.watchAddressSources)
      .innerJoin(s.watchSources, eq(s.watchAddressSources.sourceId, s.watchSources.id))
      .where(eq(s.watchAddressSources.addressId, row.id));
    const now = new Date();
    const events = await db
      .select()
      .from(s.watchEvents)
      .where(
        and(
          eq(s.watchEvents.caseId, watchCase.id),
          inArray(s.watchEvents.status, ["confirmed", "finalized"]),
          lte(s.watchEvents.publicVisibleFrom, now),
          or(eq(s.watchEvents.fromAddressId, row.id), eq(s.watchEvents.toAddressId, row.id)),
        ),
      )
      .orderBy(desc(s.watchEvents.chainObservedAt))
      .limit(50);
    const addresses = await db.select().from(s.watchAddresses).where(eq(s.watchAddresses.caseId, watchCase.id));
    const byId = new Map(addresses.map((a) => [a.id, a]));
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      address: addressView(row, links),
      events: events.map((e) => eventView(e, byId)),
    });
  });
}

function notFound(res: Response) {
  res.status(404).json({ error: "Not found" });
  return res;
}

type AddressRow = typeof s.watchAddresses.$inferSelect;
type LinkJoin = { link: typeof s.watchAddressSources.$inferSelect; source: typeof s.watchSources.$inferSelect };

function addressView(a: AddressRow, links: LinkJoin[]) {
  return {
    chain: a.chain,
    chainLabel: CHAIN_LABELS[a.chain] ?? a.chain,
    address: a.displayAddress,
    section: a.listSection,
    role: a.roleText ?? "Role not specified in the source's record list",
    anchor: a.anchorPriority,
    frozenState: a.frozenState,
    status: a.status,
    baselineRecorded: a.baselineStatus === "complete",
    lastSuccessfulCheckAt: a.lastSuccessfulCheckAt?.toISOString() ?? null,
    lastActivityAt: a.lastActivityAt?.toISOString() ?? null,
    explorerUrl: explorerUrl(a.chain, "address", a.displayAddress),
    sources: links.map(({ link, source }) => ({
      publisher: source.publisher,
      title: source.title,
      url: source.url,
      locator: link.sourceLocator,
      reportedRole: link.reportedRoleText,
      reportedSnapshot: link.reportedSnapshotText,
    })),
  };
}

type EventRow = typeof s.watchEvents.$inferSelect;
function eventView(e: EventRow, byId: Map<string, AddressRow>) {
  const from = e.fromAddressId ? byId.get(e.fromAddressId) : null;
  const to = e.toAddressId ? byId.get(e.toAddressId) : null;
  return {
    id: e.id,
    chain: e.chain,
    chainLabel: CHAIN_LABELS[e.chain] ?? e.chain,
    txHash: e.txHash,
    explorerUrl: explorerUrl(e.chain, "tx", e.txHash),
    kind: e.eventKind,
    status: e.status,
    severity: e.severity,
    from: from ? { address: from.displayAddress, section: from.listSection } : { address: e.externalFromAddress, section: "external" },
    to: to ? { address: to.displayAddress, section: to.listSection } : { address: e.externalToAddress, section: "external" },
    asset: e.assetSymbol,
    amount: String(e.amountDecimal),
    usdValueAtEvent: e.usdValueAtEvent !== null ? String(e.usdValueAtEvent) : null,
    blockHeight: e.blockHeight,
    chainObservedAt: e.chainObservedAt?.toISOString() ?? null,
    confirmations: e.confirmations,
    publicNote: e.publicNote,
  };
}
