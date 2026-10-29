// Tiny API helpers for checkout, sign-in, and server-served chapters.
export interface SiteConfig {
  checkoutEnabled: boolean;
  signInEnabled: boolean;
  authEnabled: boolean;
  bookCheckoutEnabled: boolean;
}

const FALLBACK_CONFIG: SiteConfig = {
  checkoutEnabled: false,
  signInEnabled: false,
  authEnabled: false,
  bookCheckoutEnabled: false,
};

let configPromise: Promise<SiteConfig> | null = null;

export function getConfig(): Promise<SiteConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/config")
      .then((r) => (r.ok ? (r.json() as Promise<SiteConfig>) : FALLBACK_CONFIG))
      .catch(() => FALLBACK_CONFIG);
  }
  return configPromise;
}

/**
 * Start checkout for a catalog item. On success the browser leaves for
 * Stripe. When checkout isn't connected yet (or Stripe refuses), returns
 * "unavailable" so the caller can route to the honest notice page — this
 * never pretends a purchase happened.
 */
export async function startCheckout(itemId: string, note?: string): Promise<"redirecting" | "unavailable"> {
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId, note }),
    });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { url?: string };
    if (data.url) {
      window.location.assign(data.url);
      return "redirecting";
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

// ------------------------------------------------------------- accounts
export interface MeInfo {
  user: { email: string } | null;
  /** Book ids this account owns (lifetime entitlements). */
  entitlements: string[];
}

export async function fetchMe(): Promise<MeInfo> {
  try {
    // Identity must never come from a cache: after sign-out/sign-in the
    // previous answer is actively wrong, not just stale.
    const res = await fetch("/api/me", { cache: "no-store" });
    if (!res.ok) return { user: null, entitlements: [] };
    return (await res.json()) as MeInfo;
  } catch {
    return { user: null, entitlements: [] };
  }
}

async function authPost(path: string, email: string, password: string): Promise<MeInfo> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<MeInfo>;
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return { user: data.user ?? null, entitlements: data.entitlements ?? [] };
}

export function signIn(email: string, password: string): Promise<MeInfo> {
  return authPost("/api/auth/signin", email, password);
}

export function signUp(email: string, password: string): Promise<MeInfo> {
  return authPost("/api/auth/signup", email, password);
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/signout", { method: "POST" });
  } catch {
    /* cookie may already be gone — the reload below resets the UI anyway */
  }
}

// ------------------------------------------------------------- chapters
export interface ChapterResult {
  status: "ok" | "locked" | "unavailable" | "error";
  text: string | null;
}

/**
 * Chapter text comes from the server only — it is never in this bundle.
 * Free chapters return for everyone; paid chapters return only for a
 * signed-in owner ("locked" otherwise). "unavailable" = the chapter exists
 * in the catalog but its manuscript text isn't loaded yet.
 */
export async function fetchChapter(bookId: string, index: number): Promise<ChapterResult> {
  try {
    const res = await fetch(`/api/books/${bookId}/chapters/${index}`);
    if (res.status === 403) return { status: "locked", text: null };
    if (!res.ok) return { status: "error", text: null };
    const data = (await res.json()) as { available: boolean; text: string | null };
    if (!data.available) return { status: "unavailable", text: null };
    return { status: "ok", text: data.text };
  } catch {
    return { status: "error", text: null };
  }
}

// -------------------------------------------------- worksheet progress
/** A reader's in-book worksheet tracking: checked boxes + typed answers. */
export interface WorksheetState {
  checks: Record<string, true>;
  values: Record<string, string>;
}

export const EMPTY_WORKSHEET_STATE: WorksheetState = { checks: {}, values: {} };

function normalizeWorksheetState(raw: unknown): WorksheetState {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { checks: {}, values: {} };
  const obj = raw as { checks?: unknown; values?: unknown };
  const checks: Record<string, true> = {};
  if (obj.checks != null && typeof obj.checks === "object" && !Array.isArray(obj.checks)) {
    for (const [k, v] of Object.entries(obj.checks as Record<string, unknown>)) {
      if (v) checks[k] = true;
    }
  }
  const values: Record<string, string> = {};
  if (obj.values != null && typeof obj.values === "object" && !Array.isArray(obj.values)) {
    for (const [k, v] of Object.entries(obj.values as Record<string, unknown>)) {
      if (typeof v === "string") values[k] = v;
    }
  }
  return { checks, values };
}

/** Owners only (the server 401/403s everyone else); null when the load failed. */
export async function fetchWorksheetState(bookId: string): Promise<WorksheetState | null> {
  try {
    const res = await fetch(`/api/books/${bookId}/worksheet-state`);
    if (!res.ok) return null;
    return normalizeWorksheetState(await res.json());
  } catch {
    return null;
  }
}

/** Returns true when the server stored the state. */
export async function saveWorksheetState(bookId: string, state: WorksheetState): Promise<boolean> {
  try {
    const res = await fetch(`/api/books/${bookId}/worksheet-state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
