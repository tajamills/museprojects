import { SERVICES, type Service } from "../data/site";
import { CheckoutBanner } from "../components";
import { CheckIcon, FeatherIcon, ScrollIcon, SparklesIcon } from "../icons";

const SERVICE_ICONS: Record<string, typeof SparklesIcon> = {
  "service-strategy": SparklesIcon,
  "service-manuscript": ScrollIcon,
  "service-ghostwriting": FeatherIcon,
};

function ServiceCard({ service }: { service: Service }) {
  const Icon = SERVICE_ICONS[service.id] ?? SparklesIcon;
  const gated = Boolean(service.gateLabel);
  return (
    <article className="service-card card">
      <Icon className="service-icon" />
      <h2 className="service-name">{service.name}</h2>
      <p className="service-price">
        {service.priceLabel} <span className="chip-note">one-time</span>
      </p>
      <p className="service-blurb">{service.blurb}</p>
      <ul className="includes-list">
        {service.includes.map((item) => (
          <li key={item}>
            <CheckIcon className="includes-icon" />
            {item}
          </li>
        ))}
      </ul>
      {gated ? (
        <>
          <button type="button" className="primary-button wide" disabled>
            {service.gateLabel}
          </button>
          <p className="fine-print">{service.gateNote}</p>
        </>
      ) : (
        <>
          {/* Booking is sign-in-gated on the live site; sign-in is a seam. */}
          <a href="/auth/google" className="primary-button wide link-button">
            Sign in to book
          </a>
          <p className="fine-print">1:1 · private · recorded</p>
        </>
      )}
    </article>
  );
}

export function ServicesPage({ search }: { search: string }) {
  return (
    <main className="page">
      <CheckoutBanner search={search} />
      <section className="page-head">
        <h1 className="page-title">Choose your kind of magic.</h1>
        <p className="lead">
          Every offering is 1:1, private, and recorded — working directly with
          Abisola, never handed off.
        </p>
      </section>
      <div className="service-grid">
        {SERVICES.map((s) => (
          <ServiceCard key={s.id} service={s} />
        ))}
      </div>
    </main>
  );
}
