import { useEffect, useState } from "react";
import { DOORS, QUIETLY_READY, TRUST } from "./data/books";
import { handleLinkClick, useLocation } from "./nav";
import { DoorIcon, MoonIcon, SunIcon } from "./icons";
import { HomePage } from "./pages/Home";
import { BookPage } from "./pages/BookPage";
import { ReaderPage } from "./pages/Reader";
import { SignInPage } from "./pages/SignIn";
import { signOut } from "./api";
import { useMe } from "./auth";
import { ServicesPage } from "./pages/Services";
import { ResumePage } from "./pages/Resume";
import { MusicPage } from "./pages/Music";
import { BookingPage } from "./pages/Booking";
import { CheckoutUnavailablePage, NotFoundPage } from "./pages/Notices";

const NAV = [
  { href: "/", label: "Library" },
  { href: "/services", label: "Services" },
  { href: "/resume", label: "Resume" },
  { href: "/music", label: "Music" },
  { href: "/booking", label: "Book 1:1" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute("data-theme") ?? "light",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("abisolawrites-theme", theme);
    } catch {
      /* storage unavailable — theme still applies for this visit */
    }
  }, [theme]);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <SunIcon className="toggle-icon" /> : <MoonIcon className="toggle-icon" />}
    </button>
  );
}

function Header({ pathname }: { pathname: string }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <a href="/" className="brand" onClick={(e) => handleLinkClick(e, "/")}>
          <span className="brand-mark" aria-hidden="true">
            <DoorIcon className="brand-icon" />
          </span>
          <span className="brand-text">
            Abisola Writes
            <span className="brand-sub">The Library</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : undefined}
              aria-current={pathname === item.href ? "page" : undefined}
              onClick={(e) => handleLinkClick(e, item.href)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <HeaderAccount />
        </div>
      </div>
    </header>
  );
}

function HeaderAccount() {
  const me = useMe();
  if (me === undefined) return null; // still loading — render nothing yet
  if (!me.user) {
    return (
      <>
        <a
          href="/signin?mode=signup"
          className="primary-button signin-button"
          onClick={(e) => handleLinkClick(e, "/signin?mode=signup")}
        >
          Create account
        </a>
        <a href="/signin" className="secondary-button signin-button" onClick={(e) => handleLinkClick(e, "/signin")}>
          Sign in
        </a>
      </>
    );
  }
  return (
    <>
      <span className="header-email" title={me.user.email}>
        {me.user.email}
      </span>
      <button
        type="button"
        className="secondary-button signin-button"
        onClick={() => {
          void signOut().then(() => window.location.assign("/"));
        }}
      >
        Sign out
      </button>
    </>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="brand-mark small" aria-hidden="true">
            <DoorIcon className="brand-icon" />
          </span>
          <div>
            <p className="footer-name">The Abisola Writes Library</p>
            <p className="footer-line">Three books. One threshold. Yours to keep, forever.</p>
          </div>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={(e) => handleLinkClick(e, item.href)}>
              {item.label}
            </a>
          ))}
          <a href="https://www.youtube.com/@abisolawrites" target="_blank" rel="noreferrer">
            YouTube
          </a>
        </nav>
        <p className="footer-copy">© {year} Abisola Writes</p>
      </div>
    </footer>
  );
}

export function App() {
  const { pathname, search } = useLocation();
  const clean = pathname.replace(/\/+$/, "") || "/";

  let page: React.ReactNode;
  switch (clean) {
    case "/":
      page = <HomePage />;
      break;
    case "/book/doors":
      page = <BookPage book={DOORS} search={search} />;
      break;
    case "/book/trust":
      page = <BookPage book={TRUST} search={search} />;
      break;
    case "/book/quietly-ready":
      page = <BookPage book={QUIETLY_READY} search={search} />;
      break;
    case "/reader/doors1":
      page = <ReaderPage book={DOORS} search={search} />;
      break;
    case "/reader/trust":
      page = <ReaderPage book={TRUST} search={search} />;
      break;
    case "/reader/quietlyready":
      page = <ReaderPage book={QUIETLY_READY} search={search} />;
      break;
    case "/services":
      page = <ServicesPage search={search} />;
      break;
    case "/resume":
      page = <ResumePage />;
      break;
    case "/music":
      page = <MusicPage />;
      break;
    case "/booking":
      page = <BookingPage search={search} />;
      break;
    case "/signin":
      page = <SignInPage search={search} />;
      break;
    case "/checkout-unavailable":
      page = <CheckoutUnavailablePage />;
      break;
    default:
      page = <NotFoundPage />;
  }

  return (
    <div className="shell">
      <Header pathname={clean} />
      {page}
      <Footer />
    </div>
  );
}
