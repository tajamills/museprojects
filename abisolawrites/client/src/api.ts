// Tiny API helpers for the checkout / sign-in seams.
export interface SiteConfig {
  checkoutEnabled: boolean;
  signInEnabled: boolean;
}

let configPromise: Promise<SiteConfig> | null = null;

export function getConfig(): Promise<SiteConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/config")
      .then((r) => (r.ok ? (r.json() as Promise<SiteConfig>) : { checkoutEnabled: false, signInEnabled: false }))
      .catch(() => ({ checkoutEnabled: false, signInEnabled: false }));
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
