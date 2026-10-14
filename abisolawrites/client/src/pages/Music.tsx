import { CHANNEL_URL, TRACKS } from "../data/site";
import { MusicIcon } from "../icons";

export function MusicPage() {
  return (
    <main className="page">
      <section className="page-head">
        <h1 className="page-title">Music</h1>
        <p className="lead">
          Songs from Abisola Writes — the same voice behind the books.
        </p>
        <div className="cta-row">
          <a
            href={CHANNEL_URL}
            target="_blank"
            rel="noreferrer"
            className="secondary-button link-button"
          >
            <MusicIcon className="btn-icon" />
            youtube.com/@abisolawrites
          </a>
        </div>
      </section>

      <div className="track-grid">
        {TRACKS.map((track) => (
          <article key={track.youtubeId} className="track-card card">
            <div className="track-frame">
              <iframe
                src={`https://www.youtube.com/embed/${track.youtubeId}`}
                title={track.title}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            <h2 className="track-title">{track.title}</h2>
          </article>
        ))}
      </div>
    </main>
  );
}
