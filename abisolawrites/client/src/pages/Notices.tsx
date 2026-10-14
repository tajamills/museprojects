import { go, handleLinkClick } from "../nav";
import { ArrowRightIcon, DoorIcon } from "../icons";

export function CheckoutUnavailablePage() {
  return (
    <main className="page">
      <section className="card notice-card">
        <DoorIcon className="notice-icon" />
        <h1 className="page-title">Checkout is being reconnected</h1>
        <p className="lead">
          Abisola Writes just moved to a new home, and payments are being
          reconnected during the move.
        </p>
        <p>
          Nothing was charged. The free opening chapters are open to everyone
          right now — and unlocks, services, and booking will be back shortly.
        </p>
        <div className="cta-row">
          <a href="/" className="primary-button link-button" onClick={(e) => handleLinkClick(e, "/")}>
            Back to the Library
            <ArrowRightIcon className="btn-icon" />
          </a>
          <button type="button" className="quiet-button" onClick={() => go("/reader/doors1")}>
            Read the free Prologue
          </button>
        </div>
      </section>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main className="page">
      <section className="card notice-card">
        <DoorIcon className="notice-icon" />
        <h1 className="page-title">This door doesn't open.</h1>
        <p className="lead">The page you're looking for isn't in this library.</p>
        <div className="cta-row">
          <a href="/" className="primary-button link-button" onClick={(e) => handleLinkClick(e, "/")}>
            Back to the Library
            <ArrowRightIcon className="btn-icon" />
          </a>
        </div>
      </section>
    </main>
  );
}
