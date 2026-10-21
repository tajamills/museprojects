# zepostia — Owner Platform Setup (one-time)

As the owner, you register **one app per platform**. This is a one-time setup —
customers never see any of this; they just click **Connect** and log in with the
platform.

All keys go into the zepostia service on Railway: **Variables** tab.

## 1. Facebook + Instagram (Meta) — ✅ done

- Meta app: **zepostia** (App ID `1811494946717877`)
- Railway vars: `FACEBOOK_APP_ID`, `FACEBOOK_CLIENT_SECRET`
- Callback: `https://zepostia.com/oauth/facebook/callback`
- Instagram callback: `https://zepostia.com/oauth/instagram/callback`
- Instagram publishing requires the customer's Instagram to be a **professional
  account linked to a Facebook Page** (customer-side, not your setup).
- Other customers can't connect until the app passes **Meta App Review**.

## 2. X — in progress

1. https://developer.x.com → **Default Project** (Pay Per Use) → create app **zepostia**
   (Production environment).
2. App settings → **User authentication settings** → Set up:
   - Type: **Web App, Automated App or Bot**
   - Callback URI: `https://zepostia.com/oauth/x/callback`
   - Website URL: `https://zepostia.com`
   - Scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`
3. Copy the **OAuth 2.0 Client ID** and **Client Secret**.
4. Railway vars: `X_CLIENT_ID`, `X_CLIENT_SECRET`
5. Fund credits in the X Developer Portal — X bills per tweet (pay-per-use,
   ~$0.015 per plain tweet, more for tweets with links). Every customer tweet
   bills your X account.

## 3. TikTok

1. https://developers.tiktok.com → create app → enable **Login Kit** and request
   the **Content Posting API** (scopes: `video.upload`, `video.publish`).
2. Add redirect URI: `https://zepostia.com/oauth/tiktok/callback`
3. Railway vars: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
4. Note: TikTok apps that haven't passed TikTok's audit can only publish
   **privately**. Real customer publishing needs audit approval.
