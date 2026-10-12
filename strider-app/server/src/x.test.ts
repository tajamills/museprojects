// Unit tests for server/src/x.ts — X OAuth 2.0 + PKCE client.
// Run: npx esbuild server/src/x.test.ts --bundle --platform=node --format=esm --outfile=/tmp/x-test.mjs && node /tmp/x-test.mjs
import assert from "node:assert";
import {
  X_OAUTH_SCOPES,
  buildXAuthUrl,
  exchangeXCodeForToken,
  generateCodeChallenge,
  generateCodeVerifier,
  getXUserInfo,
  isRealXConfig,
  postTweet,
  refreshXToken,
  xRedirectUri,
  XApiError,
} from "./x.js";

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  return (async (url: any, init: any) => ({
    ok: true,
    status: 200,
    json: async () => handler(String(url), init as RequestInit),
  })) as typeof fetch;
}

// 1. PKCE verifier: 43-128 chars, URL-safe alphabet.
{
  const v = generateCodeVerifier();
  assert.ok(v.length >= 43 && v.length <= 128, `verifier length ${v.length}`);
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(v), "verifier is base64url");
  assert.notEqual(generateCodeVerifier(), v, "verifiers differ");
  console.log("ok - generateCodeVerifier");
}

// 2. PKCE challenge: RFC 7636 Appendix B test vector.
{
  const challenge = generateCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.strictEqual(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c");
  console.log("ok - generateCodeChallenge (RFC 7636 vector)");
}

// 3. Auth URL carries every required OAuth 2.0 + PKCE parameter.
{
  const url = new URL(
    buildXAuthUrl({
      clientId: "abc123",
      redirectUri: "https://zepostia.com/oauth/x/callback",
      state: "state-xyz",
      codeChallenge: "challenge-abc",
    }),
  );
  assert.strictEqual(url.origin + url.pathname, "https://twitter.com/i/oauth2/authorize");
  assert.strictEqual(url.searchParams.get("response_type"), "code");
  assert.strictEqual(url.searchParams.get("client_id"), "abc123");
  assert.strictEqual(url.searchParams.get("redirect_uri"), "https://zepostia.com/oauth/x/callback");
  assert.strictEqual(url.searchParams.get("state"), "state-xyz");
  assert.strictEqual(url.searchParams.get("code_challenge"), "challenge-abc");
  assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
  const scope = url.searchParams.get("scope") ?? "";
  for (const s of X_OAUTH_SCOPES) assert.ok(scope.split(" ").includes(s), `scope ${s}`);
  console.log("ok - buildXAuthUrl");
}

// 4. Redirect URI: override wins, otherwise derived from APP_BASE_URL.
{
  const prevOverride = process.env.X_REDIRECT_URI;
  const prevBase = process.env.APP_BASE_URL;
  process.env.X_REDIRECT_URI = "https://custom.example/cb/";
  assert.strictEqual(xRedirectUri(null), "https://custom.example/cb");
  delete process.env.X_REDIRECT_URI;
  process.env.APP_BASE_URL = "https://zepostia.com/";
  assert.strictEqual(xRedirectUri(null), "https://zepostia.com/oauth/x/callback");
  assert.strictEqual(xRedirectUri("https://other.example"), "https://zepostia.com/oauth/x/callback");
  if (prevOverride === undefined) delete process.env.X_REDIRECT_URI;
  else process.env.X_REDIRECT_URI = prevOverride;
  if (prevBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = prevBase;
  console.log("ok - xRedirectUri");
}

// 5. Real-config detection.
{
  assert.ok(isRealXConfig("abc123", true));
  assert.ok(!isRealXConfig("DEMO_X", true));
  assert.ok(!isRealXConfig("abc123", false));
  assert.ok(!isRealXConfig("", true));
  console.log("ok - isRealXConfig");
}

// 6. Token exchange: Basic auth header + PKCE verifier in form body.
{
  let seenAuth = "";
  let seenBody = "";
  const fetch = mockFetch((url, init) => {
    assert.strictEqual(url, "https://api.twitter.com/2/oauth2/token");
    seenAuth = String(init.headers && (init.headers as Record<string, string>).authorization);
    seenBody = String(init.body);
    return { access_token: "at", refresh_token: "rt", expires_in: 7200 };
  });
  const tokens = await exchangeXCodeForToken(
    {
      clientId: "cid",
      clientSecret: "csec",
      redirectUri: "https://zepostia.com/oauth/x/callback",
      code: "code123",
      codeVerifier: "verifier123",
    },
    fetch,
  );
  assert.strictEqual(seenAuth, `Basic ${Buffer.from("cid:csec").toString("base64")}`);
  const body = new URLSearchParams(seenBody);
  assert.strictEqual(body.get("grant_type"), "authorization_code");
  assert.strictEqual(body.get("code"), "code123");
  assert.strictEqual(body.get("code_verifier"), "verifier123");
  assert.strictEqual(body.get("redirect_uri"), "https://zepostia.com/oauth/x/callback");
  assert.strictEqual(tokens.accessToken, "at");
  assert.strictEqual(tokens.refreshToken, "rt");
  assert.strictEqual(tokens.expiresIn, 7200);
  console.log("ok - exchangeXCodeForToken");
}

// 7. Token exchange failure surfaces the OAuth error description.
{
  const fetch = (async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "invalid_grant", error_description: "Code expired" }),
  })) as unknown as typeof globalThis.fetch;
  await assert.rejects(
    () => exchangeXCodeForToken({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x", codeVerifier: "v" }, fetch),
    (err: unknown) => err instanceof XApiError && /Code expired/.test(err.message),
  );
  console.log("ok - exchangeXCodeForToken error path");
}

// 8. Refresh flow uses grant_type=refresh_token and parses the pair.
{
  let seenBody = "";
  const fetch = mockFetch((_url, init) => {
    seenBody = String(init.body);
    return { access_token: "at2", refresh_token: "rt2", expires_in: 7200 };
  });
  const tokens = await refreshXToken({ clientId: "cid", clientSecret: "csec", refreshToken: "old-rt" }, fetch);
  assert.strictEqual(new URLSearchParams(seenBody).get("grant_type"), "refresh_token");
  assert.strictEqual(new URLSearchParams(seenBody).get("refresh_token"), "old-rt");
  assert.strictEqual(tokens.accessToken, "at2");
  console.log("ok - refreshXToken");
}

// 9. User info parses /2/users/me.
{
  const fetch = mockFetch((url, init) => {
    assert.strictEqual(url, "https://api.twitter.com/2/users/me");
    assert.strictEqual((init.headers as Record<string, string>).authorization, "Bearer tok");
    return { data: { id: "123", username: "layla", name: "Layla" } };
  });
  const info = await getXUserInfo("tok", fetch);
  assert.strictEqual(info.id, "123");
  assert.strictEqual(info.username, "layla");
  console.log("ok - getXUserInfo");
}

// 10. postTweet: endpoint, JSON body, id parsing, 280-char guard.
{
  let seenUrl = "";
  let seenBody = "";
  const fetch = mockFetch((url, init) => {
    seenUrl = url;
    seenBody = String(init.body);
    return { data: { id: "tweet-1", text: "hi" } };
  });
  const { tweetId } = await postTweet({ accessToken: "tok", text: "hi" }, fetch);
  assert.strictEqual(seenUrl, "https://api.twitter.com/2/tweets");
  assert.deepStrictEqual(JSON.parse(seenBody), { text: "hi" });
  assert.strictEqual(tweetId, "tweet-1");
  await assert.rejects(
    () => postTweet({ accessToken: "tok", text: "x".repeat(281) }, fetch),
    (err: unknown) => err instanceof XApiError && /280/.test(err.message),
  );
  console.log("ok - postTweet");
}

console.log("\nAll X unit tests passed.");
