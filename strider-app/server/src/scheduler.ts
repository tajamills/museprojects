import { and, eq, lte } from "drizzle-orm";
import type { AppCtx } from "./ctx.js";
import * as schema from "./schema.js";
import { publishBumpCommentNow, publishPendingTargets } from "./publish.js";

// In-process scheduler. The original Hatch app had no scheduler at all —
// scheduled posts stayed "pending" until cancelled, and demo bump comments
// only advanced when a user clicked "Run next demo comment". For a
// standalone Railway deployment we need the queue to actually drain, so this
// worker loop runs inside the Express process and ticks every
// SCHEDULER_INTERVAL_MS (default 30s).
//
// IMPORTANT: this only makes sense with a single replica. Two processes
// ticking against the same database would double-publish. See DEPLOY.md.
//
// Demo-mode semantics: targets without real OAuth credentials are still
// "published" with a `demo-` remote id, exactly like the original "Post now"
// path. Facebook targets with a real OAuth connection publish through the
// Graph API (see publish.ts).

export async function publishDuePosts(ctx: AppCtx): Promise<number> {
  const now = new Date();
  const due = await ctx.db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.status, "pending"), lte(schema.posts.scheduledAt, now)));
  for (const post of due) {
    try {
      await publishPendingTargets(ctx, post.id);
    } catch (err) {
      console.error(`[scheduler] failed to publish post ${post.id}:`, err);
    }
  }
  return due.length;
}

export async function publishDueBumpComments(ctx: AppCtx): Promise<number> {
  const now = new Date();
  const due = await ctx.db
    .select({ id: schema.bumpComments.id })
    .from(schema.bumpComments)
    .where(and(eq(schema.bumpComments.status, "pending"), lte(schema.bumpComments.scheduledAt, now)));
  for (const bump of due) {
    try {
      await publishBumpCommentNow(ctx, bump.id);
    } catch (err) {
      console.error(`[scheduler] failed to publish bump comment ${bump.id}:`, err);
    }
  }
  return due.length;
}

export async function pruneExpiredSessions(ctx: AppCtx): Promise<number> {
  const result = await ctx.db
    .delete(schema.sessions)
    .where(lte(schema.sessions.expiresAt, new Date()))
    .returning({ id: schema.sessions.id });
  return result.length;
}

export function startScheduler(ctx: AppCtx): () => void {
  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000);
  const tick = async () => {
    try {
      const [posts, bumps, sessions] = await Promise.all([
        publishDuePosts(ctx),
        publishDueBumpComments(ctx),
        pruneExpiredSessions(ctx),
      ]);
      if (posts > 0 || bumps > 0 || sessions > 0) {
        console.log(`[scheduler] published ${posts} due post(s), ${bumps} due bump comment(s), pruned ${sessions} expired session(s)`);
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  // First pass shortly after boot so nothing waits a full interval.
  setTimeout(tick, 5_000).unref?.();
  console.log(`[scheduler] started (interval ${intervalMs}ms, single-replica)`);
  return () => clearInterval(timer);
}
