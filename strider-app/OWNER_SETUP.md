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

## Railway variables — full list

| Variable | Platform |
|---|---|
| `FACEBOOK_APP_ID` / `FACEBOOK_CLIENT_SECRET` | Meta (Facebook + Instagram) |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | YouTube |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` | Billing |
| `X_MONTHLY_POST_CAP` (default 60) | X usage cap override |
| `TIKTOK_MONTHLY_POST_CAP` (default 60) | TikTok usage cap override |

After adding/updating variables, Railway redeploys automatically — wait for the
deploy to finish before testing Connect.
