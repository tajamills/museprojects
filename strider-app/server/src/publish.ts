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
import { decryptToken, encryptToken, publishPageComment, publishPagePost } from "./facebook.js";
import { publishInstagramMedia } from "./instagram.js";
import {
  getValidTikTokAccessToken,
  ownerTikTokCredentials,
  publishTikTokVideo,
  TikTokApiError,
} from "./tiktok.js";
import { refreshAccessToken, uploadYoutubeVideo, YoutubeApiError } from "./youtube.js";
import {
  getValidXAccessToken,
  ownerXCredentials,
  postTweet,
  XApiError,
  X_MAX_TWEET_LENGTH,
} from "./x.js";
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
