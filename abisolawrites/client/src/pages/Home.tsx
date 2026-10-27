import { BOOKS, type Book } from "../data/books";
import { handleLinkClick } from "../nav";
import { ReadFreeButton, UnlockButton } from "../components";
import {
  BookOpenIcon,
  CalendarIcon,
  DoorIcon,
  MusicIcon,
  ScrollIcon,
  ShieldIcon,
  SparklesIcon,
} from "../icons";

function BookCard({ book }: { book: Book }) {
  const CoverIcon = book.id === "doors1" ? DoorIcon : ShieldIcon;
  const freeLabel =
    book.id === "doors1"
      ? "Read the Prologue free"
      : book.id === "trust"
        ? "Read Chapter One free"
        : book.freeLabel;
  return (
    <article className="book-card">
      {book.coverSrc ? (
        <div className="book-cover book-cover-photo" aria-hidden="true">
          <img className="book-cover-img" src={book.coverSrc} alt="" />
        </div>
      ) : (
        <div className="book-cover" aria-hidden="true">
          <CoverIcon className="book-cover-icon" />
        </div>
      )}
      <div className="book-card-body">
        <p className="eyebrow">{book.genre}</p>
        <h2 className="book-title">
          <a href={book.bookPath} onClick={(e) => handleLinkClick(e, book.bookPath)}>
            {book.title}
          </a>
        </h2>
        <p className="book-tagline">{book.tagline}</p>
        <p className="book-blurb">{book.blurb}</p>
        <ul className="chip-row" aria-label="Book details">
          <li className="chip">
            <BookOpenIcon className="chip-icon" />
            {book.chaptersLabel}
          </li>
          <li className="chip">
            <ScrollIcon className="chip-icon" />
            {book.wordsLabel}
          </li>
          <li className="chip chip-price">
            {book.priceLabel} <span className="chip-note">One-time</span>
          </li>
        </ul>
        <div className="cta-row">
          <ReadFreeButton href={book.readerPath} label={freeLabel} />
          <UnlockButton itemId={book.id} label={`Unlock — ${book.priceLabel}`} />
        </div>
      </div>
    </article>
  );
}

const MORE = [
  {
    href: "/services",
    icon: SparklesIcon,
    title: "Services",
    line: "Strategy, manuscript review, and ghostwriting — 1:1 with Abisola.",
    meta: "From $18.18",
  },
  {
    href: "/resume",
    icon: ScrollIcon,
    title: "AI Resume Writer",
    line: "Get hired with an AI-written resume.",
    meta: "Download",
  },
  {
    href: "/music",
    icon: MusicIcon,
    title: "Music",
    line: "Songs from the Abisola Writes channel.",
    meta: "8 tracks",
  },
  {
    href: "/booking",
    icon: CalendarIcon,
    title: "Book 1:1",
    line: "A 30-minute 1-to-1 with Abisola, weekdays 9 AM–2 PM EDT.",
    meta: "$48.88",
  },
];

export function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <p className="hero-badge">The Abisola Writes Library</p>
        <h1 className="hero-title">The doors remember you.</h1>
        <p className="hero-sub">Three books. One threshold.</p>
        <p className="hero-copy">
          A spiritual mystery, a personal blueprint for lasting wealth, and a calm,
          staged guide to household preparedness. Read the opening of each for free —
          unlock the rest whenever you're ready. Yours to keep, forever.
        </p>
      </section>

      <section className="book-grid" aria-label="Books">
        {BOOKS.map((b) => (
          <BookCard key={b.id} book={b} />
        ))}
      </section>

      <blockquote className="pull-quote">
        <p>“Truth cannot be stolen. It can only be delayed.”</p>
        <cite>— from Doors, Book One</cite>
      </blockquote>

      <section aria-label="More from Abisola Writes">
        <h2 className="section-title">More from Abisola Writes</h2>
        <div className="more-grid">
          {MORE.map((m) => (
            <a
              key={m.href}
              href={m.href}
              className="more-card"
              onClick={(e) => handleLinkClick(e, m.href)}
            >
              <m.icon className="more-icon" />
              <span className="more-title">{m.title}</span>
              <span className="more-line">{m.line}</span>
              <span className="more-meta">{m.meta}</span>
            </a>
          ))}
        </div>
      </section>

    </main>
  );
}
