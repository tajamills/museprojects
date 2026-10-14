// Publishing orchestration shared by the "Post now" path and the scheduler.
//
// For each pending target of a post:
//   - Facebook + authMode "oauth"  -> real Graph API publish (POST /{page-id}/feed)
//   - Instagram + authMode "oauth" -> real Instagram Graph publish
//                                      (container -> READY -> media_publish)
//   - everything else              -> simulated publish (existing demo behavior)
//
// Bump comments (24-hour post bump) execute as per-target jobs: when a
// target publishes, one job per written bump comment is created for that
// target at publish +1h/+6h/+12h/+23h (by slot), and the scheduler posts
// each comment on its own platform — Facebook comment, Instagram
// comment, YouTube comment, or an X reply (metered against the X add-on
// allowance). TikTok gets no jobs: the Content Posting API has no
// comment endpoint for third-party apps. Simulated targets' jobs are
// marked published as simulated, exactly like their posts.

import { and, eq } from "drizzle-orm";
import type { AppCtx } from "./ctx.js";
import * as schema from "./schema.js";
import { decryptToken, encryptToken, publishPageComment, publishPagePost } from "./facebook.js";
import { publishInstagramComment, publishInstagramMedia } from "./instagram.js";
import {
  getValidTikTokAccessToken,
  ownerTikTokCredentials,
  publishTikTokVideo,
  TikTokApiError,
} from "./tiktok.js";
import { postYoutubeComment, refreshAccessToken, uploadYoutubeVideo, YoutubeApiError } from "./youtube.js";
import {
  getValidXAccessToken,
  ownerXCredentials,
  postTweet,
  XApiError,
  X_MAX_TWEET_LENGTH,
} from "./x.js";
import {
  canPostToX,
  isXAddonConfigured,
  recordXPost,
  xAddonUsagePeriod,
  type BillingPeriod,
} from "./billing.js";

/** Bump slot offsets in hours: comment field 1 posts at +1h, field 2 at
 *  +6h, field 3 at +12h, field 4 at +23h after the target publishes.
 *  Empty fields are skipped and keep their slot (no re-compaction). */
export const BUMP_SLOT_OFFSETS_HOURS = [1, 6, 12, 23] as const;

/** Platforms whose APIs can post a follow-up comment on an own post. */
export const BUMP_SUPPORTED_PLATFORMS = ["facebook", "instagram", "youtube", "x"] as const;
import { resolvePlatformSecret } from "./secrets.js";
import { resolveMediaDir } from "./ctx.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

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

/**
 * Returns a valid YouTube access token for the user, refreshing and
 * persisting it when it is expired or about to expire. Shared by the
 * upload flow and the bump-comment executor.
 */
async function getValidYoutubeAccessToken(ctx: AppCtx, userId: number): Promise<string> {
  const rows = await ctx.db
    .select()
    .from(schema.youtubeConnections)
    .where(eq(schema.youtubeConnections.userId, userId))
    .limit(1);
  const conn = rows[0];
  if (!conn) throw new Error("YouTube is not connected with real OAuth. Reconnect the channel.");
  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decryptToken(conn.accessTokenEncrypted);
    refreshToken = decryptToken(conn.refreshTokenEncrypted);
  } catch {
    throw new Error("The stored YouTube token could not be decrypted. Reconnect the channel.");
  }
  // Refresh when expired or within 60s of expiry.
  if (conn.expiresAt.getTime() - Date.now() < 60 * 1000) {
    const clientId = (process.env.YOUTUBE_CLIENT_ID ?? "").trim();
    const clientSecret = resolvePlatformSecret("youtube");
    if (!clientId || clientId.startsWith("DEMO_") || !clientSecret) {
      throw new Error("YouTube isn't set up on the server. Reconnect the channel.");
    }
    try {
      const tokens = await refreshAccessToken({ clientId, clientSecret, refreshToken });
      accessToken = tokens.accessToken;
      if (tokens.refreshToken) refreshToken = tokens.refreshToken;
      await ctx.db
        .update(schema.youtubeConnections)
        .set({
          accessTokenEncrypted: encryptToken(accessToken),
          refreshTokenEncrypted: encryptToken(refreshToken),
          expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          updatedAt: new Date(),
        })
        .where(eq(schema.youtubeConnections.id, conn.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/invalid_grant|revoked/i.test(msg)) {
        throw new Error("YouTube access was revoked. Reconnect the channel.");
      }
      throw new Error(`YouTube token refresh failed: ${msg}`);
    }
  }
  return accessToken;
}

