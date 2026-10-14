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
