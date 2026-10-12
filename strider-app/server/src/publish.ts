// Publishing orchestration shared by the "Post now" path and the scheduler.
//
// For each pending target of a post:
//   - Facebook + authMode "oauth"  -> real Graph API publish (POST /{page-id}/feed)
//   - Instagram + authMode "oauth" -> real Instagram Graph publish
//                                      (container -> READY -> media_publish)
//   - everything else              -> simulated publish (existing demo behavior)
//
// Bump comments follow the same split: real comments via
// POST /{facebook-post-id}/comments when the post went out through a real
// Facebook connection, simulated otherwise.

import { and, eq } from "drizzle-orm";
import type { AppCtx } from "./ctx.js";
import * as schema from "./schema.js";
import { decryptToken, publishPageComment, publishPagePost } from "./facebook.js";
import { publishInstagramMedia } from "./instagram.js";

export interface PublishSummary {
  published: number;
  failed: number;
  /** Targets published through the real Facebook API. */
  real: number;
  firstError: string | null;
}

async function realFacebookPostId(ctx: AppCtx, userId: number, body: string): Promise<string> {
  const rows = await ctx.db
    .select()
    .from(schema.facebookConnections)
    .where(eq(schema.facebookConnections.userId, userId))
    .limit(1);
  const conn = rows[0];
  if (!conn) throw new Error("Facebook is not connected with real OAuth. Reconnect the channel.");
  let pageToken: string;
  try {
    pageToken = decryptToken(conn.pageTokenEncrypted);
  } catch {
    throw new Error("The stored Facebook token could not be decrypted. Reconnect the channel.");
  }
  const { facebookPostId } = await publishPagePost({ pageId: conn.pageId, pageAccessToken: pageToken, message: body });
  return facebookPostId;
}

/**
 * Publishes a post's media to the connected Instagram business account via
 * the container flow. The media URL must be publicly reachable, so it is
 * built from APP_BASE_URL (the /media static route is public).
 */
async function realInstagramMediaId(
  ctx: AppCtx,
  userId: number,
  post: { body: string; mediaBlobKey: string | null; mediaType: string | null },
): Promise<string> {
  if (!post.mediaBlobKey) {
    throw new Error("Instagram requires an image or video. Add media or remove the Instagram target.");
  }
  const mediaType = (post.mediaType ?? "").startsWith("video/") ? "video" : "image";
  const base = (process.env.APP_BASE_URL || ctx.origin || "http://localhost:3000").replace(/\/+$/, "");
  const mediaUrl = `${base}/media/${post.mediaBlobKey}`;
  const rows = await ctx.db
    .select()
    .from(schema.instagramConnections)
    .where(eq(schema.instagramConnections.userId, userId))
    .limit(1);
  const conn = rows[0];
  if (!conn) throw new Error("Instagram is not connected with real OAuth. Reconnect the channel.");
  let userToken: string;
  try {
    userToken = decryptToken(conn.userTokenEncrypted);
  } catch {
    throw new Error("The stored Instagram token could not be decrypted. Reconnect the channel.");
  }
  const { mediaId } = await publishInstagramMedia({
    igUserId: conn.igUserId,
    userAccessToken: userToken,
    mediaUrl,
    mediaType,
    caption: post.body,
  });
  return mediaId;
}