/**
 * Uploads a post's video to the connected YouTube channel via the resumable
 * upload flow. Requires a video file and a title (enforced by the composer
 * and createPost; double-checked here). Refreshes the access token when it
 * is expired or about to expire, persisting the new one.
 */
async function realYoutubeVideoId(
  ctx: AppCtx,
  userId: number,
  post: { body: string; youtubeTitle: string | null; mediaBlobKey: string | null; mediaType: string | null; mediaName: string | null },
): Promise<string> {
  if (!post.mediaBlobKey) {
    throw new Error("YouTube requires a video and a title. Add both or remove the YouTube target.");
  }
  if (!(post.mediaType ?? "").startsWith("video/")) {
    throw new Error("YouTube requires a video and a title. Add both or remove the YouTube target.");
  }
  const title = (post.youtubeTitle ?? "").trim() || (post.body ?? "").trim().slice(0, 100);
  if (!title) {
    throw new Error("YouTube requires a video and a title. Add both or remove the YouTube target.");
  }
  const accessToken = await getValidYoutubeAccessToken(ctx, userId);
  let videoBytes: Buffer;
  try {
    const mediaPath = path.join(resolveMediaDir(), post.mediaBlobKey);
    videoBytes = await readFile(mediaPath);
  } catch {
    throw new Error("The video file for this post is missing. Re-upload it and try again.");
  }
  try {
    const { videoId } = await uploadYoutubeVideo({
      accessToken,
      videoBytes: new Uint8Array(videoBytes),
      mimeType: post.mediaType as string,
      title,
      description: post.body ?? "",
    });
    return videoId;
  } catch (err) {
    if (err instanceof YoutubeApiError && err.status === 401) {
      throw new Error("YouTube rejected the upload (unauthorized). Reconnect the channel.");
    }
    throw err;
  }
}

/**
 * Publishes a post's video to the connected TikTok account via direct post
 * (FILE_UPLOAD). Requires a video file (enforced by the composer and
 * createPost; double-checked here). Refreshes the access token when it is
 * expired or about to expire, persisting the new one.
 */
export const TIKTOK_MONTHLY_POST_CAP = Number(process.env.TIKTOK_MONTHLY_POST_CAP ?? "60") || 60;

async function checkTikTokMonthlyCap(db: AppCtx["db"], userId: number): Promise<void> {
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rows = await db.select().from(schema.tiktokMonthlyUsage)
    .where(and(eq(schema.tiktokMonthlyUsage.userId, userId), eq(schema.tiktokMonthlyUsage.yearMonth, ym))).limit(1);
  const used = rows[0]?.postCount ?? 0;
  if (used >= TIKTOK_MONTHLY_POST_CAP) {
    throw new Error(`You've used your ${TIKTOK_MONTHLY_POST_CAP} TikTok posts for this month. Your limit resets on the 1st.`);
  }
}

