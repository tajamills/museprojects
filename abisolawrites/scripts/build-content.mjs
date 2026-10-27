// Splits the author manuscripts into per-chapter plain text and writes
// server/src/content-data.ts — SERVER bundle only. Chapter text must never
// land in the client bundle (Layla's anti-sharing decision, 2026-10-15):
// the server serves free chapters publicly and paid chapters only to
// entitled (signed-in, purchased) accounts.
//
// Sources:
//   Doors          ~/workspace/abisolawrites-rescue/manuscripts/Doors-FINAL-oct27.md
//                  (FINAL edition, Oct 27, 2026: the tightened edition of
//                  the complete manuscript (Doors-complete-oct27.md, 63,021
//                  words: Prologue + Ch 1–17, extracted Oct 27, 2026 from
//                  the docx Layla uploaded, Doors_11_k4nf.docx) with the
//                  edit log's author flags fixed on Layla's ruling — see
//                  Doors-TIGHTENED-oct27-EDITLOG.md, "Flag fixes" section.
//                  Supersedes the raw complete text as the store text.
//                  Every catalog chapter has real text; nothing ships as
//                  "unavailable".)
//   Trust          ~/workspace/abisolawrites-rescue/manuscripts/Trust.md
//                  (extracted Oct 27, 2026 from the docx Layla uploaded,
//                  "The-Trust-I-Built-Before-I-Needed-It": all 10 chapters,
//                  ~7.1k words.)
//   Quietly Ready  ~/workspace/goals/30-day-household-preparedness-build/files/survival-guide-draft.md
//
// Chapter order/labels/free flags mirror client/src/data/books.ts exactly.
// Run: node scripts/build-content.mjs  (re-run whenever a manuscript changes)
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = process.env.HOME ?? "/home/hatch";

