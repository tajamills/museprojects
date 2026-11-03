import { eq, and } from "drizzle-orm";
import { sha256Hex } from "./http.js";
import {
  CASE_SLUG,
  KNOWN_SOURCE_TX_HASHES,
  SEED_ADDRESSES,
  SEED_CLAIMS,
  SEED_SOURCES,
  SEED_VERSION,
  type SeedAddress,
} from "./seedData.js";
import * as s from "../schema.js";

// Seed validation + import (spec §11). The dry-run report is the acceptance
// artifact: exact counts, duplicates, transaction-hash rejections, the
// no-role list, section conflicts and shape anomalies. One anomaly is known
// and deliberate: the case file's Bitquery record list contains one
// 64-hex-character string presented among the addresses. By shape it cannot
// be an EVM address, so the importer quarantines it (never shows it as an
// active reported address) and records the correction until the source
// record is editorially fixed.

export function addressKey(chain: string, address: string): string {
  return chain === "ethereum" || chain === "arbitrum" ? address.toLowerCase() : address;
}

const SHAPES: Record<string, RegExp> = {
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  arbitrum: /^0x[0-9a-fA-F]{40}$/,
  bitcoin: /^bc1[0-9a-z]{20,80}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  xrp_ledger: /^r[0-9a-zA-Z]{24,34}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

export interface SeedDryRunReport {
  seedVersion: string;
  seedSha256: string;
  totalEntries: number;
  reportedCount: number;
  victimCount: number;
  byChain: Record<string, number>;
  duplicates: string[];
  txHashRejections: string[];
  shortenedRejections: string[];
  quarantinedAnomalies: { address: string; chain: string; reason: string }[];
  noRoleAddresses: string[];
  sectionConflicts: string[];
  missingSourceLinks: string[];
  knownSourceTxHashesExcluded: number;
  activeReportedAfterQuarantine: number;
  claimsCount: number;
  sourcesCount: number;
}

export function computeSeedHash(): string {
  return sha256Hex(JSON.stringify({ v: SEED_VERSION, sources: SEED_SOURCES, claims: SEED_CLAIMS, addresses: SEED_ADDRESSES }));
}

export function validateSeed(): SeedDryRunReport {
  const seen = new Map<string, SeedAddress>();
  const duplicates: string[] = [];
  const txHashRejections: string[] = [];
  const shortenedRejections: string[] = [];
  const quarantinedAnomalies: { address: string; chain: string; reason: string }[] = [];
  const noRoleAddresses: string[] = [];
  const missingSourceLinks: string[] = [];
  const sectionsByAddress = new Map<string, Set<string>>();

  for (const e of SEED_ADDRESSES) {
    const key = `${e.chain}:${addressKey(e.chain, e.address)}`;
    if (seen.has(key)) duplicates.push(e.address);
    seen.set(key, e);
    const secs = sectionsByAddress.get(key) ?? new Set<string>();
    secs.add(e.section);
    sectionsByAddress.set(key, secs);

    if (e.address.includes("…") || e.address.includes("...")) {
      shortenedRejections.push(e.address);
      continue;
    }
    if (KNOWN_SOURCE_TX_HASHES.some((h) => h.toLowerCase() === e.address.toLowerCase())) {
      txHashRejections.push(e.address);
      continue;
    }
    const shape = SHAPES[e.chain];
    if (shape && !shape.test(e.address)) {
      quarantinedAnomalies.push({
        address: e.address,
        chain: e.chain,
        reason:
          e.address.startsWith("0x") && e.address.length === 66
            ? "String is 64 hex characters (transaction-hash-shaped), not a 40-character EVM address. It appears in the case file's Bitquery record list but is not in the case file's §9 quarantine list. Held quarantined pending an editorial correction to the source record."
            : `Address does not match the ${e.chain} address shape.`,
      });
      continue;
    }
    if (e.section === "reported" && !e.roleText) noRoleAddresses.push(e.address);
    if (e.sourceLinks.length === 0) missingSourceLinks.push(e.address);
  }

  const sectionConflicts = [...sectionsByAddress.entries()].filter(([, secs]) => secs.size > 1).map(([k]) => k);
  const byChain: Record<string, number> = {};
  for (const e of SEED_ADDRESSES) byChain[e.chain] = (byChain[e.chain] ?? 0) + 1;
  const reportedCount = SEED_ADDRESSES.filter((e) => e.section === "reported").length;
  const victimCount = SEED_ADDRESSES.filter((e) => e.section === "victim_owned").length;

  return {
    seedVersion: SEED_VERSION,
    seedSha256: computeSeedHash(),
    totalEntries: SEED_ADDRESSES.length,
    reportedCount,
    victimCount,
    byChain,
    duplicates,
    txHashRejections,
    shortenedRejections,
    quarantinedAnomalies,
    noRoleAddresses,
    sectionConflicts,
    missingSourceLinks,
    knownSourceTxHashesExcluded: KNOWN_SOURCE_TX_HASHES.length,
    activeReportedAfterQuarantine: reportedCount - quarantinedAnomalies.filter((q) => q.chain !== "").length,
    claimsCount: SEED_CLAIMS.length,
    sourcesCount: SEED_SOURCES.length,
  };
}

type Db = typeof import("../db.js").db;

export async function runSeedImport(
  db: Db,
  mode: "dry_run" | "commit",
  actor: string,
): Promise<SeedDryRunReport & { batchId: string | null }> {
  const report = validateSeed();
  const [watchCase] = await db.select().from(s.watchCases).where(eq(s.watchCases.slug, CASE_SLUG)).limit(1);
  if (!watchCase) throw new Error("Watch case row missing — migration 0013 not applied");

  if (mode === "commit") {
    // Sources (match on publisher + title; the schema has no unique key).
    const sourceIdByKey = new Map<string, string>();
    for (const src of SEED_SOURCES) {
      const existing = await db
        .select()
        .from(s.watchSources)
        .where(and(eq(s.watchSources.publisher, src.publisher), eq(s.watchSources.title, src.title)))
        .limit(1);
      if (existing[0]) {
        sourceIdByKey.set(src.key, existing[0].id);
      } else {
        const [row] = await db
          .insert(s.watchSources)
          .values({
            publisher: src.publisher,
            title: src.title,
            url: src.url,
            sourceType: src.sourceType,
            publishedAt: src.publishedAt ? new Date(src.publishedAt) : null,
            retrievedAt: new Date("2026-10-31T00:00:00Z"),
          })
          .returning();
        sourceIdByKey.set(src.key, row.id);
      }
    }

    // Claims (unique on case + claim_key).
    for (const c of SEED_CLAIMS) {
      const sourceId = sourceIdByKey.get(c.sourceKey);
      if (!sourceId) throw new Error(`Claim ${c.claimKey} references unknown source ${c.sourceKey}`);
      await db
        .insert(s.watchCaseClaims)
        .values({
          caseId: watchCase.id,
          claimKey: c.claimKey,
          claimType: c.claimType,
          displayLabel: c.displayLabel,
          displayValue: c.displayValue,
          sourceId,
          sourceLocator: c.sourceLocator,
          asOfAt: c.asOf ? new Date(c.asOf) : null,
          displayOrder: c.displayOrder,
        })
        .onConflictDoUpdate({
          target: [s.watchCaseClaims.caseId, s.watchCaseClaims.claimKey],
          set: {
            displayLabel: c.displayLabel,
            displayValue: c.displayValue,
            sourceId,
            sourceLocator: c.sourceLocator,
            asOfAt: c.asOf ? new Date(c.asOf) : null,
            displayOrder: c.displayOrder,
            updatedAt: new Date(),
          },
        });
    }

    // Addresses + source links.
    const anomalyAddrs = new Set(report.quarantinedAnomalies.map((q) => q.address.toLowerCase()));
    for (const e of SEED_ADDRESSES) {
      const key = addressKey(e.chain, e.address);
      const isAnomaly = anomalyAddrs.has(e.address.toLowerCase());
      const roleSourceId = e.sourceLinks[0] ? sourceIdByKey.get(e.sourceLinks[0].sourceKey) : undefined;
      const [row] = await db
        .insert(s.watchAddresses)
        .values({
          caseId: watchCase.id,
          chain: e.chain,
          network: "mainnet",
          address: e.address,
          addressKey: key,
          displayAddress: e.displayAddress,
          listSection: isAnomaly ? "quarantined" : e.section,
          roleText: e.roleText,
          roleSourceId: roleSourceId ?? null,
          status: isAnomaly ? "suspended" : "reported_not_yet_checked",
          anchorPriority: e.anchor,
          frozenState: e.frozenState,
          baselineStatus: "pending",
          isTest: watchCase.isTest,
        })
        .onConflictDoUpdate({
          target: [s.watchAddresses.caseId, s.watchAddresses.chain, s.watchAddresses.network, s.watchAddresses.addressKey],
          set: {
            displayAddress: e.displayAddress,
            listSection: isAnomaly ? "quarantined" : e.section,
            roleText: e.roleText,
            roleSourceId: roleSourceId ?? null,
            anchorPriority: e.anchor,
            frozenState: e.frozenState,
            updatedAt: new Date(),
          },
        })
        .returning();

      let linkIdx = 0;
      for (const link of e.sourceLinks) {
        const sourceId = sourceIdByKey.get(link.sourceKey);
        if (!sourceId) continue;
        // The source's own role/snapshot wording is attached to the primary
        // (first) source link only — repeating it under every source would
        // misattribute one source's snapshot to the others (§4.3).
        const isPrimary = linkIdx === 0;
        linkIdx++;
        await db
          .insert(s.watchAddressSources)
          .values({
            addressId: row.id,
            sourceId,
            sourceLocator: link.locator,
            reportedRoleText: isPrimary ? e.reportedRoleText : null,
            reportedSnapshotText: isPrimary ? e.reportedSnapshotText : null,
            matchMethod: "full_string",
          })
          .onConflictDoNothing();
      }

      if (isAnomaly) {
        const existing = await db
          .select()
          .from(s.watchCorrections)
          .where(
            and(
              eq(s.watchCorrections.caseId, watchCase.id),
              eq(s.watchCorrections.entityType, "address"),
              eq(s.watchCorrections.entityId, row.id),
              eq(s.watchCorrections.fieldChanged, "list_section"),
            ),
          )
          .limit(1);
        if (!existing[0]) {
          await db.insert(s.watchCorrections).values({
            caseId: watchCase.id,
            entityType: "address",
            entityId: row.id,
            fieldChanged: "list_section",
            oldValue: "reported",
            newValue: "quarantined",
            reason: report.quarantinedAnomalies.find((q) => q.address.toLowerCase() === e.address.toLowerCase())?.reason ?? "Shape anomaly",
            correctedBy: actor,
          });
        }
      }
    }
  }

  const [batch] = await db
    .insert(s.watchImportBatches)
    .values({
      caseId: watchCase.id,
      seedVersion: SEED_VERSION,
      seedSha256: report.seedSha256,
      mode,
      reportJson: report as unknown as Record<string, unknown>,
      importedBy: actor,
    })
    .returning();

  return { ...report, batchId: batch.id };
}
