import { useMemo, useState } from "react";
import { MANUSCRIPT_PLACEHOLDER, type Book } from "../data/books";
import { handleLinkClick } from "../nav";
import { CheckoutBanner, UnlockButton } from "../components";
import { ArrowLeftIcon, ArrowRightIcon, FeatherIcon, LockIcon } from "../icons";

function initialChapter(book: Book, search: string): number {
  const raw = Number(new URLSearchParams(search).get("ch") ?? "0");
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(Math.trunc(raw), 0), book.chapters.length - 1);
}

export function ReaderPage({ book, search }: { book: Book; search: string }) {
  const [index, setIndex] = useState(() => initialChapter(book, search));
  const chapter = book.chapters[index];
  const paragraphs = useMemo(
    () => chapter.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    [chapter.text],
  );
  const isPlaceholder = chapter.text.trim() === MANUSCRIPT_PLACEHOLDER;

  const select = (i: number) => {
    const next = Math.min(Math.max(i, 0), book.chapters.length - 1);
    setIndex(next);
    window.history.pushState({}, "", `${book.readerPath}?ch=${next}`);
    document.querySelector(".reader-main")?.scrollIntoView({ block: "start" });
  };

  return (
    <main className="page reader-page">
      <CheckoutBanner search={search} />
      <p className="crumb">
        <a href={book.bookPath} onClick={(e) => handleLinkClick(e, book.bookPath)}>
          ← {book.title}
        </a>
      </p>

      <div className="reader-layout">
        <aside className="reader-sidebar card" aria-label="Chapters">
          <h2 className="reader-book-title">{book.title}</h2>
          <p className="reader-book-meta">
            {book.chaptersLabel} · {book.priceLabel} one-time unlock
          </p>
          <ol className="reader-chapters">
            {book.chapters.map((c, i) => (
              <li key={c.label}>
                <button
                  type="button"
                  className={`reader-chapter${i === index ? " active" : ""}`}
                  onClick={() => select(i)}
                  aria-current={i === index ? "true" : undefined}
                >
                  <span className="reader-chapter-label">
                    {c.label}
                    {c.title ? <span className="reader-chapter-title">{c.title}</span> : null}
                  </span>
                  {c.free ? (
                    <span className="free-chip">Free</span>
                  ) : (
                    <LockIcon className="lock-icon" />
                  )}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <article className="reader-main card">
          <p className="eyebrow">{chapter.label}</p>
          <h1 className="reader-chapter-heading">{chapter.title ?? chapter.label}</h1>

          {chapter.free ? (
            isPlaceholder ? (
              <div className="manuscript-slot" role="note">
                <FeatherIcon className="manuscript-slot-icon" />
                <p className="manuscript-slot-title">This chapter opens here.</p>
                <p>
                  The full text of {chapter.label} is placed here from the
                  author's manuscript as the library finishes its move.
                </p>
                <p className="manuscript-slot-marker">{MANUSCRIPT_PLACEHOLDER}</p>
              </div>
            ) : (
              <div className="prose">
                {paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            )
          ) : (
            <div className="locked-panel" role="note">
              <LockIcon className="locked-panel-icon" />
              <p className="locked-panel-title">This chapter is locked.</p>
              <p>
                Sign in to unlock — one one-time purchase of {book.priceLabel}{" "}
                opens every chapter of {book.title}, yours to keep, forever.
              </p>
              <div className="cta-row">
                {/* Sign-in is a server seam (Google) — a real link, not a fake state. */}
                <a href="/auth/google" className="secondary-button">
                  Sign in to unlock
                </a>
                <UnlockButton itemId={book.id} label={`Unlock — ${book.priceLabel}`} />
              </div>
            </div>
          )}

          <nav className="reader-nav" aria-label="Chapter navigation">
            <button
              type="button"
              className="quiet-button"
              disabled={index === 0}
              onClick={() => select(index - 1)}
            >
              <ArrowLeftIcon className="btn-icon" /> Previous
            </button>
            <span className="reader-position">
              {index + 1} of {book.chapters.length}
            </span>
            <button
              type="button"
              className="quiet-button"
              disabled={index === book.chapters.length - 1}
              onClick={() => select(index + 1)}
            >
              Next <ArrowRightIcon className="btn-icon" />
            </button>
          </nav>
        </article>
      </div>
    </main>
  );
}
