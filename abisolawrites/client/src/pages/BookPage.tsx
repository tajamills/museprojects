import type { Book } from "../data/books";
import { handleLinkClick } from "../nav";
import { CheckoutBanner, ReadFreeButton, UnlockButton } from "../components";
import { BookOpenIcon, CheckIcon, LockIcon, ScrollIcon } from "../icons";

export function BookPage({ book, search }: { book: Book; search: string }) {
  const freeLabel = book.freeLabel;
  return (
    <main className="page">
      <CheckoutBanner search={search} />
      <section className="book-hero card">
        {book.coverSrc ? (
          <img className="book-hero-cover" src={book.coverSrc} alt={`Cover of ${book.title}`} />
        ) : null}
        <p className="eyebrow">{book.genre}</p>
        <h1 className="page-title">{book.title}</h1>
        <p className="book-tagline large">{book.tagline}</p>
        <p className="lead">{book.blurb}</p>
        <ul className="chip-row">
          <li className="chip">
            <BookOpenIcon className="chip-icon" />
            {book.chaptersLabel}
          </li>
          <li className="chip">
            <ScrollIcon className="chip-icon" />
            {book.wordsLabel}
          </li>
          <li className="chip chip-price">
            {book.priceLabel} <span className="chip-note">One-time · yours to keep</span>
          </li>
        </ul>
        <div className="cta-row">
          <ReadFreeButton href={book.readerPath} label={freeLabel} />
          <UnlockButton itemId={book.id} label={`Unlock the full book — ${book.priceLabel}`} />
        </div>
      </section>

      <section className="card" aria-label="Chapters">
        <h2 className="section-title">What's inside</h2>
        <ol className="chapter-index">
          {book.chapters.map((chapter, i) => (
            <li key={chapter.label}>
              <a
                href={`${book.readerPath}?ch=${i}`}
                className="chapter-index-row"
                onClick={(e) => handleLinkClick(e, `${book.readerPath}?ch=${i}`)}
              >
                <span className="chapter-index-label">
                  {chapter.label}
                  {chapter.title ? <span className="chapter-index-title"> — {chapter.title}</span> : null}
                </span>
                {chapter.free ? (
                  <span className="free-chip">
                    <CheckIcon className="chip-icon" /> Free
                  </span>
                ) : (
                  <span className="locked-chip">
                    <LockIcon className="chip-icon" /> Locked
                  </span>
                )}
              </a>
            </li>
          ))}
        </ol>
        <p className="fine-print">
          Read the opening free. One one-time unlock opens every chapter — no
          subscription, and the book stays yours.
        </p>
      </section>
    </main>
  );
}