async function incrementTikTokMonthlyUsage(db: AppCtx["db"], userId: number): Promise<void> {
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rows = await db.select().from(schema.tiktokMonthlyUsage)
    .where(and(eq(schema.tiktokMonthlyUsage.userId, userId), eq(schema.tiktokMonthlyUsage.yearMonth, ym))).limit(1);
  if (rows[0]) {
    await db.update(schema.tiktokMonthlyUsage)
      .set({ postCount: rows[0].postCount + 1 })
      .where(and(eq(schema.tiktokMonthlyUsage.userId, userId), eq(schema.tiktokMonthlyUsage.yearMonth, ym)));
  } else {
    await db.insert(schema.tiktokMonthlyUsage).values({ userId, yearMonth: ym, postCount: 1 });
  }
}

async function realTikTokPublishId(
  ctx: AppCtx,
  userId: number,
  post: { body: string; mediaBlobKey: string | null; mediaType: string | null },
): Promise<string> {
  if (!post.mediaBlobKey) {
    throw new Error("TikTok requires a video. Add a video or remove the TikTok target.");
  }
  if (!(post.mediaType ?? "").startsWith("video/")) {
    throw new Error("TikTok requires a video. Add a video or remove the TikTok target.");
  }
  await checkTikTokMonthlyCap(ctx.db, userId);
  const creds = ownerTikTokCredentials();
  if (!creds.ok) throw new Error("TikTok isn't set up on the server. Reconnect the channel.");
  const accessToken = await getValidTikTokAccessToken(ctx.db, userId, {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  let videoBytes: Buffer;
  try {
    const mediaPath = path.join(resolveMediaDir(), post.mediaBlobKey);
    videoBytes = await readFile(mediaPath);
  } catch {
    throw new Error("The video file for this post is missing. Re-upload it and try again.");
  }
  try {
    const { publishId } = await publishTikTokVideo({
      accessToken,
      caption: post.body ?? "",
      video: videoBytes,
    });
    await incrementTikTokMonthlyUsage(ctx.db, userId);
    return publishId;
  } catch (err) {
    if (err instanceof TikTokApiError && err.code === "unaudited_client_can_only_post_to_private_accounts") {
      throw new Error("TikTok only allows private posts until the app passes audit. The video was not published.");
    }
    throw err;
  }
}

/**
 * Posts a tweet to the connected X account. Enforces the 280-character
 * limit server-side (the composer enforces it client-side too). Refreshes
 * the access token when expired, persisting the new one.
 */
/** Max X posts per user per calendar month. Worst case ($0.20/link tweet) keeps
 *  owner cost well under the $19.88 subscription. Override with X_MONTHLY_POST_CAP. */
export const X_MONTHLY_POST_CAP = Number(process.env.X_MONTHLY_POST_CAP ?? "60") || 60;

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function checkXMonthlyCap(db: AppCtx["db"], userId: number): Promise<void> {
  const ym = currentYearMonth();
  const rows = await db.select().from(schema.xMonthlyUsage)
    .where(and(eq(schema.xMonthlyUsage.userId, userId), eq(schema.xMonthlyUsage.yearMonth, ym))).limit(1);
  const used = rows[0]?.postCount ?? 0;
  if (used >= X_MONTHLY_POST_CAP) {
    throw new Error(`You've used your ${X_MONTHLY_POST_CAP} X posts for this month. Your limit resets on the 1st.`);
  }
}

async function incrementXMonthlyUsage(db: AppCtx["db"], userId: number): Promise<void> {
  const ym = currentYearMonth();
  const rows = await db.select().from(schema.xMonthlyUsage)
    .where(and(eq(schema.xMonthlyUsage.userId, userId), eq(schema.xMonthlyUsage.yearMonth, ym))).limit(1);
  if (rows[0]) {
    await db.update(schema.xMonthlyUsage)
      .set({ postCount: rows[0].postCount + 1 })
      .where(and(eq(schema.xMonthlyUsage.userId, userId), eq(schema.xMonthlyUsage.yearMonth, ym)));
  } else {
    await db.insert(schema.xMonthlyUsage).values({ userId, yearMonth: ym, postCount: 1 });
  }
}

async function realXTweetId(
  ctx: AppCtx,
  userId: number,
  body: string,
): Promise<string> {
  const text = (body ?? "").trim();
  if (!text) throw new Error("Add text before posting to X.");
  if (text.length > X_MAX_TWEET_LENGTH) {
    throw new Error(`This post is ${text.length} characters; X allows ${X_MAX_TWEET_LENGTH}.`);
  }
  const creds = ownerXCredentials();
  if (!creds.ok) throw new Error("X isn't set up on the server. Reconnect the channel.");
  await checkXMonthlyCap(ctx.db, userId);
  const accessToken = await getValidXAccessToken(ctx.db, userId, {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  try {
    const { tweetId } = await postTweet({ accessToken, text });
    await incrementXMonthlyUsage(ctx.db, userId);
    return tweetId;
  } catch (err) {
    if (err instanceof XApiError && /unauthorized|forbidden/i.test(err.message)) {
      throw new Error("X rejected the tweet (unauthorized). Reconnect the channel.");
    }
    throw err;
  }
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
    const isReal = account.authMode === "oauth" && (account.platform === "facebook" || account.platform === "instagram" || account.platform === "youtube" || account.platform === "tiktok" || account.platform === "x");
    if (isReal) {
      try {
        const remoteId = account.platform === "facebook"
          ? await realFacebookPostId(ctx, post.userId, post.body)
          : account.platform === "instagram"
            ? await realInstagramMediaId(ctx, post.userId, post)
            : account.platform === "tiktok"
              ? await realTikTokPublishId(ctx, post.userId, post)
              : account.platform === "x"
                ? await realXTweetId(ctx, post.userId, post.body)
                : await realYoutubeVideoId(ctx, post.userId, post);
        await ctx.db
          .update(schema.postTargets)
          .set({ status: "published", remoteId, publishedAt: now, errorMessage: null })
          .where(eq(schema.postTargets.id, target.id));
        summary.published += 1;
        summary.real += 1;
        if (account.platform === "x") {
          await recordXAddonUsageForPublish(ctx, post.userId, post.body);
        }
        await createBumpJobsForTarget(ctx, post, target.id, account.platform, now);
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
      await createBumpJobsForTarget(ctx, post, target.id, account.platform, now);
    }
  }

  const postStatus = summary.published > 0 ? "published" : summary.failed > 0 ? "failed" : "pending";
  await ctx.db.update(schema.posts).set({ status: postStatus, updatedAt: now }).where(eq(schema.posts.id, postId));
  return summary;
}

/**
 * Records one published X post against the add-on usage counters.
 * Before this, the createPost gate read the counters but nothing ever
 * incremented them for real posts, so tier caps could never bind.
 * Best-effort by design: a metering failure must never fail a publish
 * that already succeeded. No-op unless the add-on is configured and the
 * workspace has a synced tier period.
 */
async function recordXAddonUsageForPublish(ctx: AppCtx, userId: number, body: string): Promise<void> {
  try {
    if (!isXAddonConfigured()) return;
    const rows = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const user = rows[0];
    if (!user?.xAddonTierPriceId) return;
    const period: BillingPeriod | null = xAddonUsagePeriod(user);
    if (!period) return;
    await recordXPost(ctx.db, userId, period, { hasLink: /https?:\/\/|www\./i.test(body ?? "") });
  } catch (err) {
    console.error(`[publish] failed to record X add-on usage for user ${userId}:`, err);
  }
}

/**
 * Creates the bump jobs for one freshly published target: one job per
 * written bump comment, anchored to the target's actual publish time
 * (slot offsets +1h/+6h/+12h/+23h). TikTok targets are skipped — the
 * Content Posting API cannot post comments. Idempotent per
 * (comment, target) so a re-run never duplicates a job.
 */
async function createBumpJobsForTarget(
  ctx: AppCtx,
  post: { id: number; bumpEnabled: boolean },
  targetId: number,
  platform: string,
  publishedAt: Date,
): Promise<void> {
  if (!post.bumpEnabled) return;
  if (!(BUMP_SUPPORTED_PLATFORMS as readonly string[]).includes(platform)) return;
  const plan = await ctx.db
    .select()
    .from(schema.bumpComments)
    .where(and(eq(schema.bumpComments.postId, post.id), eq(schema.bumpComments.status, "pending")))
    .orderBy(schema.bumpComments.sequence);
  for (const comment of plan) {
    const offsetHours = BUMP_SLOT_OFFSETS_HOURS[comment.sequence - 1] ?? 23;
    const existing = await ctx.db
      .select({ id: schema.bumpCommentJobs.id })
      .from(schema.bumpCommentJobs)
      .where(and(eq(schema.bumpCommentJobs.bumpCommentId, comment.id), eq(schema.bumpCommentJobs.targetId, targetId)))
      .limit(1);
    if (existing[0]) continue;
    await ctx.db.insert(schema.bumpCommentJobs).values({
      bumpCommentId: comment.id,
      targetId,
      platform: platform as typeof schema.bumpCommentJobs.$inferInsert.platform,
      status: "pending",
      scheduledAt: new Date(publishedAt.getTime() + offsetHours * 60 * 60 * 1000),
      publishedAt: null,
      errorMessage: null,
      remoteId: null,
    });
  }
}

/** Recomputes a bump plan comment's aggregate status from its jobs:
 *  pending while any job is pending; published when at least one job
 *  posted and none are left; failed when every executed job failed. */
async function refreshBumpPlanStatus(ctx: AppCtx, bumpCommentId: number): Promise<void> {
  const jobs = await ctx.db
    .select()
    .from(schema.bumpCommentJobs)
    .where(eq(schema.bumpCommentJobs.bumpCommentId, bumpCommentId));
  if (jobs.length === 0) return;
  const commentRows = await ctx.db.select().from(schema.bumpComments).where(eq(schema.bumpComments.id, bumpCommentId)).limit(1);
  const comment = commentRows[0];
  if (!comment || comment.status === "cancelled") return;
  if (jobs.some((job) => job.status === "pending")) {
    if (comment.status !== "pending") {
      await ctx.db.update(schema.bumpComments).set({ status: "pending" }).where(eq(schema.bumpComments.id, bumpCommentId));
    }
    return;
  }
  const publishedJobs = jobs.filter((job) => job.status === "published");
  if (publishedJobs.length > 0) {
    const last = publishedJobs.reduce<Date | null>((acc, job) => (job.publishedAt && (!acc || job.publishedAt > acc) ? job.publishedAt : acc), null);
    await ctx.db
      .update(schema.bumpComments)
      .set({ status: "published", publishedAt: last ?? new Date(), errorMessage: null })
      .where(eq(schema.bumpComments.id, bumpCommentId));
    return;
  }
  const firstFailure = jobs.find((job) => job.status === "failed");
  if (firstFailure) {
    await ctx.db
      .update(schema.bumpComments)
      .set({ status: "failed", errorMessage: firstFailure.errorMessage })
      .where(eq(schema.bumpComments.id, bumpCommentId));
  }
}

/**
 * Executes one due bump job: posts the comment on the job's platform.
 * Failure reasons recorded on the job are always customer-safe (never
 * raw API text). A failed job is never retried — same policy as posts.
 */
export async function publishBumpJobNow(ctx: AppCtx, jobId: number): Promise<{ ok: boolean; message: string }> {
  const jobRows = await ctx.db.select().from(schema.bumpCommentJobs).where(eq(schema.bumpCommentJobs.id, jobId)).limit(1);
  const job = jobRows[0];
  if (!job || job.status !== "pending") return { ok: false, message: "That comment is no longer pending." };

  const commentRows = await ctx.db.select().from(schema.bumpComments).where(eq(schema.bumpComments.id, job.bumpCommentId)).limit(1);
  const comment = commentRows[0];
  const targetRows = await ctx.db
    .select({ target: schema.postTargets, account: schema.connectedAccounts })
    .from(schema.postTargets)
    .innerJoin(schema.connectedAccounts, eq(schema.postTargets.accountId, schema.connectedAccounts.id))
    .where(eq(schema.postTargets.id, job.targetId))
    .limit(1);
  const found = targetRows[0];
  if (!comment || !found) {
    await ctx.db.update(schema.bumpCommentJobs).set({ status: "failed", errorMessage: "The original post is no longer available." }).where(eq(schema.bumpCommentJobs.id, job.id));
    if (comment) await refreshBumpPlanStatus(ctx, comment.id);
    return { ok: false, message: "The original post is no longer available." };
  }
  const { target, account } = found;
  const postRows = await ctx.db.select().from(schema.posts).where(eq(schema.posts.id, comment.postId)).limit(1);
  const post = postRows[0];
  if (!post) return { ok: false, message: "That post was not found." };
  const userId = post.userId;

  const mark = async (status: "published" | "failed", errorMessage: string | null, remoteId: string | null = null) => {
    await ctx.db
      .update(schema.bumpCommentJobs)
      .set({ status, publishedAt: status === "published" ? new Date() : null, errorMessage, remoteId })
      .where(eq(schema.bumpCommentJobs.id, job.id));
    await refreshBumpPlanStatus(ctx, comment.id);
  };

  // Simulated targets (no real OAuth) resolve as simulated, like posts.
  if (account.authMode !== "oauth" || !target.remoteId || target.remoteId.startsWith("demo-")) {
    await mark("published", null);
    return { ok: true, message: "Comment published." };
  }

  const platformLabel = job.platform === "x" ? "X" : job.platform.charAt(0).toUpperCase() + job.platform.slice(1);
  try {
    let remoteId: string | null = null;
    if (job.platform === "facebook") {
      remoteId = await postFacebookBumpComment(ctx, userId, target.remoteId, comment.body, account.id);
    } else if (job.platform === "instagram") {
      remoteId = await postInstagramBumpComment(ctx, userId, target.remoteId, comment.body);
    } else if (job.platform === "youtube") {
      const accessToken = await getValidYoutubeAccessToken(ctx, userId);
      const result = await postYoutubeComment({ accessToken, videoId: target.remoteId, text: comment.body });
      remoteId = result.commentId;
    } else if (job.platform === "x") {
      remoteId = await postXBumpReply(ctx, userId, target.remoteId, comment.body);
    } else {
      await mark("failed", `Follow-up comments aren't available for ${platformLabel} yet.`);
      return { ok: false, message: `Follow-up comments aren't available for ${platformLabel} yet.` };
    }
    await mark("published", null, remoteId);
    return { ok: true, message: `Comment published to ${platformLabel}.` };
  } catch (err) {
    const reason = customerSafeBumpFailure(job.platform, err);
    await mark("failed", reason);
    return { ok: false, message: reason };
  }
}

/** Maps a platform failure to a customer-safe reason (never raw API text). */
function customerSafeBumpFailure(platform: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const label = platform === "x" ? "X" : platform.charAt(0).toUpperCase() + platform.slice(1);
  if (/needs an active X add-on|add-on limit|isn't set up/i.test(raw)) return raw;
  if (platform === "instagram" && /code 10|code 200|permission|not authorized/i.test(raw)) {
    return "Instagram needs a reconnect to allow follow-up comments.";
  }
  if (platform === "youtube" && /insufficientPermissions|forbidden|unauthorized|revoked|decrypt/i.test(raw)) {
    return "YouTube needs a reconnect to allow follow-up comments.";
  }
  if (platform === "youtube" && /quota/i.test(raw)) {
    return "YouTube's daily limit was reached — the comment wasn't posted.";
  }
  if (platform === "x" && /characters/i.test(raw)) {
    return "That follow-up comment is over X's 280-character limit.";
  }
  if (/not connected|decrypt|revoked|expired|code 190/i.test(raw)) {
    return `${label} needs a reconnect to allow follow-up comments.`;
  }
  return `The comment couldn't be posted to ${label}.`;
}

async function postFacebookBumpComment(ctx: AppCtx, userId: number, facebookPostId: string, body: string, accountId: number): Promise<string> {
  const connRows = await ctx.db
    .select()
    .from(schema.facebookConnections)
    .where(eq(schema.facebookConnections.userId, userId))
    .limit(1);
  const conn = connRows[0];
  if (!conn) throw new Error("Facebook is not connected with real OAuth.");
  let pageToken: string;
  try {
    pageToken = decryptToken(conn.pageTokenEncrypted);
  } catch {
    throw new Error("The stored Facebook token could not be decrypted.");
  }
  try {
    const { commentId } = await publishPageComment({ facebookPostId, pageAccessToken: pageToken, message: body });
    return commentId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/code 190|invalid[_\s]?token|expired|session/i.test(message)) {
      await ctx.db.update(schema.connectedAccounts).set({ status: "expired" }).where(eq(schema.connectedAccounts.id, accountId));
    }
    throw err;
  }
}

async function postInstagramBumpComment(ctx: AppCtx, userId: number, igMediaId: string, body: string): Promise<string> {
  const connRows = await ctx.db
    .select()
    .from(schema.instagramConnections)
    .where(eq(schema.instagramConnections.userId, userId))
    .limit(1);
  const conn = connRows[0];
  if (!conn) throw new Error("Instagram is not connected with real OAuth.");
  let userToken: string;
  try {
    userToken = decryptToken(conn.userTokenEncrypted);
  } catch {
    throw new Error("The stored Instagram token could not be decrypted.");
  }
  const { commentId } = await publishInstagramComment({ igMediaId, userAccessToken: userToken, message: body });
  return commentId;
}

/**
 * Posts an X bump reply. A reply is a normal X post for billing: it is
 * gated by canPostToX (when the add-on is configured) BEFORE posting —
 * a reply containing a link counts against the link-post allowance —
 * and recorded with recordXPost after it lands. The legacy monthly
 * safety cap applies too, exactly like a regular post.
 */
async function postXBumpReply(ctx: AppCtx, userId: number, inReplyToTweetId: string, body: string): Promise<string> {
  const text = body.trim();
  if (text.length > X_MAX_TWEET_LENGTH) {
    throw new Error(`That follow-up comment is ${text.length} characters; X allows ${X_MAX_TWEET_LENGTH}.`);
  }
  const hasLink = /https?:\/\/|www\./i.test(text);
  let period: BillingPeriod | null = null;
  if (isXAddonConfigured()) {
    const userRows = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const user = userRows[0];
    const gate = user ? await canPostToX(ctx.db, user, { hasLink }) : null;
    if (!gate?.allowed) {
      if (gate?.reason === "cap_reached") throw new Error("Your X add-on limit for this billing period is used up.");
      if (gate?.reason === "not_configured") throw new Error("X posting isn't set up.");
      throw new Error("X follow-up comments need an active X add-on tier.");
    }
    if (gate.usage?.periodStart && gate.usage?.periodEnd) {
      period = { start: gate.usage.periodStart, end: gate.usage.periodEnd };
    }
  }
  const creds = ownerXCredentials();
  if (!creds.ok) throw new Error("X isn't set up on the server.");
  await checkXMonthlyCap(ctx.db, userId);
  const accessToken = await getValidXAccessToken(ctx.db, userId, {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  const { tweetId } = await postTweet({ accessToken, text, replyToTweetId: inReplyToTweetId });
  await incrementXMonthlyUsage(ctx.db, userId);
  if (period) {
    await recordXPost(ctx.db, userId, period, { hasLink });
  }
  return tweetId;
}
