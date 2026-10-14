import { useState } from "react";
import { DownloadIcon, FeatherIcon, ScrollIcon, ShieldIcon } from "../icons";

// The Resume page is a product page for the AI Resume Writer (not a CV).
// Captured copy: headline + CTA. Supporting lines below are minimal page
// scaffolding — the download itself is reconnected after the move.
export function ResumePage() {
  const [notice, setNotice] = useState(false);
  return (
    <main className="page">
      <section className="page-head centered">
        <p className="hero-badge">AI Resume Writer</p>
        <h1 className="page-title">Get hired with an AI-written resume.</h1>
        <p className="lead">
          The AI Resume Writer by Abisola Writes turns your experience into a
          polished, ready-to-send resume — written to sound like you, at your best.
        </p>
        <div className="cta-row centered-row">
          <button
            type="button"
            className="primary-button"
            onClick={() => setNotice(true)}
          >
            <DownloadIcon className="btn-icon" />
            Download the AI Resume Writer
          </button>
        </div>
        {notice ? (
          <div className="notice-banner" role="status">
            The download is being reconnected during our move to a new home —
            please check back shortly. Nothing was charged.
          </div>
        ) : null}
      </section>

      <div className="feature-grid">
        <article className="feature-card card">
          <FeatherIcon className="feature-icon" />
          <h2>Written in your voice</h2>
          <p>Your experience, your words — sharpened, not replaced.</p>
        </article>
        <article className="feature-card card">
          <ScrollIcon className="feature-icon" />
          <h2>Polished &amp; ready to send</h2>
          <p>A clean, professional resume you can send with confidence.</p>
        </article>
        <article className="feature-card card">
          <ShieldIcon className="feature-icon" />
          <h2>Yours to keep</h2>
          <p>Download it once and reuse it for every application.</p>
        </article>
      </div>
    </main>
  );
}
