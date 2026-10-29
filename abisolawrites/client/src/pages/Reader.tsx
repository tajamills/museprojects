import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Book } from "../data/books";
import { fetchChapter, type ChapterResult } from "../api";
import { useMe } from "../auth";
import { handleLinkClick } from "../nav";
import { CheckoutBanner, UnlockButton } from "../components";
import { ArrowLeftIcon, ArrowRightIcon, FeatherIcon, LockIcon } from "../icons";

/** Render a line with [FILL-IN] markers as visible write-in blanks. */
function renderFill(text: string, keyPrefix: string) {
  const parts = text.split("[FILL-IN]");
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) =>
    i === parts.length - 1
      ? [part]
      : [part, <span key={`${keyPrefix}-${i}`} className="fill-blank" aria-label="fill in" />],
  );
}

/**
 * The Quietly Ready appendix is worksheets, not prose: give its lines real
 * structure — worksheet titles as subheads, ☐ runs as checklist items with
 * the box on its own line start, • runs as bullet lines, [FILL-IN] as blanks.
 */
function renderAppendix(text: string) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, li) => {
      const key = `${bi}-${li}`;
      if (/^(Worksheet|Checklist) [A-Z]\b/.test(line)) {
        out.push(<h3 key={key} className="appendix-head">{line}</h3>);
      } else if (line.includes("☐")) {
        const parts = line.split("☐");
        const lead = parts[0].trim();
        const items = parts.slice(1).map((s) => s.trim()).filter(Boolean);
        if (lead) out.push(<p key={`${key}-lead`} className="appendix-lead">{renderFill(lead, key)}</p>);
        out.push(
          <ul key={key} className="appendix-checklist">
            {items.map((item, ii) => (
              <li key={ii}>{renderFill(item, `${key}-${ii}`)}</li>
            ))}
          </ul>,
        );
      } else if (line.startsWith("•")) {
        out.push(<p key={key} className="appendix-bullet">• {renderFill(line.slice(1).trim(), key)}</p>);
      } else {
        out.push(<p key={key} className="appendix-line">{renderFill(line, key)}</p>);
      }
    });
  });
  return out;
}

function initialChapter(book: Book, search: string): number {
  const raw = Number(new URLSearchParams(search).get("ch") ?? "0");
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(Math.trunc(raw), 0), book.chapters.length - 1);
}

/**
 * The reader. Chapter TEXT is fetched from the server one chapter at a
 * time — it is never part of this bundle. Free chapters come back for
 * everyone; paid chapters come back only for a signed-in account that owns
 * the book (lifetime entitlement). Everyone else gets the locked panel.
 */
export function ReaderPage({ book, search }: { book: Book; search: string }) {
  const [index, setIndex] = useState(() => initialChapter(book, search));
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ChapterResult | null>(null);
  const me = useMe();
  const chapter = book.chapters[index];
  const owned = me?.entitlements.includes(book.id) ?? false;

  useEffect(() => {
    let live = true;
    setResult(null);
    fetchChapter(book.id, index).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
    // Refetch when sign-in state resolves too: a chapter fetched before
    // /api/me returned is still authoritative (the server checks the
    // cookie), but the locked panel copy depends on `me`.
  }, [book.id, index, attempt]);

  const paragraphs = useMemo(
    () => (result?.text ? result.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : []),
    [result],
  );

  const select = (i: number) => {
    const next = Math.min(Math.max(i, 0), book.chapters.length - 1);
    setIndex(next);
    window.history.pushState({}, "", `${book.readerPath}?ch=${next}`);
    document.querySelector(".reader-main")?.scrollIntoView({ block: "start" });
  };

  const signInHref = `/signin?next=${encodeURIComponent(`${book.readerPath}?ch=${index}`)}`;

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
            {book.chapters.map((c, i) => {
              const locked = !c.free && !owned;
              return (
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
                    ) : locked ? (
                      <LockIcon className="lock-icon" />
                    ) : (
                      <span className="free-chip">Yours</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <article className="reader-main card">
          <p className="eyebrow">{chapter.label}</p>
          <h1 className="reader-chapter-heading">{chapter.title ?? chapter.label}</h1>

          {result === null ? (
            <div className="manuscript-slot" role="note">
              <FeatherIcon className="manuscript-slot-icon" />
              <p className="manuscript-slot-title">Opening the chapter…</p>
            </div>
          ) : result.status === "ok" ? (
            <>
              {book.id === "quietlyready" && chapter.label === "Appendix" && owned ? (
                <div className="cta-row worksheets-download">
                  <a className="secondary-button" href="/api/books/quietlyready/worksheets">
                    Download the worksheets (Word)
                  </a>
                </div>
              ) : null}
              {chapter.image ? (
                <figure className="chapter-figure">
                  <img src={chapter.image.src} alt="" loading="lazy" />
                  <figcaption>{chapter.image.caption}</figcaption>
                </figure>
              ) : null}
              {book.id === "quietlyready" && chapter.label === "Appendix" ? (
                <div className="prose appendix-prose">{renderAppendix(result.text)}</div>
              ) : (
                <div className="prose">
                  {paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              )}
            </>
          ) : result.status === "unavailable" ? (
            <div className="manuscript-slot" role="note">
              <FeatherIcon className="manuscript-slot-icon" />
              <p className="manuscript-slot-title">This chapter opens here.</p>
              <p>
                The full text of {chapter.label} is placed here from the
                author's manuscript as the library finishes its move.
              </p>
            </div>
          ) : result.status === "locked" ? (
            <div className="locked-panel" role="note">
              <LockIcon className="locked-panel-icon" />
              <p className="locked-panel-title">This chapter is locked.</p>
              <p>
                Locked chapters open with the full-book unlock of {book.title}{" "}
                ({book.priceLabel}, one-time, yours to keep).{" "}
                {me?.user
                  ? "This account doesn't own this book yet."
                  : "If you already own this book, sign in with the email you paid with and it will open."}
              </p>
              <div className="cta-row">
                <UnlockButton book={book} />
                {me?.user ? null : (
                  <a
                    href={signInHref}
                    className="secondary-button"
                    onClick={(e) => handleLinkClick(e, signInHref)}
                  >
                    Sign in
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="manuscript-slot" role="note">
              <FeatherIcon className="manuscript-slot-icon" />
              <p className="manuscript-slot-title">That chapter didn't load.</p>
              <p>Please try again in a moment.</p>
              <div className="cta-row">
                <button type="button" className="secondary-button" onClick={() => setAttempt((a) => a + 1)}>
                  Retry
                </button>
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
