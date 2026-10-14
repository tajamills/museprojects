import { useState } from "react";
import { startCheckout } from "./api";
import { go, handleLinkClick } from "./nav";
import { ArrowRightIcon, KeyIcon } from "./icons";

/**
 * Purchase button wired to the Stripe seam. If checkout isn't connected,
 * the reader lands on the honest "being reconnected" notice — never a
 * fake success.
 */
export function UnlockButton({
  itemId,
  label,
  className = "primary-button",
}: {
  itemId: string;
  label: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await startCheckout(itemId);
        if (result === "unavailable") {
          setBusy(false);
          go("/checkout-unavailable");
        }
      }}
    >
      <KeyIcon className="btn-icon" />
      {busy ? "Opening checkout…" : label}
    </button>
  );
}

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
