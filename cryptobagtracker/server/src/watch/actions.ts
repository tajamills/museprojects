import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { isComped } from "../entitlement.js";
import { CASE_SLUG } from "./seedData.js";
import { runSeedImport } from "./importer.js";
import { watchFlags } from "./flags.js";
import { providerHealthViews } from "./monitor.js";
import { buildEvidencePacket } from "./packet.js";

// Signed-in watch actions (follow / configure / in-app feed) and the owner
// admin surface (spec §10.4). Following is a read-side preference: any
// signed-in account may follow and configure (§10.2); DELIVERY is what the
// entitlement gate controls (§8). Admin actions require a comped (owner)
// account and write an audit row for every change.

interface CtxLike {
  db: NodePgDatabase<typeof schema>;
  invalidateQueries: () => void;
  origin: string | null;
  ip: string | null;
}

const tokenRequest = z.object({ token: z.string().min(1) });

async function requireWatchUser(ctx: CtxLike, token: string) {
  const rows = await ctx.db.select().from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1);
  const session = rows[0];
  if (!session) throw new Error("Your session has expired. Sign in again.");
  const users = await ctx.db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  const user = users[0];
  if (!user) throw new Error("Account not found.");
  return user;
}

async function requireWatchAdmin(ctx: CtxLike, token: string) {
  const user = await requireWatchUser(ctx, token);
  if (!isComped(user)) throw new Error("That area is for support only.");
  return user;
}

async function audit(
  ctx: CtxLike,
  actorUserId: number,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
  reason?: string,
) {
  await ctx.db.insert(schema.watchAdminAudit).values({
    actorUserId,
    action,
    entityType,
    entityId,
    beforeJson: (before ?? null) as Record<string, unknown> | null,
    afterJson: (after ?? null) as Record<string, unknown> | null,
    reason: reason ?? null,
  });
}

async function caseBySlug(ctx: CtxLike, slug: string) {
  const [row] = await ctx.db.select().from(schema.watchCases).where(eq(schema.watchCases.slug, slug)).limit(1);
  if (!row) throw new Error("Case not found.");
  return row;
}

