import { useEffect, useState } from "react";
import type { Book } from "./data/books";
import { getConfig, startCheckout } from "./api";
import { useMe } from "./auth";
import { go, handleLinkClick } from "./nav";
import { ArrowRightIcon } from "./icons";

export function ReadFreeButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="secondary-button" onClick={(e) => handleLinkClick(e, href)}>
      {label}
      <ArrowRightIcon className="btn-icon" />
    </a>
  );
}

/**
 * Full-book unlock button. Renders ONLY when the server says book checkout
 * is enabled (/api/config -> bookCheckoutEnabled, driven by
 * BOOK_CHECKOUT_ENABLED in server/src/catalog.ts). While book sales are
 * paused it renders nothing — no dead buttons, no fake purchase paths.
 * Signed-out visitors are sent to sign in first, because the purchase is
 * tied to their account before payment so the unlock lands on them.
 */
export function UnlockButton({ book }: { book: Book }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = useMe();

  useEffect(() => {
    let live = true;
    getConfig().then((c) => {
      if (live) setEnabled(c.bookCheckoutEnabled);
    });
    return () => {
      live = false;
    };
  }, []);

  // Also wait for the identity read: rendering (or acting) as signed
  // out while /api/me is in flight is how owners got sent to sign in.
  if (!enabled || me === undefined) return null;

  const click = async () => {
    if (!me?.user) {
      go(`/signin?next=${encodeURIComponent(book.readerPath)}`);
      return;
    }
    setBusy(true);
    const result = await startCheckout(book.id);
    if (result === "unavailable") {
      setBusy(false);
      go("/checkout-unavailable");
    }
  };

  return (
    <button type="button" className="primary-button" disabled={busy} onClick={() => void click()}>
      {busy ? "Opening checkout…" : `Unlock the full book — ${book.priceLabel}`}
    </button>
  );
}

/** Shown when Stripe sends a buyer back. */
export function CheckoutBanner({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const state = params.get("checkout");
  if (state === "success") {
    return (
      <div className="notice-banner" role="status">
        Payment confirmed by Stripe — thank you. If you bought a book, sign in
        with the email you used at checkout and your chapters will be open in
        the reader — yours to keep, forever.
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
