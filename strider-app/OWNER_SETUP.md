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
   add-on appears automatically in each customer's **Settings → Billing**
   with the tier list, their current tier, and their usage vs cap.
   Customers add, switch, or remove a tier there; the change is applied
   to their existing Stripe subscription and synced back by the Stripe
   webhook. If `STRIPE_X_TIERS` is unset, the add-on is not offered
   anywhere in the app and X stays hidden as a platform.

**Pricing guidance:** each tier's price should cover X's raw cost for its
**full** allowance plus your markup: `posts × $0.015 + link posts × $0.20`.
Worked examples: 100 posts / 25 link posts → max raw cost **$6.50**;
300 / 75 → **$19.50**; 1,000 / 250 → **$65.00**. Because posting stops at
the cap, a customer can never cost you more than their tier's full-
allowance raw cost.

The add-on entitlement gates the X posting feature: a workspace can only
post to X while its subscription carries a tier, and only up to that
tier's caps for the current billing period.

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
