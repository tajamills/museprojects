// Server-side purchasable catalog. Amounts live ONLY here (never trusted
// from the client) and mirror the prices captured from the live site on
// 2026-10-14. `returnPath` is where Stripe sends the buyer back to.
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  amountCents: number;
  returnPath: string;
}

// Book sales are DISABLED (Layla's ruling, Oct 27, 2026): a buyer who paid
// could not read what they bought. The delivery seam (accounts +
// entitlements + server-served chapters) was built Oct 27, 2026 — but book
// checkout stays OFF until a separate real test purchase passes end-to-end.
//
// >>> THE SINGLE RE-ENABLE FLIP: set BOOK_CHECKOUT_ENABLED to true. <<<
// That one change makes /api/checkout create Stripe sessions for books
// (signed-in buyers only, entitlement granted by the Stripe webhook) and
// /api/config tell the client to render the unlock buttons again.
export const BOOK_CHECKOUT_ENABLED = false;

export const BOOK_ITEM_IDS: ReadonlySet<string> = new Set([
  "doors1",
  "trust",
  "quietlyready",
]);

// 1-to-1 booking checkout is DISABLED (audit finding, Oct 27, 2026): the
// $48.88 payment delivered nothing — no booking record, no confirmation,
// no session link, and slots could be double-sold. /api/checkout refuses
// this id server-side and the booking page shows availability with no pay
// path. Re-enable only with the separate booking-delivery build (records,
// confirmation email, slot inventory).
export const BOOKING_ITEM_IDS: ReadonlySet<string> = new Set([
  "booking-1to1",
]);

export const CATALOG: Record<string, CatalogItem> = {
  doors1: {
    id: "doors1",
    name: "Doors — Book One (full unlock)",
    description: "All 18 chapters, yours to keep, forever.",
    amountCents: 299,
    returnPath: "/reader/doors1",
  },
  trust: {
    id: "trust",
    name: "The Trust I Built Before I Needed It (full unlock)",
    description: "All 10 chapters, yours to keep, forever.",
    amountCents: 1888,
    returnPath: "/reader/trust",
  },
  quietlyready: {
    id: "quietlyready",
    name: "Quietly Ready (full unlock)",
    description: "All 14 chapters plus the appendix worksheets, yours to keep, forever.",
    amountCents: 1888,
    returnPath: "/reader/quietlyready",
  },
  "service-strategy": {
    id: "service-strategy",
    name: "Strategy Session",
    description: "30-minute 1:1 video session with Abisola.",
    amountCents: 1818,
    returnPath: "/services",
  },
  "service-manuscript": {
    id: "service-manuscript",
    name: "Manuscript Review",
    description: "Full manuscript read with written editorial notes.",
    amountCents: 5555,
    returnPath: "/services",
  },
  "service-ghostwriting": {
    id: "service-ghostwriting",
    name: "Ghostwriting (Limited)",
    description: "Ghostwriting engagement with Abisola.",
    amountCents: 14444,
    returnPath: "/services",
  },
  "booking-1to1": {
    id: "booking-1to1",
    name: "Book a 1-to-1 with Abisola",
    description: "30-minute 1:1 session.",
    amountCents: 4888,
    returnPath: "/booking",
  },
};
