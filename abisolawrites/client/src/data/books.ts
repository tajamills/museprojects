// Book catalog + chapter structure, captured from the live site 2026-10-14.
//
// MANUSCRIPT SEAM: every chapter's `text` is a placeholder slot. Layla holds
// the full manuscripts herself — paste each chapter's text into its slot
// (plain text; blank lines separate paragraphs) and the reader renders it
// with no other code changes. Do NOT invent book text.
export const MANUSCRIPT_PLACEHOLDER = "CONTENT FROM MANUSCRIPT — TO BE INSERTED";

export interface Chapter {
  /** Sidebar label, e.g. "Prologue" or "Chapter One". */
  label: string;
  /** Optional captured chapter title (Trust has titles; Doors does not). */
  title?: string;
  free: boolean;
  text: string;
}

export interface Book {
  id: "doors1" | "trust";
  bookPath: string;
  readerPath: string;
  genre: string;
  title: string;
  tagline: string;
  blurb: string;
  chaptersLabel: string;
  wordsLabel: string;
  priceLabel: string;
  priceCents: number;
  chapters: Chapter[];
}

const ch = (label: string, free: boolean, title?: string): Chapter => ({
  label,
  title,
  free,
  text: MANUSCRIPT_PLACEHOLDER,
});

const DOORS_NUMBERS = [
  "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen",
];

export const DOORS: Book = {
  id: "doors1",
  bookPath: "/book/doors",
  readerPath: "/reader/doors1",
  genre: "A Spiritual Mystery · Book One",
  title: "Doors — Book One",
  tagline: "what was never taken",
  blurb:
    "A watched child. A hidden inheritance. A door that opens only for the one it recognizes. Truth, he learns, cannot be stolen — only delayed.",
  chaptersLabel: "18 Chapters",
  wordsLabel: "63k Words",
  priceLabel: "$2.99",
  priceCents: 299,
  chapters: [
    ch("Prologue", true),
    ...DOORS_NUMBERS.map((n) => ch(`Chapter ${n}`, false)),
  ],
};

export const TRUST: Book = {
  id: "trust",
  bookPath: "/book/trust",
  readerPath: "/reader/trust",
  genre: "Personal Finance · Estate & Legacy",
  title: "The Trust I Built Before I Needed It",
  tagline: "build it before you need it",
  blurb:
    "One investor's honest journey from buying assets to protecting them — trusts, jurisdictions, and an actual irrevocable trust built before it was ever needed.",
  chaptersLabel: "10 Chapters",
  wordsLabel: "7k Words",
  priceLabel: "$18.88",
  priceCents: 1888,
  chapters: [
    ch("Chapter One", true, "The Day I Started Planning for Success"),
    ch("Chapter Two", false, "The Day I Realized Wealth Is an Operating System"),
    ch("Chapter Three", false, "Revocable vs. Irrevocable: The First Decision That Changed Everything"),
    ch("Chapter Four", false, "The Rule That Changed Everything"),
    ch("Chapter Five", false, "Why the State You Choose May Matter More Than the Trust You Write"),
    ch("Chapter Six", false, "The Day I Stopped Looking for the Perfect Trust"),
    ch("Chapter Seven", false, "Building My Trust on Paper Before Paying an Attorney"),
    ch("Chapter Eight", false, "The Blueprint Was Never About Me"),
    ch("Chapter Nine", false, "The States Everyone Watches"),
    ch("Chapter Ten", false, "The Trust I Built Before I Needed It"),
  ],
};

export const BOOKS: Book[] = [DOORS, TRUST];

export function bookByReaderId(id: string): Book {
  return id === "trust" ? TRUST : DOORS;
}
