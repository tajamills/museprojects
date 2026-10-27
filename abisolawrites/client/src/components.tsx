import { handleLinkClick } from "./nav";
import { ArrowRightIcon } from "./icons";

// NOTE (Oct 27, 2026): the book UnlockButton was removed entirely. Book
// sales are disabled until the delivery seam (accounts + entitlements)
// exists — the server also refuses book ids at /api/checkout. When
// delivery ships, restore a purchase button here and on the book pages.

export function ReadFreeButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="secondary-button" onClick={(e) => handleLinkClick(e, href)}>
      {label}
      <ArrowRightIcon className="btn-icon" />
    </a>
  );
}

/** Shown when Stripe sends a buyer back. Honest about the accounts seam. */
export function CheckoutBanner({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const state = params.get("checkout");
  if (state === "success") {
    return (
      <div className="notice-banner" role="status">
        Payment confirmed by Stripe — thank you. Library accounts are being reconnected
        during our move; if your chapters don't unlock right away, keep your Stripe
        receipt and we will honor it.
      </div>
    );
  }
  if (state === "cancelled") {
    return (
      <div className="notice-banner" role="status">
        Checkout was cancelled — nothing was charged.
      </div>
    );
  }
  return null;
}