/** Split a markdown doc into [{heading, body}] on `## ` lines. */
function splitSections(md) {
  const sections = [];
  let current = null;
  for (const line of md.split("\n")) {
    const m = line.match(/^##\s+(.*\S)\s*$/);
    if (m) {
      current = { heading: m[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

/** Markdown body -> reader plain text (blank line = new paragraph). */
function cleanText(lines) {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(para.join(" "));
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t || t === "---" || t === "***") { flush(); continue; }
    if (/^!\[.*\]\(.*\)$/.test(t)) continue; // images: files are not hosted
    const sub = t.match(/^#{3,6}\s+(.*)$/); // ### subheading -> own paragraph
    if (sub) { flush(); out.push(stripMarks(sub[1])); continue; }
    const bullet = t.match(/^[-*]\s+(.*)$/);
    if (bullet) { flush(); out.push("• " + stripMarks(bullet[1])); continue; }
    const numbered = t.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) { flush(); out.push(stripMarks(t)); continue; }
    para.push(stripMarks(t));
  }
  flush();
  return out.join("\n\n");
}

function stripMarks(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

function sectionMap(md) {
  const map = new Map();
  for (const s of splitSections(md)) map.set(s.heading.toLowerCase(), cleanText(s.lines));
  return map;
}

function findSection(map, predicate, what) {
  for (const [heading, text] of map) if (predicate(heading)) return text;
  throw new Error(`section not found: ${what}`);
}

const NUM = ["One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
  "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen"];
const ROMAN = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
  nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15,
  sixteen:16, seventeen:17 };

async function buildDoors() {
  const md = await readFile(path.join(HOME, "workspace/abisolawrites-rescue/manuscripts/Doors-FINAL-oct27.md"), "utf8");
  const map = sectionMap(md);
  // Access model (Layla, Oct 27, 2026): Prologue AND Chapter One free,
  // Chapters Two..Seventeen paid (mirrors client/src/data/books.ts). The
  // complete manuscript holds all 18 units — every chapter resolves to
  // real text via findSection, which throws if a section is missing, so
  // a partial file fails the build.
  const chapters = [{ label: "Prologue", free: true, text: findSection(map, (h) => h === "prologue", "Doors Prologue") }];
  NUM.forEach((name, i) => {
    const text = findSection(map, (h) => h === `chapter ${name.toLowerCase()}`, `Doors Chapter ${name}`);
    chapters.push({ label: `Chapter ${name}`, free: i === 0, text });
  });
  return chapters;
}

async function buildQuietlyReady() {
  const md = await readFile(path.join(HOME, "workspace/goals/30-day-household-preparedness-build/files/survival-guide-draft.md"), "utf8");
  const map = sectionMap(md);
  const chapters = [
    { label: "A Note Before We Start", free: true, text: findSection(map, (h) => h.startsWith("a note before we start"), "QR note") },
    { label: "Introduction", title: "Why I Prep", free: true, text: findSection(map, (h) => h.startsWith("introduction"), "QR intro") },
  ];
  const titles = {
    1: "The staging system — layers, not a haul", 2: "How to buy it — let the sales cycle do the saving",
    3: "Water — the honest math", 4: "Food — the dry core",
    5: "The canned layer, the fats, and the small things", 6: "Cooking without power",
    7: "The animals", 8: "Hygiene and the sickness layer",
    9: "The medical layer — staged, and handled with your doctor",
    10: "Power and communications — the works-without-it principle",
    11: "Documents and money readiness", 12: "Low profile — the quiet rule",
    13: "The go-bag, and staying put vs. leaving", 14: "Keeping it alive — rotation and the monthly rhythm",
  };
  for (let n = 1; n <= 14; n++) {
    const text = findSection(map, (h) => h.startsWith(`chapter ${n}:`) || h.startsWith(`chapter ${n} `), `QR Chapter ${n}`);
    chapters.push({ label: `Chapter ${NUM[n - 1]}`, title: titles[n], free: false, text });
  }
  chapters.push({ label: "Appendix", title: "Worksheets and Checklists", free: false, text: findSection(map, (h) => h.startsWith("appendix"), "QR appendix") });
  return chapters;
}

async function buildTrust() {
  const md = await readFile(path.join(HOME, "workspace/abisolawrites-rescue/manuscripts/Trust.md"), "utf8");
  const map = sectionMap(md);
  // Chapter titles mirror books.ts exactly; headings in the source are
  // "Chapter One — <title>". Split: Chapter One free, the rest paid.
  const titles = [
    "The Day I Started Planning for Success", "The Day I Realized Wealth Is an Operating System",
    "Revocable vs. Irrevocable: The First Decision That Changed Everything", "The Rule That Changed Everything",
    "Why the State You Choose May Matter More Than the Trust You Write", "The Day I Stopped Looking for the Perfect Trust",
    "Building My Trust on Paper Before Paying an Attorney", "The Blueprint Was Never About Me",
    "The States Everyone Watches", "The Trust I Built Before I Needed It",
  ];
  return titles.map((title, i) => ({
    label: `Chapter ${NUM[i]}`,
    title,
    free: i === 0,
    text: findSection(map, (h) => h.startsWith(`chapter ${NUM[i].toLowerCase()} —`), `Trust Chapter ${NUM[i]}`),
  }));
}

const content = {
  doors1: { chapters: await buildDoors() },
  trust: { chapters: await buildTrust() },
  quietlyready: { chapters: await buildQuietlyReady() },
};

for (const [id, book] of Object.entries(content)) {
  const withText = book.chapters.filter((c) => c.text).length;
  const words = book.chapters.reduce((a, c) => a + (c.text ? c.text.split(/\s+/).length : 0), 0);
  console.log(`[content] ${id}: ${book.chapters.length} chapters, ${withText} with text, ~${words} words`);
}

const out = `// GENERATED by scripts/build-content.mjs — do not edit by hand.
// Server-bundle-only chapter text (never imported by the client).
export interface ChapterContent { label: string; title?: string; free: boolean; text: string | null }
export const CONTENT: Record<string, { chapters: ChapterContent[] }> = ${JSON.stringify(content, null, 1)};
`;
await writeFile(path.join(root, "server/src/content-data.ts"), out);
console.log("[content] wrote server/src/content-data.ts");