export const WatchActions = {
  watchGetMyState: {
    request: tokenRequest,
    response: z.any(),
    handler: async (ctx: CtxLike, args: z.infer<typeof tokenRequest>) => {
      const user = await requireWatchUser(ctx, args.token);
      const watchCase = await caseBySlug(ctx, CASE_SLUG);
      const [sub] = await ctx.db
        .select()
        .from(schema.watchSubscriptions)
        .where(and(eq(schema.watchSubscriptions.userId, user.id), eq(schema.watchSubscriptions.caseId, watchCase.id)))
        .limit(1);
      const deliveries = await ctx.db
        .select({ delivery: schema.watchDeliveries, event: schema.watchEvents })
        .from(schema.watchDeliveries)
        .innerJoin(schema.watchEvents, eq(schema.watchDeliveries.eventId, schema.watchEvents.id))
        .where(and(eq(schema.watchDeliveries.userId, user.id), eq(schema.watchDeliveries.channel, "in_app")))
        .orderBy(desc(schema.watchDeliveries.createdAt))
        .limit(50);
      return {
        isAdmin: isComped(user),
        case: { slug: watchCase.slug, title: watchCase.title },
        subscription: sub
          ? { minSeverity: sub.minSeverity, telegramEnabled: sub.telegramEnabled, inAppEnabled: sub.inAppEnabled }
          : null,
        feed: deliveries.map(({ delivery, event }) => ({
          deliveryStatus: delivery.status,
          at: delivery.createdAt.toISOString(),
          event: {
            chain: event.chain,
            txHash: event.txHash,
            kind: event.eventKind,
            status: event.status,
            severity: event.severity,
            asset: event.assetSymbol,
            amount: String(event.amountDecimal),
            usdValueAtEvent: event.usdValueAtEvent !== null ? String(event.usdValueAtEvent) : null,
            chainObservedAt: event.chainObservedAt?.toISOString() ?? null,
            publicNote: event.publicNote,
          },
        })),
      };
    },
  },

  watchFollowCase: {
    request: tokenRequest.extend({ slug: z.string().min(1) }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; slug: string }) => {
      const user = await requireWatchUser(ctx, args.token);
      const watchCase = await caseBySlug(ctx, args.slug);
      await ctx.db
        .insert(schema.watchSubscriptions)
        .values({ userId: user.id, caseId: watchCase.id, isTest: watchCase.isTest })
        .onConflictDoNothing();
      return { ok: true };
    },
  },

  watchUnfollowCase: {
    request: tokenRequest.extend({ slug: z.string().min(1) }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; slug: string }) => {
      const user = await requireWatchUser(ctx, args.token);
      const watchCase = await caseBySlug(ctx, args.slug);
      await ctx.db
        .delete(schema.watchSubscriptions)
        .where(and(eq(schema.watchSubscriptions.userId, user.id), eq(schema.watchSubscriptions.caseId, watchCase.id)));
      return { ok: true };
    },
  },

  watchUpdateSubscription: {
    request: tokenRequest.extend({
      slug: z.string().min(1),
      minSeverity: z.enum(["low", "medium", "high"]),
      telegramEnabled: z.boolean(),
      inAppEnabled: z.boolean(),
    }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; slug: string; minSeverity: string; telegramEnabled: boolean; inAppEnabled: boolean }) => {
      const user = await requireWatchUser(ctx, args.token);
      const watchCase = await caseBySlug(ctx, args.slug);
      await ctx.db
        .insert(schema.watchSubscriptions)
        .values({
          userId: user.id,
          caseId: watchCase.id,
          minSeverity: args.minSeverity,
          telegramEnabled: args.telegramEnabled,
          inAppEnabled: args.inAppEnabled,
          isTest: watchCase.isTest,
        })
        .onConflictDoUpdate({
          target: [schema.watchSubscriptions.userId, schema.watchSubscriptions.caseId],
          set: {
            minSeverity: args.minSeverity,
            telegramEnabled: args.telegramEnabled,
            inAppEnabled: args.inAppEnabled,
            updatedAt: new Date(),
          },
        });
      return { ok: true };
    },
  },

  // ---------------- owner admin ----------------

  watchAdminOverview: {
    request: tokenRequest,
    response: z.any(),
    handler: async (ctx: CtxLike, args: z.infer<typeof tokenRequest>) => {
      await requireWatchAdmin(ctx, args.token);
      const watchCase = await caseBySlug(ctx, CASE_SLUG);
      const addresses = await ctx.db.select().from(schema.watchAddresses).where(eq(schema.watchAddresses.caseId, watchCase.id));
      const batches = await ctx.db
        .select()
        .from(schema.watchImportBatches)
        .where(eq(schema.watchImportBatches.caseId, watchCase.id))
        .orderBy(desc(schema.watchImportBatches.createdAt))
        .limit(5);
      const corrections = await ctx.db
        .select()
        .from(schema.watchCorrections)
        .where(eq(schema.watchCorrections.caseId, watchCase.id))
        .orderBy(desc(schema.watchCorrections.createdAt))
        .limit(25);
      const bountyChecks = await ctx.db
        .select()
        .from(schema.watchBountyChecks)
        .where(eq(schema.watchBountyChecks.caseId, watchCase.id))
        .orderBy(desc(schema.watchBountyChecks.checkedAt))
        .limit(25);
      const deliveries = await ctx.db
        .select()
        .from(schema.watchDeliveries)
        .orderBy(desc(schema.watchDeliveries.createdAt))
        .limit(500);
      const deliveryStats: Record<string, number> = {};
      for (const d of deliveries) deliveryStats[d.status] = (deliveryStats[d.status] ?? 0) + 1;
      return {
        flags: {
          publicEnv: watchFlags.publicEnabled(),
          monitorEnv: watchFlags.monitorEnabled(),
          alertsEnv: watchFlags.alertsEnabled(),
          packetEnv: watchFlags.packetEnabled(),
          importEnv: watchFlags.importEnabled(),
        },
        case: {
          slug: watchCase.slug,
          title: watchCase.title,
          status: watchCase.status,
          publicEnabled: watchCase.publicEnabled,
          monitoringEnabled: watchCase.monitoringEnabled,
          alertsEnabled: watchCase.alertsEnabled,
          isTest: watchCase.isTest,
        },
        counts: {
          reported: addresses.filter((a) => a.listSection === "reported").length,
          victimOwned: addresses.filter((a) => a.listSection === "victim_owned").length,
          quarantined: addresses.filter((a) => a.listSection === "quarantined").length,
          baselined: addresses.filter((a) => a.baselineStatus === "complete").length,
        },
        providers: providerHealthViews(),
        importBatches: batches.map((b) => ({
          id: b.id, mode: b.mode, seedVersion: b.seedVersion, seedSha256: b.seedSha256,
          importedBy: b.importedBy, at: b.createdAt.toISOString(), report: b.reportJson,
        })),
        corrections: corrections.map((c) => ({
          id: c.id, at: c.createdAt.toISOString(), entityType: c.entityType, entityId: c.entityId,
          field: c.fieldChanged, oldValue: c.oldValue, newValue: c.newValue, reason: c.reason,
          correctedBy: c.correctedBy, approvedBy: c.approvedBy,
        })),
        bountyChecks: bountyChecks.map((b) => ({
          id: b.id, target: b.target, checkedBy: b.checkedBy, method: b.method,
          result: b.resultSummary, sourceUrl: b.sourceUrl, publicStatusChanged: b.publicStatusChanged,
          approvedBy: b.approvedBy, checkedAt: b.checkedAt.toISOString(),
        })),
        deliveryStats,
      };
    },
  },

  watchAdminRunImport: {
    request: tokenRequest.extend({ mode: z.enum(["dry_run", "commit"]) }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; mode: "dry_run" | "commit" }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      if (args.mode === "commit" && !watchFlags.importEnabled()) {
        throw new Error("Seed import is disabled (WATCH_IMPORT_ENABLED is off). Dry runs are always available.");
      }
      const report = await runSeedImport(ctx.db, args.mode, user.email);
      await audit(ctx, user.id, `seed_import_${args.mode}`, "case", null, null, report, `seed ${report.seedVersion} sha ${report.seedSha256.slice(0, 12)}`);
      return report;
    },
  },

  watchAdminSetCaseSwitches: {
    request: tokenRequest.extend({
      slug: z.string().min(1),
      publicEnabled: z.boolean().optional(),
      monitoringEnabled: z.boolean().optional(),
      alertsEnabled: z.boolean().optional(),
    }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; slug: string; publicEnabled?: boolean; monitoringEnabled?: boolean; alertsEnabled?: boolean }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      const watchCase = await caseBySlug(ctx, args.slug);
      const before = {
        publicEnabled: watchCase.publicEnabled,
        monitoringEnabled: watchCase.monitoringEnabled,
        alertsEnabled: watchCase.alertsEnabled,
      };
      const after = {
        publicEnabled: args.publicEnabled ?? before.publicEnabled,
        monitoringEnabled: args.monitoringEnabled ?? before.monitoringEnabled,
        alertsEnabled: args.alertsEnabled ?? before.alertsEnabled,
      };
      await ctx.db.update(schema.watchCases).set({ ...after, updatedAt: new Date() }).where(eq(schema.watchCases.id, watchCase.id));
      await audit(ctx, user.id, "set_case_switches", "case", watchCase.id, before, after);
      return { ok: true, ...after };
    },
  },

  watchAdminSetAddressSection: {
    request: tokenRequest.extend({
      addressId: z.string().uuid(),
      section: z.enum(["reported", "victim_owned", "quarantined"]),
      reason: z.string().min(3),
    }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; addressId: string; section: string; reason: string }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      const [addr] = await ctx.db.select().from(schema.watchAddresses).where(eq(schema.watchAddresses.id, args.addressId)).limit(1);
      if (!addr) throw new Error("Address not found.");
      const before = { listSection: addr.listSection, status: addr.status };
      const after = {
        listSection: args.section,
        status: args.section === "quarantined" ? "suspended" : addr.status === "suspended" ? "reported_not_yet_checked" : addr.status,
      };
      await ctx.db.update(schema.watchAddresses).set({ ...after, updatedAt: new Date() }).where(eq(schema.watchAddresses.id, addr.id));
      await ctx.db.insert(schema.watchCorrections).values({
        caseId: addr.caseId,
        entityType: "address",
        entityId: addr.id,
        fieldChanged: "list_section",
        oldValue: before.listSection,
        newValue: after.listSection,
        reason: args.reason,
        correctedBy: user.email,
      });
      await audit(ctx, user.id, "set_address_section", "address", addr.id, before, after, args.reason);
      return { ok: true };
    },
  },

  watchAdminCorrectClaim: {
    request: tokenRequest.extend({
      claimId: z.string().uuid(),
      displayValue: z.string().min(1),
      reason: z.string().min(3),
    }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; claimId: string; displayValue: string; reason: string }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      const [claim] = await ctx.db.select().from(schema.watchCaseClaims).where(eq(schema.watchCaseClaims.id, args.claimId)).limit(1);
      if (!claim) throw new Error("Claim not found.");
      await ctx.db
        .update(schema.watchCaseClaims)
        .set({ displayValue: args.displayValue, updatedAt: new Date() })
        .where(eq(schema.watchCaseClaims.id, claim.id));
      await ctx.db.insert(schema.watchCorrections).values({
        caseId: claim.caseId,
        entityType: "claim",
        entityId: claim.id,
        fieldChanged: "display_value",
        oldValue: claim.displayValue,
        newValue: args.displayValue,
        reason: args.reason,
        correctedBy: user.email,
        sourceId: claim.sourceId,
      });
      await audit(ctx, user.id, "correct_claim", "claim", claim.id, { displayValue: claim.displayValue }, { displayValue: args.displayValue }, args.reason);
      return { ok: true };
    },
  },

  watchAdminRetractEvent: {
    request: tokenRequest.extend({ eventId: z.string().uuid(), reason: z.string().min(3) }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; eventId: string; reason: string }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      const [ev] = await ctx.db.select().from(schema.watchEvents).where(eq(schema.watchEvents.id, args.eventId)).limit(1);
      if (!ev) throw new Error("Event not found.");
      await ctx.db
        .update(schema.watchEvents)
        .set({ status: "retracted", retractedAt: new Date(), retractionReason: args.reason, updatedAt: new Date() })
        .where(eq(schema.watchEvents.id, ev.id));
      await ctx.db.insert(schema.watchCorrections).values({
        caseId: ev.caseId,
        entityType: "event",
        entityId: ev.id,
        fieldChanged: "status",
        oldValue: ev.status,
        newValue: "retracted",
        reason: args.reason,
        correctedBy: user.email,
      });
      await audit(ctx, user.id, "retract_event", "event", ev.id, { status: ev.status }, { status: "retracted" }, args.reason);
      return { ok: true };
    },
  },

  watchAdminRecordBountyCheck: {
    request: tokenRequest.extend({
      target: z.string().min(1),
      method: z.string().min(1),
      resultSummary: z.string().min(1),
      sourceUrl: z.string().url().optional(),
      nextCheckAt: z.string().datetime().optional(),
    }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; target: string; method: string; resultSummary: string; sourceUrl?: string; nextCheckAt?: string }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      const watchCase = await caseBySlug(ctx, CASE_SLUG);
      const [row] = await ctx.db
        .insert(schema.watchBountyChecks)
        .values({
          caseId: watchCase.id,
          target: args.target,
          checkedBy: user.email,
          method: args.method,
          resultSummary: args.resultSummary,
          sourceUrl: args.sourceUrl ?? null,
          nextCheckAt: args.nextCheckAt ? new Date(args.nextCheckAt) : null,
          publicStatusChanged: false,
        })
        .returning();
      await audit(ctx, user.id, "record_bounty_check", "bounty_check", row.id, null, { target: args.target, result: args.resultSummary });
      return { ok: true, id: row.id };
    },
  },

  watchAdminSetBountyStatus: {
    request: tokenRequest.extend({
      claimKey: z.string().min(1),
      displayValue: z.string().min(1),
      approvedBy: z.string().min(1),
      reason: z.string().min(3),
    }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; claimKey: string; displayValue: string; approvedBy: string; reason: string }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      // A public bounty status change is a claim correction AND requires a
      // recorded approval (spec §9.5): an unverified lead never changes
      // public copy, and this action refuses to run without the approval
      // record.
      const watchCase = await caseBySlug(ctx, CASE_SLUG);
      const [claim] = await ctx.db
        .select()
        .from(schema.watchCaseClaims)
        .where(and(eq(schema.watchCaseClaims.caseId, watchCase.id), eq(schema.watchCaseClaims.claimKey, args.claimKey)))
        .limit(1);
      if (!claim) throw new Error("Bounty claim not found.");
      await ctx.db
        .update(schema.watchCaseClaims)
        .set({ displayValue: args.displayValue, updatedAt: new Date() })
        .where(eq(schema.watchCaseClaims.id, claim.id));
      await ctx.db.insert(schema.watchCorrections).values({
        caseId: watchCase.id,
        entityType: "claim",
        entityId: claim.id,
        fieldChanged: "display_value",
        oldValue: claim.displayValue,
        newValue: args.displayValue,
        reason: args.reason,
        correctedBy: user.email,
        approvedBy: args.approvedBy,
        sourceId: claim.sourceId,
      });
      await ctx.db.insert(schema.watchBountyChecks).values({
        caseId: watchCase.id,
        target: "binance_case_bounty",
        checkedBy: user.email,
        method: "admin_status_change",
        resultSummary: `Public bounty status changed: ${args.displayValue}`,
        publicStatusChanged: true,
        approvedBy: args.approvedBy,
      });
      await audit(ctx, user.id, "set_bounty_status", "claim", claim.id, { displayValue: claim.displayValue }, { displayValue: args.displayValue, approvedBy: args.approvedBy }, args.reason);
      return { ok: true };
    },
  },

  watchAdminExportPacket: {
    request: tokenRequest.extend({
      slug: z.string().min(1),
      format: z.enum(["json", "csv", "html"]),
    }),
    response: z.any(),
    handler: async (ctx: CtxLike, args: { token: string; slug: string; format: "json" | "csv" | "html" }) => {
      const user = await requireWatchAdmin(ctx, args.token);
      if (!watchFlags.packetEnabled()) {
        throw new Error("The evidence packet builder is disabled (WATCH_PACKET_ENABLED is off).");
      }
      const watchCase = await caseBySlug(ctx, args.slug);
      const bundle = await buildEvidencePacket(ctx.db, watchCase.id, user.email);
      await audit(ctx, user.id, "export_packet", "case", watchCase.id, null, { format: args.format, sha256: bundle.sha256, events: bundle.eventCount, addresses: bundle.addressCount });
      return {
        filename: `watch-evidence-${watchCase.slug}.${args.format === "json" ? "json" : args.format}`,
        sha256: bundle.sha256,
        eventCount: bundle.eventCount,
        addressCount: bundle.addressCount,
        content: args.format === "json" ? bundle.json : args.format === "csv" ? bundle.csv : bundle.html,
      };
    },
  },
};