5. **Sandbox mode** (for TikTok's app-review demo): set `TIKTOK_SANDBOX=true`
   plus `TIK_SAND_CLIENT` / `TIKTOK_SAND_SECRET` (the sandbox app's client key
   and secret from the developer portal's Sandbox view) in Railway. Sandbox
   uses the **same API host** as production — `open.tiktokapis.com`; TikTok
   has no separate sandbox host, the environment follows the client key. In
   sandbox mode only the sandbox app's registered target users can connect,
   and posts stay inside the sandbox. Remove `TIKTOK_SANDBOX` (or set it to
   anything but `true`) to return to production credentials.

## 4. YouTube

1. https://console.cloud.google.com → create project → enable **YouTube Data API v3**.
2. Credentials → Create **OAuth 2.0 Client ID** (Web application).
   - Authorized redirect URI: `https://zepostia.com/oauth/youtube/callback`
3. Railway vars: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`
4. Note: Google OAuth verification takes weeks. Default quota is 10,000 units/day;
   each upload costs ~1,600 units (≈6 uploads/day across all customers).

## 5. X posting add-on (Stripe tiers) — gates X posting

X posting is **never** included in the $19.88/month base plan. It is a
separate paid add-on because X's API is pay-per-use: every post a customer
publishes bills **your** X developer account (~$0.015 per plain post,
**$0.20 per post containing a link**). The add-on is sold in capped tiers —
plain posts and link posts are counted separately, mirroring X's two
rates — and posting hard-stops at the tier cap, so the maximum X cost per
customer is known in advance.

One-time setup (Stripe dashboard):

1. Create **one product**: **X Posting Add-on**.
2. Under that product, create **one recurring monthly price per tier**
   (e.g. $15, $30, $100 — your call; see the pricing guidance below).
3. Copy each price ID (`price_…`) into Railway as **one variable**,
   `STRIPE_X_TIERS` — a JSON array mapping each price ID to its tier name
   and monthly allowances:

   ```json
   [{"priceId":"price_…","name":"Starter","postsPerMonth":100,"linkPostsPerMonth":25},{"priceId":"price_…","name":"Growth","postsPerMonth":300,"linkPostsPerMonth":75},{"priceId":"price_…","name":"Pro","postsPerMonth":1000,"linkPostsPerMonth":250}]
   ```

4. That's it. Once `STRIPE_X_TIERS` is set and Railway redeploys, the
   add-on appears automatically on each customer's **Billing** page
   with the tier list, their current tier, and their usage vs cap.
   Customers add, switch, or remove a tier there; the change takes
   effect immediately, is kept in sync by the Stripe webhook (§6), and
   self-heals from Stripe on billing reads if a webhook event is ever
   missed. If `STRIPE_X_TIERS` is unset, the add-on is not offered
   anywhere in the app and X stays hidden as a platform.

**Tiers bill from day one — they never get the base plan's free
trial.** A customer can also pick a tier during checkout itself: the
tier's first month is charged on the Checkout page (it shows as an
amount due today, next to the base plan's "14 days free"), and from
month two the tier renews on its own separate Stripe subscription,
which the app creates automatically at checkout completion — no
extra setup step for you. Adding a tier later (from the Billing page)
creates that same add-on subscription and charges immediately. If the
base plan is canceled, the add-on subscription is canceled with it,
so a tier can never keep billing on its own.

**Pricing guidance:** each tier's price should cover X's raw cost for its
**full** allowance plus your markup: `posts × $0.015 + link posts × $0.20`.
Worked examples: 100 posts / 25 link posts → max raw cost **$6.50**;
300 / 75 → **$19.50**; 1,000 / 250 → **$65.00**. Because posting stops at
the cap, a customer can never cost you more than their tier's full-
allowance raw cost.

The add-on entitlement gates the X posting feature: a workspace can only
post to X while its subscription carries a tier, and only up to that
tier's caps for the current billing period.

## 6. Billing (Stripe) — base plan, webhook, and self-healing sync

The $19.88/month base plan needs `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`
in Railway. Checkout itself works with just those two.

**Register the webhook (one-time, Stripe dashboard):** Developers →
Webhooks → **Add endpoint**:

- URL: `https://zepostia.com/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`
- After creating it, open the endpoint, reveal its **Signing secret**
  (`whsec_…`), and put it in Railway as `STRIPE_WEBHOOK_SECRET`, then let
  Railway redeploy.

**The app does not depend on the webhook to notice a paid plan.** Every
billing read (and checkout / add-on action) first checks the local
subscription state; if it doesn't show a live subscription, the server
asks Stripe directly for the customer's subscriptions and repairs the
local record from Stripe's answer (`reconcileSubscriptionFromStripe` in
`server/src/billing.ts`). A customer who completes checkout therefore
sees their plan — and the X add-on tiers — on their next Billing page
load even if the webhook was never registered. The webhook is still
worth registering so changes made inside Stripe (portal cancellations,
failed payments) show up instantly instead of on the next billing read.

## 6b. Black Friday launch — captions pack + deal coupon (optional)

The Black Friday waitlist lives at `/black-friday` (capture) and
`/black-friday/youre-in` (confirmation). Two Stripe objects power the
money side; both are optional and each gates its own feature:

- **Captions pack (tripwire):** product **"90 Plug-and-Post Captions"**
  with a one-time **$8.88** price. Put that price's ID in Railway as
  `STRIPE_TRIPWIRE_PRICE_ID` and the confirmation page offers the pack
  (guest checkout; the download at `/black-friday/pack` is granted only
  after the server re-reads the checkout session from Stripe and sees
  it paid — `verifyBfPackSession`). Leave the variable unset and the
  pack is not mentioned anywhere. Sales land in `bf_pack_purchases`
  (webhook + read-time verification) and show in Settings → Owner
  setup, next to the waitlist export.
- **Black Friday deal (prep only):** a coupon of **$10.00 off,
  duration "once"** (first month $19.88 − $10.00 = **$9.88**, renewals
  $19.88). Put its ID in Railway as `STRIPE_BF_COUPON_ID`. It is
  applied ONLY by the separate `createBfCheckoutSession` action, ONLY
  inside the cart window **Fri Nov 27 – Mon Nov 30, 2026
  (America/New_York)** — the server refuses outside the window, and
  the regular checkout never sees the coupon. Nothing links to the BF
  checkout yet; wiring a button is a launch-window step.

## Railway variables — full list

| Variable | Platform |
|---|---|
| `FACEBOOK_APP_ID` / `FACEBOOK_CLIENT_SECRET` | Meta (Facebook + Instagram) |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | YouTube |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` | Billing |
| `STRIPE_X_TIERS` (JSON array — see §5) | X posting add-on tiers |
| `X_MONTHLY_POST_CAP` (default 60) | X usage cap override |
| `TIKTOK_MONTHLY_POST_CAP` (default 60) | TikTok usage cap override |

After adding/updating variables, Railway redeploys automatically — wait for the
deploy to finish before testing Connect.

## 7. 24-hour post bump (follow-up comments) — scope notes

The composer toggle "Keep this post moving for 24 hours" posts up to four
customer-written comments per platform at +1h / +6h / +12h / +23h after the
post publishes on that platform. Jobs are created per published target and
run through the same in-process scheduler as scheduled posts; outcomes
(posted / failed + a customer-safe reason) show in the post's bump plan.

Support matrix (verified against each platform's API):

- **Facebook** — works. `POST /{post-id}/comments` with the Page token;
  no new scope beyond the existing Page publishing setup.
- **Instagram** — works, needs a scope step. `POST /{ig-media-id}/comments`
  requires `instagram_manage_comments`, now included in the app's OAuth
  scopes. Until Meta App Review approves that permission, commenting can
  fail for accounts outside the app's roles — submit it with the next
  App Review round. **Existing Instagram connections must reconnect**
  once so the new scope is granted.
- **YouTube** — works, needs a scope step. `commentThreads.insert` (100
  quota units per comment; the free daily quota is 10,000, so four
  comments per post is comfortably inside it) requires the
  `youtube.force-ssl` scope, now included in the OAuth scopes. That is a
  **sensitive scope**: Google may require app verification before
  non-test users can grant it, and while the OAuth app is in Testing
  mode only listed test users can connect. **Existing YouTube
  connections must reconnect** once so the new scope is granted.
- **X** — works. A bump comment is a reply post (`in_reply_to_tweet_id`)
  through the existing X integration. It is gated by the X add-on
  exactly like a normal post (`canPostToX` before posting,
  `recordXPost` after; a reply containing a link counts against the
  link-post allowance). With no tier or no allowance left, the X bump
  job fails with that reason recorded — it does not retry forever.
  Note: this build also wired `recordXPost` into normal X publishes —
  before, createPost checked the counters but nothing incremented them,
  so tier caps could never actually bind.
- **TikTok** — NOT supported. The Content Posting API has no endpoint
  for posting comments, and the audited scope set
  (`user.info.basic`, `video.upload`, `video.publish`) includes no
  comment capability. The composer says "Not available for TikTok yet"
  when TikTok is selected. **Follow-up for the audit:** if TikTok ever
  offers a comment scope for third-party apps, request it then and
  enable bump for TikTok at that point.