/** Publishes every pending target of a post; updates target + post rows. */
export async function publishPendingTargets(ctx: AppCtx, postId: number): Promise<PublishSummary> {
  const postRows = await ctx.db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
  const post = postRows[0];
  const summary: PublishSummary = { published: 0, failed: 0, real: 0, firstError: null };
  if (!post) return summary;

  const targets = await ctx.db
    .select({ target: schema.postTargets, account: schema.connectedAccounts })
    .from(schema.postTargets)
    .innerJoin(schema.connectedAccounts, eq(schema.postTargets.accountId, schema.connectedAccounts.id))
    .where(and(eq(schema.postTargets.postId, postId), eq(schema.postTargets.status, "pending")));

  const now = new Date();
  for (const { target, account } of targets) {
    const isReal = account.authMode === "oauth" && (account.platform === "facebook" || account.platform === "instagram");
    if (isReal) {
      try {
        const remoteId = account.platform === "facebook"
          ? await realFacebookPostId(ctx, post.userId, post.body)
          : await realInstagramMediaId(ctx, post.userId, post);
        await ctx.db
          .update(schema.postTargets)
          .set({ status: "published", remoteId, publishedAt: now, errorMessage: null })
          .where(eq(schema.postTargets.id, target.id));
        summary.published += 1;
        summary.real += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!summary.firstError) summary.firstError = message;
        await ctx.db
          .update(schema.postTargets)
          .set({ status: "failed", errorMessage: message.slice(0, 500) })
          .where(eq(schema.postTargets.id, target.id));
        // OAuth token problems surface as "expired" so the UI prompts a reconnect.
        if (/code 190|invalid[_\s]?token|expired|session/i.test(message)) {
          await ctx.db.update(schema.connectedAccounts).set({ status: "expired" }).where(eq(schema.connectedAccounts.id, account.id));
        }
        summary.failed += 1;
      }
    } else {
      const remoteId = `demo-${crypto.randomUUID()}`;
      await ctx.db
        .update(schema.postTargets)
        .set({ status: "published", remoteId, publishedAt: now, errorMessage: null })
        .where(eq(schema.postTargets.id, target.id));
      summary.published += 1;
    }
  }

  const postStatus = summary.published > 0 ? "published" : summary.failed > 0 ? "failed" : "pending";
  await ctx.db.update(schema.posts).set({ status: postStatus, updatedAt: now }).where(eq(schema.posts.id, postId));
  return summary;
}

/** Publishes a single due bump comment (Post Bump). Real Facebook comments go
 *  out through POST /{post-id}/comments on every real Facebook target of the
 *  post; otherwise the comment is marked published as simulated. */
export async function publishBumpCommentNow(ctx: AppCtx, bumpId: number): Promise<{ ok: boolean; message: string }> {
  const bumpRows = await ctx.db.select().from(schema.bumpComments).where(eq(schema.bumpComments.id, bumpId)).limit(1);
  const bump = bumpRows[0];
  if (!bump || bump.status !== "pending") return { ok: false, message: "That comment is no longer pending." };

  const targets = await ctx.db
    .select({ target: schema.postTargets, account: schema.connectedAccounts })
    .from(schema.postTargets)
    .innerJoin(schema.connectedAccounts, eq(schema.postTargets.accountId, schema.connectedAccounts.id))
    .where(
      and(
        eq(schema.postTargets.postId, bump.postId),
        eq(schema.postTargets.status, "published"),
        eq(schema.connectedAccounts.platform, "facebook"),
        eq(schema.connectedAccounts.authMode, "oauth"),
      ),
    );
  const realTargets = targets.filter(
    ({ target }) => target.remoteId && !target.remoteId.startsWith("demo-"),
  );

  const mark = async (status: "published" | "failed", errorMessage: string | null) => {
    await ctx.db
      .update(schema.bumpComments)
      .set({ status, publishedAt: status === "published" ? new Date() : null, errorMessage })
      .where(eq(schema.bumpComments.id, bump.id));
  };

  if (realTargets.length === 0) {
    await mark("published", null);
    return { ok: true, message: "Comment published." };
  }

  const postRows = await ctx.db
    .select({ userId: schema.posts.userId })
    .from(schema.posts)
    .where(eq(schema.posts.id, bump.postId))
    .limit(1);
  const userId = postRows[0]?.userId;
  if (!userId) return { ok: false, message: "That post was not found." };
  const connRows = await ctx.db
    .select()
    .from(schema.facebookConnections)
    .where(eq(schema.facebookConnections.userId, userId))
    .limit(1);
  const conn = connRows[0];
  if (!conn) return { ok: false, message: "Facebook is not connected with real OAuth." };
  let pageToken: string;
  try {
    pageToken = decryptToken(conn.pageTokenEncrypted);
  } catch {
    return { ok: false, message: "The stored Facebook token could not be decrypted. Reconnect the channel." };
  }

  const errors: string[] = [];
  for (const { target } of realTargets) {
    try {
      await publishPageComment({ facebookPostId: target.remoteId as string, pageAccessToken: pageToken, message: bump.body });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length === 0) {
    await mark("published", null);
    return { ok: true, message: `Comment published to Facebook.` };
  }
  await mark("failed", errors.join(" | ").slice(0, 500));
  return { ok: false, message: `Facebook comment failed: ${errors[0]}` };
}
