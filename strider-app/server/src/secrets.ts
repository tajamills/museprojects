// Secret handling.
//
// The app stores per-platform OAuth configuration in the `platform_configs`
// Postgres table. Client IDs and secret *references* (e.g.
// "vault://marketing-app/facebook/client-secret") live there; raw secret
// values must never be stored in the database, returned by actions, or
// written to logs.
//
// Real secret values can be supplied through per-platform environment
// variables, which take precedence over any vault reference once the live
// OAuth handlers exist. The app currently runs in demo mode, so these
// overrides are only plumbed through `resolvePlatformSecret` for the future
// OAuth publish path — nothing calls it yet.

const PLATFORM_SECRET_ENV: Record<string, string> = {
  facebook: "FACEBOOK_CLIENT_SECRET",
  instagram: "INSTAGRAM_CLIENT_SECRET",
  tiktok: "TIKTOK_CLIENT_SECRET",
  youtube: "YOUTUBE_CLIENT_SECRET",
  x: "X_CLIENT_SECRET",
};

/** Returns the real secret value for a platform when one is configured via
 *  env, otherwise null. Never logs or returns anything else. */
export function resolvePlatformSecret(platform: string): string | null {
  const envKey = PLATFORM_SECRET_ENV[platform];
  if (!envKey) return null;
  const value = process.env[envKey];
  return value && value.length > 0 ? value : null;
}

/** Lists which platforms currently have a secret override configured.
 *  Reports booleans only — never values. */
export function platformsWithSecretOverride(): string[] {
  return Object.entries(PLATFORM_SECRET_ENV)
    .filter(([, envKey]) => Boolean(process.env[envKey]))
    .map(([platform]) => platform);
}
