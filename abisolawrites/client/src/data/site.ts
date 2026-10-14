// Services, music, and booking content captured from the live site 2026-10-14.

export interface Service {
  id: string;
  name: string;
  priceLabel: string;
  priceCents: number;
  blurb: string;
  includes: string[];
  /** When set, the CTA is disabled with this label (live-site gating). */
  gateLabel?: string;
  gateNote?: string;
}

export const SERVICES: Service[] = [
  {
    id: "service-strategy",
    name: "Strategy Session",
    priceLabel: "$18.18",
    priceCents: 1818,
    blurb: "A focused 1:1 to map your next move.",
    includes: [
      "30-minute 1:1 video session",
      "Session recording",
      "Resource pack",
      "Follow-up email",
    ],
  },
  {
    id: "service-manuscript",
    name: "Manuscript Review",
    priceLabel: "$55.55",
    priceCents: 5555,
    blurb: "A full read of your manuscript, with a plan for what comes next.",
    includes: [
      "Full manuscript read",
      "Written editorial notes",
      "45-minute follow-up call",
      "Revision roadmap",
    ],
  },
  {
    id: "service-ghostwriting",
    name: "Ghostwriting (Limited)",
    priceLabel: "$144.44",
    priceCents: 14444,
    blurb: "Your story, written in your voice.",
    includes: [
      "Written in your voice",
      "Multiple drafts",
      "You own the final work",
      "Confidential",
    ],
    gateLabel: "Requires Amazon Book Setup",
    gateNote:
      "Ghostwriting opens once the one-time Amazon Book Setup is complete. It isn't sold on its own from this page.",
  },
];

export interface Track {
  title: string;
  youtubeId: string;
}

export const TRACKS: Track[] = [
  { title: "Burn It to the Ground", youtubeId: "oo70gS8eIOc" },
  { title: "Yebo", youtubeId: "ci0NuwK8TWk" },
  { title: "Rudy", youtubeId: "qaT5hwmfNvI" },
  { title: "We Outside", youtubeId: "65jevJnRB5E" },
  { title: "You're Jealous", youtubeId: "mTNhSjak_Vk" },
  { title: "Creator", youtubeId: "6guxTxHE5rU" },
  { title: "I Love You, Baby", youtubeId: "qVW1OvHkzXk" },
  { title: "Listen to the full track", youtubeId: "QOfkG6SmfeE" },
];

export const CHANNEL_URL = "https://www.youtube.com/@abisolawrites";

export const BOOKING = {
  itemId: "booking-1to1",
  priceLabel: "$48.88",
  priceCents: 4888,
  durationLabel: "30 minutes",
  timezoneLabel: "Eastern Time (EDT)",
  // 30-minute starts from 9:00 AM through 1:30 PM, weekdays only.
  slots: [
    "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
    "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM",
  ],
};
