// The holding page shown on every route while SITE_HIDDEN is true
// (see site.ts). Exact content by owner order: the name and one line.
// No marketing copy, no forms, no links.
export function HoldingPage() {
  return (
    <main className="holding-page">
      <div className="holding-inner">
        <h1 className="holding-name">Zepostia</h1>
        <p className="holding-line">Not open yet.</p>
      </div>
    </main>
  );
}
